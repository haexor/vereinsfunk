import {
  AvailableChannelsResponseSchema,
  ChannelPolicySchema,
  ChannelScopeAssignmentSchema,
  CreateChannelScopeRequestSchema,
  CreateWebsiteChannelRequestSchema,
  SocialConnectionSchema,
  UpdateSocialConnectionRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { resolveAvailableChannels } from '@vereinsfunk/domain'
import { isAllowedOutboundUrl } from '@vereinsfunk/outbound-fetch'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapChannelScopeRow, mapSocialConnectionRow } from '../apiMappers.js'
import { byteaToBuffer, createSecretBoxFromEnvironment } from '../secretBox.js'
import type { ApiRouteContext } from './context.js'
import { channelOwnerScope, createAuditRecorder, isAnyMemberOfOrganization, isDepartmentOwnedChannelAllowed, resolveMembershipScope, SOCIAL_CONNECTION_COLUMNS, toChannelCandidates, toPermissionScope } from './shared.js'

// Kanonisiert die Adresse vor dem Schreiben: new URL(...).toString() normalisiert Schema und Host
// bereits auf Kleinschreibung und serialisiert einen leeren Pfad immer als "/" -- https://Example.org
// und https://example.org/ ergeben so denselben gespeicherten Wert. Ohne das umginge der zweite
// Schreibvorgang den Unique-Index unten unbemerkt.
//
// Der Fragmentbezeichner faellt weg: er wird nie an den Server geschickt, "https://verein.de/blog"
// und "https://verein.de/blog#oben" sind fuer jeden Abruf dieselbe Seite und duerfen keine zwei
// Kanaele ergeben (Review dieses PRs). Query und "www." bleiben absichtlich stehen -- beide koennen
// auf eine andere Seite zeigen, die duerfen wir nicht raten.
function canonicalizeWebsiteUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  url.hash = ''
  return url.toString()
}

// Zugangsdaten in der Adresse (https://benutzer:geheim@verein.de) ueberleben die Kanonisierung und
// landen sonst in social_connections.website_url -- einer Spalte, die JEDES Vereinsmitglied lesen
// darf (grant select in 2026081310) -- und zusaetzlich im Klartext in audit_events.metadata.
// Zurueckweisen statt still entfernen: wer sie mitschickt, meint sie, und ein stilles Abschneiden
// speicherte eine Adresse, die der Verein so nie eingegeben hat (Review dieses PRs).
function hasEmbeddedCredentials(rawUrl: string): boolean {
  const url = new URL(rawUrl)
  return url.username !== '' || url.password !== ''
}

export function registerChannelRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, environment, getMetaOAuthClient } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // Plan 039: die erste Kanal-Anlage ohne OAuth. Instagram/Facebook entstehen weiterhin
  // ausschliesslich ueber den OAuth-Callback (channelOAuth.ts) -- sonst liesse sich ein Kanal ohne
  // gueltiges Token anlegen, und die Veroeffentlichung liefe spaeter ins Leere.
  app.post('/v1/channels', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateWebsiteChannelRequestSchema.parse(request.body)
    if (input.platform !== 'website') return reply.code(422).send({ error: 'platform_requires_oauth', correlationId: request.id })
    const scope = toPermissionScope(input.organizationId, input.ownerScope === 'department' ? input.ownerDepartmentId : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (input.ownerScope === 'department' && !(await isDepartmentOwnedChannelAllowed(client, input.organizationId))) {
      return reply.code(403).send({ error: 'department_owned_channels_not_allowed', correlationId: request.id })
    }
    // Dieselbe SSRF-Regel wie jede andere vom Verein hinterlegte Adresse (Plan 034): das
    // Folgepaket zur Auslieferung ruft diese Adresse serverseitig ab, eine hier ungeprueft
    // gespeicherte Adresse waere seine Luecke.
    if (!isAllowedOutboundUrl(input.websiteUrl) || hasEmbeddedCredentials(input.websiteUrl)) {
      return reply.code(400).send({ error: 'website_url_not_allowed', correlationId: request.id })
    }
    const websiteUrl = canonicalizeWebsiteUrl(input.websiteUrl)
    const service = supabaseClients.forService()
    const insert = await service
      .from('social_connections')
      .insert({
        organization_id: input.organizationId, platform: 'website', website_url: websiteUrl, display_name: input.displayName,
        status: 'active', owner_scope: input.ownerScope, owner_department_id: input.ownerDepartmentId,
        max_characters: input.maxCharacters ?? null,
      })
      .select(SOCIAL_CONNECTION_COLUMNS)
      .single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'website_url_already_connected', correlationId: request.id })
      if (insert.error.code === '23503') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw insert.error
    }
    // Eigene Ebene bekommt automatisch eine Freigabe, wie beim OAuth-Connect (Plan 012: "beim
    // Verbinden legt die API automatisch einen Eintrag fuer die eigene Ebene an").
    const defaultScope = await service.from('channel_scopes').insert({
      organization_id: input.organizationId, social_connection_id: insert.data.id, scope: input.ownerScope,
      department_id: input.ownerDepartmentId, team_id: null, can_schedule: true, created_by: request.auth!.userId,
    })
    // Kanal ohne Freigabe zuruecknehmen, statt ihn stehen zu lassen (dasselbe Muster wie beim
    // OAuth-Connect, channelOAuth.ts): resolveAvailableChannels sieht eine Verbindung ohne
    // channel_scopes-Zeile nie, der Verein haette also einen unbenutzbaren Kanal -- und weil der
    // Unique-Index auf der Adresse greift, antwortet jeder Wiederholungsversuch dauerhaft mit 409
    // (Review dieses PRs).
    if (defaultScope.error) {
      const rollback = await service.from('social_connections').delete().eq('id', insert.data.id)
      if (rollback.error) request.log.error({ err: rollback.error, correlationId: request.id }, 'website channel rollback failed')
      throw defaultScope.error
    }
    await recordAuditEvent(request, {
      organizationId: input.organizationId, action: 'channel.connected', entityType: 'social_connections', entityId: insert.data.id as string,
      metadata: { platform: 'website', ownerScope: input.ownerScope, websiteUrl },
    })
    const scopesResult = await service.from('channel_scopes').select('id, scope, department_id, team_id, can_schedule').eq('social_connection_id', insert.data.id)
    if (scopesResult.error) throw scopesResult.error
    return reply.code(201).send(
      SocialConnectionSchema.parse({
        ...mapSocialConnectionRow(insert.data),
        scopes: scopesResult.data.map((scopeRow) => mapChannelScopeRow(scopeRow, input.organizationId)),
      }),
    )
  })

  app.get('/v1/organizations/:id/channels', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const [connections, scopes] = await Promise.all([
      client.from('social_connections').select(SOCIAL_CONNECTION_COLUMNS).eq('organization_id', params.id).order('created_at'),
      client.from('channel_scopes').select('id, social_connection_id, scope, department_id, team_id, can_schedule').eq('organization_id', params.id),
    ])
    if (connections.error) throw connections.error
    if (scopes.error) throw scopes.error
    return reply.code(200).send(
      connections.data.map((row) =>
        SocialConnectionSchema.parse({
          ...mapSocialConnectionRow(row),
          scopes: scopes.data.filter((scopeRow) => scopeRow.social_connection_id === row.id).map((scopeRow) => mapChannelScopeRow(scopeRow, params.id)),
        }),
      ),
    )
  })

  app.patch('/v1/channels/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateSocialConnectionRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('social_connections').select('organization_id, owner_scope, owner_department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    const scope = channelOwnerScope(existing.data)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    // responsible_profile_id hat nur einen Fremdschluessel auf profiles, keinen auf die
    // Mitgliedschaft -- ohne diese Pruefung liesse sich ein Mitglied eines FREMDEN Vereins als
    // verantwortliche Person eintragen und damit require_channel_responsible mit einer Person
    // erfuellen, die im Verein gar nicht existiert. Service-Client, weil die Antwort hier eine
    // Eingabevalidierung ist: eine per RLS unsichtbare Mitgliedschaftszeile duerfte nicht als
    // "kein Mitglied" durchgehen.
    if (input.responsibleProfileId) {
      const isMember = await isAnyMemberOfOrganization(supabaseClients.forService(), input.responsibleProfileId, organizationId)
      if (!isMember) return reply.code(422).send({ error: 'responsible_not_a_member', correlationId: request.id })
    }
    // Gleicher Grund wie bei responsibleProfileId: presserechtliche Verantwortung (§ 18 MStV,
    // Paket 020) darf nicht auf ein Mitglied eines fremden Vereins zeigen.
    if (input.editorialResponsibleProfileId) {
      const isMember = await isAnyMemberOfOrganization(supabaseClients.forService(), input.editorialResponsibleProfileId, organizationId)
      if (!isMember) return reply.code(422).send({ error: 'editorial_responsible_not_a_member', correlationId: request.id })
    }
    const payload: Record<string, unknown> = {}
    if (input.displayName !== undefined) payload.display_name = input.displayName
    if (input.purpose !== undefined) payload.purpose = input.purpose
    if (input.responsibleProfileId !== undefined) payload.responsible_profile_id = input.responsibleProfileId
    if (input.confidential !== undefined) payload.confidential = input.confidential
    if (input.imprintUrl !== undefined) payload.imprint_url = input.imprintUrl
    if (input.privacyUrl !== undefined) payload.privacy_url = input.privacyUrl
    if (input.editorialResponsibleProfileId !== undefined) payload.editorial_responsible_profile_id = input.editorialResponsibleProfileId
    if (input.editorialResponsibleNote !== undefined) payload.editorial_responsible_note = input.editorialResponsibleNote
    // null setzt den Kanal auf die globale Plattform-Vorgabe zurueck (Entwurfsentscheidung 3, Plan 039).
    if (input.maxCharacters !== undefined) payload.max_characters = input.maxCharacters
    // Kein Grant fuer authenticated auf social_connections ausser select (Plan 012, "Sicherheitsbefund
    // zuerst") -- die Berechtigungspruefung sitzt hier in TS, der Schreibzugriff im Service-Client,
    // wie schon bei den LLM-Provider-Konfigurationen.
    const service = supabaseClients.forService()
    const update = await service.from('social_connections').update(payload).eq('id', params.id).select(SOCIAL_CONNECTION_COLUMNS).single()
    if (update.error) throw update.error
    await recordAuditEvent(request, {
      organizationId,
      action: 'channel.updated',
      entityType: 'social_connections',
      entityId: params.id,
      // Nur die geaenderten Feldnamen, keine Werte -- purpose und displayName sind Freitext.
      metadata: { fields: Object.keys(input) },
    })
    const scopesResult = await service.from('channel_scopes').select('id, scope, department_id, team_id, can_schedule').eq('social_connection_id', params.id)
    if (scopesResult.error) throw scopesResult.error
    return reply.code(200).send(
      SocialConnectionSchema.parse({
        ...mapSocialConnectionRow(update.data),
        scopes: scopesResult.data.map((scopeRow) => mapChannelScopeRow(scopeRow, organizationId)),
      }),
    )
  })

  app.delete('/v1/channels/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('social_connections').select('organization_id, owner_scope, owner_department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    const scope = channelOwnerScope(existing.data)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const service = supabaseClients.forService()
    // Die Zeile bleibt (publications verweist per FK darauf), nur Status/archived_at aendern sich --
    // Geheimnis wird geloescht, damit kein Ciphertext eines getrennten Kanals liegen bleibt.
    const update = await service.from('social_connections').update({ status: 'disconnected', archived_at: new Date().toISOString() }).eq('id', params.id)
    if (update.error) throw update.error
    const secretDelete = await service.from('social_connection_secrets').delete().eq('social_connection_id', params.id)
    if (secretDelete.error) throw secretDelete.error
    await recordAuditEvent(request, { organizationId, action: 'channel.disconnected', entityType: 'social_connections', entityId: params.id })
    return reply.code(204).send()
  })

  app.post('/v1/channels/:id/verify', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('social_connections').select('organization_id, owner_scope, owner_department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    const scope = channelOwnerScope(existing.data)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const service = supabaseClients.forService()
    const secretRow = await service.from('social_connection_secrets').select('token_ciphertext, token_key_version').eq('social_connection_id', params.id).maybeSingle()
    if (secretRow.error) throw secretRow.error
    if (!secretRow.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const token = createSecretBoxFromEnvironment(environment).open(byteaToBuffer(secretRow.data.token_ciphertext as string), secretRow.data.token_key_version as string, params.id)
    const verification = await (await getMetaOAuthClient()).verifyToken(token)
    const update = await service
      .from('social_connections')
      .update({ status: verification.valid ? 'active' : 'action_required', last_verified_at: new Date().toISOString() })
      .eq('id', params.id)
      .select(SOCIAL_CONNECTION_COLUMNS)
      .single()
    if (update.error) throw update.error
    await recordAuditEvent(request, {
      organizationId,
      action: 'channel.verified',
      entityType: 'social_connections',
      entityId: params.id,
      metadata: { valid: verification.valid },
    })
    const scopesResult = await service.from('channel_scopes').select('id, scope, department_id, team_id, can_schedule').eq('social_connection_id', params.id)
    if (scopesResult.error) throw scopesResult.error
    return reply.code(200).send(
      SocialConnectionSchema.parse({
        ...mapSocialConnectionRow(update.data),
        scopes: scopesResult.data.map((scopeRow) => mapChannelScopeRow(scopeRow, organizationId)),
      }),
    )
  })

  app.post('/v1/channels/:id/scopes', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateChannelScopeRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const connection = await client.from('social_connections').select('organization_id, owner_scope, owner_department_id').eq('id', params.id).maybeSingle()
    if (connection.error) throw connection.error
    if (!connection.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    // Massgeblich ist der Kanalbesitz, nicht die Ziel-Scope-Berechtigung: ein Abteilungsadmin darf
    // ausschliesslich Kanaele freigeben, die seine EIGENE Abteilung besitzt (Plan 012, "Zuordnung
    // und Verantwortung") -- nicht jeden Kanal, fuer dessen Zielebene er zufaellig
    // department.manage/team.manage haelt. Dieselbe Bedingung wie channel_scopes_insert (RLS bleibt
    // Verteidigung in der Tiefe, kein zweiter Weg).
    const ownerScope = channelOwnerScope(connection.data)
    if (!(await requirePermission(request, reply, 'social_account.manage', ownerScope))) return
    const targetScope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!targetScope || targetScope.organizationId !== connection.data.organization_id) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const insert = await client
      .from('channel_scopes')
      .insert({
        organization_id: connection.data.organization_id,
        social_connection_id: params.id,
        scope: input.scope,
        department_id: targetScope.departmentId ?? null,
        team_id: targetScope.teamId ?? null,
        can_schedule: input.canSchedule,
        created_by: request.auth!.userId,
      })
      .select('id, scope, department_id, team_id, can_schedule')
      .single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'scope_already_exists', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, {
      organizationId: connection.data.organization_id as string,
      action: 'channel_scope.granted',
      entityType: 'channel_scopes',
      entityId: insert.data.id as string,
      metadata: { socialConnectionId: params.id, scope: input.scope, scopeId: input.scopeId, canSchedule: input.canSchedule },
    })
    return reply.code(201).send(ChannelScopeAssignmentSchema.parse(mapChannelScopeRow(insert.data, connection.data.organization_id as string)))
  })

  app.delete('/v1/channel-scopes/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('channel_scopes').select('organization_id, social_connection_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const connection = await client.from('social_connections').select('owner_scope, owner_department_id').eq('id', existing.data.social_connection_id).maybeSingle()
    if (connection.error) throw connection.error
    if (!connection.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = channelOwnerScope({ ...connection.data, organization_id: existing.data.organization_id })
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const del = await client.from('channel_scopes').delete().eq('id', params.id).select('id')
    if (del.error) throw del.error
    if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: existing.data.organization_id as string,
      action: 'channel_scope.revoked',
      entityType: 'channel_scopes',
      entityId: params.id,
      metadata: { socialConnectionId: existing.data.social_connection_id },
    })
    return reply.code(204).send()
  })

  app.get('/v1/organizations/:id/channel-policy', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const row = await client
      .from('policy_settings')
      .select('allow_department_owned_channels, require_channel_responsible')
      .eq('organization_id', params.id)
      .eq('scope', 'organization')
      .maybeSingle()
    if (row.error) throw row.error
    return reply.code(200).send(
      ChannelPolicySchema.parse({
        allowDepartmentOwnedChannels: row.data?.allow_department_owned_channels ?? false,
        requireChannelResponsible: row.data?.require_channel_responsible ?? false,
      }),
    )
  })

  app.get('/v1/post-versions/:id/available-channels', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const version = await client.from('post_versions').select('id, post_id, effective_config_snapshot').eq('id', params.id).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const post = await client.from('posts').select('id, organization_id, department_id, team_id').eq('id', version.data.post_id).maybeSingle()
    if (post.error) throw post.error
    if (!post.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.publish', { organizationId: post.data.organization_id, departmentId: post.data.department_id }))) return

    const [connections, scopeRows, policyRow] = await Promise.all([
      // Website-Kanaele sind hier ausgenommen (Plan 039: "Bis zum Folgepaket erzeugt ein Blog-Kanal
      // keine Veroeffentlichungszeile"). Sie waeren sonst waehlbare Veroeffentlichungsziele, und
      // schedule_publication() legte eine Zeile an, die niemand ausfuehren kann -- ein Blog-Kanal
      // hat per Entwurfsentscheidung 2 keinen social_connection_secrets-Eintrag. Die verbindliche
      // Sperre sitzt im publications_platform_check (die RPC ist direkt aufrufbar); das hier ist
      // die Anzeige, damit die Oberflaeche gar nicht erst etwas Unmoegliches anbietet.
      client.from('social_connections').select('id, status, archived_at, responsible_profile_id').eq('organization_id', post.data.organization_id).neq('platform', 'website'),
      client.from('channel_scopes').select('social_connection_id, scope, department_id, team_id, can_schedule').eq('organization_id', post.data.organization_id),
      client.from('policy_settings').select('require_channel_responsible').eq('organization_id', post.data.organization_id).eq('scope', 'organization').maybeSingle(),
    ])
    if (connections.error) throw connections.error
    if (scopeRows.error) throw scopeRows.error
    if (policyRow.error) throw policyRow.error

    const snapshotConfig = (version.data.effective_config_snapshot as { config?: { allowedChannelIds?: unknown } } | null)?.config
    const allowedChannelIds = Array.isArray(snapshotConfig?.allowedChannelIds) ? (snapshotConfig!.allowedChannelIds as string[]) : null

    const candidates = toChannelCandidates(connections.data, scopeRows.data)

    const available = resolveAvailableChannels({
      scope: post.data.team_id ? 'team' : 'department',
      departmentId: post.data.department_id as string,
      ...(post.data.team_id ? { teamId: post.data.team_id as string } : {}),
      channels: candidates,
      allowedChannelIds,
      requireChannelResponsible: policyRow.data?.require_channel_responsible ?? false,
    })
    return reply.code(200).send(AvailableChannelsResponseSchema.parse({ socialConnectionIds: available }))
  })
}
