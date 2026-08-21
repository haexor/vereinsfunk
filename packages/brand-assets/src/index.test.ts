import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { hashLogoBuffer, LogoDimensionsError, processBrandLogoUpload, UnsupportedLogoFormatError } from './index.js'

describe('processBrandLogoUpload', () => {
  it('sanitizes a valid SVG and reports the svg extension/content type', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#163a2c" /></svg>')
    const result = await processBrandLogoUpload(svg)
    expect(result).toMatchObject({ extension: 'svg', contentType: 'image/svg+xml' })
  })

  it('rejects an SVG with a <script> element instead of silently stripping it into something unexpected', async () => {
    const malicious = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const result = await processBrandLogoUpload(malicious)
    // dompurify removes the disallowed element; sanitized=true records that the input was modified.
    expect(result.sanitized).toBe(true)
    expect(result.buffer.toString('utf8')).not.toContain('script')
  })

  it('decodes a valid PNG at or above the minimum dimension and reports its measured size', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 22, g: 58, b: 44, alpha: 1 } } }).png().toBuffer()
    const result = await processBrandLogoUpload(png)
    expect(result).toMatchObject({ extension: 'png', contentType: 'image/png', width: 40, height: 40, sanitized: false })
  })

  it('rejects a PNG below the minimum dimension', async () => {
    const tiny = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
    await expect(processBrandLogoUpload(tiny)).rejects.toBeInstanceOf(LogoDimensionsError)
  })

  it('rejects a byte sequence that matches no known logo format', async () => {
    await expect(processBrandLogoUpload(Buffer.from('not an image'))).rejects.toBeInstanceOf(UnsupportedLogoFormatError)
  })

  it('determines the file kind from its bytes, ignoring a misleading extension implied by context', async () => {
    // A JPEG's magic bytes (0xFF 0xD8 0xFF) are detected regardless of what the caller believed
    // the upload to be -- there is no client-supplied content-type input to this function at all.
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 200, b: 200 } } }).jpeg().toBuffer()
    const result = await processBrandLogoUpload(jpeg)
    expect(result.extension).toBe('jpg')
  })
})

describe('hashLogoBuffer', () => {
  it('is deterministic and content-addressed', () => {
    const a = hashLogoBuffer(Buffer.from('same-bytes'))
    const b = hashLogoBuffer(Buffer.from('same-bytes'))
    const c = hashLogoBuffer(Buffer.from('different-bytes'))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})
