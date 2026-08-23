import { describe, expect, it } from 'vitest'
import { contrastRatio } from '@vereinsfunk/domain'
import { deriveSidebarPalette } from './sidebarBrand'

describe('deriveSidebarPalette', () => {
  it('uses light text on a dark primary color and dark text on a light accent color', () => {
    const palette = deriveSidebarPalette('#163a2c', '#caff4a')

    expect(palette.surface).toBe('#163a2c')
    expect(palette.onSurface).toBe('#ffffff')
    expect(palette.onAction).toBe('#14221d')
  })

  it('keeps a light club color and chooses a dark sidebar foreground', () => {
    const palette = deriveSidebarPalette('#70ade0', '#80bf06')

    expect(palette.surface).toBe('#70ade0')
    expect(palette.onSurface).toBe('#14221d')
    expect(palette.actionSurface).toBe('#80bf06')
    expect(contrastRatio(palette.onAction, palette.actionSurface)).toBeGreaterThanOrEqual(4.5)
  })

  it('does not replace a similar accent color with a product default', () => {
    const palette = deriveSidebarPalette('#163a2c', '#193c2e')

    expect(palette.actionSurface).toBe('#193c2e')
    expect(palette.onAction).toBe('#ffffff')
  })
})
