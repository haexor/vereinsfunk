import { computed } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../utils/apiClient'
import type { useApiClient } from './useApiClient'
import { useBrandWebsiteAnalysis } from './useBrandWebsiteAnalysis'

const RESULT = {
  primaryColor: '#123456', accentColor: '#654321', backgroundColor: '#ffffff', textColor: '#000000',
  onPrimaryColor: '#ffffff', suggestedFontPairingKey: 'manrope_dm_sans', detectedFontFamily: null, logoCandidate: null,
}

function setup(request: (path: string, options?: unknown) => Promise<unknown>) {
  const api = { request: vi.fn(request) } as unknown as ReturnType<typeof useApiClient>
  const organizationId = computed(() => 'org-1')
  return { api, ...useBrandWebsiteAnalysis({ api, organizationId }) }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useBrandWebsiteAnalysis', () => {
  it('polls after a successful start and reports the succeeded result', async () => {
    const { status, result, startAnalysis } = setup(async (path, options: unknown) => {
      if ((options as { method?: string })?.method === 'POST') return undefined
      return { status: 'succeeded', result: RESULT, errorReason: null }
    })

    await startAnalysis('https://verein.example.org')
    expect(status.value).toBe('pending')

    await vi.advanceTimersByTimeAsync(3000)
    expect(status.value).toBe('succeeded')
    expect(result.value).toEqual(RESULT)
  })

  it.each([
    ['website_url_not_allowed', 'Diese Adresse kann nicht abgerufen werden.'],
    ['analysis_in_progress', 'Es läuft bereits eine Analyse für diesen Verein.'],
    ['organization_has_no_department', 'Dafür braucht der Verein mindestens eine Abteilung.'],
    ['something_else', 'Die Analyse konnte nicht gestartet werden.'],
  ])('maps the %s start error to a German message', async (code, message) => {
    const { status, startError, startAnalysis } = setup(async () => {
      throw new ApiRequestError(code, 400)
    })

    await startAnalysis('https://verein.example.org')
    expect(startError.value).toBe(message)
    expect(status.value).toBe('idle')
  })

  it('gives up and reports failed once the poll timeout window elapses', async () => {
    const { status, errorReason, startAnalysis } = setup(async (path, options: unknown) => {
      if ((options as { method?: string })?.method === 'POST') return undefined
      return { status: 'running', result: null, errorReason: null }
    })

    await startAnalysis('https://verein.example.org')
    await vi.advanceTimersByTimeAsync(95_000)

    expect(status.value).toBe('failed')
    expect(errorReason.value).toBe('timeout')
  })

  it('reports failed when a poll request itself throws', async () => {
    const { status, errorReason, startAnalysis } = setup(async (path, options: unknown) => {
      if ((options as { method?: string })?.method === 'POST') return undefined
      throw new Error('network down')
    })

    await startAnalysis('https://verein.example.org')
    await vi.advanceTimersByTimeAsync(3000)

    expect(status.value).toBe('failed')
    expect(errorReason.value).toBe('poll_failed')
  })
})
