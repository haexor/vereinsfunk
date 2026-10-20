import type { ImageStyleFilter } from '@vereinsfunk/contracts'
import type { Ref } from 'vue'
import type { LogoPosition } from '../utils/photoWorkshopCanvas'

type CropCoordinates = { width: number; height: number; left: number; top: number }
export type CropperController = {
  getResult: () => {
    canvas?: HTMLCanvasElement
    coordinates: CropCoordinates
    image: { transforms: { rotate: number; flip: { horizontal: boolean; vertical: boolean } } }
  }
  // options.transitions fehlt in den mitgelieferten Typen, die Methoden werten es aber aus; reset()
  // liefert dort ebenfalls ungetypt das Promise von resetVisibleArea().
  setCoordinates: (coordinates: CropCoordinates, options?: { transitions?: boolean }) => void
  rotate: (angle: number, options?: { transitions?: boolean }) => void
  flip: (horizontal: boolean, vertical: boolean, options?: { transitions?: boolean }) => void
  reset: () => Promise<void> | void
  refresh: () => void
}
type CropState = {
  coordinates: CropCoordinates
  rotate: number
  flipHorizontal: boolean
  flipVertical: boolean
}
// Die Werkzeug-Einstellungen, die ein Schritt zurueck wiederherstellt.
export type EditorFields = {
  aspectRatio: Ref<number | undefined>
  outputWidth: Ref<number>
  outputHeight: Ref<number>
  keepAspectRatio: Ref<boolean>
  selectedFilter: Ref<ImageStyleFilter>
  selectedFrameId: Ref<string | null>
  selectedLogoId: Ref<string | null>
  logoPosition: Ref<LogoPosition>
}
type EditorState = {
  crop: CropState | null
  aspectRatio: number | undefined
  outputWidth: number
  outputHeight: number
  keepAspectRatio: boolean
  selectedFilter: ImageStyleFilter
  selectedFrameId: string | null
  selectedLogoId: string | null
  logoPosition: LogoPosition
}

/** Schritt zurueck/vor der Bildwerkstatt: Ausschnitt samt Transformationen und alle Einstellungen. */
export function usePhotoWorkshopHistory(options: {
  cropper: Ref<CropperController | null>
  // Waehrend des Wiederherstellens zaehlen Aenderungen nicht als neuer Schritt; die Filtervorschau
  // liest den Zustand ebenfalls.
  restoring: Ref<boolean>
  fields: EditorFields
  // Eine Geste (Ziehen, Tippen in ein Feld) ist abgeschlossen.
  onGroupFinished: () => void
  // Vor dem Wiederherstellen: laufende Vorschau-Renders verwerfen.
  onBeforeRestore: () => void
  // Nach dem Wiederherstellen des Ausschnitts: Vorschauen fuer den Zustand neu aufbauen.
  onRestored: (controller: CropperController, filter: ImageStyleFilter) => void
}) {
  const { cropper, fields, restoring: restoringHistory } = options
  const undoHistory = ref<EditorState[]>([])
  const redoHistory = ref<EditorState[]>([])
  const historyGroupOpen = ref(false)

  function currentEditorState(): EditorState {
    const result = cropper.value?.getResult()
    return {
      crop: result
        ? {
            coordinates: { ...result.coordinates },
            rotate: result.image.transforms.rotate,
            flipHorizontal: result.image.transforms.flip.horizontal,
            flipVertical: result.image.transforms.flip.vertical,
          }
        : null,
      aspectRatio: fields.aspectRatio.value,
      outputWidth: fields.outputWidth.value,
      outputHeight: fields.outputHeight.value,
      keepAspectRatio: fields.keepAspectRatio.value,
      selectedFilter: fields.selectedFilter.value,
      selectedFrameId: fields.selectedFrameId.value,
      selectedLogoId: fields.selectedLogoId.value,
      logoPosition: fields.logoPosition.value,
    }
  }
  function startHistoryGroup() {
    if (restoringHistory.value || historyGroupOpen.value) return
    undoHistory.value.push(currentEditorState())
    if (undoHistory.value.length > 30) undoHistory.value.shift()
    redoHistory.value = []
    historyGroupOpen.value = true
  }
  function finishHistoryGroup() {
    historyGroupOpen.value = false
    options.onGroupFinished()
  }
  // Nur Verlauf: recordEdit() laeuft vor der Aenderung. Die Filtervorschau von hier aus zu rendern,
  // nahm den Ausschnitt von vor der Aenderung -- sie folgt deshalb dem (entprellten) Crop-Change.
  function recordEdit() {
    startHistoryGroup()
    historyGroupOpen.value = false
  }
  function clearHistory() {
    undoHistory.value = []
    redoHistory.value = []
    historyGroupOpen.value = false
  }
  async function restoreEditorState(state: EditorState) {
    restoringHistory.value = true
    historyGroupOpen.value = false
    options.onBeforeRestore()
    try {
      fields.aspectRatio.value = state.aspectRatio
      fields.outputWidth.value = state.outputWidth
      fields.outputHeight.value = state.outputHeight
      fields.keepAspectRatio.value = state.keepAspectRatio
      fields.selectedFilter.value = state.selectedFilter
      fields.selectedFrameId.value = state.selectedFrameId
      fields.selectedLogoId.value = state.selectedLogoId
      fields.logoPosition.value = state.logoPosition
      await nextTick()
      const controller = cropper.value
      if (!controller || !state.crop) return
      // reset() setzt Ausschnitt und Transformationen asynchron zurueck, und rotate() schaltet fuer
      // ~350 ms Transitionen ein, waehrend derer der Cropper flip() und setCoordinates() verwirft.
      // Ohne await und ohne transitions: false verlor ein Undo Spiegelung und Ausschnitt.
      await controller.reset()
      if (state.crop.rotate) controller.rotate(state.crop.rotate, { transitions: false })
      if (state.crop.flipHorizontal || state.crop.flipVertical)
        controller.flip(state.crop.flipHorizontal, state.crop.flipVertical, { transitions: false })
      controller.setCoordinates(state.crop.coordinates, { transitions: false })
      await nextTick()
      controller.refresh()
      options.onRestored(controller, state.selectedFilter)
    } finally {
      restoringHistory.value = false
    }
  }
  async function undo() {
    const previousState = undoHistory.value.pop()
    if (!previousState || restoringHistory.value) return
    redoHistory.value.push(currentEditorState())
    await restoreEditorState(previousState)
  }
  async function redo() {
    const nextState = redoHistory.value.pop()
    if (!nextState || restoringHistory.value) return
    undoHistory.value.push(currentEditorState())
    await restoreEditorState(nextState)
  }

  return { undoHistory, redoHistory, startHistoryGroup, finishHistoryGroup, recordEdit, clearHistory, undo, redo }
}
