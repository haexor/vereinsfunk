import { describe, expect, it } from 'vitest'
import type { ScheduleOccasion } from '@vereinsfunk/contracts'
import { occasionFactRows, occasionReference, occasionReferenceFromQuery, occasionSourceLabel } from './scheduleOccasion'

const FIXTURE_ID = '3f000000-6000-4000-8000-000000000001'
const OCCASION: ScheduleOccasion = {
  kind: 'fixture', id: FIXTURE_ID, label: 'Spiel gegen TSV Sued', facts: { homeTeam: 'Erste', awayTeam: 'TSV Sued', homeScore: 2, awayScore: 1 },
  missing: [], capturedAt: '2026-10-20T04:00:00Z', suggestedGoal: 'inform',
}

describe('scheduleOccasion', () => {
  it('reads exactly one valid occasion id from the query', () => {
    expect(occasionReferenceFromQuery({})).toBeNull()
    expect(occasionReferenceFromQuery({ fixtureId: FIXTURE_ID })).toEqual({ fixtureId: FIXTURE_ID })
    expect(occasionReferenceFromQuery({ clubEventId: FIXTURE_ID })).toEqual({ clubEventId: FIXTURE_ID })
    expect(occasionReferenceFromQuery({ fixtureId: 'kaputt' })).toBe('invalid')
    expect(occasionReferenceFromQuery({ fixtureId: FIXTURE_ID, clubEventId: FIXTURE_ID })).toBe('invalid')
  })

  it('turns an occasion back into the request reference', () => {
    expect(occasionReference(null)).toEqual({})
    expect(occasionReference(OCCASION)).toEqual({ fixtureId: FIXTURE_ID })
    expect(occasionReference({ ...OCCASION, kind: 'club_event' })).toEqual({ clubEventId: FIXTURE_ID })
  })

  it('labels the facts in German and shows the score as one line', () => {
    expect(occasionFactRows(OCCASION.facts)).toEqual([
      { label: 'Heim', value: 'Erste' }, { label: 'Gast', value: 'TSV Sued' }, { label: 'Ergebnis', value: '2:1' },
    ])
  })

  it('names the source and its state in the club timezone', () => {
    expect(occasionSourceLabel(OCCASION, 'Europe/Berlin')).toBe('aus dem Spielplan · Stand 20.10.2026, 06:00')
  })
})
