import { describe, expect, it } from 'vitest'
import { blurGrid, heatmapFocusThird, heatmapLut, playerHeatmapFromTracks, renderHeatmap, teamHeatmapFromTracks } from './veoHeatmap.js'
import { encodeTrackSamples, HEATMAP_HEIGHT, HEATMAP_WIDTH } from './veoPitch.js'

const periods = [
  { number: 1, startS: 100, endS: 199, ownSide: 'left' as const },
  { number: 2, startS: 300, endS: 399, ownSide: 'right' as const },
]

const track = (side: 'left' | 'right', startS: number, x: number, seconds: number, goalkeeper = false) => ({
  side, goalkeeper, startS, samples: encodeTrackSamples(Array.from({ length: seconds }, () => ({ x, y: 0.5 }))),
})

const columnOf = (grid: Float32Array) => {
  const index = grid.indexOf(Math.max(...grid))
  return index % HEATMAP_WIDTH
}

describe('teamHeatmapFromTracks', () => {
  it('takes the outfield players of the side the team plays on in the chosen interval and turns them to attack right', () => {
    // Halbzeit 1: eigene Mannschaft links, steht bei x = 0,2 (eigene Haelfte).
    // Halbzeit 2: eigene Mannschaft rechts, steht bei x = 0,8 -- gedreht ebenfalls 0,2.
    const tracks = [track('left', 100, 0.2, 100), track('right', 300, 0.8, 100), track('left', 100, 0.9, 100, true), track('right', 100, 0.6, 100)]
    const first = teamHeatmapFromTracks(tracks, periods, 'own', 100, 199)!
    const second = teamHeatmapFromTracks(tracks, periods, 'own', 300, 399)!
    expect(columnOf(first)).toBe(12)
    expect(columnOf(second)).toBe(12)
    // Gegner in Halbzeit 1 rechts bei 0,6, gedreht 0,4.
    expect(columnOf(teamHeatmapFromTracks(tracks, periods, 'opponent', 100, 199)!)).toBe(24)
  })

  it('counts only the seconds inside the interval and inside a period', () => {
    const tracks = [track('left', 100, 0.2, 50), track('left', 150, 0.7, 50)]
    expect(columnOf(teamHeatmapFromTracks(tracks, periods, 'own', 150, 199)!)).toBe(42)
    expect(teamHeatmapFromTracks(tracks, periods, 'own', 200, 299)).toBeNull()
  })
})

describe('playerHeatmapFromTracks', () => {
  it('takes the tracks of the jersey on the own side only, the goalkeeper included', () => {
    const tracks = [
      { ...track('left', 100, 0.2, 100, true), jerseyNumber: 1 },
      { ...track('right', 100, 0.7, 100), jerseyNumber: 1 },
      { ...track('left', 100, 0.5, 100), jerseyNumber: 7 },
    ]
    expect(columnOf(playerHeatmapFromTracks(tracks, periods, 1, 100, 199)!)).toBe(12)
    expect(playerHeatmapFromTracks(tracks, periods, 9, 100, 199)).toBeNull()
  })
})

describe('heatmapFocusThird', () => {
  it('names the third with the most weight', () => {
    const grid = new Float32Array(HEATMAP_WIDTH * HEATMAP_HEIGHT)
    grid[5 * HEATMAP_WIDTH + 50] = 1
    expect(heatmapFocusThird(grid)).toBe('attacking')
    expect(heatmapFocusThird(new Float32Array(HEATMAP_WIDTH * HEATMAP_HEIGHT))).toBeNull()
  })
})

describe('renderHeatmap', () => {
  it('blurs with a normalised kernel so the sum stays the same away from the edges', () => {
    const grid = new Float32Array(15 * 15)
    grid[7 * 15 + 7] = 1
    const blurred = blurGrid(grid, 15, 15)
    expect(blurred.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
    expect(blurred[7 * 15 + 7]).toBeGreaterThan(blurred[7 * 15 + 8]!)
  })

  it('leaves weak areas transparent and paints the peak opaque in the last colour', () => {
    const grid = new Float32Array(HEATMAP_WIDTH * HEATMAP_HEIGHT)
    grid[15 * HEATMAP_WIDTH + 30] = 1
    // Ausgabe in Rastergroesse: jedes Pixel trifft genau eine Zelle.
    const pixels = renderHeatmap(grid, HEATMAP_WIDTH, HEATMAP_HEIGHT, HEATMAP_WIDTH, HEATMAP_HEIGHT)
    const pixel = (x: number, y: number) => Array.from(pixels.slice((y * HEATMAP_WIDTH + x) * 4, (y * HEATMAP_WIDTH + x) * 4 + 4))
    expect(pixel(0, 0)[3]).toBe(0)
    const peak = pixel(30, 15)
    expect(peak[3]).toBeGreaterThan(240)
    expect(peak.slice(0, 3)).toEqual(Array.from(heatmapLut().slice(255 * 3, 256 * 3)))
    expect(renderHeatmap(new Float32Array(4), 2, 2, 4, 4).every((value) => value === 0)).toBe(true)
  })

  it('runs from the light green to the red stop of Veo', () => {
    const lut = heatmapLut()
    // Chroma x 1,1 verschiebt die Stufen leicht; Anfang und Ende bleiben hellgruen und rot.
    Array.from(lut.slice(0, 3)).forEach((channel, index) => expect(Math.abs(channel - [0xe5, 0xfe, 0x8d][index]!)).toBeLessThan(16))
    const [r, g, b] = Array.from(lut.slice(255 * 3))
    expect(r).toBeGreaterThan(230)
    expect(g! + b!).toBeLessThan(80)
  })
})
