import { PreviewImageStylePresetResponseSchema, type PreviewImageStylePresetRequest } from '@vereinsfunk/contracts'
import { getCurrentScope, onScopeDispose, ref } from 'vue'
import { ApiRequestError } from '../utils/apiClient'
import type { useApiClient } from './useApiClient'

export type ImageStylePreviewState = 'idle' | 'loading' | 'ready' | 'error'

const DEBOUNCE_MS = 400

// Debounce + Race-Guard fuer die Bildstil-Vorschau, getrennt von ImageStyleCanvasEditor.vue und
// damit ohne fabric.js/Canvas-Mount testbar. Race-Guard nach demselben Muster wie erstellen.vues
// latestServerDraftSave/saveNumber: jeder Aufruf traegt eine lokale Sequenznummer, eine Antwort
// wird nur uebernommen, wenn zwischenzeitlich kein neuerer Aufruf gestartet wurde. Kein
// AbortController zusaetzlich -- dafuer gibt es im Frontend keinen Praezedenzfall, und eine
// ignorierte Antwort ist billig genug. api wird injiziert (wie useBrandWebsiteAnalysis), damit
// dieser Test ohne Nuxt-Kontext auskommt.
export function useImageStylePreviewRequest({ api }: { api: ReturnType<typeof useApiClient> }) {
  const state = ref<ImageStylePreviewState>('idle')
  const imageDataUrl = ref<string | null>(null)
  const errorCode = ref<string | null>(null)
  let sequence = 0
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  async function fetchNow(payload: PreviewImageStylePresetRequest): Promise<void> {
    const mySequence = ++sequence
    state.value = 'loading'
    try {
      const result = await api.request(
        '/v1/image-style-presets/preview',
        { method: 'POST', body: payload as unknown as Record<string, unknown> },
        PreviewImageStylePresetResponseSchema,
      )
      if (mySequence !== sequence) return
      imageDataUrl.value = `data:${result.contentType};base64,${result.imageBase64}`
      errorCode.value = null
      state.value = 'ready'
    } catch (error) {
      if (mySequence !== sequence) return
      // imageDataUrl bleibt unangetastet -- die zuletzt gute Vorschau bleibt sichtbar, waehrend die
      // Fehlermeldung separat angezeigt wird.
      errorCode.value = error instanceof ApiRequestError ? error.code : 'unknown'
      state.value = 'error'
    }
  }

  function schedule(payload: PreviewImageStylePresetRequest, delayMs = DEBOUNCE_MS): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => void fetchNow(payload), delayMs)
  }

  // Ohne das schickt ein noch ausstehender Debounce-Timer nach dem Unmount (Scope-Wechsel auf
  // /bildstil, Navigation) noch eine Vorschau-Anfrage los. getCurrentScope(), weil der Unit-Test
  // dieses Composable bewusst ohne Komponenten-Scope aufruft.
  if (getCurrentScope()) onScopeDispose(() => clearTimeout(debounceTimer))

  return { state, imageDataUrl, errorCode, schedule, fetchNow }
}
