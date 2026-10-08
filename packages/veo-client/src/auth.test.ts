import { describe, expect, it } from 'vitest'
import { exchangeSessionCookieForToken } from './auth.js'
import type { FetchLike } from './http.js'
import { captureSessionViaLogin, type LoginBrowser, type LoginLocator, type LoginPage } from './login.js'

/** Fake fuer auth.veo.co: authorize leitet mit oder ohne Code weiter, token antwortet wie angegeben. */
function oidcFake(options: { code: string | null; state?: 'echo' | 'missing' | 'wrong'; tokenStatus?: number; tokenBody?: unknown }) {
  const calls: { url: URL; init: RequestInit | undefined }[] = []
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input)
    calls.push({ url, init })
    if (url.pathname === '/oidc/auth') {
      const returnedState = options.state === 'missing' ? null : options.state === 'wrong' ? 'wrong' : url.searchParams.get('state')
      const redirect = new URL('https://app.veo.co/signin-redirect/')
      if (options.code) redirect.searchParams.set('code', options.code)
      if (returnedState) redirect.searchParams.set('state', returnedState)
      if (!options.code) redirect.searchParams.set('error', 'login_required')
      const location = redirect.toString()
      return new Response(null, { status: 303, headers: { location } })
    }
    return new Response(JSON.stringify(options.tokenBody ?? { access_token: 'access', expires_in: 3600, token_type: 'Bearer' }), { status: options.tokenStatus ?? 200 })
  }
  return { fetch, calls }
}

describe('exchangeSessionCookieForToken', () => {
  it('exchanges the session cookie via PKCE for an access token', async () => {
    const { fetch, calls } = oidcFake({ code: 'abc' })
    const token = await exchangeSessionCookieForToken('sessionid=1', { fetch })
    expect(token.accessToken).toBe('access')
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3_000_000)
    const authorize = calls[0]!
    expect(authorize.url.searchParams.get('prompt')).toBe('none')
    expect(authorize.url.searchParams.get('code_challenge_method')).toBe('S256')
    expect((authorize.init?.headers as Record<string, string>).cookie).toBe('sessionid=1')
    expect(authorize.init?.redirect).toBe('manual')
    const body = new URLSearchParams(String(calls[1]?.init?.body))
    expect(body.get('code')).toBe('abc')
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('reports a session that no longer renews as auth_expired', async () => {
    await expect(exchangeSessionCookieForToken('old', { fetch: oidcFake({ code: null }).fetch })).rejects.toMatchObject({ code: 'auth_expired' })
    await expect(exchangeSessionCookieForToken('old', { fetch: oidcFake({ code: 'x', tokenStatus: 400 }).fetch })).rejects.toMatchObject({ code: 'auth_expired' })
  })

  it('rejects an authorization response with a missing or mismatched state', async () => {
    await expect(exchangeSessionCookieForToken('old', { fetch: oidcFake({ code: 'x', state: 'missing' }).fetch })).rejects.toMatchObject({ code: 'auth_expired' })
    await expect(exchangeSessionCookieForToken('old', { fetch: oidcFake({ code: 'x', state: 'wrong' }).fetch })).rejects.toMatchObject({ code: 'auth_expired' })
  })

  it('reports a changed token response as upstream_changed', async () => {
    await expect(exchangeSessionCookieForToken('c', { fetch: oidcFake({ code: 'x', tokenBody: { token: 'x' } }).fetch })).rejects.toMatchObject({ code: 'upstream_changed' })
  })
})

/** Browser-Fake: nach Enter landet die Seite auf `landing`, Cookies wie angegeben. */
function fakeBrowser(options: { landing: string; cookies?: { name: string; value: string }[]; formMissing?: boolean }) {
  const filled: string[] = []
  let current = 'https://app.veo.co/accounts/login/'
  let closed = false
  const locator = (): LoginLocator => ({
    first: () => locator(),
    waitFor: async () => { if (options.formMissing) throw new Error('timeout') },
    fill: async (value) => { filled.push(value) },
    press: async () => { current = options.landing },
    click: async () => { throw new Error('no banner') },
  })
  const page: LoginPage = {
    goto: async () => undefined,
    locator: () => locator(),
    getByRole: () => locator(),
    waitForURL: async () => undefined,
    url: () => current,
  }
  const browser: LoginBrowser = {
    newContext: async () => ({ newPage: async () => page, cookies: async () => options.cookies ?? [] }),
    close: async () => { closed = true },
  }
  return { launch: async () => browser, filled, isClosed: () => closed }
}

describe('captureSessionViaLogin', () => {
  it('returns the auth.veo.co cookies after a successful login and closes the browser', async () => {
    const fake = fakeBrowser({ landing: 'https://app.veo.co/matches/', cookies: [{ name: 'sessionid', value: 'a' }, { name: 'csrftoken', value: 'b' }] })
    expect(await captureSessionViaLogin('coach@example.local', 'secret', fake.launch)).toBe('sessionid=a; csrftoken=b')
    expect(fake.filled).toEqual(['coach@example.local', 'secret'])
    expect(fake.isClosed()).toBe(true)
  })

  it('fails with login_failed when Veo stays on the login page or sets no cookie', async () => {
    const stays = fakeBrowser({ landing: 'https://app.veo.co/accounts/login/?error=1' })
    await expect(captureSessionViaLogin('a', 'b', stays.launch)).rejects.toMatchObject({ code: 'login_failed' })
    expect(stays.isClosed()).toBe(true)
    await expect(captureSessionViaLogin('a', 'b', fakeBrowser({ landing: 'https://app.veo.co/' }).launch)).rejects.toMatchObject({ code: 'login_failed' })
  })

  it('reports a missing login form as upstream_changed', async () => {
    await expect(captureSessionViaLogin('a', 'b', fakeBrowser({ landing: 'x', formMissing: true }).launch)).rejects.toMatchObject({ code: 'upstream_changed' })
  })
})
