import type { ImageStyleFilter } from '@vereinsfunk/contracts'
import type { ImageEffectProvider } from '@vereinsfunk/media-processing'
import { hexToRgb } from './color.js'
import { limitedSharp } from './imageStyleInput.js'
import type { BrandColors } from './imageStyle.js'

// Eigener Fehlertyp statt einer bloßen Error: apps/api/src/app.ts verallgemeinert jeden
// unbehandelten 5xx bewusst zu "internal_error" (error.message kann Interna tragen) -- ohne diesen
// Typ könnten Aufrufer (z.B. der neue Preview-Endpunkt) "G'MIC fehlt in dieser Umgebung" nicht von
// einem echten Serverfehler unterscheiden und also keine erklärende Meldung zeigen.
export class GmicNotEnabledError extends Error {
  constructor() {
    super("G'MIC image effects are not enabled")
  }
}

// .linear(a, b): output = input * a + b. a > 1 spreizt die Werte um den Mittelpunkt (128) --
// b haelt ihn fix, damit das Bild dabei nicht insgesamt heller/dunkler wird.
async function applyHighContrast(buffer: Buffer): Promise<Buffer> {
  return limitedSharp(buffer)
    .linear(1.15, -(128 * 0.15))
    .modulate({ saturation: 1.15 })
    .toBuffer()
}

// Bewusst NICHT .tint(): das koloriert (ersetzt die Chroma) statt zu waermen -- ein Mannschafts-
// foto kaeme einfarbig sepia zurueck, praktisch ein zweites schwarz_weiss, und die Filter-Kachel
// (ImageStyleFramePreview.vue, "sepia(.35) saturate(1.15)") verspricht das Gegenteil. Stattdessen
// eine Verschiebung je Kanal: Rot leicht anheben, Gruen halten, Blau absenken -- Farben bleiben
// erhalten, das Gesamtbild kippt Richtung Amber.
async function applyWarm(buffer: Buffer): Promise<Buffer> {
  return limitedSharp(buffer).linear([1.06, 1.0, 0.94], [10, 2, -8]).toBuffer()
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
  const { data, info } = await limitedSharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true })
  const rgb = Buffer.alloc(info.width * info.height * 3)
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    const luminance = data[pixel * info.channels]! / 255
    rgb[pixel * 3] = Math.round(shadow.r + (highlight.r - shadow.r) * luminance)
    rgb[pixel * 3 + 1] = Math.round(shadow.g + (highlight.g - shadow.g) * luminance)
    rgb[pixel * 3 + 2] = Math.round(shadow.b + (highlight.b - shadow.b) * luminance)
  }
  return limitedSharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png()
    .toBuffer()
}

// Kein KI-Filter: Der Comic-Look bleibt bewusst deterministisch, schnell und datensparsam im
// eigenen Rendering. Eine kräftige Quantisierung, mehr Sättigung und ein leichtes Halftone-Raster
// ergeben einen klaren Editorial-/Comic-Look, ohne ein Spielerfoto an einen externen Anbieter zu
// senden oder Personen im Bild künstlich zu verändern.
async function applyComic(buffer: Buffer): Promise<Buffer> {
  const prepared = await limitedSharp(buffer)
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
  const posterized = await limitedSharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer()
  const dots = Buffer.from(
    `<svg width="${info.width}" height="${info.height}"><defs><pattern id="comic-dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.15" fill="#10251e" fill-opacity=".18"/></pattern></defs><rect width="100%" height="100%" fill="url(#comic-dots)"/></svg>`,
  )
  return limitedSharp(posterized)
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
  const metadata = await limitedSharp(buffer).metadata()
  if (!metadata.width || !metadata.height)
    throw new Error('cannot determine image dimensions for confetti overlay')
  return limitedSharp(buffer)
    .composite([{ input: createConfettiOverlay(metadata.width, metadata.height), blend: 'over' }])
    .png()
    .toBuffer()
}

export async function applyFilter(
  buffer: Buffer,
  filter: ImageStyleFilter,
  brandColors: BrandColors,
  imageEffects?: ImageEffectProvider,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; provider: string }> {
  if (imageEffects?.supports(filter)) {
    return { buffer: await imageEffects.apply(filter, buffer, signal), provider: imageEffects.id }
  }
  switch (filter) {
    case 'original':
      return { buffer, provider: 'sharp' }
    case 'schwarz_weiss':
      return { buffer: await limitedSharp(buffer).greyscale().toBuffer(), provider: 'sharp' }
    case 'kontrastreich':
      return { buffer: await applyHighContrast(buffer), provider: 'sharp' }
    case 'warm':
      return { buffer: await applyWarm(buffer), provider: 'sharp' }
    case 'vereinsfarben_duoton':
      return {
        buffer: await applyDuotone(buffer, brandColors.primaryColor, brandColors.accentColor),
        provider: 'sharp',
      }
    case 'comic':
      return { buffer: await applyComic(buffer), provider: 'sharp' }
    case 'konfetti':
      return { buffer: await applyConfetti(buffer), provider: 'sharp' }
    case 'gmic_vintage':
    case 'gmic_poster':
    case 'gmic_brushify':
    case 'gmic_cartoon':
    case 'gmic_color_ellipses':
    case 'gmic_cubism':
    case 'gmic_ellipsionism':
    case 'gmic_fire_edges':
    case 'gmic_fractalize':
    case 'gmic_glow':
    case 'gmic_halftone':
    case 'gmic_hardsketchbw':
    case 'gmic_hearts':
    case 'gmic_houghsketchbw':
    case 'gmic_lightrays':
    case 'gmic_light_relief':
    case 'gmic_linify':
    case 'gmic_mosaic':
    case 'gmic_pencilbw':
    case 'gmic_pixelsort':
    case 'gmic_polaroid':
    case 'gmic_polygonize':
    case 'gmic_poster_edges':
    case 'gmic_rodilius':
    case 'gmic_sketchbw':
    case 'gmic_sponge':
    case 'gmic_stained_glass':
    case 'gmic_stars':
    case 'gmic_stencil':
    case 'gmic_stencilbw':
    case 'gmic_tetris':
    case 'gmic_warhol':
    case 'gmic_weave':
    case 'gmic_whirls':
      throw new GmicNotEnabledError()
  }
}
