import { GeneratedPostSchema, type GeneratedPost } from '@vereinsfunk/contracts'
import { ref, watch, type Ref } from 'vue'
import { previewErrorMessage } from '../utils/styleProfileDraft'
import type { useApiClient } from './useApiClient'

// Probelauf eines Stilprofil-Entwurfs (Vereinsprofile auf /stilprofile, Personas im Betreiberbereich).
// Der Idempotency-Key gilt fuer genau einen Entwurfsstand: ein Doppelklick oder eine Wiederholung
// nach einem Fehler erzeugt keinen zweiten LLM-Aufruf, jede Aenderung am Entwurf und jeder
// gelungene Probelauf dagegen einen neuen. api wird injiziert, damit der Test ohne Nuxt auskommt.
export function useStyleProfilePreview(options: {
  api: ReturnType<typeof useApiClient>
  path: string
  draft: Ref<unknown>
  // null, solange kein Probelauf moeglich ist (z. B. ohne Verein oder Berechtigung).
  requestBody: () => Record<string, unknown> | null
}) {
  const previewing = ref(false)
  const result = ref<GeneratedPost | null>(null)
  const error = ref('')
  let idempotencyKey = crypto.randomUUID()
  watch(options.draft, () => { idempotencyKey = crypto.randomUUID() }, { deep: true })

  async function preview() {
    previewing.value = true
    error.value = ''
    try {
      const body = options.requestBody()
      if (!body) return
      result.value = await options.api.request(options.path, { method: 'POST', body, headers: { 'idempotency-key': idempotencyKey } }, GeneratedPostSchema)
      idempotencyKey = crypto.randomUUID()
    } catch (caught) {
      error.value = previewErrorMessage(caught)
    } finally {
      previewing.value = false
    }
  }

  function reset() {
    result.value = null
    error.value = ''
  }

  return { previewing, result, error, preview, reset }
}
