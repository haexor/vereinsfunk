import type { ImageStyleLogoPosition, ImageStylePreset } from '@vereinsfunk/contracts'
import type { ImageEffectProvider } from '@vereinsfunk/media-processing'
import { assertImageStyleInputSize, limitedSharp } from './imageStyleInput.js'
import { applyFilter } from './imageStyleFilters.js'
import { applyCustomFrame, applyParametricFrame, applyRoundedCorners, resolveFrameColorHex } from './imageStyleFrames.js'

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
  imageEffects?: ImageEffectProvider
  signal?: AbortSignal
}

export interface ImageStyleRenderResult {
  buffer: Buffer
  contentType: string
  width: number
  height: number
  filterProvider: string
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
  const metadata = await limitedSharp(buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for logo placement')
  const margin = Math.round((Math.min(width, height) * marginPercent) / 100)
  const boxWidth = Math.max(
    1,
    Math.min(Math.round((width * sizePercent) / 100), width - 2 * margin),
  )
  const boxHeight = Math.max(1, height - 2 * margin)
  const resizedLogo = await limitedSharp(logoAssetBuffer)
    .resize({ width: boxWidth, height: boxHeight, fit: 'inside' })
    .toBuffer()

  if (position === 'center') {
    return limitedSharp(buffer)
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toBuffer()
  }

  const logoMetadata = await limitedSharp(resizedLogo).metadata()
  const logoActualWidth = logoMetadata.width ?? boxWidth
  const logoActualHeight = logoMetadata.height ?? boxHeight
  const top = LOGO_TOP_ALIGNED.has(position) ? margin : height - logoActualHeight - margin
  const left = LOGO_LEFT_ALIGNED.has(position) ? margin : width - logoActualWidth - margin
  return limitedSharp(buffer)
    .composite([{ input: resizedLogo, top, left }])
    .png()
    .toBuffer()
}

// Zwischenschritte kodieren nach PNG, weil sie Transparenz brauchen oder aus rohen Pixeln
// entstehen. Als ENDformat waere das falsch: ein 3000x2000-JPEG-Foto kommt als verlustfreies PNG
// rund zwoelfmal so gross zurueck (gemessen), und die Veroeffentlichungsziele deckeln Bilder bei
// wenigen MB -- ausgerechnet die gestylten Fotos wuerden dort scheitern. Deshalb am Ende einmal
// bewusst kodieren:
//   - echte Transparenz im Ergebnis (abgerundete Ecken, Luecke im 'double'-Rahmen) -> PNG,
//     alternativlos.
//   - PNG-Quelle -> PNG, damit ein grafiknahes Original nicht in JPEG-Artefakte laeuft.
//   - sonst JPEG.
// Massgeblich ist, ob ein Pixel tatsaechlich durchscheint (stats().isOpaque), nicht hasAlpha:
// jedes composite() (Logo, Rahmengrafik, Eckmarken, Konfetti) legt einen Alphakanal an, auch wenn
// er ueberall deckend ist -- ein gerahmtes JPEG-Foto kam so als rund fuenfmal groesseres PNG zurueck.
// Das macht das Ergebnis zugleich immer bucket-tauglich: 'rendered-media' laesst nur image/jpeg
// und image/png zu, eine WebP-Quelle haette bis hierher ein image/webp-Upload und damit einen
// Storage-Fehler ergeben. Liegt das Ergebnis schon im Zielformat vor, bleibt der Puffer wie er
// ist -- ein unveraendertes Foto ('original', kein Rahmen, kein Logo) wird so nicht neu kodiert.
async function encodeResult(
  buffer: Buffer,
  sourceFormat: string | undefined,
): Promise<ImageStyleRenderResult> {
  const metadata = await limitedSharp(buffer).metadata()
  const transparent = metadata.hasAlpha === true && !(await limitedSharp(buffer).stats()).isOpaque
  const lossless = transparent || sourceFormat === 'png'
  const targetFormat = lossless ? 'png' : 'jpeg'
  const encoded =
    metadata.format === targetFormat
      ? buffer
      : await (lossless ? limitedSharp(buffer).png() : limitedSharp(buffer).jpeg({ quality: 90 })).toBuffer()
  return {
    buffer: encoded,
    contentType: lossless ? 'image/png' : 'image/jpeg',
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    filterProvider: 'sharp',
  }
}

export async function renderImageStyle(
  input: ImageStyleRenderInput,
): Promise<ImageStyleRenderResult> {
  const { preset } = input
  const sourceFormat = (await assertImageStyleInputSize(input.sourceBuffer)).format
  const filtered = await applyFilter(
    input.sourceBuffer,
    preset.filter,
    input.brandColors,
    input.imageEffects,
    input.signal,
  )
  let current = filtered.buffer

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
  // noch in den DB-CHECKs an frameType 'parametric' gebunden, und ImageStyleFramePreview.vue setzt
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

  return { ...(await encodeResult(current, sourceFormat)), filterProvider: filtered.provider }
}
