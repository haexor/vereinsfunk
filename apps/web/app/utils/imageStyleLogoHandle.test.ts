import type { ImageStyleLogoPosition } from '@vereinsfunk/contracts'
import { describe, expect, it } from 'vitest'
import { logoFieldsToPixelRect, pixelRectToLogoFields } from './imageStyleLogoHandle'

const CANVAS_WIDTH = 1600
const CANVAS_HEIGHT = 1067

const POSITIONS: ImageStyleLogoPosition[] = [
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
  'center',
]

describe('imageStyleLogoHandle', () => {
  it.each(POSITIONS)('round-trips %s through pixel rect and back', (logoPosition) => {
    const fields = { logoPosition, logoSizePercent: 15, logoMarginPercent: 5 }
    const rect = logoFieldsToPixelRect(fields, CANVAS_WIDTH, CANVAS_HEIGHT)
    const roundTripped = pixelRectToLogoFields(rect, CANVAS_WIDTH, CANVAS_HEIGHT, fields.logoMarginPercent)
    expect(roundTripped.logoPosition).toBe(logoPosition)
    expect(roundTripped.logoSizePercent).toBe(15)
    expect(roundTripped.logoMarginPercent).toBe(5)
  })

  it('clamps logoSizePercent to the schema range [4, 30] when dragged past its bounds', () => {
    const tiny = pixelRectToLogoFields({ left: 0, top: 0, width: 10, height: 10 }, CANVAS_WIDTH, CANVAS_HEIGHT, 5)
    expect(tiny.logoSizePercent).toBe(4)
    const huge = pixelRectToLogoFields({ left: 0, top: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT }, CANVAS_WIDTH, CANVAS_HEIGHT, 5)
    expect(huge.logoSizePercent).toBe(30)
  })

  it('clamps logoMarginPercent to the schema range [0, 15]', () => {
    const noMargin = pixelRectToLogoFields({ left: 0, top: 0, width: 200, height: 150 }, CANVAS_WIDTH, CANVAS_HEIGHT, 5)
    expect(noMargin.logoMarginPercent).toBe(0)
  })

  it('treats a rect whose center sits in the middle 40% band as center, even off-exact-center', () => {
    // Mittelpunkt bei 45% der Breite/Hoehe liegt noch innerhalb von [30%, 70%].
    const rect = { left: CANVAS_WIDTH * 0.4, top: CANVAS_HEIGHT * 0.4, width: CANVAS_WIDTH * 0.1, height: CANVAS_HEIGHT * 0.1 }
    expect(pixelRectToLogoFields(rect, CANVAS_WIDTH, CANVAS_HEIGHT, 5).logoPosition).toBe('center')
  })

  it('keeps the previous margin unchanged for a center rect, since no direction is derivable', () => {
    const rect = { left: CANVAS_WIDTH * 0.45, top: CANVAS_HEIGHT * 0.45, width: CANVAS_WIDTH * 0.1, height: CANVAS_HEIGHT * 0.1 }
    expect(pixelRectToLogoFields(rect, CANVAS_WIDTH, CANVAS_HEIGHT, 7).logoMarginPercent).toBe(7)
  })

  it('snaps to a corner once the center crosses the central-band threshold', () => {
    // Mittelpunkt bei 25% der Breite/Hoehe liegt ausserhalb von [30%, 70%] -> top_left.
    const rect = { left: CANVAS_WIDTH * 0.2, top: CANVAS_HEIGHT * 0.2, width: CANVAS_WIDTH * 0.1, height: CANVAS_HEIGHT * 0.1 }
    expect(pixelRectToLogoFields(rect, CANVAS_WIDTH, CANVAS_HEIGHT, 5).logoPosition).toBe('top_left')
  })

  it('mirrors the server box size formula (percentage of width, not the shorter edge)', () => {
    const rect = logoFieldsToPixelRect(
      { logoPosition: 'bottom_right', logoSizePercent: 20, logoMarginPercent: 0 },
      2000,
      500,
    )
    expect(rect.width).toBe(400)
  })
})
