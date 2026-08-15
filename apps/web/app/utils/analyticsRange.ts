export type AnalyticsRangePreset = '7d' | '30d' | '90d' | 'this_month' | 'last_month' | 'custom'

export interface AnalyticsDateRange {
  from: string
  to: string
}

function addDaysToKey(day: string, delta: number): string {
  const [year, month, date] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))]
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10)
}

// Bei freien Zeiträumen bleiben unvollständige Eingaben bewusst unverändert: Die Seite zeigt
// dann eine konkrete Validierungsmeldung, statt stillschweigend einen anderen Zeitraum zu laden.
export function resolveAnalyticsRange(preset: AnalyticsRangePreset, todayKey: string, customRange: AnalyticsDateRange): AnalyticsDateRange {
  if (preset === '7d') return { from: addDaysToKey(todayKey, -6), to: todayKey }
  if (preset === '30d') return { from: addDaysToKey(todayKey, -29), to: todayKey }
  if (preset === '90d') return { from: addDaysToKey(todayKey, -89), to: todayKey }
  if (preset === 'this_month') return { from: `${todayKey.slice(0, 7)}-01`, to: todayKey }
  if (preset === 'last_month') {
    const firstOfThisMonth = `${todayKey.slice(0, 7)}-01`
    const lastOfPreviousMonth = addDaysToKey(firstOfThisMonth, -1)
    return { from: `${lastOfPreviousMonth.slice(0, 7)}-01`, to: lastOfPreviousMonth }
  }
  return customRange
}
