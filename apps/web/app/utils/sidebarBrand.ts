import { contrastRatio } from '@vereinsfunk/domain'

const WHITE = '#ffffff'
const INK = '#14221d'
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export interface SidebarPalette {
  surface: string
  onSurface: string
  actionSurface: string
  onAction: string
}

function readableForeground(background: string) {
  return contrastRatio(WHITE, background) >= contrastRatio(INK, background) ? WHITE : INK
}

export function deriveSidebarPalette(primaryColor: string, accentColor: string): SidebarPalette {
  const primary = HEX_COLOR.test(primaryColor) ? primaryColor : INK
  const accent = HEX_COLOR.test(accentColor) ? accentColor : WHITE

  // Die Marke bestimmt die Flaechen. Die Textfarbe richtet sich jeweils nach der konkreten
  // Flaeche: auf einem hellen Blau ist dunkle Schrift lesbarer, auf einem dunklen Vereinsrot
  // weisse. Dasselbe gilt unabhaengig fuer die Akzentflaeche des CTA.
  return {
    surface: primary,
    onSurface: readableForeground(primary),
    actionSurface: accent,
    onAction: readableForeground(accent),
  }
}
