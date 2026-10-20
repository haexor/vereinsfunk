
// Von Bildstil (Rahmen, Duoton) und Bildkomposition (Trennlinien-/Gutter-Farbe, Plan 047, PR 1)
// geteilt -- eine zweite Kopie derselben vierzeiligen Regex waere die groessere Redundanz.
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex)
  if (!match) throw new Error(`not a hex color: ${hex}`)
  return { r: parseInt(match[1]!, 16), g: parseInt(match[2]!, 16), b: parseInt(match[3]!, 16) }
}
