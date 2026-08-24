import type {
  ImageStyleFilter,
  ImageStyleFrameStyle,
  ImageStyleLogoPosition,
  ImageStylePreset,
} from '@vereinsfunk/contracts'
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
    | 'frameStyle'
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

// Exportiert, weil apps/api/src/photoLayout.ts (Plan 047, PR 1) dieselbe Hex->RGB-Umrechnung fuer
// die Trennlinien-/Gutter-Farbe der Bildkomposition braucht -- eine zweite Kopie derselben
// vierzeiligen Regex waere die groessere Redundanz.
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
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
  return sharp(buffer)
    .linear(1.15, -(128 * 0.15))
    .modulate({ saturation: 1.15 })
    .toBuffer()
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
async function applyDuotone(
  buffer: Buffer,
  primaryColor: string,
  accentColor: string,
): Promise<Buffer> {
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
  return sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png()
    .toBuffer()
}

// Kein KI-Filter: Der Comic-Look bleibt bewusst deterministisch, schnell und datensparsam im
// eigenen Rendering. Eine kräftige Quantisierung, mehr Sättigung und ein leichtes Halftone-Raster
// ergeben einen klaren Editorial-/Comic-Look, ohne ein Spielerfoto an einen externen Anbieter zu
// senden oder Personen im Bild künstlich zu verändern.
async function applyComic(buffer: Buffer): Promise<Buffer> {
  const prepared = await sharp(buffer)
    .modulate({ saturation: 1.42, brightness: 1.04 })
    .sharpen({ sigma: 1.15 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { data, info } = prepared
  const levels = 6
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    const offset = pixel * info.channels
    for (let channel = 0; channel < 3; channel++) {
      data[offset + channel] =
        Math.round((data[offset + channel]! / 255) * (levels - 1)) * (255 / (levels - 1))
    }
  }
  const posterized = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer()
  const dots = Buffer.from(
    `<svg width="${info.width}" height="${info.height}"><defs><pattern id="comic-dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.15" fill="#10251e" fill-opacity=".18"/></pattern></defs><rect width="100%" height="100%" fill="url(#comic-dots)"/></svg>`,
  )
  return sharp(posterized)
    .composite([{ input: dots, blend: 'over' }])
    .png()
    .toBuffer()
}

// Ein fester Pseudozufalls-Generator statt Math.random(): dieselbe Preset-Version muss immer
// dieselben Pixel liefern, damit externe Aktionen wiederholbar und Derivate auditierbar bleiben.
function createConfettiOverlay(width: number, height: number): Buffer {
  let state = ((width * 73856093) ^ (height * 19349663)) >>> 0
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  const colors = ['#ff375f', '#ffcc00', '#34c759', '#0a84ff', '#af52de', '#ff9f0a']
  const pieces = Array.from(
    { length: Math.max(30, Math.min(76, Math.round((width * height) / 45_000))) },
    () => {
      const x = Math.round(next() * width)
      const y = Math.round(next() * height)
      const size = Math.round(Math.max(9, Math.min(width, height) * (0.012 + next() * 0.018)))
      const rotation = Math.round(next() * 360)
      const color = colors[Math.floor(next() * colors.length)]!
      const shape =
        next() > 0.42
          ? `<rect x="${x}" y="${y}" width="${size}" height="${Math.max(5, Math.round(size * 0.48))}" rx="2" fill="${color}" transform="rotate(${rotation} ${x} ${y})"/>`
          : `<path d="M${x},${y} l${size},${Math.round(size * 0.34)} l-${Math.round(size * 0.45)},${size} z" fill="${color}" transform="rotate(${rotation} ${x} ${y})"/>`
      return shape
    },
  ).join('')
  return Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${pieces}</svg>`,
  )
}

async function applyConfetti(buffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata()
  if (!metadata.width || !metadata.height)
    throw new Error('cannot determine image dimensions for confetti overlay')
  return sharp(buffer)
    .composite([{ input: createConfettiOverlay(metadata.width, metadata.height), blend: 'over' }])
    .png()
    .toBuffer()
}

async function applyFilter(
  buffer: Buffer,
  filter: ImageStyleFilter,
  brandColors: BrandColors,
): Promise<Buffer> {
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
    case 'comic':
      return applyComic(buffer)
    case 'konfetti':
      return applyConfetti(buffer)
  }
}

async function applyRoundedCorners(buffer: Buffer, radiusPx: number): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for corner rounding')
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radiusPx}" ry="${radiusPx}" fill="#fff"/></svg>`,
  )
  return sharp(buffer)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

async function applySolidFrameStyle(
  buffer: Buffer,
  colorHex: string,
  widthPx: number,
): Promise<Buffer> {
  const color = hexToRgb(colorHex)
  return sharp(buffer)
    .extend({
      top: widthPx,
      bottom: widthPx,
      left: widthPx,
      right: widthPx,
      background: { r: color.r, g: color.g, b: color.b, alpha: 1 },
    })
    .png()
    .toBuffer()
}

// Rahmenzone (widthPx) gedrittelt in aeusseren Ring / Luecke / inneren Ring -- der innere Ring
// endet exakt dort, wo das Foto beginnt (ringThickness + gap + ringThickness = widthPx), die
// Luecke bleibt also immer im transparent erweiterten Rand, nie auf dem Foto selbst.
async function applyDoubleFrameStyle(
  buffer: Buffer,
  colorHex: string,
  widthPx: number,
): Promise<Buffer> {
  const extended = await sharp(buffer)
    .extend({
      top: widthPx,
      bottom: widthPx,
      left: widthPx,
      right: widthPx,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer()
  const metadata = await sharp(extended).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for double frame')

  const ringThickness = Math.max(1, Math.round(widthPx / 3))
  const gap = Math.max(0, widthPx - 2 * ringThickness)
  const ringPath = (inset: number, thickness: number): string =>
    thickness <= 0
      ? ''
      : `M${inset},${inset} H${width - inset} V${height - inset} H${inset} Z ` +
        `M${inset + thickness},${inset + thickness} H${width - inset - thickness} V${height - inset - thickness} H${inset + thickness} Z`
  const svg =
    `<svg width="${width}" height="${height}">` +
    `<path fill-rule="evenodd" fill="${colorHex}" d="${ringPath(0, ringThickness)}"/>` +
    `<path fill-rule="evenodd" fill="${colorHex}" d="${ringPath(ringThickness + gap, widthPx - ringThickness - gap)}"/>` +
    `</svg>`
  return sharp(extended)
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .png()
    .toBuffer()
}

// Vier L-foermige Eckklammern (Sucher-/Cropmark-Optik), direkt auf dem Foto -- kein Canvas-Extend
// noetig, die Marken liegen innerhalb der bestehenden Bildflaeche.
async function applyCornerMarksFrameStyle(
  buffer: Buffer,
  colorHex: string,
  widthPx: number,
): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for corner-marks frame')

  // Ohne Obergrenze wuerde ein grosses frameWidthPx (bis 200 laut Contract) auf einem kleinen Foto
  // die Marken ueber die Bildmitte hinaus wachsen lassen -- ein Drittel der kuerzeren Kante haelt
  // selbst im Extremfall (frameWidthPx=200 auf einem 40x40-Foto) einen unberuehrten Kern in der Mitte.
  const maxMarkSize = Math.max(1, Math.floor(Math.min(width, height) / 3))
  const thickness = Math.min(Math.max(1, widthPx), maxMarkSize)
  const legLength = Math.max(thickness, Math.min(widthPx * 4, maxMarkSize))
  const rect = (x: number, y: number, w: number, h: number): string =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${colorHex}"/>`
  const svg =
    `<svg width="${width}" height="${height}">` +
    rect(0, 0, legLength, thickness) +
    rect(0, 0, thickness, legLength) +
    rect(width - legLength, 0, legLength, thickness) +
    rect(width - thickness, 0, thickness, legLength) +
    rect(0, height - thickness, legLength, thickness) +
    rect(0, height - legLength, thickness, legLength) +
    rect(width - legLength, height - thickness, legLength, thickness) +
    rect(width - thickness, height - legLength, thickness, legLength) +
    `</svg>`
  return sharp(buffer)
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .png()
    .toBuffer()
}

// Polaroid-Optik: duenner gleicher Rand oben/links/rechts, deutlich dickerer Balken unten.
async function applyBottomBarFrameStyle(
  buffer: Buffer,
  colorHex: string,
  widthPx: number,
): Promise<Buffer> {
  const color = hexToRgb(colorHex)
  return sharp(buffer)
    .extend({
      top: widthPx,
      bottom: widthPx * 4,
      left: widthPx,
      right: widthPx,
      background: { r: color.r, g: color.g, b: color.b, alpha: 1 },
    })
    .png()
    .toBuffer()
}

// Gleichmaessig verteilte Mittelpunkte entlang einer Kante der Laenge `length`, mit `spacing`
// zwischen den Mittelpunkten und einem halben Abstand Rand links/rechts.
function beadOffsets(length: number, spacing: number): number[] {
  const count = Math.max(0, Math.floor(length / spacing))
  return Array.from({ length: count }, (_, index) => spacing / 2 + index * spacing)
}

// "Festlich" ist ein echter Siegerrahmen, nicht bloß ein goldener CSS-Rand: geformte Leisten,
// ein inneres Perlband und vier Florentiner Eckornamente. Er bleibt fest golden statt frameColor,
// damit ein Siegerfoto unabhängig vom Vereins-Branding sofort als Auszeichnung erkennbar ist.
async function applyFestlichFrameStyle(buffer: Buffer, widthPx: number): Promise<Buffer> {
  const extended = await sharp(buffer)
    .extend({
      top: widthPx,
      bottom: widthPx,
      left: widthPx,
      right: widthPx,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer()
  const metadata = await sharp(extended).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for festlich frame')

  const ringPath = `M0,0 H${width} V${height} H0 Z M${widthPx},${widthPx} H${width - widthPx} V${height - widthPx} H${widthPx} Z`
  const beadRadius = Math.max(1, widthPx * 0.16)
  const beadSpacing = beadRadius * 3.2
  const centerline = widthPx * 0.68
  const ornamentSize = Math.max(3, widthPx * 0.8)
  const beads = [
    ...beadOffsets(width, beadSpacing).flatMap((x) => [
      `<circle cx="${x}" cy="${centerline}" r="${beadRadius}" fill="#5c4413"/>`,
      `<circle cx="${x}" cy="${height - centerline}" r="${beadRadius}" fill="#5c4413"/>`,
    ]),
    ...beadOffsets(height, beadSpacing).flatMap((y) => [
      `<circle cx="${centerline}" cy="${y}" r="${beadRadius}" fill="#5c4413"/>`,
      `<circle cx="${width - centerline}" cy="${y}" r="${beadRadius}" fill="#5c4413"/>`,
    ]),
  ].join('')
  const corner = (x: number, y: number, horizontal: number, vertical: number): string => {
    const leaf = (factor: number, rotation: number) =>
      `<ellipse cx="${x + horizontal * ornamentSize * factor}" cy="${y + vertical * ornamentSize * factor}" rx="${Math.max(1, ornamentSize * 0.16)}" ry="${Math.max(1.4, ornamentSize * 0.38)}" fill="#fbe8a6" stroke="#725418" stroke-width="${Math.max(0.6, widthPx * 0.045)}" transform="rotate(${rotation} ${x + horizontal * ornamentSize * factor} ${y + vertical * ornamentSize * factor})"/>`
    const baseRotation = horizontal === vertical ? 45 : -45
    return `<g><circle cx="${x}" cy="${y}" r="${ornamentSize * 0.42}" fill="url(#gold)" stroke="#725418" stroke-width="${Math.max(1, widthPx * 0.09)}"/><circle cx="${x}" cy="${y}" r="${ornamentSize * 0.13}" fill="#fff1b8"/>${leaf(0.65, baseRotation)}${leaf(1.15, baseRotation)}${leaf(1.65, baseRotation)}<path d="M${x},${y} L${x + horizontal * ornamentSize * 2.1},${y + vertical * ornamentSize * 2.1}" stroke="#725418" stroke-width="${Math.max(1, widthPx * 0.08)}"/></g>`
  }
  const inset = Math.max(1, widthPx * 0.22)
  const corners = [
    corner(widthPx * 0.52, widthPx * 0.52, 1, 1),
    corner(width - widthPx * 0.52, widthPx * 0.52, -1, 1),
    corner(widthPx * 0.52, height - widthPx * 0.52, 1, -1),
    corner(width - widthPx * 0.52, height - widthPx * 0.52, -1, -1),
  ].join('')
  const svg =
    `<svg width="${width}" height="${height}">` +
    `<defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#604515"/><stop offset="16%" stop-color="#c79929"/><stop offset="40%" stop-color="#fff3bd"/><stop offset="60%" stop-color="#d4af37"/><stop offset="100%" stop-color="#6b4c14"/></linearGradient></defs>` +
    `<path fill-rule="evenodd" fill="url(#gold)" d="${ringPath}"/><rect x="${inset}" y="${inset}" width="${width - 2 * inset}" height="${height - 2 * inset}" fill="none" stroke="#725418" stroke-width="${Math.max(1, widthPx * 0.1)}"/><rect x="${widthPx - inset}" y="${widthPx - inset}" width="${width - 2 * (widthPx - inset)}" height="${height - 2 * (widthPx - inset)}" fill="none" stroke="#fff0a8" stroke-width="${Math.max(1, widthPx * 0.08)}"/>${beads}${corners}</svg>`
  return sharp(extended)
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .png()
    .toBuffer()
}

async function applyParametricFrame(
  buffer: Buffer,
  style: ImageStyleFrameStyle,
  colorHex: string,
  widthPx: number,
): Promise<Buffer> {
  switch (style) {
    case 'solid':
      return applySolidFrameStyle(buffer, colorHex, widthPx)
    case 'double':
      return applyDoubleFrameStyle(buffer, colorHex, widthPx)
    case 'corner_marks':
      return applyCornerMarksFrameStyle(buffer, colorHex, widthPx)
    case 'bottom_bar':
      return applyBottomBarFrameStyle(buffer, colorHex, widthPx)
    case 'festlich':
      return applyFestlichFrameStyle(buffer, widthPx)
  }
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
  const resizedFrame = await sharp(frameAssetBuffer)
    .resize({ width, height, fit: 'fill' })
    .toBuffer()
  return sharp(buffer)
    .composite([{ input: resizedFrame, gravity: 'center' }])
    .png()
    .toBuffer()
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
  const boxWidth = Math.max(
    1,
    Math.min(Math.round((width * sizePercent) / 100), width - 2 * margin),
  )
  const boxHeight = Math.max(1, height - 2 * margin)
  const resizedLogo = await sharp(logoAssetBuffer)
    .resize({ width: boxWidth, height: boxHeight, fit: 'inside' })
    .toBuffer()

  if (position === 'center') {
    return sharp(buffer)
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toBuffer()
  }

  const logoMetadata = await sharp(resizedLogo).metadata()
  const logoActualWidth = logoMetadata.width ?? boxWidth
  const logoActualHeight = logoMetadata.height ?? boxHeight
  const top = LOGO_TOP_ALIGNED.has(position) ? margin : height - logoActualHeight - margin
  const left = LOGO_LEFT_ALIGNED.has(position) ? margin : width - logoActualWidth - margin
  return sharp(buffer)
    .composite([{ input: resizedLogo, top, left }])
    .png()
    .toBuffer()
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
async function encodeResult(
  buffer: Buffer,
  sourceFormat: string | undefined,
): Promise<ImageStyleRenderResult> {
  const metadata = await sharp(buffer).metadata()
  const lossless = metadata.hasAlpha === true || sourceFormat === 'png'
  const targetFormat = lossless ? 'png' : 'jpeg'
  const encoded =
    metadata.format === targetFormat
      ? buffer
      : await (lossless ? sharp(buffer).png() : sharp(buffer).jpeg({ quality: 90 })).toBuffer()
  return {
    buffer: encoded,
    contentType: lossless ? 'image/png' : 'image/jpeg',
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  }
}

export async function renderImageStyle(
  input: ImageStyleRenderInput,
): Promise<ImageStyleRenderResult> {
  const { preset } = input
  const sourceFormat = (await sharp(input.sourceBuffer).metadata()).format
  let current = await applyFilter(input.sourceBuffer, preset.filter, input.brandColors)

  if (preset.frameType === 'parametric') {
    if (preset.frameWidthPx === null) throw new Error('parametric frame requires frameWidthPx')
    if (preset.frameStyle === null) throw new Error('parametric frame requires frameStyle')
    const colorHex = resolveFrameColorHex(preset.frameColor, input.brandColors)
    current = await applyParametricFrame(current, preset.frameStyle, colorHex, preset.frameWidthPx)
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
    if (preset.logoSizePercent === null || preset.logoMarginPercent === null)
      throw new Error('logoEnabled requires logoSizePercent and logoMarginPercent')
    current = await applyLogoWatermark(
      current,
      input.logoAssetBuffer,
      preset.logoPosition,
      preset.logoSizePercent,
      preset.logoMarginPercent,
    )
  }

  return encodeResult(current, sourceFormat)
}
