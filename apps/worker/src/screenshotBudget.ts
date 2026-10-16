// Empirisch gemessen gegen haex-claude-proxy im Abo-Modus (Bild als @path-Erwaehnung an die
// Claude-CLI): Screenshots bis ca. 200 KB werden gelesen, ein PNG ab ca. 460 KB endet als Prosa
// "kein Lesezugriff" ohne tool_use-Block und scheitert als provider_schema. Der genaue Mechanismus
// im Proxy ist nicht geklaert -- die CLI selbst liest auch groessere Dateien, wenn man sie direkt
// aufruft. Das Budget liegt deshalb mit Abstand unter der kleinsten gescheiterten Groesse.
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
