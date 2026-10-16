// haex-claude-proxy gibt das Bild im Abo-Modus als @path-Erwaehnung an die Claude-CLI weiter, und
// die CLI liest nur Dateien bis etwa 256 KB ein. Ein groesseres PNG (ein 1280x900-Screenshot einer
// bebilderten Vereinsseite hat schnell ueber 500 KB) endet als Prosa "kein Lesezugriff" ohne
// tool_use-Block und scheitert als provider_schema. Die Grenze liegt bewusst darunter.
export const SCREENSHOT_MAX_BYTES = 200_000

const JPEG_QUALITIES = [80, 60, 40, 25] as const

/**
 * Nimmt den Screenshot mit absteigender JPEG-Qualitaet auf, bis er in das Budget passt.
 * ponytail: Passt selbst die niedrigste Qualitaet nicht, geht der kleinste Versuch trotzdem raus;
 * der naechste Schritt waere, zusaetzlich die Aufloesung zu verkleinern.
 */
export async function captureScreenshotWithinBudget(
  take: (jpegQuality: number) => Promise<Buffer>,
  maxBytes: number = SCREENSHOT_MAX_BYTES,
): Promise<Buffer> {
  let smallest: Buffer | null = null
  for (const quality of JPEG_QUALITIES) {
    const screenshot = await take(quality)
    if (screenshot.byteLength <= maxBytes) return screenshot
    if (!smallest || screenshot.byteLength < smallest.byteLength) smallest = screenshot
  }
  return smallest!
}
