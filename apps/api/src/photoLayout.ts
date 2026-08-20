import type { PhotoLayoutKind, PhotoLayoutPreset } from '@vereinsfunk/contracts'
import sharp from 'sharp'
import { hexToRgb } from './imageStyle.js'

export interface PhotoLayoutBrandColors {
  primaryColor: string
  accentColor: string
}

// Fester quadratischer Leinwand-Ausschnitt fuer alle Layouts -- ein "Layout-Startsatz" (Plan 047)
// muss nicht je Fotoanzahl ein eigenes Seitenverhaeltnis herleiten, und ein Quadrat passt sowohl
// als Feed-Bild als auch als Ausschnitt eines Story-Formats. Nicht konfigurierbar in PR 1.
export const PHOTO_LAYOUT_CANVAS_SIZE_PX = 1600
// Breitenanteil des grossen Fotos bei mixed_grid -- die restliche Breite (minus Gutter) teilen
// sich die kleinen Fotos.
const MIXED_GRID_LARGE_FRACTION = 0.6

export interface TileRect {
  x: number
  y: number
  width: number
  height: number
}

// clipPolygon ist nur bei diagonal_split gesetzt: beide Fotos werden auf die VOLLE Leinwand
// skaliert (rect deckt die ganze Flaeche), sichtbar bleibt aber nur die Haelfte diesseits der
// Diagonale -- durchgesetzt per SVG-Polygon-Maske beim Rendern und per Polygon-Clip bei der
// Gesichtsbox-Transformation, damit beide exakt dieselbe Sichtbarkeitsgrenze verwenden.
export interface TilePlacement {
  rect: TileRect
  clipPolygon?: readonly (readonly [number, number])[]
}

function resolveDividerColorHex(dividerColor: string, brandColors: PhotoLayoutBrandColors): string {
  if (dividerColor === 'primary') return brandColors.primaryColor
  if (dividerColor === 'accent') return brandColors.accentColor
  return dividerColor
}

// Teilt totalSize in `count` gleich grosse Segmente mit `gutter` dazwischen -- das LETZTE Segment
// nimmt den Rundungsrest, damit die Summe aller Segmente plus Gutter immer exakt totalSize
// ergibt. Ohne dieses Abfangen wuerde ein ungerader dividerWidthPx (z.B. 5px auf 1600px Leinwand)
// bei krummer Division ein Segment liefern, dessen Platzierung ausserhalb der Leinwand liegt --
// sharp' composite() lehnt das mit einem harten Fehler ab (dieselbe Fehlerklasse, die
// applyLogoWatermark in imageStyle.ts fuer Logo-Platzierung schon einmal vermeiden musste).
function splitIntoSegments(totalSize: number, count: number, gutter: number): { offset: number; size: number }[] {
  const nominal = Math.floor((totalSize - (count - 1) * gutter) / count)
  const segments: { offset: number; size: number }[] = []
  let offset = 0
  for (let index = 0; index < count; index++) {
    const isLast = index === count - 1
    const size = isLast ? totalSize - offset : nominal
    segments.push({ offset, size })
    offset += size + gutter
  }
  return segments
}

// Einzige Geometriequelle fuer ein Layout -- vom Sharp-Rendering (renderPhotoLayout) UND der
// Gesichtsbox-Transformation (transformFaceRegionsForTile) gleichermassen genutzt, damit eine neu
// eingefuegte face_regions-Zeile garantiert an derselben Stelle landet, an der das Foto selbst
// tatsaechlich liegt.
export function computeTilePlacements(kind: PhotoLayoutKind, photoCount: number, dividerWidthPx: number, canvasSize = PHOTO_LAYOUT_CANVAS_SIZE_PX): TilePlacement[] {
  if (kind === 'diagonal_split') {
    const full: TileRect = { x: 0, y: 0, width: canvasSize, height: canvasSize }
    return [
      { rect: full, clipPolygon: [[0, 0], [canvasSize, 0], [canvasSize, canvasSize]] },
      { rect: full, clipPolygon: [[0, 0], [0, canvasSize], [canvasSize, canvasSize]] },
    ]
  }
  if (kind === 'grid_2x2') {
    // Quadratische Leinwand: Spalten und Zeilen sind identisch, eine Aufteilung reicht fuer beide Achsen.
    const segments = splitIntoSegments(canvasSize, 2, dividerWidthPx)
    return [
      { rect: { x: segments[0]!.offset, y: segments[0]!.offset, width: segments[0]!.size, height: segments[0]!.size } },
      { rect: { x: segments[1]!.offset, y: segments[0]!.offset, width: segments[1]!.size, height: segments[0]!.size } },
      { rect: { x: segments[0]!.offset, y: segments[1]!.offset, width: segments[0]!.size, height: segments[1]!.size } },
      { rect: { x: segments[1]!.offset, y: segments[1]!.offset, width: segments[1]!.size, height: segments[1]!.size } },
    ]
  }
  // mixed_grid: 1 grosses Foto links, die restlichen photoCount-1 gestapelt rechts. smallWidth als
  // Rest (nicht als eigene Rundung) definiert -- garantiert exakte Deckung wie splitIntoSegments,
  // nur mit einem asymmetrischen (60/40) statt gleichem Verhaeltnis.
  const largeWidth = Math.round(canvasSize * MIXED_GRID_LARGE_FRACTION - dividerWidthPx / 2)
  const smallX = largeWidth + dividerWidthPx
  const smallWidth = canvasSize - smallX
  const smallRows = splitIntoSegments(canvasSize, photoCount - 1, dividerWidthPx)
  return [
    { rect: { x: 0, y: 0, width: largeWidth, height: canvasSize } },
    ...smallRows.map((row) => ({ rect: { x: smallX, y: row.offset, width: smallWidth, height: row.size } })),
  ]
}

interface CoverCrop {
  xFrac: number
  yFrac: number
  widthFrac: number
  heightFrac: number
}

// Spiegelt sharp' eigenes resize({ fit: 'cover', position: 'centre' }): auf die Achse skalieren,
// die den Kachel-Bedarf zuerst deckt, und den Ueberschuss der anderen Achse mittig abschneiden.
// Als Bruchteile des QUELLBILDS -- dieselbe Einheit wie face_regions.x/y/width/height -- damit
// sich eine Gesichtsbox direkt dagegen schneiden laesst, ohne den Umweg ueber Pixelwerte.
function computeCoverCrop(sourceWidth: number, sourceHeight: number, tile: TileRect): CoverCrop {
  const scale = Math.max(tile.width / sourceWidth, tile.height / sourceHeight)
  const widthFrac = tile.width / scale / sourceWidth
  const heightFrac = tile.height / scale / sourceHeight
  return { xFrac: (1 - widthFrac) / 2, yFrac: (1 - heightFrac) / 2, widthFrac, heightFrac }
}

type Point = readonly [number, number]

function signedArea(points: readonly Point[]): number {
  let sum = 0
  for (let index = 0; index < points.length; index++) {
    const [x1, y1] = points[index]!
    const [x2, y2] = points[(index + 1) % points.length]!
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

function crossSign(a: Point, b: Point, p: Point): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
}

function intersectSegments(p1: Point, p2: Point, a: Point, b: Point): Point {
  const [x1, y1] = p1
  const [x2, y2] = p2
  const [x3, y3] = a
  const [x4, y4] = b
  const denom = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / denom
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)]
}

// Sutherland-Hodgman: schneidet ein beliebiges Vieleck (hier immer ein Rechteck, die
// Leinwand-absolute Gesichtsbox) gegen ein konvexes Schnitt-Vieleck (das Sichtbarkeits-Dreieck
// einer diagonal_split-Haelfte). Die Orientierung des Schnitt-Vielecks wird aus dessen eigener
// Flaeche hergeleitet, die Funktion ist also unabhaengig davon korrekt, ob dessen Punkte im oder
// gegen den Uhrzeigersinn uebergeben wurden.
function clipPolygon(subject: readonly Point[], clip: readonly Point[]): Point[] {
  const orientation = signedArea(clip) >= 0 ? 1 : -1
  let output: Point[] = [...subject]
  for (let index = 0; index < clip.length && output.length > 0; index++) {
    const a = clip[index]!
    const b = clip[(index + 1) % clip.length]!
    const input = output
    output = []
    for (let j = 0; j < input.length; j++) {
      const current = input[j]!
      const previous = input[(j + input.length - 1) % input.length]!
      const currentInside = crossSign(a, b, current) * orientation >= 0
      const previousInside = crossSign(a, b, previous) * orientation >= 0
      if (currentInside) {
        if (!previousInside) output.push(intersectSegments(previous, current, a, b))
        output.push(current)
      } else if (previousInside) {
        output.push(intersectSegments(previous, current, a, b))
      }
    }
  }
  return output
}

// numeric(6,5): fuenf Nachkommastellen, Wertebereich [0,1] fuer face_regions.x/y/width/height.
function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5
}

// Zusaetzlich zum Runden clamp't diese Funktion auf [0,1] und deckelt width/height auf den ab x/y
// verbleibenden Restplatz -- die CHECK-Constraint x+width<=1/y+height<=1 (202608030001) darf durch
// Rundungsartefakte am Rand nicht verletzt werden. Liefert null, wenn nach dem Clip nichts
// Sichtbares mehr uebrig ist (Breite/Hoehe auf 0 gerundet).
function clampNormalizedRect(x: number, y: number, width: number, height: number): { x: number; y: number; width: number; height: number } | null {
  const clampedX = Math.min(Math.max(round5(x), 0), 1)
  const clampedY = Math.min(Math.max(round5(y), 0), 1)
  const clampedWidth = round5(Math.min(width, 1 - clampedX))
  const clampedHeight = round5(Math.min(height, 1 - clampedY))
  if (clampedWidth <= 0 || clampedHeight <= 0) return null
  return { x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight }
}

export interface SourceFaceRegion {
  x: number
  y: number
  width: number
  height: number
  source: 'automatic' | 'manual'
  confidence: number | null
  subjectKind: 'adult' | 'minor' | 'unknown'
  decision: string
  consentRecordId: string | null
  obscuringStyle: string | null
}

export type TransformedFaceRegion = SourceFaceRegion

// Rechnet die bereits entschiedenen face_regions EINES Quellfotos in die Koordinaten des
// komponierten Bildes um -- Entscheidung/consent_record_id/... werden unveraendert uebernommen,
// nur die Position aendert sich (Zuschnitt der Kachel, bei diagonal_split zusaetzlich die
// Diagonal-Halbebene). Eine Region, die dabei vollstaendig aus dem sichtbaren Ausschnitt faellt,
// wird nicht uebernommen -- sie erscheint im Ergebnis nirgends, es gibt also auch nichts, wofuer
// eine spaetere Einwilligungspruefung noch greifen muesste. Siehe
// supabase/migrations/2026082010_photo_layout_media_asset.sql fuer den Grund, warum das ueberhaupt
// noetig ist (schedule_publication() prueft Widerruf ausschliesslich ueber face_regions des
// tatsaechlich im Beitrag haengenden media_asset_id).
export function transformFaceRegionsForTile(
  regions: readonly SourceFaceRegion[],
  sourceWidth: number,
  sourceHeight: number,
  placement: TilePlacement,
  canvasSize: number,
): TransformedFaceRegion[] {
  const tile = placement.rect
  const crop = computeCoverCrop(sourceWidth, sourceHeight, tile)
  const results: TransformedFaceRegion[] = []
  for (const region of regions) {
    const ix1 = Math.max(region.x, crop.xFrac)
    const iy1 = Math.max(region.y, crop.yFrac)
    const ix2 = Math.min(region.x + region.width, crop.xFrac + crop.widthFrac)
    const iy2 = Math.min(region.y + region.height, crop.yFrac + crop.heightFrac)
    if (ix2 <= ix1 || iy2 <= iy1) continue

    // Der Zuschnitt bildet 1:1 (ohne Verzerrung) auf die Kachel ab -- computeCoverCrop waehlt seine
    // Groesse dafuer genau passend -- deshalb reicht eine lineare Umrechnung in Kachel-Pixel.
    const toCanvasPoint = (fracX: number, fracY: number): Point => [
      tile.x + ((fracX - crop.xFrac) / crop.widthFrac) * tile.width,
      tile.y + ((fracY - crop.yFrac) / crop.heightFrac) * tile.height,
    ]
    let corners: Point[] = [toCanvasPoint(ix1, iy1), toCanvasPoint(ix2, iy1), toCanvasPoint(ix2, iy2), toCanvasPoint(ix1, iy2)]
    if (placement.clipPolygon) {
      corners = clipPolygon(corners, placement.clipPolygon)
      if (corners.length === 0) continue
    }
    const xs = corners.map(([x]) => x)
    const ys = corners.map(([, y]) => y)
    const boxX = Math.min(...xs)
    const boxY = Math.min(...ys)
    const boxWidth = Math.max(...xs) - boxX
    const boxHeight = Math.max(...ys) - boxY
    if (boxWidth <= 0 || boxHeight <= 0) continue

    const normalized = clampNormalizedRect(boxX / canvasSize, boxY / canvasSize, boxWidth / canvasSize, boxHeight / canvasSize)
    if (!normalized) continue
    results.push({ ...normalized, source: region.source, confidence: region.confidence, subjectKind: region.subjectKind, decision: region.decision, consentRecordId: region.consentRecordId, obscuringStyle: region.obscuringStyle })
  }
  return results
}

export interface PhotoLayoutRenderInput {
  sourceBuffers: readonly Buffer[]
  preset: Pick<PhotoLayoutPreset, 'kind' | 'dividerColor' | 'dividerWidthPx' | 'cornerRadiusPx'>
  brandColors: PhotoLayoutBrandColors
}

export interface PhotoLayoutRenderResult {
  buffer: Buffer
  contentType: string
  width: number
  height: number
}

function polygonToSvgPoints(polygon: readonly (readonly [number, number])[]): string {
  return polygon.map(([x, y]) => `${x},${y}`).join(' ')
}

async function encodePhotoLayoutResult(buffer: Buffer, hasTransparency: boolean): Promise<PhotoLayoutRenderResult> {
  // Wie encodeResult in imageStyle.ts: PNG nur, wenn das Ergebnis tatsaechlich Transparenz traegt
  // (abgerundete Ecken), sonst JPEG -- ein unkomprimiertes PNG eines 1600x1600-Fotos waere ein
  // Vielfaches der Groesse, die die Veroeffentlichungsziele zulassen.
  const metadata = await sharp(buffer).metadata()
  const encoded = hasTransparency ? buffer : await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
  return { buffer: encoded, contentType: hasTransparency ? 'image/png' : 'image/jpeg', width: metadata.width ?? 0, height: metadata.height ?? 0 }
}

// Setzt die N Quellfotos gemaess computeTilePlacements auf eine gemeinsame Leinwand -- dieselbe
// Sharp-Technik wie die Bildstil-Rahmen (composite/SVG-Overlays, apps/api/src/imageStyle.ts):
// grid_2x2/mixed_grid komponieren per resize(fit:'cover') + composite an fester Position,
// diagonal_split zusaetzlich per SVG-Polygon-Maske (dest-in) geclippt.
export async function renderPhotoLayout(input: PhotoLayoutRenderInput): Promise<PhotoLayoutRenderResult> {
  const { preset, sourceBuffers } = input
  const canvasSize = PHOTO_LAYOUT_CANVAS_SIZE_PX
  const dividerColorHex = resolveDividerColorHex(preset.dividerColor, input.brandColors)
  const placements = computeTilePlacements(preset.kind, sourceBuffers.length, preset.dividerWidthPx, canvasSize)

  const layers: { input: Buffer; left: number; top: number }[] = []
  for (let index = 0; index < sourceBuffers.length; index++) {
    const placement = placements[index]!
    const tile = placement.rect
    const resized = await sharp(sourceBuffers[index]!)
      .resize({ width: Math.round(tile.width), height: Math.round(tile.height), fit: 'cover', position: 'centre' })
      .toBuffer()
    if (placement.clipPolygon) {
      const mask = Buffer.from(`<svg width="${canvasSize}" height="${canvasSize}"><polygon points="${polygonToSvgPoints(placement.clipPolygon)}" fill="#fff"/></svg>`)
      const masked = await sharp(resized).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
      layers.push({ input: masked, left: 0, top: 0 })
    } else {
      layers.push({ input: resized, left: Math.round(tile.x), top: Math.round(tile.y) })
    }
  }

  // Die diagonale Naht bekommt einen eigenen Trennstrich (kein Gutter wie bei grid_2x2/mixed_grid
  // moeglich, die beiden Haelften stossen direkt aneinander) -- nur bei dividerWidthPx > 0, sonst
  // bleiben die beiden Fotos ohne sichtbare Trennung aneinandergesetzt.
  if (preset.kind === 'diagonal_split' && preset.dividerWidthPx > 0) {
    const line = Buffer.from(`<svg width="${canvasSize}" height="${canvasSize}"><line x1="0" y1="0" x2="${canvasSize}" y2="${canvasSize}" stroke="${dividerColorHex}" stroke-width="${preset.dividerWidthPx}"/></svg>`)
    layers.push({ input: line, left: 0, top: 0 })
  }

  const background = hexToRgb(dividerColorHex)
  let composed = await sharp({ create: { width: canvasSize, height: canvasSize, channels: 3, background } })
    .composite(layers)
    .png()
    .toBuffer()

  const hasCornerRadius = !!preset.cornerRadiusPx && preset.cornerRadiusPx > 0
  if (hasCornerRadius) {
    const mask = Buffer.from(`<svg width="${canvasSize}" height="${canvasSize}"><rect x="0" y="0" width="${canvasSize}" height="${canvasSize}" rx="${preset.cornerRadiusPx}" ry="${preset.cornerRadiusPx}" fill="#fff"/></svg>`)
    composed = await sharp(composed).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
  }
  return encodePhotoLayoutResult(composed, hasCornerRadius)
}
