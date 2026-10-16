import { describe, expect, it } from 'vitest'
import { captureScreenshot } from './screenshotCapture.js'

const shotOf = (bytes: number) => Buffer.alloc(bytes)

describe('captureScreenshot', () => {
  it('keeps the lossless PNG when it fits the budget', async () => {
    const calls: string[] = []
    const result = await captureScreenshot(async (type) => {
      calls.push(type)
      return shotOf(500)
    }, 1000)
    expect(result.mediaType).toBe('image/png')
    expect(result.buffer.byteLength).toBe(500)
    expect(calls).toEqual(['png'])
  })

  it('falls back to JPEG with falling quality until it fits', async () => {
    const jpegSizes: Record<number, number> = { 90: 900, 75: 300, 60: 100 }
    const calls: string[] = []
    const result = await captureScreenshot(async (type, quality) => {
      calls.push(type === 'png' ? 'png' : `jpeg${quality}`)
      return type === 'png' ? shotOf(5000) : shotOf(jpegSizes[quality!]!)
    }, 400)
    expect(result.mediaType).toBe('image/jpeg')
    expect(result.buffer.byteLength).toBe(300)
    expect(calls).toEqual(['png', 'jpeg90', 'jpeg75'])
  })

  it('returns the smallest attempt when nothing fits the budget', async () => {
    const jpegSizes: Record<number, number> = { 90: 900, 75: 700, 60: 800 }
    const result = await captureScreenshot(async (type, quality) => (type === 'png' ? shotOf(5000) : shotOf(jpegSizes[quality!]!)), 100)
    expect(result.mediaType).toBe('image/jpeg')
    expect(result.buffer.byteLength).toBe(700)
  })
})
