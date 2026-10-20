
type CalendarDate = { year: number; month: number; day: number }

type CalendarDateTime = CalendarDate & { hour: number; minute: number; second: number }

// Die Aktivitaetsperioden orientieren sich an der Zeitzone des Vereins, nicht an der
// Server-Zeitzone. Damit wechselt der Tageszaehler fuer einen Berliner Verein auch im
// Sommer korrekt um Mitternacht in Berlin. Die iterative Umrechnung behandelt dabei
// unterschiedliche UTC-Offsets (Sommer-/Winterzeit) ohne eine weitere Datumsbibliothek.
function calendarDateTimeInTimeZone(timeZone: string, instant = new Date()): CalendarDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return {
    year: value('year'), month: value('month'), day: value('day'),
    hour: value('hour'), minute: value('minute'), second: value('second'),
  }
}

function calendarDateInTimeZone(timeZone: string, instant = new Date()): CalendarDate {
  const { year, month, day } = calendarDateTimeInTimeZone(timeZone, instant)
  return { year, month, day }
}

function midnightInTimeZone(date: CalendarDate, timeZone: string): string {
  const localMidnight = Date.UTC(date.year, date.month - 1, date.day)
  let instant = localMidnight
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = calendarDateTimeInTimeZone(timeZone, new Date(instant))
    const renderedAsUtc = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, rendered.second)
    instant += localMidnight - renderedAsUtc
  }
  return new Date(instant).toISOString()
}

function addCalendarDays(date: CalendarDate, amount: number): CalendarDate {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + amount))
  return { year: result.getUTCFullYear(), month: result.getUTCMonth() + 1, day: result.getUTCDate() }
}

export function currentPeriodStarts(timeZone: string): Record<'day' | 'week' | 'month' | 'year', string> {
  const today = calendarDateInTimeZone(timeZone)
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay()
  const monday = addCalendarDays(today, -((weekday + 6) % 7))
  return {
    day: midnightInTimeZone(today, timeZone),
    week: midnightInTimeZone(monday, timeZone),
    month: midnightInTimeZone({ year: today.year, month: today.month, day: 1 }, timeZone),
    year: midnightInTimeZone({ year: today.year, month: 1, day: 1 }, timeZone),
  }
}
