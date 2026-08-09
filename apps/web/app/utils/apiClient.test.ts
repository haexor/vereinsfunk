import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApiClient } from './apiClient'

describe('createApiClient', () => {
  it('adds the current bearer header to authenticated requests', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    const client = createApiClient({ fetch, getAuthHeaders: vi.fn().mockResolvedValue({ authorization: 'Bearer current-token' }) })

    await client.request('/v1/private')

    expect(fetch).toHaveBeenCalledWith('/v1/private', expect.objectContaining({ headers: { authorization: 'Bearer current-token' } }))
  })

  it('does not read a session for explicitly public requests', async () => {
    const getAuthHeaders = vi.fn()
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    const client = createApiClient({ fetch, getAuthHeaders })

    await client.request('/v1/public', { authenticate: false })

    expect(getAuthHeaders).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('/v1/public', expect.objectContaining({ headers: {} }))
  })

  it('validates a response at the browser boundary', async () => {
    const client = createApiClient({ fetch: vi.fn().mockResolvedValue({ id: 42 }), getAuthHeaders: vi.fn().mockResolvedValue({}) })

    await expect(client.request('/v1/value', {}, z.object({ id: z.string() }))).rejects.toThrow('expected string')
  })

  it('preserves a server error code for page-specific feedback', async () => {
    const client = createApiClient({
      fetch: vi.fn().mockRejectedValue({ statusCode: 401, data: { error: 'unauthorized' } }),
      getAuthHeaders: vi.fn().mockResolvedValue({}),
    })

    await expect(client.request('/v1/private')).rejects.toMatchObject({ code: 'unauthorized', statusCode: 401, data: { error: 'unauthorized' } })
  })

  it('forwards an authenticated mutation unchanged', async () => {
    const fetch = vi.fn().mockResolvedValue({ id: 'channel-1' })
    const client = createApiClient({ fetch, getAuthHeaders: vi.fn().mockResolvedValue({ authorization: 'Bearer current-token' }) })

    await client.request('/v1/channels/channel-1', { method: 'PATCH', body: { purpose: 'Hauptkanal' } }, z.object({ id: z.string() }))

    expect(fetch).toHaveBeenCalledWith('/v1/channels/channel-1', expect.objectContaining({
      method: 'PATCH', body: { purpose: 'Hauptkanal' }, headers: { authorization: 'Bearer current-token' },
    }))
  })
})
