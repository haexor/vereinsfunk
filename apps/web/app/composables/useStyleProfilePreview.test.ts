import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../utils/apiClient'
import type { useApiClient } from './useApiClient'
import { useStyleProfilePreview } from './useStyleProfilePreview'

const POST = {
  verifiedFacts: [], missingFacts: [], headline: 'Sieg', caption: 'Was fuer ein Spiel', shortCaption: 'Sieg',
  callToAction: '', hashtags: [], altText: '', templateId: 'match_report', safetyFlags: [], generatedClaims: [], variants: [],
}

function setup(request: () => Promise<unknown>, body: Record<string, unknown> | null = { name: 'Klar' }) {
  const requestMock = vi.fn(request)
  const api = { request: requestMock } as unknown as ReturnType<typeof useApiClient>
  const draft = ref({ name: 'Klar' })
  const preview = useStyleProfilePreview({ api, path: '/v1/content-style-profiles/preview', draft, requestBody: () => body })
  const keys = () => requestMock.mock.calls.map((call) => ((call as unknown[])[1] as { headers: Record<string, string> }).headers['idempotency-key'])
  return { requestMock, draft, keys, ...preview }
}

describe('useStyleProfilePreview', () => {
  it('shows the generated post of a successful preview', async () => {
    const { result, error, previewing, preview } = setup(async () => POST)

    await preview()

    expect(result.value).toEqual(POST)
    expect(error.value).toBe('')
    expect(previewing.value).toBe(false)
  })

  it('reuses the idempotency key when a failed preview of the same draft is retried', async () => {
    const { keys, error, preview } = setup(async () => { throw new ApiRequestError('provider_rate_limit', 429) })

    await preview()
    await preview()

    expect(error.value).toBe('Zu viele Testanfragen. Bitte kurz warten und erneut versuchen.')
    expect(keys()[0]).toBe(keys()[1])
  })

  it('uses a new idempotency key after the draft changed', async () => {
    const { keys, draft, preview } = setup(async () => { throw new ApiRequestError('provider_error', 502) })

    await preview()
    draft.value.name = 'Kapitaen klar'
    await nextTick()
    await preview()

    expect(keys()[0]).not.toBe(keys()[1])
  })

  it('uses a new idempotency key after a successful preview', async () => {
    const { keys, preview } = setup(async () => POST)

    await preview()
    await preview()

    expect(keys()[0]).not.toBe(keys()[1])
  })

  it('sends nothing while no preview is possible', async () => {
    const { requestMock, previewing, preview } = setup(async () => POST, null)

    await preview()

    expect(requestMock).not.toHaveBeenCalled()
    expect(previewing.value).toBe(false)
  })

  it('clears result and error on reset', async () => {
    const { result, error, preview, reset } = setup(async () => POST)
    await preview()
    error.value = 'alt'

    reset()

    expect(result.value).toBeNull()
    expect(error.value).toBe('')
  })
})
