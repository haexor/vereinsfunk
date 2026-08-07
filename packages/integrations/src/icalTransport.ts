import type { SourceTransport } from './types.js'

/**
 * RFC-5545-Zeilenfaltung rückgängig machen: eine Fortsetzungszeile beginnt mit einem
 * Leerzeichen oder Tab und gehört an die vorherige Zeile.
 */
function unfoldLines(text: string): string[] {
  const rawLines = text.split(/\r\n|\n|\r/)
  const lines: string[] = []
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

function unescapeIcalText(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

/**
 * Kein vollständiger RFC-5545-Parser -- nur genug für eine Terminübersicht: BEGIN/END:VEVENT
 * erkennen, Property-Parameter (";VALUE=DATE", ";TZID=…") abtrennen und den Rohwert je
 * Property behalten. Datumswerte bleiben unangetastete Strings (z. B. "20260101T100000Z");
 * deren Interpretation ist Sache des Bereichsadapters, nicht des Transports.
 */
function parseVEvents(text: string): Record<string, unknown>[] {
  const lines = unfoldLines(text)
  const events: Record<string, unknown>[] = []
  let current: Record<string, string> | null = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === 'BEGIN:VEVENT') {
      current = {}
      continue
    }
    if (trimmed === 'END:VEVENT') {
      if (current) events.push(current)
      current = null
      continue
    }
    if (!current) continue
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) continue
    const rawKey = line.slice(0, separatorIndex)
    const rawValue = line.slice(separatorIndex + 1)
    const propertyName = (rawKey.split(';')[0] ?? '').trim().toLowerCase()
    if (!propertyName) continue
    current[propertyName] = unescapeIcalText(rawValue)
  }
  return events
}

// Nur die gängigen VALUE=DATE / VALUE=DATE-TIME-Formen; alles andere lässt den Termin
// lieber durch, statt ihn fälschlich wegzufiltern (since ist ohnehin nur eine Optimierung).
function parseIcalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value)
  if (!match) return undefined
  const [, year, month, day, hour, minute, second, utc] = match
  const y = Number(year)
  const mo = Number(month) - 1
  const d = Number(day)
  const h = hour ? Number(hour) : 0
  const mi = minute ? Number(minute) : 0
  const s = second ? Number(second) : 0
  return utc ? new Date(Date.UTC(y, mo, d, h, mi, s)) : new Date(y, mo, d, h, mi, s)
}

/**
 * iCal-Transport: liest einen als Text übergebenen iCal-Feed (RFC 5545) und liefert je VEVENT
 * einen rohen Record mit den unveränderten iCal-Feldern (uid, summary, dtstart, dtend,
 * location, description, ...). Den Text holt dieser Transport nicht selbst (kein HTTP-Client);
 * das ist Sache der aufrufenden API.
 */
export class IcalSourceTransport implements SourceTransport {
  readonly kind = 'ical' as const
  readonly key: string
  private readonly text: string

  constructor(options: { key: string; text: string }) {
    this.key = options.key
    this.text = options.text
  }

  async *read(options: { since?: Date } = {}): AsyncIterable<Readonly<Record<string, unknown>>> {
    for (const event of parseVEvents(this.text)) {
      if (options.since) {
        const start = parseIcalDate(event['dtstart'])
        if (start && start < options.since) continue
      }
      yield event
    }
  }
}
