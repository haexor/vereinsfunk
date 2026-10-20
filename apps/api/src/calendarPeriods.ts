import { addDays, dayWindow, localDateKey } from '@vereinsfunk/domain'

// Die Aktivitaetsperioden orientieren sich an der Zeitzone des Vereins, nicht an der
// Server-Zeitzone. Damit wechselt der Tageszaehler fuer einen Berliner Verein auch im
// Sommer korrekt um Mitternacht in Berlin. Tagesbeginn und Kalenderrechnung kommen aus
// @vereinsfunk/domain, dieselben Tagesgrenzen wie in der Auswertung.
export function currentPeriodStarts(timeZone: string, now = new Date()): Record<'day' | 'week' | 'month' | 'year', string> {
  const today = localDateKey(now, timeZone)
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  const startOf = (day: string) => dayWindow(day, timeZone).startUtc
  return {
    day: startOf(today),
    week: startOf(addDays(today, -((weekday + 6) % 7))),
    month: startOf(`${today.slice(0, 8)}01`),
    year: startOf(`${today.slice(0, 5)}01-01`),
  }
}
