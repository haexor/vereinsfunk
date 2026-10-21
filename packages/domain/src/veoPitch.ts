// Spec 002 (research.md R-05, R-06): Spielfeld-Regeln der Veo-Analyse. Worker (Normieren beim
// Schreiben) und Web (Zeichnen, Zeitabschnitte) rechnen damit gleich. Koordinaten nach dem Normieren:
// x entlang der Laenge, die jeweilige Mannschaft greift Richtung x = 1 an; y ueber die Breite.
// Beides liegt in [0, 1].

export type PitchSide = 'left' | 'right'
export type PitchTeam = 'own' | 'opponent'
export type PitchThird = 'defensive' | 'middle' | 'attacking'

export interface PitchPoint { x: number; y: number }

export interface PitchPeriod {
  number: number
  startS: number
  endS: number
  // Seite, auf der die eigene Mannschaft in dieser Halbzeit verteidigt (Kamerasicht).
  ownSide: PitchSide
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * Ort eines MES-Ereignisses (Kamerasicht x/z) so gedreht, dass die Mannschaft des Ereignisses nach
 * rechts angreift -- wie Veos Schusskarte (Inventar §1a.7 `wt`). Veo liefert Werte knapp ausserhalb
 * des Feldes; sie werden wie beim Zeichnen in Veo auf das Feld begrenzt.
 */
export function normalizeEventLocation(raw: { x: number | null; z: number | null }, team: PitchTeam, ownSide: PitchSide): PitchPoint | null {
  if (raw.x === null || raw.z === null) return null
  const defendsRight = (team === 'own') === (ownSide === 'right')
  return defendsRight ? { x: clamp01(1 - raw.x), y: clamp01(1 - raw.z) } : { x: clamp01(raw.x), y: clamp01(raw.z) }
}

/** Halbzeit, in die eine Videozeit (Sekunden) faellt; Pausen und Vor- und Nachlauf gehoeren zu keiner. */
export function periodAt<T extends PitchPeriod>(periods: readonly T[], videoTimeS: number): T | null {
  return periods.find((period) => period.startS <= videoTimeS && videoTimeS <= period.endS) ?? null
}

/** Drittel aus Sicht der angreifenden Mannschaft (Inventar §1a.3.2). */
export function thirdOf(x: number): PitchThird {
  if (x < 1 / 3) return 'defensive'
  if (x > 2 / 3) return 'attacking'
  return 'middle'
}

// Strafraum der Veo-Schusskarte, Spielfeld 234 x 150 (Inventar §1a.7).
const BOX_MIN_X = 198.132 / 234
const BOX_MIN_Y = 31.4706 / 150
const BOX_MAX_Y = 118.529 / 150

/** Liegt ein normierter Ort im gegnerischen Strafraum? */
export function isInsidePenaltyBox(point: PitchPoint): boolean {
  return point.x >= BOX_MIN_X && point.y >= BOX_MIN_Y && point.y <= BOX_MAX_Y
}

// --- Heatmaps -------------------------------------------------------------------------------------

// Raster der Veo-Spielerheatmaps (Testabruf: 60 x 30, zeilenweise, Zeile 0 am Rand y = 1).
export const HEATMAP_WIDTH = 60
export const HEATMAP_HEIGHT = 30

/** Dreht eine Veo-Matrix mit direction_of_play "rightToLeft" nach "leftToRight" (Inventar §4.2.2). */
export function normalizeHeatmapCells(cells: Uint8Array, width: number, height: number, direction: 'leftToRight' | 'rightToLeft'): Uint8Array {
  if (cells.length !== width * height) throw new Error('heatmap size does not match its cells')
  return direction === 'leftToRight' ? Uint8Array.from(cells) : Uint8Array.from(cells).reverse()
}

/** Dichteraster aus normierten Orten, auf 1 normiert -- gleiche Ausrichtung wie Veos Matrizen. */
export function heatmapFromPoints(points: readonly PitchPoint[], width = HEATMAP_WIDTH, height = HEATMAP_HEIGHT): Float32Array {
  const grid = new Float32Array(width * height)
  for (const point of points) {
    const column = Math.min(width - 1, Math.floor(clamp01(point.x) * width))
    const row = Math.min(height - 1, Math.floor((1 - clamp01(point.y)) * height))
    grid[row * width + column]! += 1
  }
  const max = grid.reduce((top, value) => Math.max(top, value), 0)
  if (max > 0) for (let index = 0; index < grid.length; index += 1) grid[index]! /= max
  return grid
}

/**
 * Saison-Heatmap: Veo-Matrizen mehrerer Spiele nach Spielsekunden gewichtet summiert und auf 1
 * normiert. Veo normiert jede Matrix je Spieler, die Summe ist deshalb eine Naeherung (research.md R-05).
 */
export function combineHeatmaps(maps: readonly { cells: Uint8Array; weight: number }[]): Float32Array | null {
  if (maps.length === 0) return null
  const size = maps[0]!.cells.length
  if (maps.some((map) => map.cells.length !== size)) throw new Error('heatmaps of different size cannot be combined')
  const sum = new Float32Array(size)
  for (const map of maps) for (let index = 0; index < size; index += 1) sum[index]! += (map.cells[index]! / 255) * map.weight
  const max = sum.reduce((top, value) => Math.max(top, value), 0)
  if (max > 0) for (let index = 0; index < size; index += 1) sum[index]! /= max
  return sum
}

// --- Positionsdaten -------------------------------------------------------------------------------

export interface TrackSample {
  t: number
  trackId: number
  // Veo: 0 Torwart links, 1 Feldspieler links, 2 Torwart rechts, 3 Feldspieler rechts, 4 Schiedsrichter, 6 Ball.
  category: number
  x: number
  y: number
  jerseyNumber: number | null
}

export interface PitchTrack {
  veoTrackId: number
  side: PitchSide
  goalkeeper: boolean
  // Haeufigste erkannte Rueckennummer der Spur.
  jerseyNumber: number | null
  // Erste volle Sekunde; points[i] gehoert zur Sekunde startS + i (Kamerasicht).
  startS: number
  points: (PitchPoint | null)[]
}

const SIDE_BY_CATEGORY: Readonly<Record<number, { side: PitchSide; goalkeeper: boolean }>> = {
  0: { side: 'left', goalkeeper: true },
  1: { side: 'left', goalkeeper: false },
  2: { side: 'right', goalkeeper: true },
  3: { side: 'right', goalkeeper: false },
}

/** Verdichtet Veo-Proben (2,5 Hz) auf die erste Probe je Sekunde und Spur; Ball und Schiedsrichter entfallen. */
export function downsampleTracks(samples: readonly TrackSample[]): PitchTrack[] {
  const byTrack = new Map<number, { side: PitchSide; goalkeeper: boolean; seconds: Map<number, PitchPoint>; jerseys: Map<number, number> }>()
  for (const sample of samples) {
    const kind = SIDE_BY_CATEGORY[sample.category]
    if (!kind) continue
    const track = byTrack.get(sample.trackId) ?? { ...kind, seconds: new Map(), jerseys: new Map() }
    const second = Math.floor(sample.t)
    if (!track.seconds.has(second)) track.seconds.set(second, { x: clamp01(sample.x), y: clamp01(sample.y) })
    if (sample.jerseyNumber !== null) track.jerseys.set(sample.jerseyNumber, (track.jerseys.get(sample.jerseyNumber) ?? 0) + 1)
    byTrack.set(sample.trackId, track)
  }
  return [...byTrack.entries()].sort(([a], [b]) => a - b).map(([veoTrackId, track]) => {
    const seconds = [...track.seconds.keys()]
    const startS = Math.min(...seconds)
    const endS = Math.max(...seconds)
    const points = Array.from({ length: endS - startS + 1 }, (_, index) => track.seconds.get(startS + index) ?? null)
    const jerseyNumber = [...track.jerseys.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null
    return { veoTrackId, side: track.side, goalkeeper: track.goalkeeper, jerseyNumber, startS, points }
  })
}

const NO_VALUE = 0xffff
const SCALE = 0xfffe

/** Je Sekunde x und y als uint16 (little endian), 0xFFFF fuer keine Probe. */
export function encodeTrackSamples(points: readonly (PitchPoint | null)[]): Uint8Array {
  const bytes = new Uint8Array(points.length * 4)
  const view = new DataView(bytes.buffer)
  points.forEach((point, index) => {
    view.setUint16(index * 4, point ? Math.round(clamp01(point.x) * SCALE) : NO_VALUE, true)
    view.setUint16(index * 4 + 2, point ? Math.round(clamp01(point.y) * SCALE) : NO_VALUE, true)
  })
  return bytes
}

export function decodeTrackSamples(bytes: Uint8Array): (PitchPoint | null)[] {
  if (bytes.length % 4 !== 0) throw new Error('track samples length must be a multiple of four')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({ length: bytes.length / 4 }, (_, index) => {
    const x = view.getUint16(index * 4, true)
    const y = view.getUint16(index * 4 + 2, true)
    return x === NO_VALUE || y === NO_VALUE ? null : { x: x / SCALE, y: y / SCALE }
  })
}

/** Zu welcher Mannschaft eine Spur auf `side` zur Videozeit gehoert; ausserhalb der Halbzeiten zu keiner. */
export function trackTeam(side: PitchSide, periods: readonly PitchPeriod[], videoTimeS: number): PitchTeam | null {
  const period = periodAt(periods, videoTimeS)
  if (!period) return null
  return period.ownSide === side ? 'own' : 'opponent'
}

/** Ort einer Spur so gedreht, dass ihre Mannschaft nach rechts angreift (sie verteidigt auf `side`). */
export function normalizeTrackPoint(point: PitchPoint, side: PitchSide): PitchPoint {
  return side === 'right' ? { x: 1 - point.x, y: 1 - point.y } : { x: point.x, y: point.y }
}
