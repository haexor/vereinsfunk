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
    const [rawPropertyName, ...paramPairs] = rawKey.split(';')
    const propertyName = (rawPropertyName ?? '').trim().toLowerCase()
    if (!propertyName) continue
    current[propertyName] = unescapeIcalText(rawValue)
    // Parameter (TZID, VALUE, ...) zusätzlich als eigene Geschwister-Keys freilegen, damit ein
    // Domänen-Adapter z. B. die Zeitzone einer DTSTART sieht, ohne die Rohzeile selbst zu parsen.
    for (const paramPair of paramPairs) {
      const equalsIndex = paramPair.indexOf('=')
      if (equalsIndex === -1) continue
      const paramName = paramPair.slice(0, equalsIndex).trim().toLowerCase()
      if (!paramName) continue
      const rawParamValue = paramPair.slice(equalsIndex + 1)
      // RFC 5545 erlaubt ein quoted-string fuer Parameterwerte (z. B. TZID="Europe/Berlin") --
      // ohne das Entfernen der Anfuehrungszeichen wuerde resolveIcalDateTime eine Zeitzonen-ID
      // erhalten, die Intl.DateTimeFormat nicht erkennt, und stillschweigend auf die Fallback-
      // Zeitzone ausweichen.
      const paramValue = rawParamValue.length >= 2 && rawParamValue.startsWith('"') && rawParamValue.endsWith('"')
        ? rawParamValue.slice(1, -1)
        : rawParamValue
      current[propertyName + '_' + paramName] = paramValue
    }
  }
  return events
}

// Gemeinsames Muster für YYYYMMDD[THHMMSS[Z]] -- von parseIcalDate und resolveIcalDateTime
// geteilt, damit es nur eine Wahrheit über das unterstützte iCal-Datumsformat gibt.
const ICAL_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/

// Nur die gängigen VALUE=DATE / VALUE=DATE-TIME-Formen; alles andere lässt den Termin
// lieber durch, statt ihn fälschlich wegzufiltern (since ist ohnehin nur eine Optimierung).
function parseIcalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const match = ICAL_DATE_PATTERN.exec(value)
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

// Zwei Umrechnungen gegeneinander verrechnet: einmal die Wanduhrzeit naiv als UTC interpretiert
// (asIfUtcMs), einmal die tatsächlich gemeinte UTC-Instanz geschätzt (utcGuessMs). Die Differenz
// beider ist der Zonenversatz zum Schätzzeitpunkt (inkl. Sommerzeit); zieht man sie vom Schätzwert
// ab, landet man exakt auf der gesuchten UTC-Instanz -- ohne eine eigene Offset-Tabelle zu pflegen.
// Ein zweiter Durchlauf mit dem Ergebnis des ersten wiederholt das: liegt die gesuchte Instanz
// jenseits einer Zeitumstellung, gilt dort ein anderer Versatz als am Schätzzeitpunkt, und nur der
// am Ergebnis erneut berechnete Versatz trifft die tatsächliche Instanz.
function offsetAtInstant(instantMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(instantMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asIfUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asIfUtcMs - instantMs
}

function zonedWallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const utcGuessMs = Date.UTC(year, month - 1, day, hour, minute, second)
  const firstPassMs = utcGuessMs - offsetAtInstant(utcGuessMs, timeZone)
  return utcGuessMs - offsetAtInstant(firstPassMs, timeZone)
}

export interface ResolvedIcalDateTime {
  readonly iso: string
  readonly confirmed: boolean
}

/**
 * Löst einen rohen DTSTART/DTEND-Wert in eine UTC-Instanz auf. "confirmed" ist nur true, wenn die
 * Zeitzone aus der Quelle eindeutig hervorgeht (Z-Suffix oder TZID) -- sonst gilt fachlich "ohne
 * Angabe gilt die Vereinszeitzone": der Fallback wird trotzdem verwendet, aber als unbestätigt
 * markiert, weil er eine Annahme ist und keine Angabe der Quelle.
 */
export function resolveIcalDateTime(
  rawValue: string,
  tzid: string | undefined,
  fallbackTimezone: string,
): ResolvedIcalDateTime | undefined {
  const match = ICAL_DATE_PATTERN.exec(rawValue)
  if (!match) return undefined
  const [, year, month, day, hour, minute, second, utc] = match
  const y = Number(year)
  const mo = Number(month)
  const d = Number(day)
  const h = hour ? Number(hour) : 0
  const mi = minute ? Number(minute) : 0
  const s = second ? Number(second) : 0

  if (utc) {
    return { iso: new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString(), confirmed: true }
  }

  if (tzid) {
    try {
      return { iso: new Date(zonedWallTimeToUtcMs(y, mo, d, h, mi, s, tzid)).toISOString(), confirmed: true }
    } catch {
      // Ein kaputter/unbekannter TZID-Wert aus einer echten Quelle darf den ganzen Sync-Lauf nicht
      // abreißen -- wie ein fehlendes TZID behandeln und auf die Vereinszeitzone zurückfallen.
    }
  }

  return { iso: new Date(zonedWallTimeToUtcMs(y, mo, d, h, mi, s, fallbackTimezone)).toISOString(), confirmed: false }
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
