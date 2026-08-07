import { describe, expect, it, vi } from 'vitest'
import { FakeMetaOAuthClient, FakePublisher, RealMetaOAuthClient } from './index.js'

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
