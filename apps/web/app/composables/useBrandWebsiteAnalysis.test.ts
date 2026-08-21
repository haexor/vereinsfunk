import { computed } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../utils/apiClient'
import type { useApiClient } from './useApiClient'
import { useBrandWebsiteAnalysis } from './useBrandWebsiteAnalysis'

const RESULT = {
  primaryColor: '#123456', accentColor: '#654321', backgroundColor: '#ffffff', textColor: '#000000',
  onPrimaryColor: '#ffffff', suggestedFontPairingKey: 'manrope_dm_sans', detectedFontFamily: null, logoCandidate: null,
}

function isPost(options: unknown) {
  return (options as { method?: string })?.method === 'POST'
}

function setup(request: (path: string, options?: unknown) => Promise<unknown>) {
  const requestMock = vi.fn(request)
  const api = { request: requestMock } as unknown as ReturnType<typeof useApiClient>
  const organizationId = computed(() => 'org-1')
  return { requestMock, ...useBrandWebsiteAnalysis({ api, organizationId }) }
}

function pollCount(requestMock: { mock: { calls: unknown[][] } }) {
  return requestMock.mock.calls.filter(([, options]) => !isPost(options)).length
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useBrandWebsiteAnalysis', () => {
  it('polls after a successful start and reports the succeeded result', async () => {
    const { status, result, startAnalysis } = setup(async (path, options: unknown) => {
      if (isPost(options)) return undefined
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

  it('completes a bare domain to https and posts the normalized address', async () => {
    const { requestMock, startAnalysis, startError } = setup(async () => undefined)

    await startAnalysis('  verein.example.org  ')

    expect(startError.value).toBe('')
    expect(requestMock).toHaveBeenCalledWith(
      '/v1/organizations/org-1/brand/website-analysis',
      { method: 'POST', body: { websiteUrl: 'https://verein.example.org' } },
    )
  })

  it.each([
    ['http://verein.example.org', 'Bitte eine Adresse angeben, die mit https:// beginnt.'],
    ['nicht mal eine adresse', 'Bitte eine vollständige Webadresse angeben, zum Beispiel https://euer-verein.de.'],
  ])('rejects %s at the browser boundary without a request', async (input, message) => {
    const { requestMock, startAnalysis, startError, status } = setup(async () => undefined)

    await startAnalysis(input)

    expect(startError.value).toBe(message)
    expect(status.value).toBe('idle')
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('drops a previous success when the next start fails', async () => {
    let failStart = false
    const { status, result, startAnalysis, startError } = setup(async (path, options: unknown) => {
      if (isPost(options)) {
        if (failStart) throw new ApiRequestError('analysis_in_progress', 409)
        return undefined
      }
      return { status: 'succeeded', result: RESULT, errorReason: null }
    })

    await startAnalysis('https://verein.example.org')
    await vi.advanceTimersByTimeAsync(3000)
    expect(status.value).toBe('succeeded')

    failStart = true
    await startAnalysis('https://verein.example.org')

    expect(startError.value).toBe('Es läuft bereits eine Analyse für diesen Verein.')
    expect(status.value).toBe('idle')
    expect(result.value).toBeNull()
  })

  it('gives up and reports failed once the poll timeout window elapses, then stops polling', async () => {
    const { requestMock, status, errorReason, startAnalysis } = setup(async (path, options: unknown) => {
      if (isPost(options)) return undefined
      return { status: 'running', result: null, errorReason: null }
    })

    await startAnalysis('https://verein.example.org')
    // Die Deadline folgt dem serverseitigen Ausfuehrungsbudget von 10 Minuten.
    await vi.advanceTimersByTimeAsync(605_000)

    expect(status.value).toBe('failed')
    expect(errorReason.value).toBe('timeout')

    const pollsAtDeadline = pollCount(requestMock)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pollCount(requestMock)).toBe(pollsAtDeadline)
  })

  it('keeps polling through a single failed request instead of reporting a job failure', async () => {
    let failNextPoll = true
    const { status, result, startAnalysis } = setup(async (path, options: unknown) => {
      if (isPost(options)) return undefined
      if (failNextPoll) { failNextPoll = false; throw new Error('network blip') }
      return { status: 'succeeded', result: RESULT, errorReason: null }
    })

    await startAnalysis('https://verein.example.org')
    await vi.advanceTimersByTimeAsync(3000)
    expect(status.value).toBe('pending')

    await vi.advanceTimersByTimeAsync(3000)
    expect(status.value).toBe('succeeded')
    expect(result.value).toEqual(RESULT)
  })

  it('reports failed after three consecutive poll failures', async () => {
    const { status, errorReason, startAnalysis } = setup(async (path, options: unknown) => {
      if (isPost(options)) return undefined
      throw new Error('network down')
    })

    await startAnalysis('https://verein.example.org')
    await vi.advanceTimersByTimeAsync(6000)
    expect(status.value).toBe('pending')

    await vi.advanceTimersByTimeAsync(3000)
    expect(status.value).toBe('failed')
    expect(errorReason.value).toBe('poll_failed')
  })

  it('resumes polling for a job that is still running from an earlier page view', async () => {
    let jobStatus = 'running'
    const { status, result, resumeRunningAnalysis } = setup(async () => ({
      status: jobStatus, result: jobStatus === 'succeeded' ? RESULT : null, errorReason: null,
    }))

    await resumeRunningAnalysis()
    expect(status.value).toBe('running')

    jobStatus = 'succeeded'
    await vi.advanceTimersByTimeAsync(3000)
    expect(status.value).toBe('succeeded')
    expect(result.value).toEqual(RESULT)
  })

  it.each(['succeeded', 'failed'])('does not adopt an already finished %s job on mount', async (jobStatus) => {
    const { requestMock, status, result, resumeRunningAnalysis } = setup(async () => ({
      status: jobStatus, result: jobStatus === 'succeeded' ? RESULT : null, errorReason: null,
    }))

    await resumeRunningAnalysis()

    expect(status.value).toBe('idle')
    expect(result.value).toBeNull()

    const callsAfterResume = pollCount(requestMock)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(pollCount(requestMock)).toBe(callsAfterResume)
  })

  it('ignores a missing job when resuming', async () => {
    const { status, resumeRunningAnalysis } = setup(async () => {
      throw new ApiRequestError('no_analysis_yet', 404)
    })

    await resumeRunningAnalysis()

    expect(status.value).toBe('idle')
  })
})
