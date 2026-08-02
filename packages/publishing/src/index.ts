export type Platform = 'instagram' | 'facebook'

export interface PublicationInput {
  publicationId: string
  postVersionId: string
  platform: Platform
  caption: string
  mediaUrl?: string
  scheduledFor?: string
  idempotencyKey: string
}

export interface ValidationResult {
  valid: boolean
  errors: readonly string[]
}

export interface PublicationResult {
  externalId: string
  status: 'published' | 'scheduled'
}

export interface SocialPublisher {
  validate(input: PublicationInput): Promise<ValidationResult>
  publish(input: PublicationInput): Promise<PublicationResult>
  getStatus(externalId: string): Promise<PublicationResult['status'] | 'failed' | 'unknown'>
  delete?(externalId: string): Promise<void>
}

export class FakePublisher implements SocialPublisher {
  private readonly publications = new Map<string, PublicationResult>()

  async validate(input: PublicationInput): Promise<ValidationResult> {
    const maxCaption = input.platform === 'instagram' ? 2_200 : 63_206
    return input.caption.length <= maxCaption
      ? { valid: true, errors: [] }
      : { valid: false, errors: [`Caption exceeds ${maxCaption} characters`] }
  }

  async publish(input: PublicationInput): Promise<PublicationResult> {
    const existing = this.publications.get(input.idempotencyKey)
    if (existing) return existing
    const validation = await this.validate(input)
    if (!validation.valid) throw new Error(validation.errors.join(', '))
    const result: PublicationResult = {
      externalId: `fake_${input.publicationId}`,
      status: input.scheduledFor ? 'scheduled' : 'published',
    }
    this.publications.set(input.idempotencyKey, result)
    return result
  }

  async getStatus(externalId: string) {
    return [...this.publications.values()].find((item) => item.externalId === externalId)?.status ?? 'unknown'
  }
}
