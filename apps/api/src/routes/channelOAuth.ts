import { ChannelConnectStartRequestSchema, ChannelOwnerScopeSchema, MetaOAuthPlatformSchema, OAuthPendingConnectionSchema, SelectOAuthAccountRequestSchema, SocialConnectionSchema, UuidSchema } from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { mapChannelScopeRow, mapSocialConnectionRow, metaRedirectUri } from '../apiMappers.js'
import { ciphertextToBytea, createSecretBoxFromEnvironment } from '../secretBox.js'
import type { ApiRouteContext } from './context.js'
import { channelOwnerScope, createAuditRecorder, isDepartmentOwnedChannelAllowed, SOCIAL_CONNECTION_COLUMNS, toPermissionScope } from './shared.js'

export function registerChannelOAuthRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, environment, metaOAuthClient } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // Aufgerufen per fetch (nicht per Browser-Navigation): eine vollstaendige Seitennavigation traegt
  // keinen Authorization-Header, deshalb liefert dieser Endpunkt die Autorisierungs-URL als JSON
  // zurueck und die Oberflaeche navigiert selbst dorthin (window.location.href).
  app.get('/v1/channels/connect/:platform/start', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    // MetaOAuthPlatformSchema statt SocialPlatformSchema: ein Website-Kanal entsteht nie ueber
    // OAuth (Plan 039, POST /v1/channels), 'website' waere hier immer ein Fehleingang.
    const params = z.object({ platform: MetaOAuthPlatformSchema }).parse(request.params)
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
    if (start.ownerScope === 'department' && !(await isDepartmentOwnedChannelAllowed(supabaseClients.forUser(request.auth!.accessToken), query.organizationId))) {
      return reply.code(403).send({ error: 'department_owned_channels_not_allowed', correlationId: request.id })
    }
    // Die Redirect-URL allein reicht nicht: sie wird im Deployment auch fuer
    // den inaktiven Fake-Provider gerendert, damit die Callback-Adresse nicht
    // an mehreren Stellen gepflegt wird. OAuth darf aber ausschliesslich mit
    // dem vollstaendig validierten Meta-Adapter starten -- sonst wuerde ein
    // leerer client_id-Wert den Browser zu einer irrefuehrenden Meta-Fehlerseite
    // schicken.
    if (environment.PUBLISHING_PROVIDER !== 'meta' || !environment.META_OAUTH_REDIRECT_URL) {
      return reply.code(503).send({ error: 'meta_not_configured', correlationId: request.id })
    }
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
    const params = z.object({ platform: MetaOAuthPlatformSchema }).parse(request.params)
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

    if (environment.PUBLISHING_PROVIDER !== 'meta' || !environment.META_OAUTH_REDIRECT_URL) {
      return reply.redirect(`${webBaseUrl}/kanaele?oauthError=meta_not_configured`, 302)
    }
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
    const scope = channelOwnerScope(pending.data)
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
}
