import { describe, expect, it, vi } from 'vitest'
import { FakeLinkedInOAuthClient, FakeMetaOAuthClient, FakePublisher, FakeTwitterOAuthClient, MetaPublisher, RealMetaOAuthClient, type Platform, type PublicationInput } from './index.js'

function publicationInput(overrides: Partial<PublicationInput> = {}): PublicationInput {
  return {
    publicationId: 'pub-1',
    postVersionId: 'version-1',
    socialConnectionId: 'connection-1',
    platform: 'instagram',
    caption: 'Ein Test',
    media: [{ derivativeId: 'derivative-1', sha256: 'a'.repeat(64), mimeType: 'image/jpeg', grantUrl: 'https://example.invalid/grant', role: 'primary' }],
    idempotencyKey: 'publish:pub-1:instagram:version-1',
    ...overrides,
  }
}

describe('fake publisher', () => {
  it('returns the same publication for a retry', async () => {
    const publisher = new FakePublisher()
    const input = publicationInput()
    expect(await publisher.publish(input)).toEqual(await publisher.publish(input))
  })

  // Paket 045: X (280) und LinkedIn (3000) sind die echten Plattform-Maxima -- vorher gab es nur
  // die Zweiteilung Instagram (2200) / "alles andere" (63206, Facebooks Grenze).
  it.each([
    ['instagram', 2_200],
    ['facebook', 63_206],
    ['twitter', 280],
    ['linkedin', 3_000],
  ] as const)('enforces the %s caption limit (%d characters)', async (platform, limit) => {
    const publisher = new FakePublisher()
    const tooLong = publicationInput({ platform, caption: 'x'.repeat(limit + 1), media: [] })
    const result = await publisher.validate(tooLong)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain(`${limit} characters`)
  })

  // Paket 045: nur Instagram verlangt technisch zwingend ein Bild -- Facebooks bisheriger
  // unconditional-Foto-Zwang war eine Einschraenkung dieses Adapters, keine echte API-Grenze.
  it('requires media only for instagram', async () => {
    const publisher = new FakePublisher()
    expect((await publisher.validate(publicationInput({ platform: 'instagram', media: [] }))).valid).toBe(false)
    for (const platform of ['facebook', 'twitter', 'linkedin'] as const) {
      expect((await publisher.validate(publicationInput({ platform, media: [] }))).valid).toBe(true)
    }
  })
})

describe('MetaPublisher', () => {
  function publisher(fetchImpl: typeof fetch) {
    return new MetaPublisher({ graphVersion: 'v21.0', accessToken: 'token', instagramAccountId: 'ig-1', facebookPageId: 'page-1', fetch: fetchImpl })
  }

  it('posts a Facebook page update without media to /feed using the message field', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: 'post-1' })) as unknown as typeof fetch
    await publisher(fetchImpl).publish(publicationInput({ platform: 'facebook', media: [] }))
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/page-1/feed')
    expect(String(init.body)).toContain('message=')
    expect(String(init.body)).not.toContain('url=')
  })

  it('posts a Facebook page update with media to /photos using the caption field', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: 'post-1' })) as unknown as typeof fetch
    await publisher(fetchImpl).publish(publicationInput({ platform: 'facebook' }))
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/page-1/photos')
    expect(String(init.body)).toContain('caption=')
  })

  it('rejects a platform it does not implement (Twitter/LinkedIn are separate adapters)', async () => {
    const result = await publisher(vi.fn()).validate(publicationInput({ platform: 'twitter' as Platform }))
    expect(result.valid).toBe(false)
  })
})

describe('RealMetaOAuthClient', () => {
  function client(fetchImpl: typeof fetch) {
    return new RealMetaOAuthClient({ appId: 'app-id', appSecret: 'app-secret', graphVersion: 'v21.0', fetch: fetchImpl })
  }

  it('builds an authorization URL with state, redirect_uri and platform-specific scopes', () => {
    const url = new URL(client(vi.fn()).authorizationUrl({ state: 'nonce-1', redirectUri: 'https://api.example.org/callback', platform: 'instagram' }))
    expect(url.searchParams.get('client_id')).toBe('app-id')
    expect(url.searchParams.get('state')).toBe('nonce-1')
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.org/callback')
    expect(url.searchParams.get('scope')).toContain('instagram_content_publish')
  })

  it('rejects a failed code exchange instead of returning a partial token', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 400 })) as unknown as typeof fetch
    await expect(client(fetchImpl).exchangeCode('bad-code', 'https://api.example.org/callback')).rejects.toThrow(/failed/)
  })

  it('parses the access token from a successful code exchange', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: 'short-token', expires_in: 3600 })) as unknown as typeof fetch
    const result = await client(fetchImpl).exchangeCode('code', 'https://api.example.org/callback')
    expect(result).toEqual({ accessToken: 'short-token', expiresInSeconds: 3600 })
  })

  // URLs landen in Proxy-, Server- und Fehlerlogs -- appSecret und Zugriffstoken duerfen deshalb
  // nur im POST-Body bzw. im Authorization-Header stehen, nie als Query-Parameter.
  it('sends the app secret in the request body and never in the URL', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: 'short-token' })) as unknown as typeof fetch
    await client(fetchImpl).exchangeCode('code', 'https://api.example.org/callback')
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('app-secret')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toContain('client_secret=app-secret')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends the access token as a bearer header and never in the URL', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [] })) as unknown as typeof fetch
    await client(fetchImpl).listAvailableAccounts('user-token', 'facebook')
    await client(fetchImpl).verifyToken('user-token')
    for (const [url, init] of (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][]) {
      expect(url).not.toContain('user-token')
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer user-token')
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('aborts a Meta call that exceeds the configured timeout', async () => {
    const hangingFetch = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    ) as unknown as typeof fetch
    const timingOutClient = new RealMetaOAuthClient({ appId: 'app-id', appSecret: 'app-secret', graphVersion: 'v21.0', timeoutMs: 10, fetch: hangingFetch })
    await expect(timingOutClient.exchangeCode('code', 'https://api.example.org/callback')).rejects.toThrow()
  })

  it('maps facebook pages and instagram business accounts from /me/accounts', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [
          { id: 'page-1', name: 'SV Nordstadt', access_token: 'page-token-1', instagram_business_account: { id: 'ig-1', username: 'sv_nordstadt' } },
        ],
      }),
    ) as unknown as typeof fetch
    expect(await client(fetchImpl).listAvailableAccounts('user-token', 'facebook')).toEqual([
      { externalAccountId: 'page-1', displayName: 'SV Nordstadt', pageAccessToken: 'page-token-1' },
    ])
    expect(await client(fetchImpl).listAvailableAccounts('user-token', 'instagram')).toEqual([
      { externalAccountId: 'ig-1', displayName: 'sv_nordstadt', pageAccessToken: 'page-token-1' },
    ])
  })

  it('skips a page without an instagram business account when listing for instagram', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ id: 'page-1', name: 'SV Nordstadt', access_token: 'page-token-1' }] })) as unknown as typeof fetch
    expect(await client(fetchImpl).listAvailableAccounts('user-token', 'instagram')).toEqual([])
  })
})

describe('FakeMetaOAuthClient', () => {
  it('returns the configured accounts for the requested platform only', async () => {
    const fake = new FakeMetaOAuthClient({
      instagram: [{ externalAccountId: 'ig-1', displayName: 'sv_nordstadt', pageAccessToken: 'token' }],
      facebook: [],
    })
    expect(await fake.listAvailableAccounts('token', 'instagram')).toHaveLength(1)
    expect(await fake.listAvailableAccounts('token', 'facebook')).toHaveLength(0)
  })
})

// Paket 045: nur die Fake-Implementierungen sind Teil dieses Pakets -- Real*/Publisher folgen in
// eigenen PRs (plans/045), sobald echte Entwickler-Zugaenge vorliegen.
describe('FakeTwitterOAuthClient', () => {
  it('returns exactly the configured account (X hat kein Seiten-Konzept)', async () => {
    const fake = new FakeTwitterOAuthClient([{ externalAccountId: 'x-1', displayName: 'sv_nordstadt', accessToken: 'token' }])
    expect(await fake.listAvailableAccounts()).toEqual([{ externalAccountId: 'x-1', displayName: 'sv_nordstadt', accessToken: 'token' }])
  })
})

describe('FakeLinkedInOAuthClient', () => {
  it('returns the configured organization pages', async () => {
    const fake = new FakeLinkedInOAuthClient([{ externalAccountId: 'org-1', displayName: 'SV Nordstadt', accessToken: 'token' }])
    expect(await fake.listAvailableAccounts()).toEqual([{ externalAccountId: 'org-1', displayName: 'SV Nordstadt', accessToken: 'token' }])
  })
})
