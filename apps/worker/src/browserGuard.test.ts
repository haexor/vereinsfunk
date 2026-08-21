import { describe, expect, it, vi } from 'vitest'
import { assertNavigableUrl, guardOutboundRequests } from './browserGuard.js'

const publicLookup = async (hostname: string) => (hostname === 'verein.example.org' ? ['203.0.113.10'] : ['203.0.113.11'])
const privateLookup = async () => ['169.254.169.254']

describe('assertNavigableUrl', () => {
  it('allows a plain https url that resolves publicly', async () => {
    await expect(assertNavigableUrl('https://verein.example.org/', publicLookup)).resolves.toBeUndefined()
  })

  it('rejects http (no TLS)', async () => {
    await expect(assertNavigableUrl('http://verein.example.org/', publicLookup)).rejects.toMatchObject({ reason: 'blocked_url' })
  })

  it('rejects a hostname that resolves to a private/metadata address (DNS rebinding)', async () => {
    await expect(assertNavigableUrl('https://verein.example.org/', privateLookup)).rejects.toMatchObject({ reason: 'blocked_url' })
  })

  it('rejects an internal-looking hostname outright', async () => {
    await expect(assertNavigableUrl('https://service.internal/', publicLookup)).rejects.toMatchObject({ reason: 'blocked_url' })
  })
})

class FakeRoute {
  continued = false
  aborted = false
  /** `failWith` steht fuer den Normalfall "Seite/Browser inzwischen geschlossen": Playwright wirft dann. */
  constructor(private readonly url: string, private readonly failWith?: Error) {}
  request() {
    return { url: () => this.url }
  }
  async continue() { this.continued = true; if (this.failWith) throw this.failWith }
  async abort() { this.aborted = true; if (this.failWith) throw this.failWith }
}

function fakeRouter() {
  let handler: ((route: FakeRoute) => Promise<void>) | undefined
  return {
    route: vi.fn(async (_pattern: string, fn: (route: FakeRoute) => Promise<void>) => { handler = fn }),
    async dispatch(url: string, failWith?: Error) {
      const route = new FakeRoute(url, failWith)
      await handler!(route)
      return route
    },
  }
}

describe('guardOutboundRequests', () => {
  it('continues a request to a public host', async () => {
    const router = fakeRouter()
    await guardOutboundRequests(router as never, publicLookup)
    const route = await router.dispatch('https://verein.example.org/logo.png')
    expect(route.continued).toBe(true)
    expect(route.aborted).toBe(false)
  })

  it('aborts a sub-request that resolves to a blocked address, even mid-page-load', async () => {
    const router = fakeRouter()
    await guardOutboundRequests(router as never, privateLookup)
    const route = await router.dispatch('https://cdn.example.org/script.js')
    expect(route.aborted).toBe(true)
    expect(route.continued).toBe(false)
  })

  it('aborts a request whose url cannot be parsed', async () => {
    const router = fakeRouter()
    await guardOutboundRequests(router as never, publicLookup)
    const route = await router.dispatch('not-a-url')
    expect(route.aborted).toBe(true)
  })

  it('resolves each distinct hostname only once (cache), but every hostname is still checked', async () => {
    const lookup = vi.fn(publicLookup)
    const router = fakeRouter()
    await guardOutboundRequests(router as never, lookup)
    await router.dispatch('https://verein.example.org/a.png')
    await router.dispatch('https://verein.example.org/b.png')
    await router.dispatch('https://andere-domain.example.org/c.png')
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  // Ohne dieses Verhalten waere ein Request, der noch laeuft, waehrend render() den Browser
  // schliesst, eine unbehandelte Rejection -- und die beendet den ganzen Worker-Prozess.
  it('swallows a continue/abort that fails because the page is already closed', async () => {
    const router = fakeRouter()
    await guardOutboundRequests(router as never, publicLookup)
    await expect(router.dispatch('https://verein.example.org/late.png', new Error('Target page, context or browser has been closed'))).resolves.toBeDefined()
    await expect(router.dispatch('https://blocked.example.org/late.png', new Error('Route is already handled!'))).resolves.toBeDefined()
  })

  // page.route()/context.route() ist asynchron: bis es erfuellt ist, faengt Chromium noch nichts
  // ab. Der Guard muss es abwarten, sonst liefe eine Navigation unmittelbar danach ungeprueft
  // hinaus -- genau der Sub-Request-Weg, den er schliessen soll.
  it('does not resolve before the route registration itself has resolved', async () => {
    let release = () => {}
    const registered = new Promise<void>((resolve) => { release = resolve })
    const router = { route: vi.fn(async () => { await registered }) }
    let guardReady = false
    const guarding = guardOutboundRequests(router as never, publicLookup).then(() => { guardReady = true })
    await new Promise((resolve) => { setImmediate(resolve) })
    expect(guardReady).toBe(false)
    release()
    await guarding
    expect(guardReady).toBe(true)
  })
})
