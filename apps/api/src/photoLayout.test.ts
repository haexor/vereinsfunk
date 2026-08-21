import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { computeTilePlacements, renderPhotoLayout, transformFaceRegionsForTile, type SourceFaceRegion } from './photoLayout.js'

const BRAND_COLORS = { primaryColor: '#163a2c', accentColor: '#caff4a' }

async function solidColorImage(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()
}

async function pixelAt(buffer: Buffer, x: number, y: number): Promise<{ r: number; g: number; b: number; a: number | null }> {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
  const index = (y * info.width + x) * info.channels
  return { r: data[index]!, g: data[index + 1]!, b: data[index + 2]!, a: info.channels >= 4 ? data[index + 3]! : null }
}

const RED = { r: 220, g: 20, b: 20 }
const GREEN = { r: 20, g: 180, b: 20 }
const BLUE = { r: 20, g: 20, b: 220 }
const YELLOW = { r: 220, g: 200, b: 20 }

function expectClose(actual: number, expected: number, tolerance = 6) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

describe('computeTilePlacements', () => {
  it('grid_2x2 teilt die Leinwand in vier gleich grosse Kacheln mit Gutter', () => {
    const placements = computeTilePlacements('grid_2x2', 4, 8, 100)
    expect(placements).toHaveLength(4)
    expect(placements[0]!.rect).toEqual({ x: 0, y: 0, width: 46, height: 46 })
    expect(placements[1]!.rect).toEqual({ x: 54, y: 0, width: 46, height: 46 })
    expect(placements[2]!.rect).toEqual({ x: 0, y: 54, width: 46, height: 46 })
    expect(placements[3]!.rect).toEqual({ x: 54, y: 54, width: 46, height: 46 })
    // Keine Kachel reicht ueber die Leinwand hinaus, auch bei krummer (ungerader) Gutterbreite nicht.
    const odd = computeTilePlacements('grid_2x2', 4, 7, 101)
    for (const placement of odd) {
      expect(placement.rect.x + placement.rect.width).toBeLessThanOrEqual(101)
      expect(placement.rect.y + placement.rect.height).toBeLessThanOrEqual(101)
    }
  })

  it('diagonal_split gibt beiden Fotos die volle Leinwand mit komplementaeren Dreiecks-Clips', () => {
    const placements = computeTilePlacements('diagonal_split', 2, 6, 100)
    expect(placements).toHaveLength(2)
    expect(placements[0]!.rect).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(placements[0]!.clipPolygon).toEqual([[0, 0], [100, 0], [100, 100]])
    expect(placements[1]!.clipPolygon).toEqual([[0, 0], [0, 100], [100, 100]])
  })

  it('mixed_grid gibt dem grossen Foto ~60% Breite, die kleinen fuellen den Rest exakt aus', () => {
    const placements = computeTilePlacements('mixed_grid', 3, 4, 100)
    expect(placements).toHaveLength(3)
    const large = placements[0]!.rect
    expect(large.x).toBe(0)
    expect(large.height).toBe(100)
    expectClose(large.width, 58, 2)
    const smallX = large.width + 4
    for (const small of placements.slice(1)) {
      expect(small.rect.x).toBe(smallX)
      expect(small.rect.x + small.rect.width).toBe(100)
    }
    // Die beiden kleinen Kacheln fuellen die Hoehe zusammen mit dem Gutter exakt aus.
    const [firstSmall, secondSmall] = placements.slice(1)
    expect(firstSmall!.rect.y).toBe(0)
    expect(secondSmall!.rect.y).toBe(firstSmall!.rect.height + 4)
    expect(secondSmall!.rect.y + secondSmall!.rect.height).toBe(100)
  })
})

describe('renderPhotoLayout', () => {
  it('grid_2x2 platziert vier Fotos erkennbar in ihren Quadranten', async () => {
    const [red, green, blue, yellow] = await Promise.all([
      solidColorImage(50, 50, RED), solidColorImage(50, 50, GREEN), solidColorImage(50, 50, BLUE), solidColorImage(50, 50, YELLOW),
    ])
    const result = await renderPhotoLayout({
      sourceBuffers: [red, green, blue, yellow],
      preset: { kind: 'grid_2x2', dividerColor: '#000000', dividerWidthPx: 20, cornerRadiusPx: null },
      brandColors: BRAND_COLORS,
    })
    const size = result.width
    const quarter = size / 4
    const topLeft = await pixelAt(result.buffer, quarter, quarter)
    const topRight = await pixelAt(result.buffer, size - quarter, quarter)
    const bottomLeft = await pixelAt(result.buffer, quarter, size - quarter)
    const bottomRight = await pixelAt(result.buffer, size - quarter, size - quarter)
    expectClose(topLeft.r, RED.r); expectClose(topLeft.g, RED.g); expectClose(topLeft.b, RED.b)
    expectClose(topRight.r, GREEN.r); expectClose(topRight.g, GREEN.g); expectClose(topRight.b, GREEN.b)
    expectClose(bottomLeft.r, BLUE.r); expectClose(bottomLeft.g, BLUE.g); expectClose(bottomLeft.b, BLUE.b)
    expectClose(bottomRight.r, YELLOW.r); expectClose(bottomRight.g, YELLOW.g); expectClose(bottomRight.b, YELLOW.b)
  })

  it('diagonal_split zeigt je ein Foto auf jeder Seite der Diagonale', async () => {
    const [red, blue] = await Promise.all([solidColorImage(50, 50, RED), solidColorImage(50, 50, BLUE)])
    const result = await renderPhotoLayout({
      sourceBuffers: [red, blue],
      preset: { kind: 'diagonal_split', dividerColor: '#000000', dividerWidthPx: 0, cornerRadiusPx: null },
      brandColors: BRAND_COLORS,
    })
    const size = result.width
    // Deutlich abseits der Diagonale (y=x) testen, damit Anti-Aliasing an der Kante nicht stoert.
    const upperRight = await pixelAt(result.buffer, Math.round(size * 0.9), Math.round(size * 0.1))
    const lowerLeft = await pixelAt(result.buffer, Math.round(size * 0.1), Math.round(size * 0.9))
    expectClose(upperRight.r, RED.r); expectClose(upperRight.g, RED.g); expectClose(upperRight.b, RED.b)
    expectClose(lowerLeft.r, BLUE.r); expectClose(lowerLeft.g, BLUE.g); expectClose(lowerLeft.b, BLUE.b)
  })

  it('cornerRadiusPx macht die aeusseren Ecken transparent (PNG)', async () => {
    const [red, blue] = await Promise.all([solidColorImage(50, 50, RED), solidColorImage(50, 50, BLUE)])
    const result = await renderPhotoLayout({
      sourceBuffers: [red, blue],
      preset: { kind: 'diagonal_split', dividerColor: '#000000', dividerWidthPx: 0, cornerRadiusPx: 40 },
      brandColors: BRAND_COLORS,
    })
    expect(result.contentType).toBe('image/png')
    const corner = await pixelAt(result.buffer, 0, 0)
    expect(corner.a).toBe(0)
  })

  it('ohne Eckenradius wird JPEG kodiert', async () => {
    const [red, blue] = await Promise.all([solidColorImage(50, 50, RED), solidColorImage(50, 50, BLUE)])
    const result = await renderPhotoLayout({
      sourceBuffers: [red, blue],
      preset: { kind: 'diagonal_split', dividerColor: '#000000', dividerWidthPx: 0, cornerRadiusPx: null },
      brandColors: BRAND_COLORS,
    })
    expect(result.contentType).toBe('image/jpeg')
  })
})

const BASE_REGION: SourceFaceRegion = {
  x: 0, y: 0, width: 0, height: 0, source: 'automatic', confidence: 0.9, subjectKind: 'adult', decision: 'consented', consentRecordId: '00000000-0000-4000-8000-000000000001', obscuringStyle: null,
}

describe('transformFaceRegionsForTile', () => {
  it('verschiebt eine Gesichtsbox in die Zielkachel, wenn die Kachel dem Quellbild direkt entspricht', () => {
    const region: SourceFaceRegion = { ...BASE_REGION, x: 0.1, y: 0.2, width: 0.2, height: 0.1 }
    const placement = { rect: { x: 50, y: 50, width: 100, height: 100 } }
    const [transformed] = transformFaceRegionsForTile([region], 100, 100, placement, 200)
    // Quellbild deckt die Kachel exakt (kein Beschnitt): 0.1 * 100px Kachel + 50px Versatz = 60px von 200px Leinwand = 0.3.
    expect(transformed!.x).toBeCloseTo(0.3, 2)
    expect(transformed!.y).toBeCloseTo(0.35, 2)
    expect(transformed!.width).toBeCloseTo(0.1, 2)
    expect(transformed!.height).toBeCloseTo(0.05, 2)
    expect(transformed!.decision).toBe('consented')
    expect(transformed!.consentRecordId).toBe(BASE_REGION.consentRecordId)
  })

  it('verwirft eine Gesichtsbox vollstaendig ausserhalb des sichtbaren Zuschnitts', () => {
    // Ein 200x100-Quellbild (doppelt so breit wie hoch) wird auf eine quadratische 100x100-Kachel
    // per cover-fit zugeschnitten -- nur der mittlere 50%-Streifen (x in [0.25, 0.75]) bleibt
    // sichtbar. Ein Gesicht ganz am linken Rand (x=0..0.1) faellt komplett heraus.
    const region: SourceFaceRegion = { ...BASE_REGION, x: 0, y: 0.1, width: 0.1, height: 0.1 }
    const placement = { rect: { x: 0, y: 0, width: 100, height: 100 } }
    const transformed = transformFaceRegionsForTile([region], 200, 100, placement, 100)
    expect(transformed).toHaveLength(0)
  })

  it('behaelt nur den sichtbaren Anteil eines Gesichts, das den Zuschnittrand ueberlappt', () => {
    // Zuschnitt (200x100-Quellbild auf eine 100x100-Kachel) beginnt bei xFrac=0.25 -- der Anteil
    // links davon (0.2 bis 0.25 im Original) ist nicht sichtbar; sichtbar bleibt nur [0.25, 0.35],
    // 2x vergroessert auf die Kachel (crop.widthFrac = 0.5) also exakt die Kachel-Breite [0, 0.2].
    const region: SourceFaceRegion = { ...BASE_REGION, x: 0.2, y: 0.1, width: 0.15, height: 0.1 }
    const placement = { rect: { x: 0, y: 0, width: 100, height: 100 } }
    const transformed = transformFaceRegionsForTile([region], 200, 100, placement, 100)
    expect(transformed).toHaveLength(1)
    expect(transformed[0]!.x).toBeCloseTo(0, 4)
    expect(transformed[0]!.width).toBeCloseTo(0.2, 4)
  })

  it('schneidet eine Gesichtsbox an der Diagonale exakt auf den sichtbaren Anteil zurueck', () => {
    // Box [30,60]x[50,60] (Pixel auf 100x100) gegen das sichtbare Dreieck y<=x ((0,0)-(100,0)-
    // (100,100)) geschnitten: nur der Anteil mit x>=y bleibt, das ist per Hand nachvollziehbar
    // exakt [50,60]x[50,60] -- die Breite schrumpft von 30 auf 10, die Hoehe (bereits vollstaendig
    // auf der sichtbaren Seite) bleibt unveraendert bei 10.
    const region: SourceFaceRegion = { ...BASE_REGION, x: 0.3, y: 0.5, width: 0.3, height: 0.1 }
    const visiblePlacement = { rect: { x: 0, y: 0, width: 100, height: 100 }, clipPolygon: [[0, 0], [100, 0], [100, 100]] as const }
    const transformed = transformFaceRegionsForTile([region], 100, 100, visiblePlacement, 100)
    expect(transformed).toHaveLength(1)
    expect(transformed[0]!.x).toBeCloseTo(0.5, 4)
    expect(transformed[0]!.y).toBeCloseTo(0.5, 4)
    expect(transformed[0]!.width).toBeCloseTo(0.1, 4)
    expect(transformed[0]!.height).toBeCloseTo(0.1, 4)

    // Dieselbe Box, gegen das KOMPLEMENTAERE Dreieck (die andere Bildhaelfte) geschnitten, ist
    // vollstaendig unsichtbar (x<y ueberall in der Box liegt nicht vor -- hier ist es umgekehrt:
    // eine Box, die vollstaendig auf der jeweils anderen Seite liegt, verschwindet ganz).
    const farRegion: SourceFaceRegion = { ...BASE_REGION, x: 0.7, y: 0.05, width: 0.1, height: 0.1 }
    const otherPlacement = { rect: { x: 0, y: 0, width: 100, height: 100 }, clipPolygon: [[0, 0], [0, 100], [100, 100]] as const }
    expect(transformFaceRegionsForTile([farRegion], 100, 100, otherPlacement, 100)).toHaveLength(0)
  })
})
