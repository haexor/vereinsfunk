import { z } from 'zod'

export type Platform = 'instagram' | 'facebook' | 'twitter' | 'linkedin'
export type PublicationStatus = 'queued' | 'uploading' | 'processing' | 'published' | 'failed' | 'unknown' | 'action_required' | 'cancelled'
export interface PublicationMedia { derivativeId: string; sha256: string; mimeType: string; grantUrl: string; role: 'primary' | 'slide' }
export interface PublicationInput { publicationId: string; postVersionId: string; socialConnectionId: string; platform: Platform; caption: string; media: readonly PublicationMedia[]; scheduledFor?: string; idempotencyKey: string }
export interface PublicationReference { publicationId: string; platform: Platform; externalId?: string; socialConnectionId: string }
export interface ValidationResult { valid: boolean; errors: readonly string[] }
/** Ein einzelner, bereits ausgefuehrter externer Schreibaufruf und die ID, die er erzeugt hat. */
export interface PublicationStep { label: string; externalId: string }
// completedSteps traegt die Zwischen-IDs eines mehrstufigen Ablaufs (Meta-Karussell: Item-Container
// und uebergeordneter Container, Facebook-Mehrfoto: die unveroeffentlichten Fotos). Optional, weil
// ein einstufiger Publish nichts zu berichten hat ausser der externalId selbst.
export interface PublicationResult { externalId: string; status: Extract<PublicationStatus, 'published' | 'processing' | 'unknown' | 'failed'>; permalink?: string; completedSteps?: readonly PublicationStep[] }
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
// Systemgrenze zum Meta-Provider (AGENTS.md: "Alle Systemgrenzen werden mit Zod validiert") --
// jeder schreibende Graph-Aufruf antwortet mit derselben Huelle: genau einer nichtleeren id.
const MetaWriteResponseSchema = z.object({ id: z.string().min(1) })

// Der Karussell-Fluss (Plan 047, PR 2) macht pro Beitrag N+2 statt einem einzigen Schreibaufruf.
// Meta kennt fuer die Content-Publishing-Endpunkte keine Idempotenzkennung -- input.idempotencyKey
// laesst sich hier also nicht durchreichen. Was bleibt, ist Buchfuehrung: schlaegt Schritt k fehl,
// existieren die k-1 Objekte davor trotzdem bei Meta. Ohne ihre IDs im Fehlerfall waere nicht mehr
// feststellbar, was dort liegt -- genau das, was der Hinweis "reconcile before retrying" in post()
// verlangt (AGENTS.md: "Externe Aktionen sind idempotent und werden auditiert").
export class MetaPublishError extends Error {
  constructor(message: string, readonly completedSteps: readonly PublicationStep[]) {
    super(message)
    this.name = 'MetaPublishError'
  }
}

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
  // Gemeinsamer Kern jedes Graph-API-Schreibaufrufs in publish() (Einzelfoto- wie Karussell-Fluss)
  // -- label fliesst nur in die Fehlermeldung ein (Vorbild: RealMetaOAuthClient.post() oben), damit
  // ein Fehlschlag mitten in einem mehrstufigen Karussell-Aufbau erkennen laesst, welcher der
  // Graph-Aufrufe betroffen war, statt einer einzigen generischen Meldung fuer alle Schritte.
  private async post(url: string, body: URLSearchParams, headers: Record<string, string>, label: string): Promise<string> {
    const response = await this.request(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(this.timeoutMs) })
    if (!response.ok) throw new Error(`Meta ${label} failed (${response.status})`)
    const parsed = MetaWriteResponseSchema.safeParse(await response.json())
    if (!parsed.success) throw new Error(`Meta ${label} response did not contain an ID; reconcile before retrying`)
    return parsed.data.id
  }
  async publish(input: PublicationInput): Promise<PublicationResult> {
    const validation = await this.validate(input); if (!validation.valid) throw new Error(validation.errors.join(', '))
    const base = `https://graph.facebook.com/${this.options.graphVersion}`
    const target = input.platform === 'instagram' ? this.options.instagramAccountId! : this.options.facebookPageId!
    const headers = { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${this.options.accessToken}` }
    // Karussell (Plan 047, PR 2): weder Instagram noch Facebook erlauben mehrere Fotos ueber den
    // einstufigen Einzelfoto-Fluss unten -- beide brauchen je Foto zuerst einen eigenen,
    // unveroeffentlichten Medien-Container, danach einen uebergeordneten Container/Post, der alle
    // referenziert. Bei genau einem Foto bleibt der bisherige, einstufige Fluss unveraendert.
    if (input.media.length > 1) {
      // Buchfuehrung ueber die bereits ausgefuehrten Schritte: erst nach der Rueckmeldung von Meta
      // verbucht, damit ein Fehlschlag mitten im Ablauf nach aussen traegt, welche Objekte dort
      // wirklich entstanden sind (siehe MetaPublishError).
      const completed: PublicationStep[] = []
      const step = async (url: string, body: URLSearchParams, label: string): Promise<string> => {
        const externalId = await this.post(url, body, headers, label)
        completed.push({ label, externalId })
        return externalId
      }
      try {
        if (input.platform === 'instagram') {
          const childIds: string[] = []
          for (const item of input.media) childIds.push(await step(`${base}/${target}/media`, new URLSearchParams({ image_url: item.grantUrl, is_carousel_item: 'true' }), 'carousel item creation'))
          const containerId = await step(`${base}/${target}/media`, new URLSearchParams({ media_type: 'CAROUSEL', caption: input.caption, children: childIds.join(',') }), 'carousel container creation')
          const externalId = await step(`${base}/${target}/media_publish`, new URLSearchParams({ creation_id: containerId }), 'carousel publish')
          return { externalId, status: 'published', completedSteps: completed }
        }
        // Facebook kennt keinen eigenen Karussell-Typ -- ein Mehrfoto-Beitrag ist ein normaler
        // Feed-Post mit mehreren zuvor unveroeffentlichten Fotos (attached_media). Der Feed-Aufruf
        // selbst liefert bereits die endgueltige Post-ID; anders als bei Instagram gibt es hier keinen
        // zweiten Publish-Schritt.
        const photoIds: string[] = []
        for (const item of input.media) photoIds.push(await step(`${base}/${target}/photos`, new URLSearchParams({ url: item.grantUrl, published: 'false' }), 'unpublished photo upload'))
        const attachedMedia = Object.fromEntries(photoIds.map((id, index) => [`attached_media[${index}]`, JSON.stringify({ media_fbid: id })]))
        const externalId = await step(`${base}/${target}/feed`, new URLSearchParams({ message: input.caption, ...attachedMedia }), 'multi-photo feed post')
        return { externalId, status: 'published', completedSteps: completed }
      } catch (err) {
        // Botschaft unveraendert weiterreichen: die Route klassifiziert retry-faehig/nicht
        // retry-faehig anhand des HTTP-Status im Fehlertext (routes/publishing.ts, "Klassifikation
        // nach Plan 004") -- ein eigener Text wuerde jeden Mehrfoto-Fehlschlag zu 'unknown' machen.
        throw new MetaPublishError(err instanceof Error ? err.message : 'Meta multi-photo publish failed', completed)
      }
    }
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
    const containerId = await this.post(endpoint, body, headers, 'publish request')
    if (input.platform === 'facebook') return { externalId: containerId, status: 'published' }
    const externalId = await this.post(`${base}/${target}/media_publish`, new URLSearchParams({ creation_id: containerId }), headers, 'media_publish')
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
