import type { Ref } from 'vue'
import { outputSizeError, readOutputDimension, type ImageDimensions } from '../utils/imageOutputDimensions'

/**
 * Ausgabegroesse der Bildwerkstatt. 0 x 0 heisst "Groesse des Ausschnitts"; mit festem
 * Seitenverhaeltnis folgt die Gegenseite jeder Eingabe. Fehler landen in der gemeinsamen
 * Fehlerzeile der Werkstatt (error).
 */
export function useOutputDimensions(options: { cropDimensions: () => ImageDimensions; error: Ref<string> }) {
  const { cropDimensions, error } = options
  const outputWidth = ref(0)
  const outputHeight = ref(0)
  const keepAspectRatio = ref(true)

  const outputDimensionsLabel = computed(() => {
    const dimensions = cropDimensions()
    return `${outputWidth.value || dimensions.width} × ${outputHeight.value || dimensions.height} px`
  })

  function setOutputDimensions(dimensions: ImageDimensions) {
    const sizeError = outputSizeError(dimensions)
    if (sizeError) {
      error.value = sizeError
      return false
    }
    outputWidth.value = dimensions.width
    outputHeight.value = dimensions.height
    error.value = ''
    return true
  }
  function resetOutputDimensions() {
    outputWidth.value = 0
    outputHeight.value = 0
  }
  // Die Ausgabegroesse entsteht beim Oeffnen von "Bildgroesse" aus dem damaligen Ausschnitt. Mit
  // festem Verhaeltnis folgt die Hoehe jedem spaeteren Zuschnitt, Drehen oder Seitenverhaeltnis --
  // sonst wuerde der neue Ausschnitt beim Speichern verzerrt. Passt sie nicht mehr in die Grenzen,
  // gilt wieder die Groesse des Ausschnitts. Abweichungen unter einem Pixel sind Rundung einer
  // eingetippten Hoehe und bleiben stehen.
  function followCrop(croppedWidth: number, croppedHeight: number) {
    const exactHeight = (outputWidth.value * croppedHeight) / croppedWidth
    if (keepAspectRatio.value && outputWidth.value && outputHeight.value && Math.abs(exactHeight - outputHeight.value) >= 1) {
      const height = Math.max(1, Math.round(exactHeight))
      if (outputSizeError({ width: outputWidth.value, height })) {
        resetOutputDimensions()
      } else {
        outputHeight.value = height
      }
    }
  }
  function updateOutputWidth(value: string) {
    const width = readOutputDimension(value)
    if (!width) {
      error.value = 'Die Breite muss eine positive Zahl sein.'
      return
    }
    const dimensions = cropDimensions()
    const height = keepAspectRatio.value
      ? Math.max(1, Math.round((width * dimensions.height) / dimensions.width))
      : outputHeight.value
    if (height) setOutputDimensions({ width, height })
  }
  function updateOutputHeight(value: string) {
    const height = readOutputDimension(value)
    if (!height) {
      error.value = 'Die Höhe muss eine positive Zahl sein.'
      return
    }
    const dimensions = cropDimensions()
    const width = keepAspectRatio.value
      ? Math.max(1, Math.round((height * dimensions.width) / dimensions.height))
      : outputWidth.value
    if (width) setOutputDimensions({ width, height })
  }

  return {
    outputWidth, outputHeight, keepAspectRatio, outputDimensionsLabel,
    setOutputDimensions, resetOutputDimensions, followCrop, updateOutputWidth, updateOutputHeight,
  }
}
