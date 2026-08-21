import {
  BrandWebsiteAnalysisStatusResponseSchema,
  StartBrandWebsiteAnalysisRequestSchema,
  type BrandWebsiteAnalysisResult,
} from '@vereinsfunk/contracts'
import { onBeforeUnmount, onMounted, ref, type ComputedRef } from 'vue'
import { ApiRequestError } from '../utils/apiClient'

// Paket 048: erster Auto-Poll-Loop in apps/web (Textwerkstatt nutzt bisher einen manuellen
// "Aktualisieren"-Button). Bewusst ein lokaler setTimeout-Loop statt einer generischen
// Poll-Abstraktion -- ein einziger Verwendungsort rechtfertigt keine Wiederverwendbarkeit.
const POLL_INTERVAL_MS = 3000
// Muss mindestens dem serverseitigen Ausfuehrungsbudget entsprechen (executionTimeout '10m' in
// apps/worker/src/workflows.ts). Eine kuerzere Client-Deadline meldete einen bloss langsamen oder
// wartenden Lauf als Fehler; weil ein Neustart waehrenddessen an analysis_in_progress scheitert
// (Migration 2026082007) und die RPC bei einem spaeteren Neustart result auf null zuruecksetzt,
// waere das fertige -- bezahlte -- Vision-Ergebnis danach unerreichbar.
const POLL_TIMEOUT_MS = 600_000
// Ein einzelner fehlgeschlagener Abruf ist ein Client-Aussetzer (WLAN, ablaufende Session, die
// 404 no_analysis_yet kurz nach dem Start), kein Job-Fehler. Erst nach drei aufeinanderfolgenden
// Fehlversuchen wird aufgegeben -- die Deadline begrenzt die Schleife ohnehin.
const MAX_CONSECUTIVE_POLL_FAILURES = 3

export type BrandWebsiteAnalysisUiStatus = 'idle' | 'pending' | 'running' | 'succeeded' | 'failed'

function startErrorMessage(error: unknown): string {
  const code = error instanceof ApiRequestError ? error.code : null
  if (code === 'website_url_not_allowed') return 'Diese Adresse kann nicht abgerufen werden.'
  if (code === 'analysis_in_progress') return 'Es läuft bereits eine Analyse für diesen Verein.'
  if (code === 'organization_has_no_department') return 'Dafür braucht der Verein mindestens eine Abteilung.'
  return 'Die Analyse konnte nicht gestartet werden.'
}

// Der Verein tippt "verein.de" oder bekommt aus dem Impressum ein "http://..." vorbelegt
// (OrganizationProfileFieldsSchema.websiteUrl erlaubt http). Der Analyse-Endpunkt verlangt aber
// hart https (isAllowedOutboundUrl), ein fehlendes Schema faellt ausserdem schon an z.url() --
// beides ergaebe eine unspezifische Fehlermeldung fuer eine gewoehnliche Eingabe.
function normalizeWebsiteUrl(raw: string): string {
  const trimmed = raw.trim()
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
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
  // Fencing-Token: clearTimeout erreicht nur einen *geplanten* Abruf. Ein bereits laufender GET
  // ueberlebte damit Unmount und Neustart, schrieb danach in die verwaisten Refs und plante sich
  // selbst neu -- die Schleife lief bis zur Deadline weiter. Jeder Abruf traegt seine Generation
  // und verwirft sein Ergebnis, sobald sie nicht mehr die aktuelle ist.
  let pollGeneration = 0
  let consecutivePollFailures = 0

  function stopPolling() {
    pollGeneration += 1
    consecutivePollFailures = 0
    if (pollTimeoutId === null) return
    clearTimeout(pollTimeoutId)
    pollTimeoutId = null
  }

  function schedulePoll(generation: number) {
    pollTimeoutId = setTimeout(() => void pollOnce(generation), POLL_INTERVAL_MS)
  }

  function giveUp(reason: string) {
    status.value = 'failed'
    errorReason.value = reason
  }

  async function pollOnce(generation: number) {
    pollTimeoutId = null
    if (generation !== pollGeneration) return
    if (Date.now() >= pollDeadline) { giveUp('timeout'); return }
    // Der Scope kann waehrend eines Laufs kurz leer sein (Session-Neuaufloesung). Das beendet die
    // Schleife nicht -- sonst blieb die Anzeige dauerhaft in "Analyse laeuft" haengen, ohne dass
    // je ein Timeout gegriffen haette.
    if (!organizationId.value) { schedulePoll(generation); return }
    try {
      const response = await api.request(
        `/v1/organizations/${organizationId.value}/brand/website-analysis`,
        {},
        BrandWebsiteAnalysisStatusResponseSchema,
      )
      if (generation !== pollGeneration) return
      consecutivePollFailures = 0
      status.value = response.status
      result.value = response.result
      errorReason.value = response.errorReason
      if (response.status !== 'pending' && response.status !== 'running') return
      if (Date.now() < pollDeadline) schedulePoll(generation)
      else giveUp('timeout')
    } catch {
      if (generation !== pollGeneration) return
      consecutivePollFailures += 1
      if (consecutivePollFailures < MAX_CONSECUTIVE_POLL_FAILURES && Date.now() < pollDeadline) {
        schedulePoll(generation)
        return
      }
      giveUp('poll_failed')
    }
  }

  async function startAnalysis(websiteUrl: string) {
    starting.value = true
    startError.value = ''
    stopPolling()
    // Ein fehlgeschlagener Start darf den Erfolg des vorigen Laufs nicht weiter anzeigen.
    status.value = 'idle'
    result.value = null
    errorReason.value = null
    try {
      if (!organizationId.value) {
        startError.value = 'Der Verein ist noch nicht vollständig geladen. Bitte die Seite neu laden.'
        return
      }
      // Dieselbe Zod-Grenze wie serverseitig in der Route: die Browser-Grenze validiert die
      // Eingabe gegen denselben Vertrag, statt eine unspezifische 400 abzuwarten.
      const websiteUrlInput = StartBrandWebsiteAnalysisRequestSchema.safeParse({
        websiteUrl: normalizeWebsiteUrl(websiteUrl),
      })
      if (!websiteUrlInput.success) {
        startError.value = 'Bitte eine vollständige Webadresse angeben, zum Beispiel https://euer-verein.de.'
        return
      }
      if (!websiteUrlInput.data.websiteUrl.startsWith('https://')) {
        startError.value = 'Bitte eine Adresse angeben, die mit https:// beginnt.'
        return
      }
      await api.request(`/v1/organizations/${organizationId.value}/brand/website-analysis`, {
        method: 'POST',
        body: websiteUrlInput.data,
      })
      status.value = 'pending'
      pollDeadline = Date.now() + POLL_TIMEOUT_MS
      schedulePoll(pollGeneration)
    } catch (error) {
      startError.value = startErrorMessage(error)
    } finally {
      starting.value = false
    }
  }

  // Ein Reload oder Seitenwechsel waehrend eines laufenden Jobs verlor bisher jede Sicht darauf:
  // der Job lief serverseitig weiter, der Client zeigte ein leeres Formular, und ein Neustart
  // scheiterte an analysis_in_progress. Ein bereits *abgeschlossener* Job wird bewusst nicht
  // wieder aufgegriffen -- sonst uebernaehme jeder Seitenaufruf einen alten Vorschlag ungefragt
  // in das Formular.
  async function resumeRunningAnalysis() {
    if (!organizationId.value) return
    const generation = pollGeneration
    try {
      const response = await api.request(
        `/v1/organizations/${organizationId.value}/brand/website-analysis`,
        {},
        BrandWebsiteAnalysisStatusResponseSchema,
      )
      if (generation !== pollGeneration) return
      if (response.status !== 'pending' && response.status !== 'running') return
      status.value = response.status
      result.value = response.result
      errorReason.value = response.errorReason
      pollDeadline = Date.now() + POLL_TIMEOUT_MS
      schedulePoll(generation)
    } catch {
      // Kein Job (404 no_analysis_yet) oder ein Abrufproblem: es gibt nichts anzuzeigen.
    }
  }

  onMounted(() => { void resumeRunningAnalysis() })
  onBeforeUnmount(stopPolling)

  return { status, result, errorReason, startError, starting, startAnalysis, resumeRunningAnalysis }
}
