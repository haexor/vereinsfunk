import sharp from 'sharp'

// Zwei Groessen fuer unterschiedliche Verwendung: klein fuer Vorschaukacheln/Meta-Anhaenge, gross
// fuer Remotion-Kompositionen (Plan 013, "Bilder" -- "ein PNG in zwei Groessen"). Kein SVG kommt
// dadurch je in einen Pfad, in dem es ausserhalb unserer Kontrolle interpretiert wird.
const RASTER_DERIVATIVE_WIDTHS = { small: 128, large: 512 } as const

export type RasterDerivativeSize = keyof typeof RASTER_DERIVATIVE_WIDTHS

export class SvgRasterizationError extends Error {}

// sharp rendert ein SVG zuerst in seiner Nenngroesse mal density und verkleinert erst danach.
// Ein SVG mit sehr grosser viewBox erzeugt dabei eine Zwischenbitmap, die den API-Prozess an sein
// Speicherlimit bringen kann -- die Sanitisierung aus packages/svg-safe prueft die Knoten-
// komplexitaet, nicht die Zeichenflaeche. 40 Megapixel liegen weit ueber jedem realen Vereinslogo
// und weit unter sharps Standardgrenze (~268 Megapixel, rund 1 GB als RGBA).
const MAX_RASTERIZED_PIXELS = 40_000_000

export async function generateSvgRasterDerivatives(sanitizedSvg: Buffer): Promise<Record<RasterDerivativeSize, Buffer>> {
  try {
    const entries = await Promise.all(
      (Object.entries(RASTER_DERIVATIVE_WIDTHS) as [RasterDerivativeSize, number][]).map(
        async ([size, width]) =>
          [
            size,
            await sharp(sanitizedSvg, { density: 300, limitInputPixels: MAX_RASTERIZED_PIXELS })
              .resize({ width, withoutEnlargement: false })
              .png()
              .toBuffer(),
          ] as const,
      ),
    )
    return Object.fromEntries(entries) as Record<RasterDerivativeSize, Buffer>
  } catch {
    // Eine 400-Antwort statt eines rohen 500: die Datei ist das Problem, nicht der Dienst.
    throw new SvgRasterizationError('the SVG drawing area is too large to rasterize')
  }
}
