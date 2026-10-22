// Spec 002 (research.md R-05): Heatmaps zeichnen wie Veo (Inventar §2.8, §3.6d) und die Heatmap
// einer Mannschaft fuer einen frei gewaehlten Zeitabschnitt aus den Positionsdaten rechnen.

import {
  decodeTrackSamples,
  HEATMAP_WIDTH,
  heatmapFromPoints,
  normalizeTrackPoint,
  thirdOf,
  trackTeam,
  type PitchPeriod,
  type PitchPoint,
  type PitchSide,
  type PitchTeam,
  type PitchThird,
} from './veoPitch.js'

export interface StoredTrack {
  side: PitchSide
  goalkeeper: boolean
  startS: number
  // Je Sekunde x/y als uint16, siehe encodeTrackSamples.
  samples: Uint8Array
}

/**
 * Heatmap einer Mannschaft aus den Positionsdaten zwischen `fromS` und `toS` (Videosekunden). Wie
 * Veos Mannschafts-Heatmap nur Feldspieler (Kategorien 1 und 3); gedreht, sodass die Mannschaft nach
 * rechts angreift. Null, wenn im Abschnitt keine Probe der Mannschaft liegt.
 */
export function teamHeatmapFromTracks(tracks: readonly StoredTrack[], periods: readonly PitchPeriod[], team: PitchTeam, fromS: number, toS: number): Float32Array | null {
  const points: PitchPoint[] = []
  for (const track of tracks) {
    if (track.goalkeeper) continue
    decodeTrackSamples(track.samples).forEach((point, index) => {
      const second = track.startS + index
      if (!point || second < fromS || second > toS) return
      if (trackTeam(track.side, periods, second) !== team) return
      points.push(normalizeTrackPoint(point, track.side))
    })
  }
  return points.length > 0 ? heatmapFromPoints(points) : null
}

/** Drittel mit dem groessten Anteil einer Heatmap -- Textersatz "Schwerpunkt im ...". */
export function heatmapFocusThird(grid: Float32Array, width = HEATMAP_WIDTH): PitchThird | null {
  const totals: Record<PitchThird, number> = { defensive: 0, middle: 0, attacking: 0 }
  grid.forEach((value, index) => { totals[thirdOf(((index % width) + 0.5) / width)] += value })
  const best = (Object.entries(totals) as [PitchThird, number][]).sort((a, b) => b[1] - a[1])[0]!
  return best[1] > 0 ? best[0] : null
}

// --- Zeichnen ---------------------------------------------------------------------------------------

const BLUR_SIGMA = 0.8
const THRESHOLD = 0.05
const FADE_BAND = 0.04
const GAMMA = 0.8

// Farbstufen von Analytics Studio und Spielerkarte (OKLCH-Verlauf), Chroma x 1,1.
export const VEO_HEATMAP_STOPS = ['#e5fe8d', '#dafb54', '#ffe500', '#ffcc00', '#f87612', '#f5140f'] as const
const CHROMA_BOOST = 1.1

/** Separabler Gauss-Filter mit Radius ceil(3 sigma), Rand geklemmt. */
export function blurGrid(grid: Float32Array, width: number, height: number, sigma = BLUR_SIGMA): Float32Array {
  const radius = Math.ceil(3 * sigma)
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, index) => Math.exp(-((index - radius) ** 2) / (2 * sigma * sigma)))
  const weight = kernel.reduce((sum, value) => sum + value, 0)
  const pass = (source: Float32Array, horizontal: boolean) => {
    const target = new Float32Array(source.length)
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        let sum = 0
        for (let offset = -radius; offset <= radius; offset += 1) {
          const c = horizontal ? Math.min(width - 1, Math.max(0, column + offset)) : column
          const r = horizontal ? row : Math.min(height - 1, Math.max(0, row + offset))
          sum += source[r * width + c]! * kernel[offset + radius]!
        }
        target[row * width + column] = sum / weight
      }
    }
    return target
  }
  return pass(pass(grid, true), false)
}

/**
 * RGBA-Pixel einer Heatmap in der Groesse outWidth x outHeight. Rezept wie Veo: weichzeichnen,
 * Werte unter 5 % des Hoechstwerts transparent mit 4 % Uebergang, auf die sichtbaren Werte normieren,
 * Gamma 0,8, bilinear abtasten, Farbe aus dem Verlauf, Deckkraft fade * g^0,1.
 */
export function renderHeatmap(grid: Float32Array, width: number, height: number, outWidth: number, outHeight: number): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(outWidth * outHeight * 4)
  const blurred = blurGrid(grid, width, height)
  const max = blurred.reduce((top, value) => Math.max(top, value), 0)
  if (max <= 0) return pixels
  const threshold = THRESHOLD * max
  const band = FADE_BAND * max
  let low = Infinity
  let high = -Infinity
  for (const value of blurred) if (value >= threshold) { low = Math.min(low, value); high = Math.max(high, value) }
  if (!(high > low)) { low = 0; high = 1 }
  const lut = heatmapLut()
  for (let py = 0; py < outHeight; py += 1) {
    for (let px = 0; px < outWidth; px += 1) {
      const value = sampleBilinear(blurred, width, height, ((px + 0.5) / outWidth) * width - 0.5, ((py + 0.5) / outHeight) * height - 0.5)
      if (value < threshold) continue
      const fade = Math.min(1, (value - threshold) / band)
      const g = Math.min(1, Math.max(0, (value - low) / (high - low))) ** GAMMA
      const color = Math.round(g * 255) * 3
      const offset = (py * outWidth + px) * 4
      pixels[offset] = lut[color]!
      pixels[offset + 1] = lut[color + 1]!
      pixels[offset + 2] = lut[color + 2]!
      pixels[offset + 3] = Math.round(255 * fade * g ** 0.1)
    }
  }
  return pixels
}

function sampleBilinear(grid: Float32Array, width: number, height: number, x: number, y: number): number {
  const cx = Math.min(width - 1, Math.max(0, x))
  const cy = Math.min(height - 1, Math.max(0, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  const top = grid[y0 * width + x0]! * (1 - fx) + grid[y0 * width + x1]! * fx
  const bottom = grid[y1 * width + x0]! * (1 - fx) + grid[y1 * width + x1]! * fx
  return top * (1 - fy) + bottom * fy
}

let cachedLut: Uint8ClampedArray | null = null

/** 256 Farben (RGB) zwischen den Stufen, in OKLCH auf dem kuerzeren Bogen interpoliert. */
export function heatmapLut(): Uint8ClampedArray {
  if (cachedLut) return cachedLut
  const stops = VEO_HEATMAP_STOPS.map((hex) => toOklch(hex))
  const lut = new Uint8ClampedArray(256 * 3)
  for (let index = 0; index < 256; index += 1) {
    const position = (index / 255) * (stops.length - 1)
    const segment = Math.min(stops.length - 2, Math.floor(position))
    const t = position - segment
    const [l0, c0, h0] = stops[segment]!
    const [l1, c1, h1] = stops[segment + 1]!
    const dh = ((h1 - h0 + 540) % 360) - 180
    const [r, g, b] = fromOklch(l0 + (l1 - l0) * t, (c0 + (c1 - c0) * t) * CHROMA_BOOST, h0 + dh * t)
    lut.set([r, g, b], index * 3)
  }
  cachedLut = lut
  return lut
}

// sRGB <-> OKLab nach Bjoern Ottosson.
const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
const fromLinear = (channel: number) => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055)

function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((start) => toLinear(parseInt(hex.slice(start, start + 2), 16) / 255)) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [lightness, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360]
}

function fromOklch(lightness: number, chroma: number, hue: number): [number, number, number] {
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return rgb.map((channel) => Math.round(Math.min(1, Math.max(0, fromLinear(channel))) * 255)) as [number, number, number]
}
