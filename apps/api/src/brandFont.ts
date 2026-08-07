import { create as createFont } from 'fontkit'
import { compress as compressToWoff2 } from 'wawoff2'

export class UnsupportedFontFormatError extends Error {}
export class FontEmbeddingRestrictedError extends Error {}

export interface ProcessedFont {
  originalBuffer: Buffer
  originalExtension: 'ttf' | 'otf' | 'woff2'
  originalContentType: 'font/ttf' | 'font/otf' | 'font/woff2'
  woff2Buffer: Buffer
  fontFamily: string
  fontWeight: number
  fontStyle: 'normal' | 'italic'
}

type DetectedFormat = 'ttf' | 'otf' | 'woff2' | 'woff1'

// sfnt TrueType outlines start with the version tag 0x00010000, not representable as a plain
// ASCII literal like the other three signatures -- compared as raw bytes instead.
const SFNT_VERSION_1 = Buffer.from([0x00, 0x01, 0x00, 0x00])

function detectFontFormat(buffer: Buffer): DetectedFormat | null {
  if (buffer.length < 4) return null
  const head = buffer.subarray(0, 4)
  const signature = head.toString('latin1')
  if (signature === 'wOF2') return 'woff2'
  if (signature === 'wOFF') return 'woff1'
  if (signature === 'OTTO') return 'otf'
  if (head.equals(SFNT_VERSION_1) || signature === 'true' || signature === 'ttcf') return 'ttf'
  return null
}

/**
 * Determines the font container from its bytes, extracts family/weight/style/embedding rights
 * from the OS/2 table (never from user input), and converts the original to WOFF2 for serving.
 * Legacy WOFF (version 1) is deliberately rejected: unlike TTF/OTF/WOFF2, converting it back to a
 * servable WOFF2 needs a full SFNT re-serialization step this package does not implement (see
 * plans/013, "Risiken und offene Entscheidungen") -- real-world font deliveries are TTF/OTF today.
 */
export async function processBrandFontUpload(buffer: Buffer): Promise<ProcessedFont> {
  const format = detectFontFormat(buffer)
  if (format === null) throw new UnsupportedFontFormatError('unrecognized font file')
  if (format === 'woff1') {
    throw new UnsupportedFontFormatError('legacy WOFF (version 1) fonts are not supported -- provide TTF, OTF or WOFF2')
  }

  let font
  try {
    const parsed = createFont(buffer)
    if (!('familyName' in parsed)) {
      throw new UnsupportedFontFormatError('font collections are not supported, upload a single font file')
    }
    font = parsed
  } catch (error) {
    if (error instanceof UnsupportedFontFormatError) throw error
    throw new UnsupportedFontFormatError('font file could not be parsed')
  }

  if (font['OS/2'].fsType.noEmbedding) {
    throw new FontEmbeddingRestrictedError("this font's license forbids embedding it -- use a font licensed for web/app embedding")
  }

  const woff2Buffer = format === 'woff2' ? buffer : Buffer.from(await compressToWoff2(buffer))

  return {
    originalBuffer: buffer,
    originalExtension: format,
    originalContentType: format === 'woff2' ? 'font/woff2' : format === 'otf' ? 'font/otf' : 'font/ttf',
    woff2Buffer,
    fontFamily: font.familyName,
    fontWeight: font['OS/2'].usWeightClass,
    fontStyle: font['OS/2'].fsSelection.italic ? 'italic' : 'normal',
  }
}
