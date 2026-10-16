// api.anthropic.com lehnt Bilder ueber 5 MB ab. Der Screenshot einer Vereinsseite (1280x900) ist
// als PNG meist 0,3-2 MB gross und geht verlustfrei raus, damit Farben und Schrift fuer die
// Vision-Analyse unverfaelscht bleiben; nur eine ungewoehnlich bildlastige Seite faellt auf JPEG
// zurueck. Das Budget liegt mit Abstand unter dem Limit.
export const SCREENSHOT_MAX_BYTES = 4_000_000

const JPEG_QUALITIES = [90, 75, 60] as const

export interface CapturedScreenshot {
  buffer: Buffer
  mediaType: 'image/png' | 'image/jpeg'
}

/**
 * Nimmt den Screenshot als PNG auf und weicht nur auf JPEG mit absteigender Qualitaet aus, wenn das
 * PNG das Budget sprengt.
 * ponytail: Passt selbst die niedrigste Qualitaet nicht, geht der kleinste Versuch trotzdem raus;
 * der naechste Schritt waere, zusaetzlich die Aufloesung zu verkleinern.
 */
export async function captureScreenshot(
  take: (type: 'png' | 'jpeg', jpegQuality?: number) => Promise<Buffer>,
  maxBytes: number = SCREENSHOT_MAX_BYTES,
): Promise<CapturedScreenshot> {
  let smallest: CapturedScreenshot = { buffer: await take('png'), mediaType: 'image/png' }
  if (smallest.buffer.byteLength <= maxBytes) return smallest
  for (const quality of JPEG_QUALITIES) {
    const attempt: CapturedScreenshot = { buffer: await take('jpeg', quality), mediaType: 'image/jpeg' }
    if (attempt.buffer.byteLength <= maxBytes) return attempt
    if (attempt.buffer.byteLength < smallest.buffer.byteLength) smallest = attempt
  }
  return smallest
}
