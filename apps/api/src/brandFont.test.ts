import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { processBrandFontUpload, UnsupportedFontFormatError } from './brandFont.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
// Karla Bold, SIL Open Font License 1.1 -- the same file self-hosted for the app under
// apps/web/public/fonts/karla, reused here so the upload path is exercised against a real,
// unrestricted TTF rather than a synthetic buffer.
const karlaBoldTtf = readFileSync(join(fixturesDir, 'karla-bold.ttf'))

describe('processBrandFontUpload', () => {
  it('reads family, weight and style from the OS/2 table, never from user input', async () => {
    const result = await processBrandFontUpload(karlaBoldTtf)
    expect(result.fontFamily).toBe('Karla')
    expect(result.fontWeight).toBe(700)
    expect(result.fontStyle).toBe('normal')
    expect(result.originalExtension).toBe('ttf')
    expect(result.originalContentType).toBe('font/ttf')
  })

  it('converts a TTF original to a valid WOFF2 buffer', async () => {
    const result = await processBrandFontUpload(karlaBoldTtf)
    expect(result.woff2Buffer.subarray(0, 4).toString('latin1')).toBe('wOF2')
    expect(result.woff2Buffer.length).toBeGreaterThan(0)
    expect(result.woff2Buffer.length).toBeLessThan(result.originalBuffer.length)
  })

  it('accepts its own WOFF2 output as a valid upload, unchanged', async () => {
    const converted = await processBrandFontUpload(karlaBoldTtf)
    const reprocessed = await processBrandFontUpload(converted.woff2Buffer)
    expect(reprocessed.fontFamily).toBe('Karla')
    expect(reprocessed.fontWeight).toBe(700)
    expect(reprocessed.originalExtension).toBe('woff2')
    expect(reprocessed.woff2Buffer.equals(converted.woff2Buffer)).toBe(true)
  })

  it('rejects a file that is not a recognizable font container', async () => {
    await expect(processBrandFontUpload(Buffer.from('not a font'))).rejects.toBeInstanceOf(UnsupportedFontFormatError)
  })

  it('rejects a buffer too short to contain a format signature', async () => {
    await expect(processBrandFontUpload(Buffer.from([0x01, 0x02]))).rejects.toBeInstanceOf(UnsupportedFontFormatError)
  })

  it('rejects legacy WOFF (version 1) with a message naming the supported formats', async () => {
    const fakeWoff1 = Buffer.concat([Buffer.from('wOFF', 'latin1'), Buffer.alloc(60)])
    await expect(processBrandFontUpload(fakeWoff1)).rejects.toThrow(/WOFF \(version 1\)/)
  })
})
