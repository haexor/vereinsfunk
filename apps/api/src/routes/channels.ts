import {
  AvailableChannelsResponseSchema,
  ChannelConnectStartRequestSchema,
  ChannelOwnerScopeSchema,
  ChannelPolicySchema,
  ChannelScopeAssignmentSchema,
  CreateChannelScopeRequestSchema,
  OAuthPendingConnectionSchema,
  SelectOAuthAccountRequestSchema,
  SocialConnectionSchema,
  SocialPlatformSchema,
  UpdateSocialConnectionRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { resolveAvailableChannels, type ChannelCandidate, type ScopeLevelName } from '@vereinsfunk/domain'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { mapChannelScopeRow, mapSocialConnectionRow, metaRedirectUri } from '../apiMappers.js'
import { byteaToBuffer, ciphertextToBytea, createSecretBoxFromEnvironment } from '../secretBox.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, isAnyMemberOfOrganization, resolveMembershipScope, toPermissionScope } from './shared.js'

const SOCIAL_CONNECTION_COLUMNS =
  'id, platform, external_account_id, display_name, status, token_expires_at, last_verified_at, owner_scope, owner_department_id, responsible_profile_id, purpose, confidential, archived_at, created_at, imprint_url, privacy_url, editorial_responsible_profile_id, editorial_responsible_note'

export function registerChannelRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, environment, metaOAuthClient } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

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
    const scope = toPermissionScope(organizationId, existing.data.owner_scope === 'department' ? (existing.data.owner_department_id as string) : null)
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
    const scope = toPermissionScope(organizationId, existing.data.owner_scope === 'department' ? (existing.data.owner_department_id as string) : null)
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
    const scope = toPermissionScope(organizationId, existing.data.owner_scope === 'department' ? (existing.data.owner_department_id as string) : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const service = supabaseClients.forService()
    const secretRow = await service.from('social_connection_secrets').select('token_ciphertext, token_key_version').eq('social_connection_id', params.id).maybeSingle()
    if (secretRow.error) throw secretRow.error
    if (!secretRow.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const token = createSecretBoxFromEnvironment(environment).open(byteaToBuffer(secretRow.data.token_ciphertext as string), secretRow.data.token_key_version as string, params.id)
    const verification = await metaOAuthClient.verifyToken(token)
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
    const ownerScope = toPermissionScope(connection.data.organization_id as string, connection.data.owner_scope === 'department' ? (connection.data.owner_department_id as string) : null)
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
    const scope = toPermissionScope(existing.data.organization_id as string, connection.data.owner_scope === 'department' ? (connection.data.owner_department_id as string) : null)
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

  // Aufgerufen per fetch (nicht per Browser-Navigation): eine vollstaendige Seitennavigation traegt
  // keinen Authorization-Header, deshalb liefert dieser Endpunkt die Autorisierungs-URL als JSON
  // zurueck und die Oberflaeche navigiert selbst dorthin (window.location.href).
  app.get('/v1/channels/connect/:platform/start', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ platform: SocialPlatformSchema }).parse(request.params)
    // ownerDepartmentId kommt hier als Query-Parameter statt im Body (GET) -- der leere String ist
    // deshalb ein gueltiger Eingangswert und bedeutet "nicht gesetzt": ein null-Wert wird von der
    // Query-Serialisierung des Browsers (ufo/withQuery hinter $fetch) als schluessellosen Parameter
    // angehaengt, und Fastify liest den als ''. Ohne diese Normalisierung scheiterte jeder
    // vereinseigene Verbindungsstart aus der Oberflaeche an der UUID-Pruefung (400).
    const query = z
      .object({ organizationId: UuidSchema, ownerScope: ChannelOwnerScopeSchema, ownerDepartmentId: UuidSchema.or(z.literal('')).nullish() })
      .parse(request.query)
    // Die Bedingung zwischen ownerScope und ownerDepartmentId steht im Vertrag, nicht hier -- damit
    // gilt fuer diese Route dieselbe Regel wie fuer jeden anderen Aufrufer des Schemas.
    const start = ChannelConnectStartRequestSchema.parse({
      ownerScope: query.ownerScope,
      ownerDepartmentId: query.ownerDepartmentId ? query.ownerDepartmentId : null,
    })
    const ownerDepartmentId = start.ownerDepartmentId
    const scope = toPermissionScope(query.organizationId, ownerDepartmentId)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    if (start.ownerScope === 'department') {
      const policyRow = await supabaseClients
        .forUser(request.auth!.accessToken)
        .from('policy_settings')
        .select('allow_department_owned_channels')
        .eq('organization_id', query.organizationId)
        .eq('scope', 'organization')
        .maybeSingle()
      if (policyRow.error) throw policyRow.error
      if (!(policyRow.data?.allow_department_owned_channels ?? false)) {
        return reply.code(403).send({ error: 'department_owned_channels_not_allowed', correlationId: request.id })
      }
    }
    if (!environment.META_OAUTH_REDIRECT_URL) return reply.code(503).send({ error: 'meta_not_configured', correlationId: request.id })
    const nonce = randomUUID()
    const insert = await supabaseClients.forService().from('oauth_states').insert({
      organization_id: query.organizationId,
      platform: params.platform,
      owner_scope: start.ownerScope,
      owner_department_id: ownerDepartmentId,
      nonce,
      created_by: request.auth!.userId,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    if (insert.error) throw insert.error
    const redirectUri = metaRedirectUri(environment.META_OAUTH_REDIRECT_URL, params.platform)
    const authorizationUrl = metaOAuthClient.authorizationUrl({ state: nonce, redirectUri, platform: params.platform })
    return reply.code(200).send({ authorizationUrl })
  })

  // Meta leitet den Browser hierher um -- kein Authorization-Header, keine requireAuth. Die
  // Vertrauensgrenze ist state: unerraten, einmalig, kurzlebig, an Organisation/Besitzebene
  // gebunden (Plan 012: "state niemals ungeprueft zurueckvertrauen").
  app.get('/v1/channels/connect/:platform/callback', async (request, reply) => {
    const params = z.object({ platform: SocialPlatformSchema }).parse(request.params)
    const query = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(request.query)
    const webBaseUrl = environment.WEB_BASE_URL ?? 'http://localhost:4200'

    if (query.error || !query.code || !query.state) {
      return reply.redirect(`${webBaseUrl}/kanaele?oauthError=denied`, 302)
    }
    const service = supabaseClients.forService()
    const stateRow = await service
      .from('oauth_states')
      .select('id, organization_id, platform, owner_scope, owner_department_id, created_by, expires_at, consumed_at')
      .eq('nonce', query.state)
      .maybeSingle()
    if (stateRow.error) throw stateRow.error
    if (
      !stateRow.data ||
      stateRow.data.platform !== params.platform ||
      stateRow.data.consumed_at !== null ||
      new Date(stateRow.data.expires_at as string).getTime() < Date.now()
    ) {
      return reply.redirect(`${webBaseUrl}/kanaele?oauthError=invalid_state`, 302)
    }
    // .is('consumed_at', null): einmalig verbrauchbar, sonst koennte ein doppelt zugestelltes
    // Callback (Netzwerk-Retry, zwei Tabs) denselben Code zweimal einloesen.
    const consume = await service.from('oauth_states').update({ consumed_at: new Date().toISOString() }).eq('id', stateRow.data.id).is('consumed_at', null).select('id')
    if (consume.error) throw consume.error
    if (consume.data.length === 0) return reply.redirect(`${webBaseUrl}/kanaele?oauthError=invalid_state`, 302)

    if (!environment.META_OAUTH_REDIRECT_URL) return reply.redirect(`${webBaseUrl}/kanaele?oauthError=meta_not_configured`, 302)
    const redirectUri = metaRedirectUri(environment.META_OAUTH_REDIRECT_URL, params.platform)

    let availableAccounts: readonly { externalAccountId: string; displayName: string; pageAccessToken: string }[]
    try {
      const shortLived = await metaOAuthClient.exchangeCode(query.code, redirectUri)
      const longLived = await metaOAuthClient.exchangeForLongLivedToken(shortLived.accessToken)
      availableAccounts = await metaOAuthClient.listAvailableAccounts(longLived.accessToken, params.platform)
    } catch (error) {
      request.log.warn({ err: error, correlationId: request.id }, 'meta oauth exchange failed')
      return reply.redirect(`${webBaseUrl}/kanaele?oauthError=meta_exchange_failed`, 302)
    }
    if (availableAccounts.length === 0) return reply.redirect(`${webBaseUrl}/kanaele?oauthError=no_accounts`, 302)

    const pendingId = randomUUID()
    const secretBox = createSecretBoxFromEnvironment(environment)
    // Jeder Seiten-Token einzeln versiegelt (AAD = pendingId + externalAccountId) -- die Auswahl
    // entschluesselt spaeter nur den EINEN gewaehlten Token, nie die ganze Liste auf einmal.
    const sealedAccounts = availableAccounts.map((account) => {
      const sealed = secretBox.seal(account.pageAccessToken, `${pendingId}:${account.externalAccountId}`)
      return {
        externalAccountId: account.externalAccountId,
        displayName: account.displayName,
        pageAccessTokenCiphertext: ciphertextToBytea(sealed.ciphertext).slice(2),
        pageAccessTokenKeyVersion: sealed.keyVersion,
      }
    })
    const insert = await service.from('oauth_pending_connections').insert({
      id: pendingId,
      organization_id: stateRow.data.organization_id,
      platform: params.platform,
      owner_scope: stateRow.data.owner_scope,
      owner_department_id: stateRow.data.owner_department_id,
      available_accounts: sealedAccounts,
      created_by: stateRow.data.created_by,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    if (insert.error) throw insert.error
    return reply.redirect(`${webBaseUrl}/kanaele?pending=${pendingId}`, 302)
  })

  app.get('/v1/oauth-pending/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const pending = await service
      .from('oauth_pending_connections')
      .select('id, organization_id, platform, owner_scope, owner_department_id, available_accounts, expires_at')
      .eq('id', params.id)
      .maybeSingle()
    if (pending.error) throw pending.error
    if (!pending.data || new Date(pending.data.expires_at as string).getTime() < Date.now()) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const scope = toPermissionScope(pending.data.organization_id as string, pending.data.owner_scope === 'department' ? (pending.data.owner_department_id as string) : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const accounts = pending.data.available_accounts as { externalAccountId: string; displayName: string }[]
    return reply.code(200).send(
      OAuthPendingConnectionSchema.parse({
        id: pending.data.id,
        platform: pending.data.platform,
        availableAccounts: accounts.map((account) => ({ externalAccountId: account.externalAccountId, displayName: account.displayName })),
      }),
    )
  })

  app.post('/v1/oauth-pending/:id/select', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = SelectOAuthAccountRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const pending = await service
      .from('oauth_pending_connections')
      .select('id, organization_id, platform, owner_scope, owner_department_id, available_accounts, expires_at')
      .eq('id', params.id)
      .maybeSingle()
    if (pending.error) throw pending.error
    if (!pending.data || new Date(pending.data.expires_at as string).getTime() < Date.now()) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const organizationId = pending.data.organization_id as string
    const ownerScope = pending.data.owner_scope
    const ownerDepartmentId = pending.data.owner_department_id
    const platform = pending.data.platform
    const scope = toPermissionScope(organizationId, ownerScope === 'department' ? (ownerDepartmentId as string) : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const accounts = pending.data.available_accounts as {
      externalAccountId: string
      displayName: string
      pageAccessTokenCiphertext: string
      pageAccessTokenKeyVersion: string
    }[]
    const chosen = accounts.find((account) => account.externalAccountId === input.externalAccountId)
    if (!chosen) return reply.code(404).send({ error: 'not_found', correlationId: request.id })

    const secretBox = createSecretBoxFromEnvironment(environment)
    const pageAccessToken = secretBox.open(Buffer.from(chosen.pageAccessTokenCiphertext, 'hex'), chosen.pageAccessTokenKeyVersion, `${params.id}:${chosen.externalAccountId}`)

    const insert = await service
      .from('social_connections')
      .insert({
        organization_id: organizationId,
        platform,
        external_account_id: chosen.externalAccountId,
        display_name: chosen.displayName,
        status: 'active',
        owner_scope: ownerScope,
        owner_department_id: ownerDepartmentId,
      })
      .select(SOCIAL_CONNECTION_COLUMNS)
      .single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'already_connected', correlationId: request.id })
      throw insert.error
    }

    // Re-verschluesselt mit der social_connection_id als AAD (nicht mehr pendingId) -- damit ein
    // Ciphertext nicht auf eine andere Verbindung umgehaengt werden kann (Plan 012, packages/secrets).
    const sealed = secretBox.seal(pageAccessToken, insert.data.id as string)
    const secretInsert = await service.from('social_connection_secrets').insert({
      organization_id: organizationId,
      social_connection_id: insert.data.id,
      token_ciphertext: ciphertextToBytea(sealed.ciphertext),
      token_key_version: sealed.keyVersion,
    })
    if (secretInsert.error) {
      // Ohne Rollback bliebe eine Kanalzeile ohne Geheimnis zurueck.
      await service.from('social_connections').delete().eq('id', insert.data.id)
      throw secretInsert.error
    }

    // Eigene Ebene bekommt automatisch eine Freigabe (Plan 012: "beim Verbinden legt die API
    // automatisch einen Eintrag fuer die eigene Ebene an, alles Weitere ist eine bewusste Freigabe").
    const defaultScope = await service.from('channel_scopes').insert({
      organization_id: organizationId,
      social_connection_id: insert.data.id,
      scope: ownerScope,
      department_id: ownerDepartmentId,
      team_id: null,
      can_schedule: true,
      created_by: request.auth!.userId,
    })
    if (defaultScope.error) throw defaultScope.error

    await recordAuditEvent(request, {
      organizationId,
      action: 'channel.connected',
      entityType: 'social_connections',
      entityId: insert.data.id as string,
      metadata: { platform, ownerScope, externalAccountId: chosen.externalAccountId },
    })

    // Bleibt die Zeile stehen, liegen die versiegelten Seiten-Tokens der ABGELEHNTEN Konten bis
    // expires_at weiter in der Datenbank -- der Aufruf darf nicht stillschweigend scheitern.
    // Geloggt statt geworfen: der Kanal ist zu diesem Zeitpunkt bereits angelegt.
    const pendingDelete = await service.from('oauth_pending_connections').delete().eq('id', params.id)
    if (pendingDelete.error) request.log.error({ err: pendingDelete.error, correlationId: request.id }, 'oauth_pending_connections delete failed')

    const scopesResult = await service.from('channel_scopes').select('id, scope, department_id, team_id, can_schedule').eq('social_connection_id', insert.data.id)
    if (scopesResult.error) throw scopesResult.error
    return reply.code(201).send(
      SocialConnectionSchema.parse({
        ...mapSocialConnectionRow(insert.data),
        scopes: scopesResult.data.map((scopeRow) => mapChannelScopeRow(scopeRow, organizationId)),
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
      client.from('social_connections').select('id, status, archived_at, responsible_profile_id').eq('organization_id', post.data.organization_id),
      client.from('channel_scopes').select('social_connection_id, scope, department_id, team_id, can_schedule').eq('organization_id', post.data.organization_id),
      client.from('policy_settings').select('require_channel_responsible').eq('organization_id', post.data.organization_id).eq('scope', 'organization').maybeSingle(),
    ])
    if (connections.error) throw connections.error
    if (scopeRows.error) throw scopeRows.error
    if (policyRow.error) throw policyRow.error

    const snapshotConfig = (version.data.effective_config_snapshot as { config?: { allowedChannelIds?: unknown } } | null)?.config
    const allowedChannelIds = Array.isArray(snapshotConfig?.allowedChannelIds) ? (snapshotConfig!.allowedChannelIds as string[]) : null

    const candidates: ChannelCandidate[] = connections.data.map((connection) => ({
      socialConnectionId: connection.id as string,
      status: connection.status as ChannelCandidate['status'],
      archivedAt: connection.archived_at as string | null,
      responsibleProfileId: connection.responsible_profile_id as string | null,
      scopeGrants: scopeRows.data
        .filter((row) => row.social_connection_id === connection.id)
        .map((row) => ({
          scope: row.scope as ScopeLevelName,
          ...(row.department_id ? { departmentId: row.department_id as string } : {}),
          ...(row.team_id ? { teamId: row.team_id as string } : {}),
          canSchedule: row.can_schedule as boolean,
        })),
    }))

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
