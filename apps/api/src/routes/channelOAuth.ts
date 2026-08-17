import { ChannelConnectStartRequestSchema, ChannelOwnerScopeSchema, OAuthPlatformSchema, OAuthPendingConnectionSchema, SelectOAuthAccountRequestSchema, SocialConnectionSchema, UuidSchema, type OAuthPlatform } from '@vereinsfunk/contracts'
import type { MetaPlatform } from '@vereinsfunk/publishing'
import type { FastifyInstance } from 'fastify'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { mapChannelScopeRow, mapSocialConnectionRow, oauthRedirectUri } from '../apiMappers.js'
import { ciphertextToBytea, createSecretBoxFromEnvironment } from '../secretBox.js'
import type { ApiRouteContext } from './context.js'
import { channelOwnerScope, createAuditRecorder, isDepartmentOwnedChannelAllowed, SOCIAL_CONNECTION_COLUMNS, toPermissionScope } from './shared.js'

// Paket 045: welcher OAuth-Adapter eine Plattform bedient. Instagram/Facebook teilen sich weiterhin
// den Meta-Graph-API-Adapter (Paket 012); Twitter/LinkedIn haben je einen eigenen, strukturell
// anderen Flow (PKCE bei Twitter, Organisations-Listing bei LinkedIn, siehe packages/publishing).
type OAuthProvider = 'meta' | 'twitter' | 'linkedin'
const OAUTH_PROVIDER_BY_PLATFORM: Record<OAuthPlatform, OAuthProvider> = {
  instagram: 'meta', facebook: 'meta', twitter: 'twitter', linkedin: 'linkedin',
}

// PKCE (Paket 045, X OAuth2): der Verifier muss zwischen /start und /callback ueberleben (siehe
// oauth_states.code_verifier), der Challenge-Wert geht in die Autorisierungs-URL. RFC 7636 verlangt
// S256 als Hash-Verfahren, 43-128 Zeichen fuer den Verifier -- 32 Zufallsbytes base64url-kodiert
// ergeben 43 Zeichen.
function generatePkceCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}
function derivePkceCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url')
}

export function registerChannelOAuthRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, environment, metaOAuthClient, twitterOAuthClient, linkedinOAuthClient } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  function redirectBaseUrlFor(provider: OAuthProvider): string | undefined {
    if (provider === 'meta') return environment.META_OAUTH_REDIRECT_URL
    if (provider === 'twitter') return environment.TWITTER_OAUTH_REDIRECT_URL
    return environment.LINKEDIN_OAUTH_REDIRECT_URL
  }

  // Aufgerufen per fetch (nicht per Browser-Navigation): eine vollstaendige Seitennavigation traegt
  // keinen Authorization-Header, deshalb liefert dieser Endpunkt die Autorisierungs-URL als JSON
  // zurueck und die Oberflaeche navigiert selbst dorthin (window.location.href).
  app.get('/v1/channels/connect/:platform/start', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ platform: OAuthPlatformSchema }).parse(request.params)
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
    const provider = OAUTH_PROVIDER_BY_PLATFORM[params.platform]
    const redirectBaseUrl = redirectBaseUrlFor(provider)
    // Die Redirect-URL allein reicht nicht: sie wird im Deployment auch fuer den inaktiven
    // Fake-Provider gerendert, damit die Callback-Adresse nicht an mehreren Stellen gepflegt wird.
    // OAuth darf aber ausschliesslich mit dem vollstaendig validierten Adapter starten -- sonst
    // wuerde eine leere client_id den Browser zu einer irrefuehrenden Anbieter-Fehlerseite schicken.
    if (!environment.PUBLISHING_PROVIDER.includes(provider) || !redirectBaseUrl) {
      return reply.code(503).send({ error: `${provider}_not_configured`, correlationId: request.id })
    }
    const nonce = randomUUID()
    const redirectUri = oauthRedirectUri(redirectBaseUrl, params.platform)
    // PKCE ausschliesslich fuer Twitter (RFC 7636) -- Meta/LinkedIn kennen den Verifier nicht, die
    // Spalte bleibt fuer sie null.
    const codeVerifier = provider === 'twitter' ? generatePkceCodeVerifier() : null
    const authorizationUrl =
      provider === 'meta'
        ? metaOAuthClient.authorizationUrl({ state: nonce, redirectUri, platform: params.platform as MetaPlatform })
        : provider === 'twitter'
          ? twitterOAuthClient.authorizationUrl({ state: nonce, redirectUri, codeChallenge: derivePkceCodeChallenge(codeVerifier!) })
          : linkedinOAuthClient.authorizationUrl({ state: nonce, redirectUri })
    const insert = await supabaseClients.forService().from('oauth_states').insert({
      organization_id: query.organizationId,
      platform: params.platform,
      owner_scope: start.ownerScope,
      owner_department_id: ownerDepartmentId,
      nonce,
      code_verifier: codeVerifier,
      created_by: request.auth!.userId,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    if (insert.error) throw insert.error
    return reply.code(200).send({ authorizationUrl })
  })

  // Der Anbieter leitet den Browser hierher um -- kein Authorization-Header, keine requireAuth. Die
  // Vertrauensgrenze ist state: unerraten, einmalig, kurzlebig, an Organisation/Besitzebene
  // gebunden (Plan 012: "state niemals ungeprueft zurueckvertrauen").
  app.get('/v1/channels/connect/:platform/callback', async (request, reply) => {
    const params = z.object({ platform: OAuthPlatformSchema }).parse(request.params)
    const query = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(request.query)
    const webBaseUrl = environment.WEB_BASE_URL ?? 'http://localhost:4200'

    if (query.error || !query.code || !query.state) {
      return reply.redirect(`${webBaseUrl}/kanaele?oauthError=denied`, 302)
    }
    const service = supabaseClients.forService()
    const stateRow = await service
      .from('oauth_states')
      .select('id, organization_id, platform, owner_scope, owner_department_id, created_by, expires_at, consumed_at, code_verifier')
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

    const provider = OAUTH_PROVIDER_BY_PLATFORM[params.platform]
    const redirectBaseUrl = redirectBaseUrlFor(provider)
    if (!environment.PUBLISHING_PROVIDER.includes(provider) || !redirectBaseUrl) {
      return reply.redirect(`${webBaseUrl}/kanaele?oauthError=${provider}_not_configured`, 302)
    }
    const redirectUri = oauthRedirectUri(redirectBaseUrl, params.platform)

    // Normalisiert auf eine gemeinsame Form, bevor die Konten unten versiegelt werden -- Meta,
    // Twitter und LinkedIn haben je ein anderes "Konto"-Shape (Seiten-Token, Nutzer-Token,
    // Organisations-Token), aber ab hier zaehlt nur noch externalAccountId/displayName/secretToken.
    let availableAccounts: readonly { externalAccountId: string; displayName: string; secretToken: string }[]
    try {
      if (provider === 'meta') {
        const shortLived = await metaOAuthClient.exchangeCode(query.code, redirectUri)
        const longLived = await metaOAuthClient.exchangeForLongLivedToken(shortLived.accessToken)
        const accounts = await metaOAuthClient.listAvailableAccounts(longLived.accessToken, params.platform as MetaPlatform)
        availableAccounts = accounts.map((account) => ({ externalAccountId: account.externalAccountId, displayName: account.displayName, secretToken: account.pageAccessToken }))
      } else if (provider === 'twitter') {
        const codeVerifier = stateRow.data.code_verifier as string | null
        if (!codeVerifier) throw new Error('oauth_states row is missing the PKCE code verifier')
        const exchanged = await twitterOAuthClient.exchangeCode(query.code, redirectUri, codeVerifier)
        const accounts = await twitterOAuthClient.listAvailableAccounts(exchanged.accessToken)
        availableAccounts = accounts.map((account) => ({ externalAccountId: account.externalAccountId, displayName: account.displayName, secretToken: account.accessToken }))
      } else {
        const exchanged = await linkedinOAuthClient.exchangeCode(query.code, redirectUri)
        const accounts = await linkedinOAuthClient.listAvailableAccounts(exchanged.accessToken)
        availableAccounts = accounts.map((account) => ({ externalAccountId: account.externalAccountId, displayName: account.displayName, secretToken: account.accessToken }))
      }
    } catch (error) {
      request.log.warn({ err: error, correlationId: request.id }, `${provider} oauth exchange failed`)
      return reply.redirect(`${webBaseUrl}/kanaele?oauthError=${provider}_exchange_failed`, 302)
    }
    if (availableAccounts.length === 0) return reply.redirect(`${webBaseUrl}/kanaele?oauthError=no_accounts`, 302)

    const pendingId = randomUUID()
    const secretBox = createSecretBoxFromEnvironment(environment)
    // Jeder Konto-Token einzeln versiegelt (AAD = pendingId + externalAccountId) -- die Auswahl
    // entschluesselt spaeter nur den EINEN gewaehlten Token, nie die ganze Liste auf einmal.
    const sealedAccounts = availableAccounts.map((account) => {
      const sealed = secretBox.seal(account.secretToken, `${pendingId}:${account.externalAccountId}`)
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
