import { describe, expect, it } from 'vitest'
import { clubEventDomainAdapter, ExternalClubEventSchema } from './event.js'

describe('clubEventDomainAdapter.normalize', () => {
  it('passes explicitly mapped title/startsAt through unchanged', () => {
    const raw = { Titel: 'Mitgliederversammlung', Beginn: '2026-09-01T19:00:00Z', summary: 'irrelevant' }
    const mapping = { Titel: 'title', Beginn: 'startsAt' }
    const normalized = clubEventDomainAdapter.normalize(raw, mapping) as Record<string, unknown>
    expect(normalized).toEqual({ title: 'Mitgliederversammlung', startsAt: '2026-09-01T19:00:00Z' })
  })

  it('parses a CSV-string "false" allDay as false, not as Boolean("false") === true', () => {
    const raw = { Titel: 'Vollversammlung', Beginn: '2026-09-01T19:00:00Z', Ganztags: 'false' }
    const mapping = { Titel: 'title', Beginn: 'startsAt', Ganztags: 'allDay' }
    const normalized = clubEventDomainAdapter.normalize(raw, mapping)
    expect(ExternalClubEventSchema.parse(normalized).allDay).toBe(false)
  })

  it('falls back to an iCal summary that does not look like a match', () => {
    const raw = {
      summary: 'Sommerfest im Vereinsheim',
      dtstart: '2026-08-20T16:00:00Z',
      dtend: '2026-08-20T22:00:00Z',
      location: 'Vereinsheim',
      uid: 'ical-uid-2',
      description: 'Grillen und Musik',
    }
    const normalized = clubEventDomainAdapter.normalize(raw, {}) as Record<string, unknown>
    expect(normalized).toEqual({
      title: 'Sommerfest im Vereinsheim',
      startsAt: '2026-08-20T16:00:00Z',
      endsAt: '2026-08-20T22:00:00Z',
      locationName: 'Vereinsheim',
      description: 'Grillen und Musik',
      externalId: 'ical-uid-2',
    })
  })

  it('keeps the RECURRENCE-ID of a moved series instance as recurrenceKey next to the shared UID', () => {
    const raw = { summary: 'Training', dtstart: '20260828T160000Z', uid: 'series-1', 'recurrence-id': '20260827T160000Z' }
    const normalized = clubEventDomainAdapter.normalize(raw, {}) as Record<string, unknown>
    expect(normalized).toMatchObject({ externalId: 'series-1', recurrenceKey: '20260827T160000Z' })
  })

  it('returns undefined when the summary looks like a match -- that belongs to the fixtures domain', () => {
    const raw = { summary: 'SV Nordstadt – TSV Süd', dtstart: '2026-08-15T15:00:00Z' }
    expect(clubEventDomainAdapter.normalize(raw, {})).toBeUndefined()
  })

  it('returns undefined for a row with neither explicit fields nor a usable summary', () => {
    expect(clubEventDomainAdapter.normalize({ Sonstiges: 'x' }, {})).toBeUndefined()
  })
})
