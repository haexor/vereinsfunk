// WCAG 2.x relative luminance and contrast ratio (Plan 013, "Farbrollen und Kontrast"). A warning,
// never a blocker -- the club's brand colors are its own choice, but the warning must be concrete.
function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

// Ohne diese Pruefung liefert Number.parseInt bei einer Kurzform (#abc) oder einer halb
// getippten Eingabe NaN, und die Kontrastanzeige auf /marke zeigt "NaN:1" statt eines Fehlers.
const SIX_DIGIT_HEX = /^#?[0-9a-fA-F]{6}$/

function relativeLuminance(hex: string): number {
  if (!SIX_DIGIT_HEX.test(hex)) throw new Error(`invalid hex color: ${hex}`)
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b)
}

export function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const foreground = relativeLuminance(foregroundHex)
  const background = relativeLuminance(backgroundHex)
  const lighter = Math.max(foreground, background)
  const darker = Math.min(foreground, background)
  return (lighter + 0.05) / (darker + 0.05)
}

const MINIMUM_AA_CONTRAST = 4.5

export interface ContrastCheck {
  ratio: number
  meetsAA: boolean
}

export function meetsMinimumContrast(foregroundHex: string, backgroundHex: string): ContrastCheck {
  const ratio = contrastRatio(foregroundHex, backgroundHex)
  return { ratio: Math.round(ratio * 100) / 100, meetsAA: ratio >= MINIMUM_AA_CONTRAST }
}
