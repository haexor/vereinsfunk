import sharp from 'sharp'

// Zwei Groessen fuer unterschiedliche Verwendung: klein fuer Vorschaukacheln/Meta-Anhaenge, gross
// fuer Remotion-Kompositionen (Plan 013, "Bilder" -- "ein PNG in zwei Groessen"). Kein SVG kommt
// dadurch je in einen Pfad, in dem es ausserhalb unserer Kontrolle interpretiert wird.
const RASTER_DERIVATIVE_WIDTHS = { small: 128, large: 512 } as const

export type RasterDerivativeSize = keyof typeof RASTER_DERIVATIVE_WIDTHS

export async function generateSvgRasterDerivatives(sanitizedSvg: Buffer): Promise<Record<RasterDerivativeSize, Buffer>> {
  const entries = await Promise.all(
    (Object.entries(RASTER_DERIVATIVE_WIDTHS) as [RasterDerivativeSize, number][]).map(
      async ([size, width]) => [size, await sharp(sanitizedSvg, { density: 300 }).resize({ width, withoutEnlargement: false }).png().toBuffer()] as const,
    ),
  )
  return Object.fromEntries(entries) as Record<RasterDerivativeSize, Buffer>
}
