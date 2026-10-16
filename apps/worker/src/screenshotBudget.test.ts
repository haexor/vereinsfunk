import { describe, expect, it } from 'vitest'
import { captureScreenshotWithinBudget } from './screenshotBudget.js'

const shotOf = (bytes: number) => Buffer.alloc(bytes)

describe('captureScreenshotWithinBudget', () => {
  it('keeps the first screenshot that fits and does not capture again', async () => {
    const qualities: number[] = []
    const result = await captureScreenshotWithinBudget(async (quality) => {
      qualities.push(quality)
      return shotOf(100)
    }, 1000)
    expect(result.byteLength).toBe(100)
    expect(qualities).toEqual([80])
  })

  it('lowers the quality until the screenshot fits', async () => {
    const sizes: Record<number, number> = { 80: 900, 60: 600, 40: 300, 25: 100 }
    const qualities: number[] = []
    const result = await captureScreenshotWithinBudget(async (quality) => {
      qualities.push(quality)
      return shotOf(sizes[quality]!)
    }, 400)
    expect(result.byteLength).toBe(300)
    expect(qualities).toEqual([80, 60, 40])
  })

  it('returns the smallest attempt when nothing fits the budget', async () => {
    const sizes: Record<number, number> = { 80: 900, 60: 700, 40: 800, 25: 750 }
    const result = await captureScreenshotWithinBudget(async (quality) => shotOf(sizes[quality]!), 100)
    expect(result.byteLength).toBe(700)
  })
})
