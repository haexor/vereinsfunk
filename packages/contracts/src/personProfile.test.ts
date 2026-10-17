import { describe, expect, it } from 'vitest'
import { PersonProfileQuerySchema, PersonProfileSchema } from './index.js'

const PERSON_ID = '58000000-1000-4000-8000-000000000001'
const TEAM_ID = '58000000-2000-4000-8000-000000000001'
const PLAYER_ID = '58000000-3000-4000-8000-000000000001'

const team = {
  teamId: TEAM_ID, teamName: 'U13', playerId: PLAYER_ID, jerseyNumber: 7, position: 'Sturm', active: true, isSelf: false,
  rank: 1, total: 12, categories: [{ name: 'Einsatz', points: 12 }],
}

describe('person profile contract', () => {
  it('accepts a profile without the management fields', () => {
    const parsed = PersonProfileSchema.parse({ id: PERSON_ID, firstName: 'Ada', lastName: 'Arnold', status: 'active', teams: [team] })
    expect('email' in parsed).toBe(false)
    expect('hasAccount' in parsed).toBe(false)
  })

  it('accepts a profile for a person without any squad entry', () => {
    expect(PersonProfileSchema.safeParse({ id: PERSON_ID, firstName: 'Ada', lastName: 'Arnold', status: 'left', teams: [] }).success).toBe(true)
  })

  it('keeps the management fields when present', () => {
    const parsed = PersonProfileSchema.parse({ id: PERSON_ID, firstName: 'Ada', lastName: 'Arnold', status: 'active', teams: [], email: null, hasAccount: false })
    expect(parsed.email).toBeNull()
    expect(parsed.hasAccount).toBe(false)
  })

  it('never carries a birth year or a minor flag, even if the source sends them', () => {
    const parsed = PersonProfileSchema.parse({
      id: PERSON_ID, firstName: 'Ada', lastName: 'Arnold', status: 'active', teams: [], birthYear: 2014, isMinor: true,
    })
    expect(parsed).not.toHaveProperty('birthYear')
    expect(parsed).not.toHaveProperty('isMinor')
  })

  it('accepts a team entry without a rank for an inactive player without points', () => {
    expect(PersonProfileSchema.safeParse({ id: PERSON_ID, firstName: 'Ada', lastName: 'Arnold', status: 'inactive', teams: [{ ...team, active: false, rank: null, total: 0, categories: [] }] }).success).toBe(true)
  })

  it('rejects a jersey number outside 0 to 99', () => {
    expect(PersonProfileSchema.safeParse({ id: PERSON_ID, firstName: 'Ada', lastName: 'Arnold', status: 'active', teams: [{ ...team, jerseyNumber: 100 }] }).success).toBe(false)
  })

  it('defaults the period to the current season and rejects unknown periods', () => {
    expect(PersonProfileQuerySchema.parse({}).period).toBe('season')
    expect(PersonProfileQuerySchema.parse({ period: 'all' }).period).toBe('all')
    expect(PersonProfileQuerySchema.safeParse({ period: 'foo' }).success).toBe(false)
  })
})
