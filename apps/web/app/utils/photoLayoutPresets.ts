// dividerColor ist eine Rolle ('primary'/'accent') oder ein fester Hexwert; die Rollen folgen den
// Vereinsfarben, damit ein Preset einen spaeteren Farbwechsel mitmacht.
export function resolveDividerColor(dividerColor: string, colors: { primaryColor: string; accentColor: string }): string {
  if (dividerColor === 'primary') return colors.primaryColor
  if (dividerColor === 'accent') return colors.accentColor
  return dividerColor
}
