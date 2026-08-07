import { describe, expect, it } from 'vitest'
import { IcalSourceTransport, resolveIcalDateTime } from './icalTransport.js'

async function collect(transport: IcalSourceTransport, options: { since?: Date } = {}): Promise<Readonly<Record<string, unknown>>[]> {
  const rows: Readonly<Record<string, unknown>>[] = []
  for await (const row of transport.read(options)) rows.push(row)
  return rows
}

const singleEvent = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:event-1@example.org',
  'SUMMARY:Heimspiel gegen SV Nord',
  'DTSTART:20260815T140000Z',
  'DTEND:20260815T160000Z',
  'LOCATION:Sportplatz Nord',
  'LAST-MODIFIED:20260801T090000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

describe('IcalSourceTransport', () => {
  it('reads a raw record from a minimal iCal text with one VEVENT', async () => {
    const transport = new IcalSourceTransport({ key: 'club.ics', text: singleEvent })
    const rows = await collect(transport)
    expect(rows).toEqual([
      {
        uid: 'event-1@example.org',
        summary: 'Heimspiel gegen SV Nord',
        dtstart: '20260815T140000Z',
        dtend: '20260815T160000Z',
        location: 'Sportplatz Nord',
        'last-modified': '20260801T090000Z',
      },
    ])
  })

  it('reads two VEVENTs from the same feed', async () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:event-1@example.org',
      'SUMMARY:Heimspiel',
      'DTSTART:20260815T140000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:event-2@example.org',
      'SUMMARY:Auswaertsspiel',
      'DTSTART:20260822T140000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n')
    const transport = new IcalSourceTransport({ key: 'club.ics', text })
    const rows = await collect(transport)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.['uid']).toBe('event-1@example.org')
    expect(rows[1]?.['uid']).toBe('event-2@example.org')
  })

  it('un-escapes standard iCal text escaping without interpreting the value', async () => {
    const text = ['BEGIN:VEVENT', 'UID:e1', 'SUMMARY:Training\\, Halle A\\nBitte puenktlich', 'END:VEVENT'].join('\n')
    const transport = new IcalSourceTransport({ key: 'club.ics', text })
    const rows = await collect(transport)
    expect(rows[0]?.['summary']).toBe('Training, Halle A\nBitte puenktlich')
  })

  it('unfolds a continuation line per RFC 5545', async () => {
    // Die gefaltete Fortsetzungszeile beginnt mit genau einem Leerzeichen, das beim Entfalten
    // entfernt wird (RFC-5545-Beispiel faltet ebenfalls mitten im Wort: "lo" + "ng").
    const text = ['BEGIN:VEVENT', 'UID:e1', 'SUMMARY:Ein sehr langer Ti', ' tel, der umgebrochen wurde', 'END:VEVENT'].join('\r\n')
    const transport = new IcalSourceTransport({ key: 'club.ics', text })
    const rows = await collect(transport)
    expect(rows[0]?.['summary']).toBe('Ein sehr langer Titel, der umgebrochen wurde')
  })

  it('filters events before options.since when dtstart is parseable', async () => {
    const transport = new IcalSourceTransport({ key: 'club.ics', text: singleEvent })
    const rowsBefore = await collect(transport, { since: new Date('2026-09-01T00:00:00Z') })
    expect(rowsBefore).toHaveLength(0)
    const rowsAfter = await collect(transport, { since: new Date('2026-01-01T00:00:00Z') })
    expect(rowsAfter).toHaveLength(1)
  })

  it('exposes a TZID parameter as a sibling key next to the unchanged raw value', async () => {
    const text = ['BEGIN:VEVENT', 'UID:e1', 'DTSTART;TZID=Europe/Berlin:20260107T190000', 'END:VEVENT'].join('\n')
    const transport = new IcalSourceTransport({ key: 'club.ics', text })
    const rows = await collect(transport)
    expect(rows[0]?.['dtstart']).toBe('20260107T190000')
    expect(rows[0]?.['dtstart_tzid']).toBe('Europe/Berlin')
  })

  it('exposes a VALUE parameter as a sibling key', async () => {
    const text = ['BEGIN:VEVENT', 'UID:e1', 'DTSTART;VALUE=DATE:20260315', 'END:VEVENT'].join('\n')
    const transport = new IcalSourceTransport({ key: 'club.ics', text })
    const rows = await collect(transport)
    expect(rows[0]?.['dtstart']).toBe('20260315')
    // Sibling-Key folgt <propertyname>_<paramname> (hier "value", aus VALUE=DATE) -- siehe
    // Bericht: eine frühere Fassung der Aufgabenbeschreibung nannte hier "dtstart_valuedate",
    // was dem an anderer Stelle exakt vorgegebenen Split-Algorithmus (";" dann erstes "=")
    // widerspricht; hier wird konsequent nach diesem Algorithmus benannt.
    expect(rows[0]?.['dtstart_value']).toBe('DATE')
    expect(rows[0]?.['dtstart_valuedate']).toBeUndefined()
  })

  it('exposes no sibling keys for a property without parameters', async () => {
    const text = ['BEGIN:VEVENT', 'UID:e1', 'DTSTART:20260107T190000Z', 'END:VEVENT'].join('\n')
    const transport = new IcalSourceTransport({ key: 'club.ics', text })
    const rows = await collect(transport)
    expect(rows[0]).toEqual({ uid: 'e1', dtstart: '20260107T190000Z' })
    expect(rows[0]?.['dtstart_tzid']).toBeUndefined()
    expect(rows[0]?.['dtstart_valuedate']).toBeUndefined()
  })

  it('exposes multiple parameters on the same property as separate siblings', async () => {
    const text = ['BEGIN:VEVENT', 'UID:e1', 'DTSTART;TZID=Europe/Berlin;VALUE=DATE-TIME:20260107T190000', 'END:VEVENT'].join('\n')
    const transport = new IcalSourceTransport({ key: 'club.ics', text })
    const rows = await collect(transport)
    expect(rows[0]?.['dtstart_tzid']).toBe('Europe/Berlin')
    expect(rows[0]?.['dtstart_value']).toBe('DATE-TIME')
  })
})

describe('resolveIcalDateTime', () => {
  it('treats a trailing Z as an explicit, confirmed UTC instant', () => {
    const resolved = resolveIcalDateTime('20260107T190000Z', undefined, 'Europe/Berlin')
    expect(resolved).toEqual({ iso: '2026-01-07T19:00:00.000Z', confirmed: true })
  })

  it('resolves a TZID against winter time (UTC+1) as confirmed', () => {
    const resolved = resolveIcalDateTime('20260107T190000', 'Europe/Berlin', 'Europe/Berlin')
    expect(resolved).toEqual({ iso: '2026-01-07T18:00:00.000Z', confirmed: true })
  })

  it('resolves a TZID against summer time (UTC+2, DST) via real IANA data, not a fixed offset', () => {
    const resolved = resolveIcalDateTime('20260707T190000', 'Europe/Berlin', 'Europe/Berlin')
    expect(resolved).toEqual({ iso: '2026-07-07T17:00:00.000Z', confirmed: true })
  })

  it('falls back to the club timezone when no TZID is given, marked unconfirmed', () => {
    const resolved = resolveIcalDateTime('20260107T190000', undefined, 'Europe/Berlin')
    expect(resolved).toEqual({ iso: '2026-01-07T18:00:00.000Z', confirmed: false })
  })

  it('treats an invalid/unknown TZID like a missing one instead of throwing', () => {
    const resolved = resolveIcalDateTime('20260107T190000', 'Not/AZone', 'Europe/Berlin')
    expect(resolved).toEqual({ iso: '2026-01-07T18:00:00.000Z', confirmed: false })
  })

  it('returns undefined for an unparseable value', () => {
    expect(resolveIcalDateTime('not-a-date', undefined, 'Europe/Berlin')).toBeUndefined()
  })

  it('resolves a negative-offset fallback zone (America/New_York, UTC-5) correctly', () => {
    const resolved = resolveIcalDateTime('20260107T190000', 'America/New_York', 'Europe/Berlin')
    expect(resolved).toEqual({ iso: '2026-01-08T00:00:00.000Z', confirmed: true })
  })
})
