// Bisher nur in plattform-admin/vereine/[id].vue -- Plan 021 braucht denselben Formatierer auf
// /einstellungen/tarif, /struktur und plattform-admin/tarife.vue, deshalb hier einmal extrahiert.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`
}
