export type Platform = 'instagram' | 'facebook' | 'twitter' | 'linkedin'
export type PublicationStatus = 'queued' | 'uploading' | 'processing' | 'published' | 'failed' | 'unknown' | 'action_required' | 'cancelled'
export interface PublicationMedia { derivativeId: string; sha256: string; mimeType: string; grantUrl: string; role: 'primary' | 'slide' }
export interface PublicationInput { publicationId: string; postVersionId: string; socialConnectionId: string; platform: Platform; caption: string; media: readonly PublicationMedia[]; scheduledFor?: string; idempotencyKey: string }
export interface PublicationReference { publicationId: string; platform: Platform; externalId?: string; socialConnectionId: string }
export interface ValidationResult { valid: boolean; errors: readonly string[] }
export interface PublicationResult { externalId: string; status: Extract<PublicationStatus, 'published' | 'processing' | 'unknown' | 'failed'>; permalink?: string }
export interface SocialPublisher { validate(input: PublicationInput): Promise<ValidationResult>; publish(input: PublicationInput): Promise<PublicationResult>; reconcile(input: PublicationReference): Promise<PublicationResult>; delete?(input: PublicationReference): Promise<void> }

// Echte Plattform-Maxima (Paket 045: X 280, LinkedIn 3000), Instagram/Facebook unveraendert.
const CAPTION_LIMITS: Record<Platform, number> = { instagram: 2_200, facebook: 63_206, twitter: 280, linkedin: 3_000 }
// Nur Instagram verlangt technisch zwingend ein Bild -- Facebook/X/LinkedIn erlauben reine
// Text-Posts (Paket 045: Facebooks bisheriger unconditional-Foto-Zwang war eine Einschraenkung
// dieses Adapters, keine echte API-Grenze, siehe MetaPublisher unten).
const PLATFORMS_REQUIRING_MEDIA: ReadonlySet<Platform> = new Set(['instagram'])

export class FakePublisher implements SocialPublisher {
  private readonly publications = new Map<string, PublicationResult>()
  async validate(input: PublicationInput): Promise<ValidationResult> {
    const maxCaption = CAPTION_LIMITS[input.platform]
    const errors = input.caption.length > maxCaption ? [`Caption exceeds ${maxCaption} characters`] : []
    if (PLATFORMS_REQUIRING_MEDIA.has(input.platform) && input.media.length === 0) errors.push('At least one approved derivative is required')
    if (input.media.some((media) => !/^[a-f0-9]{64}$/i.test(media.sha256))) errors.push('Media hash is invalid')
    return { valid: errors.length === 0, errors }
  }
  async publish(input: PublicationInput): Promise<PublicationResult> { const existing = this.publications.get(input.idempotencyKey); if (existing) return existing; const validation = await this.validate(input); if (!validation.valid) throw new Error(validation.errors.join(', ')); const result: PublicationResult = { externalId: `fake_${input.publicationId}`, status: 'published', permalink: `https://example.invalid/${input.publicationId}` }; this.publications.set(input.idempotencyKey, result); return result }
  async reconcile(input: PublicationReference): Promise<PublicationResult> { return [...this.publications.values()].find((result) => result.externalId === input.externalId) ?? { externalId: input.externalId ?? `unknown_${input.publicationId}`, status: 'unknown' } }
}

export interface MetaPublisherOptions { graphVersion: string; accessToken: string; instagramAccountId?: string; facebookPageId?: string; timeoutMs?: number; fetch?: typeof fetch }
// Meta antwortet auf einen Publish-Aufruf normalerweise deutlich schneller -- ohne Abbruch haengt
// der aufrufende API-Request bis zum Socket-Timeout (dieselbe Lehre wie bei RealMetaOAuthClient).
const META_PUBLISH_TIMEOUT_MS = 15_000
/** Direct Graph API adapter. Tokens and media grants are created server-side and never accepted from a browser. */
export class MetaPublisher implements SocialPublisher {
  private readonly request: typeof fetch
  private readonly timeoutMs: number
  constructor(private readonly options: MetaPublisherOptions) { this.request = options.fetch ?? fetch; this.timeoutMs = options.timeoutMs ?? META_PUBLISH_TIMEOUT_MS }
  async validate(input: PublicationInput): Promise<ValidationResult> {
    if (input.platform !== 'instagram' && input.platform !== 'facebook') return { valid: false, errors: ['Meta publisher does not support this platform'] }
    const fake = new FakePublisher(); const base = await fake.validate(input)
    if (input.platform === 'instagram' && !this.options.instagramAccountId) return { valid: false, errors: [...base.errors, 'Instagram account is not configured'] }
    if (input.platform === 'facebook' && !this.options.facebookPageId) return { valid: false, errors: [...base.errors, 'Facebook page is not configured'] }
    return base
  }
  async publish(input: PublicationInput): Promise<PublicationResult> {
    const validation = await this.validate(input); if (!validation.valid) throw new Error(validation.errors.join(', '))
    const base = `https://graph.facebook.com/${this.options.graphVersion}`
    const target = input.platform === 'instagram' ? this.options.instagramAccountId! : this.options.facebookPageId!
    const headers = { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${this.options.accessToken}` }
    const media = input.media[0]
    // Instagram braucht immer ein Bild (media-Endpunkt). Facebook postet mit Bild ueber /photos
    // (caption-Feld), ohne Bild ueber /feed (message-Feld) -- reiner Text ist bei Facebook technisch
    // moeglich, der bisherige unconditional-/photos-Aufruf war eine unnoetige Einschraenkung dieses
    // Adapters (Paket 045).
    const endpoint = input.platform === 'instagram' ? `${base}/${target}/media` : media ? `${base}/${target}/photos` : `${base}/${target}/feed`
    const body = input.platform === 'instagram'
      ? new URLSearchParams({ caption: input.caption, image_url: media!.grantUrl })
      : media
        ? new URLSearchParams({ caption: input.caption, url: media.grantUrl })
        : new URLSearchParams({ message: input.caption })
    const response = await this.request(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(this.timeoutMs) })
    if (!response.ok) throw new Error(`Meta publish request failed (${response.status})`)
    const data: unknown = await response.json(); const containerId = typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string' ? data.id : undefined
    if (!containerId) throw new Error('Meta response did not contain an ID; reconcile before retrying')
    if (input.platform === 'facebook') return { externalId: containerId, status: 'published' }
    const publishResponse = await this.request(`${base}/${target}/media_publish`, { method: 'POST', headers, body: new URLSearchParams({ creation_id: containerId }), signal: AbortSignal.timeout(this.timeoutMs) })
    if (!publishResponse.ok) throw new Error(`Meta media_publish request failed (${publishResponse.status})`)
    const publishData: unknown = await publishResponse.json(); const externalId = typeof publishData === 'object' && publishData !== null && 'id' in publishData && typeof publishData.id === 'string' ? publishData.id : undefined
    if (!externalId) throw new Error('Meta response did not contain a published media ID; reconcile before retrying')
    return { externalId, status: 'published' }
  }
  async reconcile(input: PublicationReference): Promise<PublicationResult> {
    if (!input.externalId) return { externalId: `unknown_${input.publicationId}`, status: 'unknown' }
    const response = await this.request(`https://graph.facebook.com/${this.options.graphVersion}/${input.externalId}?fields=id,permalink,status_code`, { headers: { authorization: `Bearer ${this.options.accessToken}` } })
    if (response.status === 404) return { externalId: input.externalId, status: 'unknown' }
    if (!response.ok) throw new Error(`Meta reconciliation failed (${response.status})`)
    const data: unknown = await response.json()
    const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
    const permalink = typeof record.permalink === 'string' ? record.permalink : undefined
    const statusCode = typeof record.status_code === 'string' ? record.status_code : undefined
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') return { externalId: input.externalId, status: 'failed' }
    if (statusCode === 'IN_PROGRESS' || statusCode === 'FINISHED') return { externalId: input.externalId, status: 'processing' }
    return permalink ? { externalId: input.externalId, status: 'published', permalink } : { externalId: input.externalId, status: 'published' }
  }
}

// Paket 012: OAuth-Anbindung. Eigenes Interface statt Teil von SocialPublisher -- Token-Beschaffung
// ist eine andere Zustaendigkeit als Veroeffentlichen, teilt sich aber dieselbe Provider-Grenze
// (Plan README: "SocialPublisher bleibt die Provider-Grenze"), deshalb im selben Paket.
// Paket 045: MetaOAuthClient deckt weiterhin nur Instagram/Facebook ab (der gemeinsame
// Meta-Graph-API-Adapter) -- eigener, engerer Typ statt der vollen Platform-Union, sonst waeren
// FakeMetaOAuthClient/RealMetaOAuthClient scheinbar auch fuer Twitter/LinkedIn zustaendig.
export type MetaPlatform = Extract<Platform, 'instagram' | 'facebook'>
export interface MetaExchangedToken { accessToken: string; expiresInSeconds?: number }
export interface MetaAvailableAccount { externalAccountId: string; displayName: string; pageAccessToken: string }

export interface MetaOAuthClient {
  authorizationUrl(options: { state: string; redirectUri: string; platform: MetaPlatform }): string
  exchangeCode(code: string, redirectUri: string): Promise<MetaExchangedToken>
  exchangeForLongLivedToken(shortLivedToken: string): Promise<MetaExchangedToken>
  listAvailableAccounts(userToken: string, platform: MetaPlatform): Promise<readonly MetaAvailableAccount[]>
  verifyToken(accessToken: string): Promise<{ valid: boolean }>
}

export interface MetaOAuthClientOptions { appId: string; appSecret: string; graphVersion: string; timeoutMs?: number; fetch?: typeof fetch }

// Meta antwortet auf diese vier Aufrufe normalerweise in unter einer Sekunde. Ohne Abbruch haengt
// der Fastify-Request bis zum Socket-Timeout -- der OAuth-Callback laeuft im Anfrage-Thread eines
// Browser-Redirects, ein haengender Aufruf dort ist eine sichtbare, leere Seite.
const META_REQUEST_TIMEOUT_MS = 10_000

export class RealMetaOAuthClient implements MetaOAuthClient {
  private readonly request: typeof fetch
  private readonly timeoutMs: number
  constructor(private readonly options: MetaOAuthClientOptions) {
    this.request = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? META_REQUEST_TIMEOUT_MS
  }

  // Token und appSecret gehoeren nie in die URL: URLs landen in Proxy-, Server- und Fehlerlogs
  // (Projektregel "Secrets duerfen nicht geloggt werden"). Geheimnisse reisen deshalb im
  // POST-Body, Zugriffstoken im Authorization-Header.
  private async post(path: string, body: Record<string, string>, label: string): Promise<Record<string, unknown>> {
    const response = await this.request(`https://graph.facebook.com/${this.options.graphVersion}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) throw new Error(`Meta ${label} failed (${response.status})`)
    return (await response.json()) as Record<string, unknown>
  }

  private async getWithToken(path: string, accessToken: string): Promise<Response> {
    return this.request(`https://graph.facebook.com/${this.options.graphVersion}/${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    })
  }

  authorizationUrl(options: { state: string; redirectUri: string; platform: MetaPlatform }): string {
    // instagram_content_publish/pages_manage_posts/pages_read_engagement erfordern den Meta App
    // Review (Plan 012, "Risiken") -- die Autorisierungs-URL laesst sich unabhaengig davon gegen
    // ein Testkonto bauen und pruefen.
    const scopes = options.platform === 'instagram'
      ? ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement']
      : ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']
    const url = new URL(`https://www.facebook.com/${this.options.graphVersion}/dialog/oauth`)
    url.searchParams.set('client_id', this.options.appId)
    url.searchParams.set('redirect_uri', options.redirectUri)
    url.searchParams.set('state', options.state)
    url.searchParams.set('scope', scopes.join(','))
    url.searchParams.set('response_type', 'code')
    return url.toString()
  }

  async exchangeCode(code: string, redirectUri: string): Promise<MetaExchangedToken> {
    const data = await this.post(
      'oauth/access_token',
      { client_id: this.options.appId, client_secret: this.options.appSecret, redirect_uri: redirectUri, code },
      'code exchange',
    )
    if (typeof data.access_token !== 'string') throw new Error('Meta code exchange response did not contain an access token')
    return { accessToken: data.access_token, ...(typeof data.expires_in === 'number' ? { expiresInSeconds: data.expires_in } : {}) }
  }

  // Meta-Nutzertoken werden gegen ein langlebiges Token getauscht (Plan 012, "Token"), bevor daraus
  // Seiten-/Instagram-Business-Tokens abgeleitet werden -- Seiten-Tokens aus einem langlebigen
  // Nutzertoken laufen selbst nicht mehr ab, aus einem kurzlebigen schon nach Stunden.
  async exchangeForLongLivedToken(shortLivedToken: string): Promise<MetaExchangedToken> {
    const data = await this.post(
      'oauth/access_token',
      { grant_type: 'fb_exchange_token', client_id: this.options.appId, client_secret: this.options.appSecret, fb_exchange_token: shortLivedToken },
      'long-lived token exchange',
    )
    if (typeof data.access_token !== 'string') throw new Error('Meta long-lived token exchange response did not contain an access token')
    return { accessToken: data.access_token, ...(typeof data.expires_in === 'number' ? { expiresInSeconds: data.expires_in } : {}) }
  }

  async listAvailableAccounts(userToken: string, platform: MetaPlatform): Promise<readonly MetaAvailableAccount[]> {
    const fields = platform === 'instagram' ? 'id,name,access_token,instagram_business_account{id,username}' : 'id,name,access_token'
    const response = await this.getWithToken(`me/accounts?fields=${encodeURIComponent(fields)}`, userToken)
    if (!response.ok) throw new Error(`Meta account listing failed (${response.status})`)
    const data = (await response.json()) as { data?: unknown[] }
    const pages = Array.isArray(data.data) ? data.data : []
    const accounts: MetaAvailableAccount[] = []
    for (const page of pages) {
      if (typeof page !== 'object' || page === null) continue
      const record = page as Record<string, unknown>
      const pageAccessToken = typeof record.access_token === 'string' ? record.access_token : undefined
      if (!pageAccessToken) continue
      if (platform === 'facebook' && typeof record.id === 'string' && typeof record.name === 'string') {
        accounts.push({ externalAccountId: record.id, displayName: record.name, pageAccessToken })
      }
      if (platform === 'instagram' && typeof record.instagram_business_account === 'object' && record.instagram_business_account !== null) {
        const instagramAccount = record.instagram_business_account as Record<string, unknown>
        if (typeof instagramAccount.id === 'string') {
          accounts.push({
            externalAccountId: instagramAccount.id,
            displayName: typeof instagramAccount.username === 'string' ? instagramAccount.username : (typeof record.name === 'string' ? record.name : instagramAccount.id),
            pageAccessToken,
          })
        }
      }
    }
    return accounts
  }

  async verifyToken(accessToken: string): Promise<{ valid: boolean }> {
    // Ein Netzwerk-/Timeout-Fehler wird bewusst durchgereicht statt zu valid: false zu werden: er
    // ist keine Aussage ueber das Token, und der Verify-Endpunkt wuerde den Kanal sonst wegen einer
    // Stoerung bei Meta auf action_required setzen.
    const response = await this.getWithToken('me', accessToken)
    return { valid: response.ok }
  }
}

export class FakeMetaOAuthClient implements MetaOAuthClient {
  constructor(private readonly accounts: Readonly<Record<MetaPlatform, readonly MetaAvailableAccount[]>> = { instagram: [], facebook: [] }) {}
  authorizationUrl(options: { state: string; redirectUri: string; platform: MetaPlatform }): string {
    return `https://example.invalid/oauth/dialog?state=${encodeURIComponent(options.state)}&redirect_uri=${encodeURIComponent(options.redirectUri)}&platform=${options.platform}`
  }
  async exchangeCode(code: string): Promise<MetaExchangedToken> { return { accessToken: `short_${code}` } }
  async exchangeForLongLivedToken(shortLivedToken: string): Promise<MetaExchangedToken> { return { accessToken: `long_${shortLivedToken}` } }
  async listAvailableAccounts(_userToken: string, platform: MetaPlatform): Promise<readonly MetaAvailableAccount[]> { return this.accounts[platform] }
  async verifyToken(): Promise<{ valid: boolean }> { return { valid: true } }
}

// Paket 045: eigene Interfaces statt MetaOAuthClient wiederzuverwenden -- Twitter/X (OAuth2 + PKCE,
// genau ein Konto pro Verbindung) und LinkedIn (Standard-OAuth2, Organisations-Listing) haben
// strukturell andere Flows als der gemeinsame Meta-Adapter. Nur die Fake-Implementierungen sind Teil
// dieses Pakets (PR 1) -- RealTwitterOAuthClient/RealLinkedInOAuthClient sowie TwitterPublisher/
// LinkedInPublisher folgen in eigenen PRs, sobald echte Entwickler-Zugaenge vorliegen (plans/045).

export interface TwitterExchangedToken { accessToken: string; refreshToken?: string; expiresInSeconds?: number }
// Kein "Seiten-Token" wie bei Meta -- X kennt kein Konzept getrennter Seiten, das Nutzer-Token selbst
// wird zum Posten verwendet. Genau ein Konto pro Verbindung (kein Auswahlschritt noetig, die
// bestehende Pending-Auswahl-UI verarbeitet das als Liste der Laenge 1).
export interface TwitterAvailableAccount { externalAccountId: string; displayName: string; accessToken: string; refreshToken?: string }
export interface TwitterOAuthClient {
  authorizationUrl(options: { state: string; redirectUri: string; codeChallenge: string }): string
  exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<TwitterExchangedToken>
  listAvailableAccounts(accessToken: string): Promise<readonly TwitterAvailableAccount[]>
  verifyToken(accessToken: string): Promise<{ valid: boolean }>
}

export class FakeTwitterOAuthClient implements TwitterOAuthClient {
  constructor(private readonly accounts: readonly TwitterAvailableAccount[] = []) {}
  authorizationUrl(options: { state: string; redirectUri: string; codeChallenge: string }): string {
    return `https://example.invalid/oauth/dialog?state=${encodeURIComponent(options.state)}&redirect_uri=${encodeURIComponent(options.redirectUri)}&platform=twitter`
  }
  async exchangeCode(code: string): Promise<TwitterExchangedToken> { return { accessToken: `short_${code}` } }
  async listAvailableAccounts(): Promise<readonly TwitterAvailableAccount[]> { return this.accounts }
  async verifyToken(): Promise<{ valid: boolean }> { return { valid: true } }
}

export interface LinkedInExchangedToken { accessToken: string; expiresInSeconds?: number }
// Paket 045-Entscheidung: LinkedIn als Vereins-Unternehmensseite (w_organization_social), nicht als
// persoenliches Mitgliedsprofil -- listAvailableAccounts liefert die vom Nutzer administrierten
// Seiten, analog zu Metas "me/accounts".
export interface LinkedInAvailableAccount { externalAccountId: string; displayName: string; accessToken: string }
export interface LinkedInOAuthClient {
  authorizationUrl(options: { state: string; redirectUri: string }): string
  exchangeCode(code: string, redirectUri: string): Promise<LinkedInExchangedToken>
  listAvailableAccounts(accessToken: string): Promise<readonly LinkedInAvailableAccount[]>
  verifyToken(accessToken: string): Promise<{ valid: boolean }>
}

export class FakeLinkedInOAuthClient implements LinkedInOAuthClient {
  constructor(private readonly accounts: readonly LinkedInAvailableAccount[] = []) {}
  authorizationUrl(options: { state: string; redirectUri: string }): string {
    return `https://example.invalid/oauth/dialog?state=${encodeURIComponent(options.state)}&redirect_uri=${encodeURIComponent(options.redirectUri)}&platform=linkedin`
  }
  async exchangeCode(code: string): Promise<LinkedInExchangedToken> { return { accessToken: `short_${code}` } }
  async listAvailableAccounts(): Promise<readonly LinkedInAvailableAccount[]> { return this.accounts }
  async verifyToken(): Promise<{ valid: boolean }> { return { valid: true } }
}
