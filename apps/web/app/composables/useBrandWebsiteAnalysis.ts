import {
  BrandWebsiteAnalysisStatusResponseSchema,
  type BrandWebsiteAnalysisResult,
} from '@vereinsfunk/contracts'
import { onBeforeUnmount, ref, type ComputedRef } from 'vue'
import { ApiRequestError } from '../utils/apiClient'

// Paket 048: erster Auto-Poll-Loop in apps/web (Textwerkstatt nutzt bisher einen manuellen
// "Aktualisieren"-Button). Bewusst ein lokaler setTimeout-Loop statt einer generischen
// Poll-Abstraktion -- ein einziger Verwendungsort rechtfertigt keine Wiederverwendbarkeit.
const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 90_000

export type BrandWebsiteAnalysisUiStatus = 'idle' | 'pending' | 'running' | 'succeeded' | 'failed'

function startErrorMessage(error: unknown): string {
  const code = error instanceof ApiRequestError ? error.code : null
  if (code === 'website_url_not_allowed') return 'Diese Adresse kann nicht abgerufen werden.'
  if (code === 'analysis_in_progress') return 'Es läuft bereits eine Analyse für diesen Verein.'
  if (code === 'organization_has_no_department') return 'Dafür braucht der Verein mindestens eine Abteilung.'
  return 'Die Analyse konnte nicht gestartet werden.'
}

export function useBrandWebsiteAnalysis({
  api,
  organizationId,
}: {
  api: ReturnType<typeof useApiClient>
  organizationId: ComputedRef<string | null>
}) {
  const status = ref<BrandWebsiteAnalysisUiStatus>('idle')
  const result = ref<BrandWebsiteAnalysisResult | null>(null)
  const errorReason = ref<string | null>(null)
  const startError = ref('')
  const starting = ref(false)

  let pollTimeoutId: ReturnType<typeof setTimeout> | null = null
  let pollDeadline = 0

  function stopPolling() {
    if (pollTimeoutId === null) return
    clearTimeout(pollTimeoutId)
    pollTimeoutId = null
  }

  async function pollOnce() {
    pollTimeoutId = null
    if (!organizationId.value) return
    try {
      const response = await api.request(
        `/v1/organizations/${organizationId.value}/brand/website-analysis`,
        {},
        BrandWebsiteAnalysisStatusResponseSchema,
      )
      status.value = response.status
      result.value = response.result
      errorReason.value = response.errorReason
      if (response.status === 'pending' || response.status === 'running') {
        if (Date.now() < pollDeadline) pollTimeoutId = setTimeout(() => void pollOnce(), POLL_INTERVAL_MS)
        else { status.value = 'failed'; errorReason.value = 'timeout' }
      }
    } catch {
      status.value = 'failed'
      errorReason.value = 'poll_failed'
    }
  }

  async function startAnalysis(websiteUrl: string) {
    if (!organizationId.value) return
    starting.value = true
    startError.value = ''
    stopPolling()
    try {
      await api.request(`/v1/organizations/${organizationId.value}/brand/website-analysis`, {
        method: 'POST',
        body: { websiteUrl },
      })
      status.value = 'pending'
      result.value = null
      errorReason.value = null
      pollDeadline = Date.now() + POLL_TIMEOUT_MS
      pollTimeoutId = setTimeout(() => void pollOnce(), POLL_INTERVAL_MS)
    } catch (error) {
      startError.value = startErrorMessage(error)
    } finally {
      starting.value = false
    }
  }

  onBeforeUnmount(stopPolling)

  return { status, result, errorReason, startError, starting, startAnalysis }
}
