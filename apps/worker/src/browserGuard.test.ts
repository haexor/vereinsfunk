import { describe, expect, it, vi } from 'vitest'
import { assertNavigableUrl, guardPageNavigation } from './browserGuard.js'

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

function fakePage() {
  let handler: ((route: FakeRoute) => void) | undefined
  return {
    route: vi.fn((_pattern: string, fn: (route: FakeRoute) => void) => { handler = fn }),
    async dispatch(url: string) {
      const route = new FakeRoute(url)
      handler!(route)
      await route.settled
      return route
    },
  }
}

class FakeRoute {
  continued = false
  aborted = false
  settled: Promise<void>
  private resolveSettled!: () => void
  constructor(private readonly url: string) {
    this.settled = new Promise((resolve) => { this.resolveSettled = resolve })
  }
  request() {
    return { url: () => this.url }
  }
  async continue() { this.continued = true; this.resolveSettled() }
  async abort() { this.aborted = true; this.resolveSettled() }
}

describe('guardPageNavigation', () => {
  it('continues a request to a public host', async () => {
    const page = fakePage()
    guardPageNavigation(page as never, publicLookup)
    const route = await page.dispatch('https://verein.example.org/logo.png')
    expect(route.continued).toBe(true)
    expect(route.aborted).toBe(false)
  })

  it('aborts a sub-request that resolves to a blocked address, even mid-page-load', async () => {
    const page = fakePage()
    guardPageNavigation(page as never, privateLookup)
    const route = await page.dispatch('https://cdn.example.org/script.js')
    expect(route.aborted).toBe(true)
    expect(route.continued).toBe(false)
  })

  it('aborts a request whose url cannot be parsed', async () => {
    const page = fakePage()
    guardPageNavigation(page as never, publicLookup)
    const route = await page.dispatch('not-a-url')
    expect(route.aborted).toBe(true)
  })

  it('resolves each distinct hostname only once (cache), but every hostname is still checked', async () => {
    const lookup = vi.fn(publicLookup)
    const page = fakePage()
    guardPageNavigation(page as never, lookup)
    await page.dispatch('https://verein.example.org/a.png')
    await page.dispatch('https://verein.example.org/b.png')
    await page.dispatch('https://andere-domain.example.org/c.png')
    expect(lookup).toHaveBeenCalledTimes(2)
  })
})
