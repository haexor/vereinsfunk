export type Platform = 'instagram' | 'facebook'
export type PublicationStatus = 'queued' | 'uploading' | 'processing' | 'published' | 'failed' | 'unknown' | 'action_required' | 'cancelled'
export interface PublicationMedia { derivativeId: string; sha256: string; mimeType: string; grantUrl: string; role: 'primary' | 'slide' }
export interface PublicationInput { publicationId: string; postVersionId: string; socialConnectionId: string; platform: Platform; caption: string; media: readonly PublicationMedia[]; scheduledFor?: string; idempotencyKey: string }
export interface PublicationReference { publicationId: string; platform: Platform; externalId?: string; socialConnectionId: string }
export interface ValidationResult { valid: boolean; errors: readonly string[] }
export interface PublicationResult { externalId: string; status: Extract<PublicationStatus, 'published' | 'processing' | 'unknown' | 'failed'>; permalink?: string }
export interface SocialPublisher { validate(input: PublicationInput): Promise<ValidationResult>; publish(input: PublicationInput): Promise<PublicationResult>; reconcile(input: PublicationReference): Promise<PublicationResult>; delete?(input: PublicationReference): Promise<void> }

export class FakePublisher implements SocialPublisher {
  private readonly publications = new Map<string, PublicationResult>()
  async validate(input: PublicationInput): Promise<ValidationResult> { const maxCaption = input.platform === 'instagram' ? 2_200 : 63_206; const errors = input.caption.length > maxCaption ? [`Caption exceeds ${maxCaption} characters`] : []; if (input.media.length === 0) errors.push('At least one approved derivative is required'); if (input.media.some((media) => !/^[a-f0-9]{64}$/i.test(media.sha256))) errors.push('Media hash is invalid'); return { valid: errors.length === 0, errors } }
  async publish(input: PublicationInput): Promise<PublicationResult> { const existing = this.publications.get(input.idempotencyKey); if (existing) return existing; const validation = await this.validate(input); if (!validation.valid) throw new Error(validation.errors.join(', ')); const result: PublicationResult = { externalId: `fake_${input.publicationId}`, status: 'published', permalink: `https://example.invalid/${input.publicationId}` }; this.publications.set(input.idempotencyKey, result); return result }
  async reconcile(input: PublicationReference): Promise<PublicationResult> { return [...this.publications.values()].find((result) => result.externalId === input.externalId) ?? { externalId: input.externalId ?? `unknown_${input.publicationId}`, status: 'unknown' } }
}

export interface MetaPublisherOptions { graphVersion: string; accessToken: string; instagramAccountId?: string; facebookPageId?: string; fetch?: typeof fetch }
/** Direct Graph API adapter. Tokens and media grants are created server-side and never accepted from a browser. */
export class MetaPublisher implements SocialPublisher {
  private readonly request: typeof fetch
  constructor(private readonly options: MetaPublisherOptions) { this.request = options.fetch ?? fetch }
  async validate(input: PublicationInput): Promise<ValidationResult> { const fake = new FakePublisher(); const base = await fake.validate(input); if (input.platform === 'instagram' && !this.options.instagramAccountId) return { valid: false, errors: [...base.errors, 'Instagram account is not configured'] }; if (input.platform === 'facebook' && !this.options.facebookPageId) return { valid: false, errors: [...base.errors, 'Facebook page is not configured'] }; return base }
  async publish(input: PublicationInput): Promise<PublicationResult> {
    const validation = await this.validate(input); if (!validation.valid) throw new Error(validation.errors.join(', '))
    const base = `https://graph.facebook.com/${this.options.graphVersion}`
    const target = input.platform === 'instagram' ? this.options.instagramAccountId! : this.options.facebookPageId!
    const endpoint = input.platform === 'instagram' ? `${base}/${target}/media` : `${base}/${target}/photos`
    const media = input.media[0]!
    const body = new URLSearchParams({ access_token: this.options.accessToken, caption: input.caption, ...(input.platform === 'instagram' ? { image_url: media.grantUrl } : { url: media.grantUrl }) })
    const response = await this.request(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    if (!response.ok) throw new Error(`Meta publish request failed (${response.status})`)
    const data: unknown = await response.json(); const externalId = typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string' ? data.id : undefined
    if (!externalId) throw new Error('Meta response did not contain an ID; reconcile before retrying')
    return { externalId, status: input.platform === 'instagram' ? 'processing' : 'published' }
  }
  async reconcile(input: PublicationReference): Promise<PublicationResult> { if (!input.externalId) return { externalId: `unknown_${input.publicationId}`, status: 'unknown' }; const response = await this.request(`https://graph.facebook.com/${this.options.graphVersion}/${input.externalId}?fields=id,permalink&access_token=${encodeURIComponent(this.options.accessToken)}`); if (response.status === 404) return { externalId: input.externalId, status: 'unknown' }; if (!response.ok) throw new Error(`Meta reconciliation failed (${response.status})`); const data: unknown = await response.json(); const permalink = typeof data === 'object' && data !== null && 'permalink' in data && typeof data.permalink === 'string' ? data.permalink : undefined; return permalink ? { externalId: input.externalId, status: 'published', permalink } : { externalId: input.externalId, status: 'published' } }
}
