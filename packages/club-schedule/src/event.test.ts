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

  it('returns undefined when the summary looks like a match -- that belongs to the fixtures domain', () => {
    const raw = { summary: 'SV Nordstadt – TSV Süd', dtstart: '2026-08-15T15:00:00Z' }
    expect(clubEventDomainAdapter.normalize(raw, {})).toBeUndefined()
  })

  it('returns undefined for a row with neither explicit fields nor a usable summary', () => {
    expect(clubEventDomainAdapter.normalize({ Sonstiges: 'x' }, {})).toBeUndefined()
  })
})

describe('clubEventDomainAdapter.identityOf', () => {
  it('prefers the external id when present', () => {
    const entity = ExternalClubEventSchema.parse({ externalId: 'ext-1', title: 'Sommerfest', startsAt: '2026-08-20T16:00:00Z' })
    expect(clubEventDomainAdapter.identityOf(entity)).toEqual({ externalId: 'ext-1' })
  })

  it('falls back to a fuzzy key of title and start time', () => {
    const entity = ExternalClubEventSchema.parse({ title: 'Sommerfest', startsAt: '2026-08-20T16:00:00Z' })
    expect(clubEventDomainAdapter.identityOf(entity)).toEqual({ fuzzy: ['sommerfest', '2026-08-20T16:00:00Z'] })
  })
})
