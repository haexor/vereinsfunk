import { describe, expect, it } from 'vitest'
import { detectFixtureTitle } from './titleHeuristic.js'

describe('detectFixtureTitle', () => {
  it('splits on an en dash without a score', () => {
    expect(detectFixtureTitle('SV Nordstadt – TSV Süd')).toEqual({
      homeName: 'SV Nordstadt',
      awayName: 'TSV Süd',
    })
  })

  it('strips a trailing score in colon notation and splits on a hyphen', () => {
    expect(detectFixtureTitle('SV Nordstadt - TSV Süd 3:1')).toEqual({
      homeName: 'SV Nordstadt',
      awayName: 'TSV Süd',
      homeScore: 3,
      awayScore: 1,
    })
  })

  it('recognizes "vs." as a separator', () => {
    expect(detectFixtureTitle('FC Bayern vs. Real Madrid')).toEqual({
      homeName: 'FC Bayern',
      awayName: 'Real Madrid',
    })
  })

  it('recognizes "vs" without a trailing dot', () => {
    expect(detectFixtureTitle('FC Bayern vs Real Madrid')).toEqual({
      homeName: 'FC Bayern',
      awayName: 'Real Madrid',
    })
  })

  it('recognizes a colon as a separator', () => {
    expect(detectFixtureTitle('SV Nordstadt : TSV Süd')).toEqual({
      homeName: 'SV Nordstadt',
      awayName: 'TSV Süd',
    })
  })

  it('returns undefined for a title without a recognizable match pattern', () => {
    expect(detectFixtureTitle('Sommerfest im Vereinsheim')).toBeUndefined()
  })

  it('returns undefined for a single segment without a separator', () => {
    expect(detectFixtureTitle('Trainingslager')).toBeUndefined()
  })

  it('does not split on a hyphen inside a team name that has no surrounding whitespace', () => {
    // "Bad-Homburg" darf nicht selbst als Trenner gelesen werden -- der echte Trenner ist der
    // Gedankenstrich mit Leerraum davor und danach.
    expect(detectFixtureTitle('SV Bad-Homburg – TSV Süd')).toEqual({
      homeName: 'SV Bad-Homburg',
      awayName: 'TSV Süd',
    })
  })
})
