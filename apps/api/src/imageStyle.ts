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

// Bewusst NICHT .tint(): das koloriert (ersetzt die Chroma) statt zu waermen -- ein Mannschafts-
// foto kaeme einfarbig sepia zurueck, praktisch ein zweites schwarz_weiss, und die CSS-Vorschau
// (ImageStyleLivePreview.vue, "sepia(.35) saturate(1.15)") verspricht das Gegenteil. Stattdessen
// eine Verschiebung je Kanal: Rot leicht anheben, Gruen halten, Blau absenken -- Farben bleiben
// erhalten, das Gesamtbild kippt Richtung Amber.
async function applyWarm(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).linear([1.06, 1.0, 0.94], [10, 2, -8]).toBuffer()
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

async function applyParametricFrame(buffer: Buffer, colorHex: string, widthPx: number): Promise<Buffer> {
  const color = hexToRgb(colorHex)
  return sharp(buffer)
    .extend({ top: widthPx, bottom: widthPx, left: widthPx, right: widthPx, background: { r: color.r, g: color.g, b: color.b, alpha: 1 } })
    .png()
    .toBuffer()
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

// Die Logogroesse ist relativ zur Bildbreite -- die einzige im Plan explizit benannte
// Referenzgroesse ("Größe relativ zur Bildbreite"). Der Randabstand nimmt die KUERZERE Kante als
// Basis: an der Bildbreite gemessen waere er bei einem Panorama (2000x300) hoeher als das Bild
// selbst. Beides zusammen ist mehr als Kosmetik -- sharp' composite verweigert jedes Overlay, das
// groesser als das Grundbild ist oder ausserhalb liegt, und die Route hat kein try/catch: ein
// legales Preset (30 % Groesse, 15 % Rand -- beides innerhalb der DB-CHECKs) wurde auf einem
// Panorama zu einem 500. Die Logo-Box wird deshalb zusaetzlich auf den verbleibenden Platz
// begrenzt, wodurch die Offsets nie negativ werden koennen.
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
  const margin = Math.round((Math.min(width, height) * marginPercent) / 100)
  const boxWidth = Math.max(1, Math.min(Math.round((width * sizePercent) / 100), width - 2 * margin))
  const boxHeight = Math.max(1, height - 2 * margin)
  const resizedLogo = await sharp(logoAssetBuffer).resize({ width: boxWidth, height: boxHeight, fit: 'inside' }).toBuffer()

  if (position === 'center') {
    return sharp(buffer).composite([{ input: resizedLogo, gravity: 'center' }]).png().toBuffer()
  }

  const logoMetadata = await sharp(resizedLogo).metadata()
  const logoActualWidth = logoMetadata.width ?? boxWidth
  const logoActualHeight = logoMetadata.height ?? boxHeight
  const top = LOGO_TOP_ALIGNED.has(position) ? margin : height - logoActualHeight - margin
  const left = LOGO_LEFT_ALIGNED.has(position) ? margin : width - logoActualWidth - margin
  return sharp(buffer).composite([{ input: resizedLogo, top, left }]).png().toBuffer()
}

// Zwischenschritte kodieren nach PNG, weil sie Transparenz brauchen oder aus rohen Pixeln
// entstehen. Als ENDformat waere das falsch: ein 3000x2000-JPEG-Foto kommt als verlustfreies PNG
// rund zwoelfmal so gross zurueck (gemessen), und die Veroeffentlichungsziele deckeln Bilder bei
// wenigen MB -- ausgerechnet die gestylten Fotos wuerden dort scheitern. Deshalb am Ende einmal
// bewusst kodieren:
//   - Alpha im Ergebnis (abgerundete Ecken, durchscheinende Rahmengrafik) -> PNG, alternativlos.
//   - PNG-Quelle -> PNG, damit ein grafiknahes Original nicht in JPEG-Artefakte laeuft.
//   - sonst JPEG.
// Das macht das Ergebnis zugleich immer bucket-tauglich: 'rendered-media' laesst nur image/jpeg
// und image/png zu, eine WebP-Quelle haette bis hierher ein image/webp-Upload und damit einen
// Storage-Fehler ergeben. Liegt das Ergebnis schon im Zielformat vor, bleibt der Puffer wie er
// ist -- ein unveraendertes Foto ('original', kein Rahmen, kein Logo) wird so nicht neu kodiert.
async function encodeResult(buffer: Buffer, sourceFormat: string | undefined): Promise<ImageStyleRenderResult> {
  const metadata = await sharp(buffer).metadata()
  const lossless = metadata.hasAlpha === true || sourceFormat === 'png'
  const targetFormat = lossless ? 'png' : 'jpeg'
  const encoded = metadata.format === targetFormat
    ? buffer
    : await (lossless ? sharp(buffer).png() : sharp(buffer).jpeg({ quality: 90 })).toBuffer()
  return {
    buffer: encoded,
    contentType: lossless ? 'image/png' : 'image/jpeg',
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  }
}

export async function renderImageStyle(input: ImageStyleRenderInput): Promise<ImageStyleRenderResult> {
  const { preset } = input
  const sourceFormat = (await sharp(input.sourceBuffer).metadata()).format
  let current = await applyFilter(input.sourceBuffer, preset.filter, input.brandColors)

  if (preset.frameType === 'parametric') {
    if (preset.frameWidthPx === null) throw new Error('parametric frame requires frameWidthPx')
    const colorHex = resolveFrameColorHex(preset.frameColor, input.brandColors)
    current = await applyParametricFrame(current, colorHex, preset.frameWidthPx)
  } else if (preset.frameType === 'custom') {
    if (!input.frameAssetBuffer) throw new Error('missing frame asset buffer for custom frame')
    current = await applyCustomFrame(current, input.frameAssetBuffer)
  }

  // Nach dem Rahmen, aber unabhaengig von dessen Art: frame_corner_radius_px ist weder im Contract
  // noch in den DB-CHECKs an frameType 'parametric' gebunden, und ImageStyleLivePreview.vue setzt
  // borderRadius ebenfalls fuer jeden Rahmentyp. Solange die Rundung nur im parametrischen Zweig
  // lief, zeigte die Vorschau bei frameType 'none'/'custom' runde Ecken, die im Ergebnis fehlten.
  if (preset.frameCornerRadiusPx && preset.frameCornerRadiusPx > 0) {
    current = await applyRoundedCorners(current, preset.frameCornerRadiusPx)
  }

  if (preset.logoEnabled) {
    if (!input.logoAssetBuffer) throw new Error('missing logo asset buffer')
    if (preset.logoSizePercent === null || preset.logoMarginPercent === null) throw new Error('logoEnabled requires logoSizePercent and logoMarginPercent')
    current = await applyLogoWatermark(current, input.logoAssetBuffer, preset.logoPosition, preset.logoSizePercent, preset.logoMarginPercent)
  }

  return encodeResult(current, sourceFormat)
}
