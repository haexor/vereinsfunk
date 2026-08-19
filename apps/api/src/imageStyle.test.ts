import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { renderImageStyle } from './imageStyle.js'

const BRAND_COLORS = { primaryColor: '#163a2c', accentColor: '#caff4a' }

const NO_STYLE_PRESET = {
  frameType: 'none' as const,
  frameColor: null,
  frameWidthPx: null,
  frameCornerRadiusPx: null,
  logoEnabled: false,
  logoPosition: 'bottom_right' as const,
  logoSizePercent: null,
  logoMarginPercent: null,
  filter: 'original' as const,
}

async function solidColorImage(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()
}

async function splitImage(width: number, height: number, left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }): Promise<Buffer> {
  const leftHalf = await solidColorImage(Math.floor(width / 2), height, left)
  const rightHalf = await solidColorImage(width - Math.floor(width / 2), height, right)
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([
      { input: leftHalf, left: 0, top: 0 },
      { input: rightHalf, left: Math.floor(width / 2), top: 0 },
    ])
    .png()
    .toBuffer()
}

async function pixelAt(buffer: Buffer, x: number, y: number): Promise<{ r: number; g: number; b: number; a: number | null }> {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
  const index = (y * info.width + x) * info.channels
  return { r: data[index]!, g: data[index + 1]!, b: data[index + 2]!, a: info.channels >= 4 ? data[index + 3]! : null }
}

describe('renderImageStyle: Filter', () => {
  it('original laesst das Bild unveraendert', async () => {
    const source = await solidColorImage(20, 20, { r: 10, g: 120, b: 230 })
    const result = await renderImageStyle({ sourceBuffer: source, preset: NO_STYLE_PRESET, brandColors: BRAND_COLORS })
    const pixel = await pixelAt(result.buffer, 10, 10)
    expect(pixel.r).toBe(10)
    expect(pixel.g).toBe(120)
    expect(pixel.b).toBe(230)
  })

  it('schwarz_weiss entsaettigt vollstaendig', async () => {
    const source = await solidColorImage(20, 20, { r: 200, g: 40, b: 40 })
    const result = await renderImageStyle({ sourceBuffer: source, preset: { ...NO_STYLE_PRESET, filter: 'schwarz_weiss' }, brandColors: BRAND_COLORS })
    const pixel = await pixelAt(result.buffer, 10, 10)
    expect(pixel.r).toBe(pixel.g)
    expect(pixel.g).toBe(pixel.b)
  })

  it('kontrastreich spreizt Werte vom Mittelpunkt weg', async () => {
    const source = await splitImage(20, 20, { r: 200, g: 200, b: 200 }, { r: 50, g: 50, b: 50 })
    const result = await renderImageStyle({ sourceBuffer: source, preset: { ...NO_STYLE_PRESET, filter: 'kontrastreich' }, brandColors: BRAND_COLORS })
    const light = await pixelAt(result.buffer, 4, 10)
    const dark = await pixelAt(result.buffer, 16, 10)
    expect(light.r).toBeGreaterThan(200)
    expect(dark.r).toBeLessThan(50)
  })

  it('warm verschiebt Richtung Amber (roter Kanal ueber blauem)', async () => {
    const source = await solidColorImage(20, 20, { r: 128, g: 128, b: 128 })
    const result = await renderImageStyle({ sourceBuffer: source, preset: { ...NO_STYLE_PRESET, filter: 'warm' }, brandColors: BRAND_COLORS })
    const pixel = await pixelAt(result.buffer, 10, 10)
    expect(pixel.r).toBeGreaterThan(pixel.b)
  })

  it('vereinsfarben_duoton bildet Schatten auf primaryColor, Lichter auf accentColor ab', async () => {
    const source = await splitImage(20, 20, { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })
    const result = await renderImageStyle({ sourceBuffer: source, preset: { ...NO_STYLE_PRESET, filter: 'vereinsfarben_duoton' }, brandColors: BRAND_COLORS })
    const shadow = await pixelAt(result.buffer, 4, 10)
    const highlight = await pixelAt(result.buffer, 16, 10)
    expect(shadow.r).toBeCloseTo(0x16, -1)
    expect(shadow.g).toBeCloseTo(0x3a, -1)
    expect(shadow.b).toBeCloseTo(0x2c, -1)
    expect(highlight.r).toBeCloseTo(0xca, -1)
    expect(highlight.g).toBeCloseTo(0xff, -1)
    expect(highlight.b).toBeCloseTo(0x4a, -1)
  })
})

describe('renderImageStyle: Rahmen', () => {
  it('parametrischer Rahmen erweitert das Bild um die Rahmenbreite auf jeder Seite und faerbt den Rand', async () => {
    const source = await solidColorImage(20, 20, { r: 0, g: 255, b: 0 })
    const result = await renderImageStyle({
      sourceBuffer: source,
      preset: { ...NO_STYLE_PRESET, frameType: 'parametric', frameColor: '#ff0000', frameWidthPx: 10, frameCornerRadiusPx: null },
      brandColors: BRAND_COLORS,
    })
    expect(result.width).toBe(40)
    expect(result.height).toBe(40)
    const border = await pixelAt(result.buffer, 5, 5)
    expect(border.r).toBe(255)
    expect(border.g).toBe(0)
    const center = await pixelAt(result.buffer, 20, 20)
    expect(center.r).toBe(0)
    expect(center.g).toBe(255)
  })

  it('frameColor "primary"/"accent" loest gegen die uebergebenen Markenfarben auf', async () => {
    const source = await solidColorImage(10, 10, { r: 0, g: 0, b: 0 })
    const result = await renderImageStyle({
      sourceBuffer: source,
      preset: { ...NO_STYLE_PRESET, frameType: 'parametric', frameColor: 'accent', frameWidthPx: 4, frameCornerRadiusPx: null },
      brandColors: BRAND_COLORS,
    })
    const border = await pixelAt(result.buffer, 1, 1)
    expect(border.r).toBe(0xca)
    expect(border.g).toBe(0xff)
    expect(border.b).toBe(0x4a)
  })

  it('abgerundete Ecken machen die Bildecke transparent, lassen die Mitte opak', async () => {
    const source = await solidColorImage(40, 40, { r: 10, g: 10, b: 10 })
    const result = await renderImageStyle({
      sourceBuffer: source,
      preset: { ...NO_STYLE_PRESET, frameType: 'parametric', frameColor: '#000000', frameWidthPx: 5, frameCornerRadiusPx: 15 },
      brandColors: BRAND_COLORS,
    })
    const corner = await pixelAt(result.buffer, 0, 0)
    const center = await pixelAt(result.buffer, Math.floor(result.width / 2), Math.floor(result.height / 2))
    expect(corner.a).not.toBeNull()
    expect(corner.a!).toBeLessThan(50)
    expect(center.a).toBe(255)
  })

  it('eigene Rahmengrafik wird auf Fotogroesse gestreckt und darueber gelegt', async () => {
    const source = await solidColorImage(30, 20, { r: 0, g: 0, b: 255 })
    const frameOverlay = await splitImage(30, 20, { r: 255, g: 255, b: 0 }, { r: 255, g: 255, b: 0 })
    const result = await renderImageStyle({
      sourceBuffer: source,
      preset: { ...NO_STYLE_PRESET, frameType: 'custom', frameColor: null, frameWidthPx: null, frameCornerRadiusPx: null },
      frameAssetBuffer: frameOverlay,
      brandColors: BRAND_COLORS,
    })
    expect(result.width).toBe(30)
    expect(result.height).toBe(20)
    const pixel = await pixelAt(result.buffer, 10, 10)
    expect(pixel.r).toBe(255)
    expect(pixel.g).toBe(255)
    expect(pixel.b).toBe(0)
  })
})

describe('renderImageStyle: Logo-Wasserzeichen', () => {
  it('platziert das Logo relativ zur Bildbreite in der gewaehlten Ecke, laesst die gegenueberliegende Ecke unberuehrt', async () => {
    const source = await solidColorImage(200, 100, { r: 0, g: 0, b: 0 })
    const logo = await solidColorImage(40, 40, { r: 255, g: 0, b: 255 })
    const result = await renderImageStyle({
      sourceBuffer: source,
      preset: { ...NO_STYLE_PRESET, logoEnabled: true, logoPosition: 'bottom_right', logoSizePercent: 20, logoMarginPercent: 5 },
      logoAssetBuffer: logo,
      brandColors: BRAND_COLORS,
    })
    // logoWidth = 200*0.20 = 40px, margin = 200*0.05 = 10px -- Logo sitzt bei x in [150,190], y in [50,90].
    const withinLogo = await pixelAt(result.buffer, 170, 70)
    expect(withinLogo.r).toBe(255)
    expect(withinLogo.g).toBe(0)
    expect(withinLogo.b).toBe(255)
    const oppositeCorner = await pixelAt(result.buffer, 10, 10)
    expect(oppositeCorner.r).toBe(0)
    expect(oppositeCorner.g).toBe(0)
    expect(oppositeCorner.b).toBe(0)
  })

  it('platziert das Logo mittig bei logoPosition "center"', async () => {
    const source = await solidColorImage(100, 100, { r: 0, g: 0, b: 0 })
    const logo = await solidColorImage(20, 20, { r: 0, g: 255, b: 255 })
    const result = await renderImageStyle({
      sourceBuffer: source,
      preset: { ...NO_STYLE_PRESET, logoEnabled: true, logoPosition: 'center', logoSizePercent: 20, logoMarginPercent: 0 },
      logoAssetBuffer: logo,
      brandColors: BRAND_COLORS,
    })
    const center = await pixelAt(result.buffer, 50, 50)
    expect(center.r).toBe(0)
    expect(center.g).toBe(255)
    expect(center.b).toBe(255)
  })
})

describe('renderImageStyle: Kombinationen', () => {
  it('wendet Filter, Rahmen und Logo in dieser Reihenfolge auf dasselbe Bild an', async () => {
    const source = await solidColorImage(50, 50, { r: 200, g: 30, b: 30 })
    const logo = await solidColorImage(10, 10, { r: 0, g: 0, b: 255 })
    const result = await renderImageStyle({
      sourceBuffer: source,
      preset: {
        frameType: 'parametric', frameColor: '#00ff00', frameWidthPx: 5, frameCornerRadiusPx: null,
        logoEnabled: true, logoPosition: 'top_left', logoSizePercent: 20, logoMarginPercent: 0,
        filter: 'schwarz_weiss',
      },
      logoAssetBuffer: logo,
      brandColors: BRAND_COLORS,
    })
    expect(result.width).toBe(60)
    expect(result.height).toBe(60)
    // Rahmenfarbe bleibt unberuehrt vom Foto-Filter (Filter laeuft vor dem Rahmen). Ecke unten
    // rechts abtasten, nicht oben links -- dort liegt das Logo (Position top_left, Marge 0).
    const border = await pixelAt(result.buffer, 58, 58)
    expect(border.r).toBe(0)
    expect(border.g).toBe(255)
    expect(border.b).toBe(0)
    // Logo liegt ueber dem gerahmten, geschwaerzten Foto in der oberen linken Ecke.
    const logoPixel = await pixelAt(result.buffer, 8, 8)
    expect(logoPixel.r).toBe(0)
    expect(logoPixel.g).toBe(0)
    expect(logoPixel.b).toBe(255)
  })
})
