import { describe, expect, it } from 'vitest'
import { IcalSourceTransport } from './icalTransport.js'

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
})
