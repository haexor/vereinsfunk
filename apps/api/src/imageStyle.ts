import type { ImageStyleFilter, ImageStyleLogoPosition, ImageStylePreset } from '@vereinsfunk/contracts'
import sharp from 'sharp'

export interface BrandColors {
  primaryColor: string
  accentColor: string
}

export interface ImageStyleRenderInput {
  sourceBuffer: Buffer
  preset: Pick<
    ImageStylePreset,
    | 'frameType'
    | 'frameColor'
    | 'frameWidthPx'
    | 'frameCornerRadiusPx'
    | 'logoEnabled'
    | 'logoPosition'
    | 'logoSizePercent'
    | 'logoMarginPercent'
    | 'filter'
  >
  frameAssetBuffer?: Buffer
  logoAssetBuffer?: Buffer
  brandColors: BrandColors
}

export interface ImageStyleRenderResult {
  buffer: Buffer
  contentType: string
  width: number
  height: number
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex)
  if (!match) throw new Error(`not a hex color: ${hex}`)
  return { r: parseInt(match[1]!, 16), g: parseInt(match[2]!, 16), b: parseInt(match[3]!, 16) }
}

function resolveFrameColorHex(frameColor: string | null, brandColors: BrandColors): string {
  if (frameColor === 'primary') return brandColors.primaryColor
  if (frameColor === 'accent') return brandColors.accentColor
  if (!frameColor) throw new Error('parametric frame requires frameColor')
  return frameColor
}

// .linear(a, b): output = input * a + b. a > 1 spreizt die Werte um den Mittelpunkt (128) --
// b haelt ihn fix, damit das Bild dabei nicht insgesamt heller/dunkler wird.
async function applyHighContrast(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).linear(1.15, -(128 * 0.15)).modulate({ saturation: 1.15 }).toBuffer()
}

async function applyWarm(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).tint({ r: 255, g: 200, b: 150 }).toBuffer()
}

// sharp kennt keinen Gradient-Map-Filter: Graustufen-Luminanz je Pixel wird hier von Hand
// zwischen Vereinsfarbe (Schatten) und Akzentfarbe (Lichter) interpoliert. .greyscale().raw()
// liefert je Pixel mindestens einen Luminanzkanal (info.channels kann bei vorhandenem Alpha
// hoeher sein) -- Kanal 0 ist in jedem Fall die Luminanz.
async function applyDuotone(buffer: Buffer, primaryColor: string, accentColor: string): Promise<Buffer> {
  const shadow = hexToRgb(primaryColor)
  const highlight = hexToRgb(accentColor)
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true })
  const rgb = Buffer.alloc(info.width * info.height * 3)
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    const luminance = data[pixel * info.channels]! / 255
    rgb[pixel * 3] = Math.round(shadow.r + (highlight.r - shadow.r) * luminance)
    rgb[pixel * 3 + 1] = Math.round(shadow.g + (highlight.g - shadow.g) * luminance)
    rgb[pixel * 3 + 2] = Math.round(shadow.b + (highlight.b - shadow.b) * luminance)
  }
  return sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()
}

async function applyFilter(buffer: Buffer, filter: ImageStyleFilter, brandColors: BrandColors): Promise<Buffer> {
  switch (filter) {
    case 'original':
      return buffer
    case 'schwarz_weiss':
      return sharp(buffer).greyscale().toBuffer()
    case 'kontrastreich':
      return applyHighContrast(buffer)
    case 'warm':
      return applyWarm(buffer)
    case 'vereinsfarben_duoton':
      return applyDuotone(buffer, brandColors.primaryColor, brandColors.accentColor)
  }
}

async function applyRoundedCorners(buffer: Buffer, radiusPx: number): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for corner rounding')
  const mask = Buffer.from(`<svg width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radiusPx}" ry="${radiusPx}" fill="#fff"/></svg>`)
  return sharp(buffer).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}

async function applyParametricFrame(buffer: Buffer, colorHex: string, widthPx: number, cornerRadiusPx: number | null): Promise<Buffer> {
  const color = hexToRgb(colorHex)
  const framed = await sharp(buffer)
    .extend({ top: widthPx, bottom: widthPx, left: widthPx, right: widthPx, background: { r: color.r, g: color.g, b: color.b, alpha: 1 } })
    .png()
    .toBuffer()
  if (cornerRadiusPx && cornerRadiusPx > 0) return applyRoundedCorners(framed, cornerRadiusPx)
  return framed
}

// Die Rahmengrafik wird auf die Fotomasse gestreckt (fit: 'fill') statt umgekehrt das Foto an die
// Rahmengrafik anzupassen -- das Foto behaelt so sein eigenes Seitenverhaeltnis. Das setzt voraus,
// dass hochgeladene Rahmengrafiken einen durchsichtigen Bereich passend zum spaeter angehaengten
// Foto haben; dieselbe Annahme wie bei jedem "Rahmen als PNG-Overlay"-Muster.
async function applyCustomFrame(buffer: Buffer, frameAssetBuffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for custom frame')
  const resizedFrame = await sharp(frameAssetBuffer).resize({ width, height, fit: 'fill' }).toBuffer()
  return sharp(buffer).composite([{ input: resizedFrame, gravity: 'center' }]).png().toBuffer()
}

const LOGO_TOP_ALIGNED: ReadonlySet<ImageStyleLogoPosition> = new Set(['top_left', 'top_right'])
const LOGO_LEFT_ALIGNED: ReadonlySet<ImageStyleLogoPosition> = new Set(['top_left', 'bottom_left'])

// Groesse UND Randabstand sind relativ zur Bildbreite (nicht zur Hoehe) -- die einzige im Plan
// explizit benannte Referenzgroesse ("Größe relativ zur Bildbreite"); der Randabstand folgt
// derselben Referenz, weil das Plandokument dafuer keine eigene Basis nennt.
async function applyLogoWatermark(
  buffer: Buffer,
  logoAssetBuffer: Buffer,
  position: ImageStyleLogoPosition,
  sizePercent: number,
  marginPercent: number,
): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for logo placement')
  const logoWidth = Math.round((width * sizePercent) / 100)
  const resizedLogo = await sharp(logoAssetBuffer).resize({ width: logoWidth, fit: 'inside' }).toBuffer()
  const logoMetadata = await sharp(resizedLogo).metadata()
  const logoActualWidth = logoMetadata.width ?? logoWidth
  const logoActualHeight = logoMetadata.height ?? logoWidth

  if (position === 'center') {
    return sharp(buffer).composite([{ input: resizedLogo, gravity: 'center' }]).png().toBuffer()
  }

  const margin = Math.round((width * marginPercent) / 100)
  const top = LOGO_TOP_ALIGNED.has(position) ? margin : height - logoActualHeight - margin
  const left = LOGO_LEFT_ALIGNED.has(position) ? margin : width - logoActualWidth - margin
  return sharp(buffer).composite([{ input: resizedLogo, top, left }]).png().toBuffer()
}

const CONTENT_TYPE_BY_FORMAT: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }

export async function renderImageStyle(input: ImageStyleRenderInput): Promise<ImageStyleRenderResult> {
  const { preset } = input
  let current = await applyFilter(input.sourceBuffer, preset.filter, input.brandColors)

  if (preset.frameType === 'parametric') {
    if (preset.frameWidthPx === null) throw new Error('parametric frame requires frameWidthPx')
    const colorHex = resolveFrameColorHex(preset.frameColor, input.brandColors)
    current = await applyParametricFrame(current, colorHex, preset.frameWidthPx, preset.frameCornerRadiusPx)
  } else if (preset.frameType === 'custom') {
    if (!input.frameAssetBuffer) throw new Error('missing frame asset buffer for custom frame')
    current = await applyCustomFrame(current, input.frameAssetBuffer)
  }

  if (preset.logoEnabled) {
    if (!input.logoAssetBuffer) throw new Error('missing logo asset buffer')
    if (preset.logoSizePercent === null || preset.logoMarginPercent === null) throw new Error('logoEnabled requires logoSizePercent and logoMarginPercent')
    current = await applyLogoWatermark(current, input.logoAssetBuffer, preset.logoPosition, preset.logoSizePercent, preset.logoMarginPercent)
  }

  const finalMetadata = await sharp(current).metadata()
  const format = finalMetadata.format ?? 'png'
  return {
    buffer: current,
    contentType: CONTENT_TYPE_BY_FORMAT[format] ?? 'application/octet-stream',
    width: finalMetadata.width ?? 0,
    height: finalMetadata.height ?? 0,
  }
}
