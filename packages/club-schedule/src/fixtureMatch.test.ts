import { planSync } from '@vereinsfunk/integrations'
import { describe, expect, it } from 'vitest'
import { ExternalFixtureSchema } from './fixture.js'
import { createFixtureMatchStrategy, type FixtureLocal } from './fixtureMatch.js'

const TEAM_HOME = '11111111-1111-4111-8111-111111111111'
const TEAM_AWAY_KNOWN = '22222222-2222-4222-8222-222222222222'

function resolver(knownNames: Record<string, string>) {
  return { resolveTeamId: (name: string) => knownNames[name] }
}

function localFixture(overrides: Partial<FixtureLocal> = {}): FixtureLocal {
  return {
    id: 'local-1',
    externalId: 'ext-1',
    sourceId: 'source-1',
    teamId: TEAM_HOME,
    isHome: true,
    ownTeamLabel: 'SV Nordstadt 1921 II',
    opponentName: 'TSV Süd',
    competition: 'Kreisliga A',
    kickoffAt: new Date('2026-08-15T15:00:00Z'),
    kickoffTimeConfirmed: true,
    venueName: 'Sportplatz Nord',
    venueAddress: null,
    status: 'scheduled',
    homeScore: null,
    awayScore: null,
    note: null,
    sourceUpdatedAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  }
}

describe('createFixtureMatchStrategy team resolution', () => {
  it('resolves teamId directly from an explicit teamReference (file-style row)', () => {
    const strategy = createFixtureMatchStrategy(resolver({ '2. Herren': TEAM_HOME }))
    const external = ExternalFixtureSchema.parse({ teamReference: '2. Herren', opponentName: 'TSV Süd', isHome: true })
    expect(strategy.fieldsOf(external)).toEqual({
      teamId: TEAM_HOME, opponentName: 'TSV Süd', isHome: true, competition: null, kickoffAt: null,
    })
    expect(strategy.unknownStructureRefs?.(external)).toEqual([])
  })

  it('assigns isHome=true when the home-side iCal title name resolves to a known team', () => {
    const strategy = createFixtureMatchStrategy(resolver({ 'SV Nordstadt': TEAM_HOME }))
    const external = ExternalFixtureSchema.parse({ homeNameRaw: 'SV Nordstadt', awayNameRaw: 'TSV Süd' })
    expect(strategy.fieldsOf(external)).toEqual({
      teamId: TEAM_HOME, opponentName: 'TSV Süd', isHome: true, competition: null, kickoffAt: null,
    })
  })

  it('assigns isHome=false when the away-side iCal title name resolves to a known team', () => {
    const strategy = createFixtureMatchStrategy(resolver({ 'TSV Süd': TEAM_AWAY_KNOWN }))
    const external = ExternalFixtureSchema.parse({ homeNameRaw: 'SV Nordstadt', awayNameRaw: 'TSV Süd' })
    expect(strategy.fieldsOf(external)).toEqual({
      teamId: TEAM_AWAY_KNOWN, opponentName: 'SV Nordstadt', isHome: false, competition: null, kickoffAt: null,
    })
  })

  it('resolves neither side to an unknown-structure signal -- kein Raten', () => {
    const strategy = createFixtureMatchStrategy(resolver({}))
    const external = ExternalFixtureSchema.parse({ homeNameRaw: 'SV Nordstadt', awayNameRaw: 'TSV Süd' })
    expect(strategy.unknownStructureRefs?.(external)).toEqual(['SV Nordstadt', 'TSV Süd'])
    expect(strategy.fieldsOf(external)).toEqual({
      teamId: null, opponentName: null, isHome: null, competition: null, kickoffAt: null,
    })
  })

  it('turns an unresolved iCal fixture into an unknown_structure conflict via planSync, never a guess', () => {
    const strategy = createFixtureMatchStrategy(resolver({}))
    const external = ExternalFixtureSchema.parse({ homeNameRaw: 'SV Nordstadt', awayNameRaw: 'TSV Süd' })
    const plan = planSync({ existing: [], incoming: [external], match: strategy, policy: { lossThresholdPercent: 30 } })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]?.kind).toBe('unknown_structure')
    expect(plan.created).toHaveLength(0)
  })

  it('detects a changed opponent between a resolved local fixture and an updated external row', () => {
    const strategy = createFixtureMatchStrategy(resolver({ '2. Herren': TEAM_HOME }))
    const external = ExternalFixtureSchema.parse({
      externalId: 'ext-1', teamReference: '2. Herren', opponentName: 'TSV Nord', isHome: true,
      competition: 'Kreisliga A', kickoffAt: '20260815T150000Z', sourceUpdatedAt: '2026-08-05T00:00:00Z',
    })
    const plan = planSync({
      existing: [localFixture()],
      incoming: [external],
      match: strategy,
      policy: { lossThresholdPercent: 30 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.updated).toHaveLength(1)
    // kickoffAt bleibt trotz Formatwechsel unveraendert (iCal-Kompaktform hier, ISO bei
    // localFixture()) -- nur der tatsaechliche Unterschied (opponentName) darf erscheinen.
    expect(plan.updated[0]?.changedFields).toEqual(['opponentName'])
  })
})
