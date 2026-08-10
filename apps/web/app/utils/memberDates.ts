export function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
  return (asUtc - (date.getTime() - date.getMilliseconds())) / 60000
}

export function endOfDayIso(dateKey: string, timeZone: string): string {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number]
  const utcGuess = Date.UTC(year, month - 1, day, 23, 59, 59, 999)
  return new Date(utcGuess - tzOffsetMinutes(new Date(utcGuess), timeZone) * 60000).toISOString()
}
