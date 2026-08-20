import { sanitizeSvg, SvgRejectedError, SvgTooComplexError } from '@vereinsfunk/svg-safe'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

export class UnsupportedLogoFormatError extends Error {}
export class LogoDimensionsError extends Error {}

export interface ProcessedLogo {
  buffer: Buffer
  extension: 'svg' | 'png' | 'jpg'
  contentType: string
  sanitized: boolean
  // Nur fuer Rasterbilder gefuellt -- ein SVG ist ein Vektor ohne feste Pixelmasse.
  width?: number
  height?: number
}

const MIN_DIMENSION_PX = 32
// War 4096: ein aus einem Vektorprogramm exportiertes Logo bleibt bei grosser Pixelzahl haeufig
// unter 1 MB Dateigroesse (viel transparente Flaeche), wurde hier aber schon abgelehnt.
const MAX_DIMENSION_PX = 8192

function looksLikeSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 512).toString('utf8').trimStart()
  return /^(<\?xml[\s\S]*?\?>)?\s*<svg[\s>]/i.test(head)
}

function detectRasterFormat(buffer: Buffer): 'png' | 'jpg' | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  return null
}

/**
 * Determines the file kind from its bytes (never from a client-supplied Content-Type),
 * sanitizes SVGs via packages/svg-safe, and re-encodes raster images without EXIF metadata.
 */
export async function processBrandLogoUpload(buffer: Buffer): Promise<ProcessedLogo> {
  if (looksLikeSvg(buffer)) {
    let result
    try {
      result = sanitizeSvg(buffer.toString('utf8'))
    } catch (error) {
      if (error instanceof SvgRejectedError || error instanceof SvgTooComplexError) {
        throw new UnsupportedLogoFormatError(error.message)
      }
      throw error
    }
    return { buffer: Buffer.from(result.sanitized, 'utf8'), extension: 'svg', contentType: 'image/svg+xml', sanitized: result.modified }
  }

  const rasterFormat = detectRasterFormat(buffer)
  if (!rasterFormat) throw new UnsupportedLogoFormatError('unsupported logo file type')

  let metadata
  try {
    metadata = await sharp(buffer).metadata()
  } catch {
    throw new UnsupportedLogoFormatError('logo file could not be decoded')
  }
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width < MIN_DIMENSION_PX || height < MIN_DIMENSION_PX) {
    throw new LogoDimensionsError(`logo is ${width}×${height}px, below the minimum of ${MIN_DIMENSION_PX}px per side`)
  }
  if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
    throw new LogoDimensionsError(`logo is ${width}×${height}px, exceeding the maximum of ${MAX_DIMENSION_PX}px per side`)
  }

  // .rotate() bakes in the EXIF orientation; omitting .withMetadata() during re-encode
  // drops the rest of it (GPS, camera/software identifiers, ...).
  // libvips can read basic IHDR metadata (width/height) from a file whose pixel data is
  // corrupt, so metadata() above can succeed while the actual decode during re-encoding
  // still fails -- found via manual browser testing of Paket 013 (an unrelated, pre-existing
  // gap surfaced through the new general asset upload path, which shares this function).
  let reencoded
  let encodedMetadata
  try {
    reencoded = rasterFormat === 'png' ? await sharp(buffer).rotate().png().toBuffer() : await sharp(buffer).rotate().jpeg().toBuffer()
    // Die Masse muessen den AUSGELIEFERTEN Puffer beschreiben: bei EXIF-Orientierung 5 bis 8
    // dreht .rotate() das Bild um 90 Grad, wodurch Breite und Hoehe gegenueber metadata() der
    // Originaldatei vertauscht sind. Sie landen in brand_assets.width/height und bestimmen dort
    // das Seitenverhaeltnis fuer Vorschauen und Remotion-Layouts.
    encodedMetadata = await sharp(reencoded).metadata()
  } catch {
    throw new UnsupportedLogoFormatError('logo file could not be decoded')
  }

  return {
    buffer: reencoded,
    extension: rasterFormat,
    contentType: rasterFormat === 'png' ? 'image/png' : 'image/jpeg',
    sanitized: false,
    width: encodedMetadata.width ?? width,
    height: encodedMetadata.height ?? height,
  }
}

export function hashLogoBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
