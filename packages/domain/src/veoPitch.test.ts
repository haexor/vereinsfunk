import { describe, expect, it } from 'vitest'
import {
  combineHeatmaps,
  decodeTrackSamples,
  downsampleTracks,
  encodeTrackSamples,
  HEATMAP_HEIGHT,
  HEATMAP_WIDTH,
  heatmapFromPoints,
  isInsidePenaltyBox,
  normalizeEventLocation,
  normalizeHeatmapCells,
  normalizeTrackPoint,
  periodAt,
  thirdOf,
  trackTeam,
} from './veoPitch.js'

const periods = [
  { number: 1, startS: 605, endS: 2573, ownSide: 'left' as const },
  { number: 2, startS: 3268, endS: 5441, ownSide: 'right' as const },
]

describe('normalizeEventLocation', () => {
  // Testabruf 2026-10-21: eigene Schuesse in Halbzeit 1 (eigene Mannschaft verteidigt links) bei
  // x ~ 0,88, in Halbzeit 2 bei x ~ 0,24 -- nach dem Normieren greifen beide nach rechts an.
  it('keeps own events when the own team defends left and mirrors them when it defends right', () => {
    expect(normalizeEventLocation({ x: 0.9, z: 0.3 }, 'own', 'left')).toEqual({ x: 0.9, y: 0.3 })
    const mirrored = normalizeEventLocation({ x: 0.24, z: 0.3 }, 'own', 'right')!
    expect(mirrored.x).toBeCloseTo(0.76)
    expect(mirrored.y).toBeCloseTo(0.7)
  })

  it('mirrors opponent events when the own team defends left, like the Veo shot map', () => {
    const point = normalizeEventLocation({ x: 0.1, z: 0.2 }, 'opponent', 'left')!
    expect(point.x).toBeCloseTo(0.9)
    expect(point.y).toBeCloseTo(0.8)
    expect(normalizeEventLocation({ x: 0.968, z: 0.5 }, 'opponent', 'right')).toEqual({ x: 0.968, y: 0.5 })
  })

  it('clamps values Veo reports slightly outside the pitch', () => {
    expect(normalizeEventLocation({ x: 1.02, z: -0.0016 }, 'own', 'left')).toEqual({ x: 1, y: 0 })
    expect(normalizeEventLocation({ x: 0.5, z: 1.04 }, 'own', 'left')).toEqual({ x: 0.5, y: 1 })
  })

  it('keeps an event without location without location', () => {
    expect(normalizeEventLocation({ x: null, z: null }, 'own', 'left')).toBeNull()
    expect(normalizeEventLocation({ x: 0.5, z: null }, 'own', 'left')).toBeNull()
  })
})

describe('periods, thirds and penalty box', () => {
  it('finds the period of a video time and nothing in the break', () => {
    expect(periodAt(periods, 605)?.number).toBe(1)
    expect(periodAt(periods, 2573)?.number).toBe(1)
    expect(periodAt(periods, 3000)).toBeNull()
    expect(periodAt(periods, 5441)?.number).toBe(2)
  })

  it('splits the pitch into thirds at one and two thirds', () => {
    expect(thirdOf(0.2)).toBe('defensive')
    expect(thirdOf(1 / 3)).toBe('middle')
    expect(thirdOf(2 / 3)).toBe('middle')
    expect(thirdOf(0.7)).toBe('attacking')
  })

  it('uses the box of the Veo shot map (234 x 150, box from x 198.132 and y 31.4706 to 118.529)', () => {
    expect(isInsidePenaltyBox({ x: 0.9, y: 0.5 })).toBe(true)
    expect(isInsidePenaltyBox({ x: 198.132 / 234, y: 31.4706 / 150 })).toBe(true)
    expect(isInsidePenaltyBox({ x: 0.84, y: 0.5 })).toBe(false)
    expect(isInsidePenaltyBox({ x: 0.9, y: 0.2 })).toBe(false)
  })
})

describe('heatmap matrices', () => {
  it('keeps a left-to-right matrix and reverses rows and columns of a right-to-left one', () => {
    const cells = Uint8Array.from([1, 2, 3, 4, 5, 6])
    expect([...normalizeHeatmapCells(cells, 3, 2, 'leftToRight')]).toEqual([1, 2, 3, 4, 5, 6])
    expect([...normalizeHeatmapCells(cells, 3, 2, 'rightToLeft')]).toEqual([6, 5, 4, 3, 2, 1])
  })

  // Testabruf: der Schwerpunkt einer Veo-Matrix liegt in Spalte x und Zeile 1 - z -- Zeile 0 ist
  // der Rand bei y = 1.
  it('puts points into the cell Veo uses, with row 0 at y = 1', () => {
    const grid = heatmapFromPoints([{ x: 0.01, y: 0.99 }, { x: 0.99, y: 0.01 }, { x: 0.99, y: 0.01 }])
    expect(grid).toHaveLength(HEATMAP_WIDTH * HEATMAP_HEIGHT)
    expect(grid[0]).toBeCloseTo(0.5)
    expect(grid[(HEATMAP_HEIGHT - 1) * HEATMAP_WIDTH + HEATMAP_WIDTH - 1]).toBe(1)
    expect(Math.max(...grid)).toBe(1)
  })

  it('returns an empty grid without points', () => {
    expect(Math.max(...heatmapFromPoints([]))).toBe(0)
  })

  it('sums matrices weighted by seconds played and normalises to 1', () => {
    const a = { cells: Uint8Array.from([255, 0]), weight: 60 }
    const b = { cells: Uint8Array.from([0, 255]), weight: 20 }
    expect(combineHeatmaps([a, b])).toEqual(Float32Array.from([1, 1 / 3]))
    expect(combineHeatmaps([])).toBeNull()
  })

  it('refuses matrices of different sizes', () => {
    expect(() => combineHeatmaps([{ cells: new Uint8Array(2), weight: 1 }, { cells: new Uint8Array(3), weight: 1 }])).toThrow(/size/)
  })
})

describe('tracks', () => {
  const sample = (t: number, trackId: number, category: number, x: number, jerseyNumber: number | null = 7) => ({ t, trackId, category, x, y: 0.5, jerseyNumber })

  it('keeps one point per second per track, drops ball and referee, and keeps the most frequent jersey', () => {
    const tracks = downsampleTracks([
      sample(605.19, 3, 1, 0.2), sample(605.59, 3, 1, 0.21), sample(605.99, 3, 1, 0.22, null),
      sample(606.39, 3, 1, 0.3, 9), sample(608.1, 3, 1, 0.4),
      sample(605.19, 8, 6, 0.5), sample(605.19, 9, 4, 0.5), sample(605.19, 4, 2, 0.95, null),
    ])
    expect(tracks.map((track) => track.veoTrackId)).toEqual([3, 4])
    const field = tracks[0]!
    expect(field).toMatchObject({ side: 'left', goalkeeper: false, jerseyNumber: 7, startS: 605 })
    expect(field.points).toEqual([{ x: 0.2, y: 0.5 }, { x: 0.3, y: 0.5 }, null, { x: 0.4, y: 0.5 }])
    expect(tracks[1]).toMatchObject({ side: 'right', goalkeeper: true, jerseyNumber: null })
  })

  it('round-trips points through the uint16 encoding with gaps', () => {
    const points = [{ x: 0, y: 1 }, null, { x: 0.5, y: 0.25 }]
    const decoded = decodeTrackSamples(encodeTrackSamples(points))
    expect(decoded[0]).toEqual({ x: 0, y: 1 })
    expect(decoded[1]).toBeNull()
    expect(decoded[2]!.x).toBeCloseTo(0.5, 4)
    expect(decoded[2]!.y).toBeCloseTo(0.25, 4)
  })

  it('rejects an encoding whose length is not a multiple of four', () => {
    expect(() => decodeTrackSamples(new Uint8Array(3))).toThrow(/length/)
  })

  it('assigns a side to the own team or the opponent per period and normalises the direction', () => {
    expect(trackTeam('left', periods, 700)).toBe('own')
    expect(trackTeam('left', periods, 4000)).toBe('opponent')
    expect(trackTeam('right', periods, 3000)).toBeNull()
    const point = normalizeTrackPoint({ x: 0.1, y: 0.2 }, 'right')
    expect(point.x).toBeCloseTo(0.9)
    expect(point.y).toBeCloseTo(0.8)
    expect(normalizeTrackPoint({ x: 0.1, y: 0.2 }, 'left')).toEqual({ x: 0.1, y: 0.2 })
  })
})
