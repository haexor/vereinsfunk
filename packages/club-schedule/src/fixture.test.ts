import { describe, expect, it } from 'vitest'
import { ExternalFixtureSchema, fixtureDomainAdapter } from './fixture.js'

describe('fixtureDomainAdapter.normalize', () => {
  it('passes explicitly mapped fixture columns through and never touches the iCal fallback', () => {
    const raw = { Gegner: 'TSV Süd', Mannschaft: '2. Herren', Heimspiel: true, summary: 'irrelevant title text' }
    const mapping = { Gegner: 'opponentName', Mannschaft: 'teamReference', Heimspiel: 'isHome' }
    const normalized = fixtureDomainAdapter.normalize(raw, mapping) as Record<string, unknown>
    expect(normalized).toEqual({ opponentName: 'TSV Süd', teamReference: '2. Herren', isHome: true })
  })

  it('parses a CSV-string "false" as false, not as Boolean("false") === true', () => {
    const raw = { Gegner: 'TSV Süd', Heimspiel: 'false' }
    const mapping = { Gegner: 'opponentName', Heimspiel: 'isHome' }
    const normalized = fixtureDomainAdapter.normalize(raw, mapping)
    expect(ExternalFixtureSchema.parse(normalized).isHome).toBe(false)
  })

  it('falls back to the title heuristic for an iCal row with no explicit fixture columns', () => {
    const raw = {
      summary: 'SV Nordstadt – TSV Süd',
      dtstart: '2026-08-15T15:00:00Z',
      location: 'Sportplatz Nord',
      uid: 'ical-uid-1',
      description: 'Ligaspiel',
    }
    const normalized = fixtureDomainAdapter.normalize(raw, {}) as Record<string, unknown>
    expect(normalized).toEqual({
      homeNameRaw: 'SV Nordstadt',
      awayNameRaw: 'TSV Süd',
      kickoffAt: '2026-08-15T15:00:00Z',
      venueName: 'Sportplatz Nord',
      externalId: 'ical-uid-1',
      note: 'Ligaspiel',
    })
  })

  it('returns undefined when the summary has no recognizable match pattern -- the events domain gets the chance instead', () => {
    expect(fixtureDomainAdapter.normalize({ summary: 'Sommerfest im Vereinsheim' }, {})).toBeUndefined()
  })

  it('sets homeScore/awayScore from a score-bearing title', () => {
    const normalized = fixtureDomainAdapter.normalize({ summary: 'SV Nordstadt - TSV Süd 3:1' }, {}) as Record<string, unknown>
    expect(normalized.homeScore).toBe(3)
    expect(normalized.awayScore).toBe(1)
  })

  it('keeps an explicitly mapped score over a score detected in the title -- mapped wins over erraten', () => {
    const raw = { summary: 'SV Nordstadt - TSV Süd 3:1', Tore: 9 }
    const normalized = fixtureDomainAdapter.normalize(raw, { Tore: 'homeScore' }) as Record<string, unknown>
    expect(normalized.homeScore).toBe(9)
    expect(normalized.awayScore).toBe(1)
  })
})

describe('fixtureDomainAdapter.identityOf', () => {
  it('prefers the external id when present', () => {
    const entity = ExternalFixtureSchema.parse({ externalId: 'ext-1', opponentName: 'TSV Süd' })
    expect(fixtureDomainAdapter.identityOf(entity)).toEqual({ externalId: 'ext-1' })
  })

  it('falls back to a fuzzy key of opponent and kickoff time', () => {
    const entity = ExternalFixtureSchema.parse({ opponentName: 'TSV Süd', kickoffAt: '2026-08-15T15:00:00Z' })
    expect(fixtureDomainAdapter.identityOf(entity)).toEqual({ fuzzy: ['tsv süd', '2026-08-15T15:00:00Z'] })
  })
})
