import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { generateSvgRasterDerivatives } from './brandAssetDerivatives.js'

const SIMPLE_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#163a2c"/></svg>')

describe('generateSvgRasterDerivatives', () => {
  it('produces a small and a large PNG derivative at the documented widths', async () => {
    const derivatives = await generateSvgRasterDerivatives(SIMPLE_SVG)
    const small = await sharp(derivatives.small).metadata()
    const large = await sharp(derivatives.large).metadata()
    expect(small.format).toBe('png')
    expect(small.width).toBe(128)
    expect(large.format).toBe('png')
    expect(large.width).toBe(512)
  })
})
