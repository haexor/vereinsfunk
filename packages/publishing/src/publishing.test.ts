import { describe, expect, it } from 'vitest'
import { FakePublisher } from './index.js'

describe('fake publisher', () => {
  it('returns the same publication for a retry', async () => {
    const publisher = new FakePublisher()
    const input = {
      publicationId: 'pub-1',
      postVersionId: 'version-1',
      socialConnectionId: 'connection-1',
      platform: 'instagram' as const,
      caption: 'Ein Test',
      media: [{ derivativeId: 'derivative-1', sha256: 'a'.repeat(64), mimeType: 'image/jpeg', grantUrl: 'https://example.invalid/grant', role: 'primary' as const }],
      idempotencyKey: 'publish:pub-1:instagram:version-1',
    }
    expect(await publisher.publish(input)).toEqual(await publisher.publish(input))
  })
})
