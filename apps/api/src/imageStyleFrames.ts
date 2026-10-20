import type { ImageStyleFrameStyle } from '@vereinsfunk/contracts'
import { hexToRgb } from './color.js'
import { limitedSharp } from './imageStyleInput.js'
import type { BrandColors } from './imageStyle.js'

export function resolveFrameColorHex(frameColor: string | null, brandColors: BrandColors): string {
  if (frameColor === 'primary') return brandColors.primaryColor
  if (frameColor === 'accent') return brandColors.accentColor
  if (!frameColor) throw new Error('parametric frame requires frameColor')
  return frameColor
}

export async function applyRoundedCorners(buffer: Buffer, radiusPx: number): Promise<Buffer> {
  const metadata = await limitedSharp(buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for corner rounding')
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radiusPx}" ry="${radiusPx}" fill="#fff"/></svg>`,
  )
  return limitedSharp(buffer)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

async function applySolidFrameStyle(
  buffer: Buffer,
  colorHex: string,
  widthPx: number,
): Promise<Buffer> {
  const color = hexToRgb(colorHex)
  return limitedSharp(buffer)
    .extend({
      top: widthPx,
      bottom: widthPx,
      left: widthPx,
      right: widthPx,
      background: { r: color.r, g: color.g, b: color.b, alpha: 1 },
    })
    .png()
    .toBuffer()
}

// Rahmenzone (widthPx) gedrittelt in aeusseren Ring / Luecke / inneren Ring -- der innere Ring
// endet exakt dort, wo das Foto beginnt (ringThickness + gap + ringThickness = widthPx), die
// Luecke bleibt also immer im transparent erweiterten Rand, nie auf dem Foto selbst.
async function applyDoubleFrameStyle(
  buffer: Buffer,
  colorHex: string,
  widthPx: number,
): Promise<Buffer> {
  const extended = await limitedSharp(buffer)
    .extend({
      top: widthPx,
      bottom: widthPx,
      left: widthPx,
      right: widthPx,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer()
  const metadata = await limitedSharp(extended).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for double frame')

  const ringThickness = Math.max(1, Math.round(widthPx / 3))
  const gap = Math.max(0, widthPx - 2 * ringThickness)
  const ringPath = (inset: number, thickness: number): string =>
    thickness <= 0
      ? ''
      : `M${inset},${inset} H${width - inset} V${height - inset} H${inset} Z ` +
        `M${inset + thickness},${inset + thickness} H${width - inset - thickness} V${height - inset - thickness} H${inset + thickness} Z`
  const svg =
    `<svg width="${width}" height="${height}">` +
    `<path fill-rule="evenodd" fill="${colorHex}" d="${ringPath(0, ringThickness)}"/>` +
    `<path fill-rule="evenodd" fill="${colorHex}" d="${ringPath(ringThickness + gap, widthPx - ringThickness - gap)}"/>` +
    `</svg>`
  return limitedSharp(extended)
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .png()
    .toBuffer()
}

// Vier L-foermige Eckklammern (Sucher-/Cropmark-Optik), direkt auf dem Foto -- kein Canvas-Extend
// noetig, die Marken liegen innerhalb der bestehenden Bildflaeche.
async function applyCornerMarksFrameStyle(
  buffer: Buffer,
  colorHex: string,
  widthPx: number,
): Promise<Buffer> {
  const metadata = await limitedSharp(buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for corner-marks frame')

  // Ohne Obergrenze wuerde ein grosses frameWidthPx (bis 200 laut Contract) auf einem kleinen Foto
  // die Marken ueber die Bildmitte hinaus wachsen lassen -- ein Drittel der kuerzeren Kante haelt
  // selbst im Extremfall (frameWidthPx=200 auf einem 40x40-Foto) einen unberuehrten Kern in der Mitte.
  const maxMarkSize = Math.max(1, Math.floor(Math.min(width, height) / 3))
  const thickness = Math.min(Math.max(1, widthPx), maxMarkSize)
  const legLength = Math.max(thickness, Math.min(widthPx * 4, maxMarkSize))
  const rect = (x: number, y: number, w: number, h: number): string =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${colorHex}"/>`
  const svg =
    `<svg width="${width}" height="${height}">` +
    rect(0, 0, legLength, thickness) +
    rect(0, 0, thickness, legLength) +
    rect(width - legLength, 0, legLength, thickness) +
    rect(width - thickness, 0, thickness, legLength) +
    rect(0, height - thickness, legLength, thickness) +
    rect(0, height - legLength, thickness, legLength) +
    rect(width - legLength, height - thickness, legLength, thickness) +
    rect(width - thickness, height - legLength, thickness, legLength) +
    `</svg>`
  return limitedSharp(buffer)
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .png()
    .toBuffer()
}

// Polaroid-Optik: duenner gleicher Rand oben/links/rechts, deutlich dickerer Balken unten.
async function applyBottomBarFrameStyle(
  buffer: Buffer,
  colorHex: string,
  widthPx: number,
): Promise<Buffer> {
  const color = hexToRgb(colorHex)
  return limitedSharp(buffer)
    .extend({
      top: widthPx,
      bottom: widthPx * 4,
      left: widthPx,
      right: widthPx,
      background: { r: color.r, g: color.g, b: color.b, alpha: 1 },
    })
    .png()
    .toBuffer()
}

// Gleichmaessig verteilte Mittelpunkte entlang einer Kante der Laenge `length`, mit `spacing`
// zwischen den Mittelpunkten und einem halben Abstand Rand links/rechts.
function beadOffsets(length: number, spacing: number): number[] {
  const count = Math.max(0, Math.floor(length / spacing))
  return Array.from({ length: count }, (_, index) => spacing / 2 + index * spacing)
}

// "Festlich" ist ein echter Siegerrahmen, nicht bloß ein goldener CSS-Rand: geformte Leisten,
// ein inneres Perlband und vier ausgearbeitete Ranken-Eckornamente mit Blättern, Rosetten und
// Voluten. Er bleibt fest golden statt frameColor, damit ein Siegerfoto unabhängig vom
// Vereins-Branding sofort als Auszeichnung erkennbar ist.
async function applyFestlichFrameStyle(buffer: Buffer, widthPx: number): Promise<Buffer> {
  const extended = await limitedSharp(buffer)
    .extend({
      top: widthPx,
      bottom: widthPx,
      left: widthPx,
      right: widthPx,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer()
  const metadata = await limitedSharp(extended).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for festlich frame')

  const ringPath = `M0,0 H${width} V${height} H0 Z M${widthPx},${widthPx} H${width - widthPx} V${height - widthPx} H${widthPx} Z`
  const beadRadius = Math.max(1, widthPx * 0.16)
  const beadSpacing = beadRadius * 3.2
  const centerline = widthPx * 0.68
  const ornamentSize = Math.max(7, widthPx * 0.95)
  const beads = [
    ...beadOffsets(width, beadSpacing).flatMap((x) => [
      `<circle cx="${x}" cy="${centerline}" r="${beadRadius}" fill="#5c4413"/>`,
      `<circle cx="${x}" cy="${height - centerline}" r="${beadRadius}" fill="#5c4413"/>`,
    ]),
    ...beadOffsets(height, beadSpacing).flatMap((y) => [
      `<circle cx="${centerline}" cy="${y}" r="${beadRadius}" fill="#5c4413"/>`,
      `<circle cx="${width - centerline}" cy="${y}" r="${beadRadius}" fill="#5c4413"/>`,
    ]),
  ].join('')
  const corner = (x: number, y: number, horizontal: number, vertical: number): string => {
    const point = (factorX: number, factorY = factorX) =>
      `${x + horizontal * ornamentSize * factorX},${y + vertical * ornamentSize * factorY}`
    const leaf = (factorX: number, factorY: number, rotation: number) => {
      const cx = x + horizontal * ornamentSize * factorX
      const cy = y + vertical * ornamentSize * factorY
      return `<path d="M${point(factorX - 0.24, factorY + 0.16)} Q${cx},${cy - vertical * ornamentSize * 0.28} ${point(factorX + 0.24, factorY - 0.16)} Q${cx},${cy + vertical * ornamentSize * 0.28} ${point(factorX - 0.24, factorY + 0.16)}Z" fill="#fbe8a6" stroke="#725418" stroke-width="${Math.max(0.65, widthPx * 0.045)}" transform="rotate(${rotation} ${cx} ${cy})"/>`
    }
    const diagonalRotation = horizontal === vertical ? 45 : -45
    const stroke = Math.max(0.8, widthPx * 0.07)
    return `<g><path d="M${point(0, 0)} C${point(0.25, 1.12)} ${point(1.42, 0.22)} ${point(1.18, 1.42)} C${point(1.02, 2.05)} ${point(2.18, 1.72)} ${point(2.12, 0.86)}" fill="none" stroke="#725418" stroke-width="${stroke}" stroke-linecap="round"/><path d="M${point(0.34, 0.34)} C${point(1.1, 0.04)} ${point(1.78, 0.68)} ${point(1.48, 1.18)} C${point(1.24, 1.58)} ${point(0.82, 1.28)} ${point(1.04, 0.92)}" fill="none" stroke="#725418" stroke-width="${Math.max(0.65, stroke * 0.72)}" stroke-linecap="round"/>${leaf(0.58, 0.88, diagonalRotation)}${leaf(1.32, 0.6, diagonalRotation + horizontal * 24)}${leaf(1.72, 1.38, diagonalRotation - horizontal * 28)}<circle cx="${x}" cy="${y}" r="${ornamentSize * 0.48}" fill="url(#gold)" stroke="#725418" stroke-width="${Math.max(1, widthPx * 0.09)}"/><path d="M${point(0, -0.27)} L${point(0.18, 0)} L${point(0, 0.27)} L${point(-0.18, 0)}Z M${point(-0.27, 0)} L${point(0, 0.18)} L${point(0.27, 0)} L${point(0, -0.18)}Z" fill="#fff1b8"/><circle cx="${x}" cy="${y}" r="${ornamentSize * 0.09}" fill="#725418"/></g>`
  }
  const inset = Math.max(1, widthPx * 0.22)
  const corners = [
    corner(widthPx * 0.52, widthPx * 0.52, 1, 1),
    corner(width - widthPx * 0.52, widthPx * 0.52, -1, 1),
    corner(widthPx * 0.52, height - widthPx * 0.52, 1, -1),
    corner(width - widthPx * 0.52, height - widthPx * 0.52, -1, -1),
  ].join('')
  const svg =
    `<svg width="${width}" height="${height}">` +
    `<defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#604515"/><stop offset="16%" stop-color="#c79929"/><stop offset="40%" stop-color="#fff3bd"/><stop offset="60%" stop-color="#d4af37"/><stop offset="100%" stop-color="#6b4c14"/></linearGradient><clipPath id="frame-area" clipPathUnits="userSpaceOnUse"><path fill-rule="evenodd" clip-rule="evenodd" d="${ringPath}"/></clipPath></defs>` +
    `<path fill-rule="evenodd" fill="url(#gold)" d="${ringPath}"/><rect x="${inset}" y="${inset}" width="${width - 2 * inset}" height="${height - 2 * inset}" fill="none" stroke="#725418" stroke-width="${Math.max(1, widthPx * 0.1)}"/><rect x="${widthPx - inset}" y="${widthPx - inset}" width="${width - 2 * (widthPx - inset)}" height="${height - 2 * (widthPx - inset)}" fill="none" stroke="#fff0a8" stroke-width="${Math.max(1, widthPx * 0.08)}"/>${beads}<g clip-path="url(#frame-area)">${corners}</g></svg>`
  return limitedSharp(extended)
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .png()
    .toBuffer()
}

export async function applyParametricFrame(
  buffer: Buffer,
  style: ImageStyleFrameStyle,
  colorHex: string,
  widthPx: number,
): Promise<Buffer> {
  switch (style) {
    case 'solid':
      return applySolidFrameStyle(buffer, colorHex, widthPx)
    case 'double':
      return applyDoubleFrameStyle(buffer, colorHex, widthPx)
    case 'corner_marks':
      return applyCornerMarksFrameStyle(buffer, colorHex, widthPx)
    case 'bottom_bar':
      return applyBottomBarFrameStyle(buffer, colorHex, widthPx)
    case 'festlich':
      return applyFestlichFrameStyle(buffer, widthPx)
  }
}

// Die Rahmengrafik wird auf die Fotomasse gestreckt (fit: 'fill') statt umgekehrt das Foto an die
// Rahmengrafik anzupassen -- das Foto behaelt so sein eigenes Seitenverhaeltnis. Das setzt voraus,
// dass hochgeladene Rahmengrafiken einen durchsichtigen Bereich passend zum spaeter angehaengten
// Foto haben; dieselbe Annahme wie bei jedem "Rahmen als PNG-Overlay"-Muster.
export async function applyCustomFrame(buffer: Buffer, frameAssetBuffer: Buffer): Promise<Buffer> {
  const metadata = await limitedSharp(buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('cannot determine image dimensions for custom frame')
  const resizedFrame = await limitedSharp(frameAssetBuffer)
    .resize({ width, height, fit: 'fill' })
    .toBuffer()
  return limitedSharp(buffer)
    .composite([{ input: resizedFrame, gravity: 'center' }])
    .png()
    .toBuffer()
}
