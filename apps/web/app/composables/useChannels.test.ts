import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { ZodType } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScopedLoad } from './useLatestRequest'
import { useChannels } from './useChannels'

const PENDING_ID = '10000000-1000-4000-8000-000000000001'

describe('useChannels', () => {
  const scope = ref({ organizationId: 'A', departmentId: null as string | null })
  const route = { query: {} as Record<string, string> }
  let gateB: Promise<void> = Promise.resolve()
  let openB = () => {}
  let authorizationUrl = 'https://www.facebook.com/dialog/oauth'
  const request = vi.fn(async (path: string, _options?: unknown, schema?: ZodType) => {
    if (path.startsWith('/v1/channels/connect/')) return schema!.parse({ authorizationUrl })
    const organizationId = /^\/v1\/organizations\/([^/]+)\//.exec(path)?.[1]
    if (organizationId === 'B') await gateB
    if (path.endsWith('/channels')) return [{ id: `${organizationId}-channel`, scopes: [] }]
    if (path.endsWith('/members')) return []
    return {}
  })

  beforeEach(() => {
    scope.value = { organizationId: 'A', departmentId: null }
    route.query = {}
    authorizationUrl = 'https://www.facebook.com/dialog/oauth'
    gateB = new Promise<void>((resolve) => { openB = resolve })
    request.mockClear()
    const departments = { select: () => departments, eq: () => departments, is: () => departments, order: async () => ({ data: [], error: null }) }
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useScopedLoad', useScopedLoad)
    vi.stubGlobal('useApiClient', () => ({ request }))
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useScope', async () => scope)
    vi.stubGlobal('useSupabaseClient', () => ({ from: () => departments }))
    vi.stubGlobal('useCan', () => true)
    vi.stubGlobal('window', { location: { href: 'https://app.example/kanaele' } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the newest club when a slower answer for a previous club arrives late', async () => {
    const channels = await useChannels()

    scope.value = { organizationId: 'B', departmentId: null }
    await nextTick()
    scope.value = { organizationId: 'C', departmentId: null }
    await nextTick()
    await vi.waitFor(() => expect(channels.loading.value).toBe(false))
    openB()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(channels.channels.value.map((channel) => channel.id)).toEqual(['C-channel'])
    expect(channels.loading.value).toBe(false)
  })

  it('ignores a pending connection id that is not a UUID instead of putting it into the API path', async () => {
    route.query = { pending: '../channels/x/verify' }

    const channels = await useChannels()

    expect(channels.pendingId.value).toBeNull()
    expect(request.mock.calls.some(([path]) => path.includes('oauth-pending'))).toBe(false)
  })

  it('loads a pending connection by its UUID', async () => {
    route.query = { pending: PENDING_ID }

    await useChannels()

    expect(request).toHaveBeenCalledWith(`/v1/oauth-pending/${PENDING_ID}`, {}, expect.anything())
  })

  it('refuses to navigate to an authorization URL that is not https', async () => {
    authorizationUrl = 'javascript:alert(document.cookie)'
    const channels = await useChannels()

    await channels.connect('facebook', 'organization', null)

    expect(window.location.href).toBe('https://app.example/kanaele')
    expect(channels.actionError.value).toBe('Die Verbindung konnte nicht gestartet werden.')
  })
})
