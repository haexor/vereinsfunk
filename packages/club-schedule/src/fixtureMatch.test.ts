import { planSync, resolveIcalDateTime } from '@vereinsfunk/integrations'
import { describe, expect, it } from 'vitest'
import { ExternalFixtureSchema } from './fixture.js'
import { createFixtureMatchStrategy, type FixtureLocal } from './fixtureMatch.js'
import type { ScheduleMatchContext } from './scheduleTime.js'

const TEAM_HOME = '11111111-1111-4111-8111-111111111111'
const TEAM_AWAY_KNOWN = '22222222-2222-4222-8222-222222222222'

function resolver(knownNames: Record<string, string>) {
  return { resolveTeamId: (name: string) => knownNames[name] }
}

// Ersatz fuer resolveScheduleDateTime der API: iCal-Kompaktform in Europe/Berlin, eine ISO-Spalte
// nur mit Offset -- genug, um zu zeigen, dass der Abgleich Instanzen statt Schreibweisen vergleicht.
const schedule: ScheduleMatchContext = {
  resolveDateTime: (rawValue, tzid) => {
    const ical = resolveIcalDateTime(rawValue, tzid, 'Europe/Berlin')
    if (ical) return ical
    return /(?:Z|[+-]\d{2}:\d{2})$/.test(rawValue) ? { iso: new Date(rawValue).toISOString(), confirmed: true } : undefined
  },
  now: new Date('2026-08-10T00:00:00Z'),
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
    const strategy = createFixtureMatchStrategy(resolver({ '2. Herren': TEAM_HOME }), schedule)
    const external = ExternalFixtureSchema.parse({ teamReference: '2. Herren', opponentName: 'TSV Süd', isHome: true })
    expect(strategy.fieldsOf(external)).toEqual({
      teamId: TEAM_HOME, opponentName: 'TSV Süd', isHome: true, competition: null,
    })
    expect(strategy.unknownStructureRefs?.(external)).toEqual([])
  })

  it('assigns isHome=true when the home-side iCal title name resolves to a known team', () => {
    const strategy = createFixtureMatchStrategy(resolver({ 'SV Nordstadt': TEAM_HOME }), schedule)
    const external = ExternalFixtureSchema.parse({ homeNameRaw: 'SV Nordstadt', awayNameRaw: 'TSV Süd' })
    expect(strategy.fieldsOf(external)).toEqual({
      teamId: TEAM_HOME, opponentName: 'TSV Süd', isHome: true, competition: null,
    })
  })

  it('assigns isHome=false when the away-side iCal title name resolves to a known team', () => {
    const strategy = createFixtureMatchStrategy(resolver({ 'TSV Süd': TEAM_AWAY_KNOWN }), schedule)
    const external = ExternalFixtureSchema.parse({ homeNameRaw: 'SV Nordstadt', awayNameRaw: 'TSV Süd' })
    expect(strategy.fieldsOf(external)).toEqual({
      teamId: TEAM_AWAY_KNOWN, opponentName: 'SV Nordstadt', isHome: false, competition: null,
    })
  })

  it('resolves neither side to an unknown-structure signal -- kein Raten', () => {
    const strategy = createFixtureMatchStrategy(resolver({}), schedule)
    const external = ExternalFixtureSchema.parse({ homeNameRaw: 'SV Nordstadt', awayNameRaw: 'TSV Süd' })
    expect(strategy.unknownStructureRefs?.(external)).toEqual(['SV Nordstadt', 'TSV Süd'])
    expect(strategy.fieldsOf(external)).toEqual({
      teamId: null, opponentName: null, isHome: null, competition: null,
    })
  })

  it('turns an unresolved iCal fixture into an unknown_structure conflict via planSync, never a guess', () => {
    const strategy = createFixtureMatchStrategy(resolver({}), schedule)
    const external = ExternalFixtureSchema.parse({ homeNameRaw: 'SV Nordstadt', awayNameRaw: 'TSV Süd' })
    const plan = planSync({ existing: [], incoming: [external], match: strategy, policy: { lossThresholdPercent: 30 } })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]?.kind).toBe('unknown_structure')
    expect(plan.created).toHaveLength(0)
  })

  it('detects a changed opponent between a resolved local fixture and an updated external row', () => {
    const strategy = createFixtureMatchStrategy(resolver({ '2. Herren': TEAM_HOME }), schedule)
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

describe('createFixtureMatchStrategy.identityOf', () => {
  it('prefers the external id when present', () => {
    const entity = ExternalFixtureSchema.parse({ externalId: 'ext-1', opponentName: 'TSV Süd' })
    expect(createFixtureMatchStrategy(resolver({}), schedule).identityOf(entity)).toEqual({ externalId: 'ext-1' })
  })

  it('falls back to a fuzzy key of opponent and kickoff time', () => {
    const entity = ExternalFixtureSchema.parse({ opponentName: 'TSV Süd', kickoffAt: '2026-08-15T15:00:00Z' })
    expect(createFixtureMatchStrategy(resolver({}), schedule).identityOf(entity)).toEqual({ fuzzy: ['tsv süd', String(Date.parse('2026-08-15T15:00:00Z'))] })
  })
})

describe('createFixtureMatchStrategy kickoff comparison', () => {
  it('finds the fuzzy candidate for a re-imported kickoff written with an offset instead of planning create plus retire', () => {
    const external = ExternalFixtureSchema.parse({ teamReference: '2. Herren', opponentName: 'TSV Süd', kickoffAt: '2026-08-15T17:00:00+02:00' })
    const plan = planSync({
      existing: [localFixture()],
      incoming: [external],
      match: createFixtureMatchStrategy(resolver({ '2. Herren': TEAM_HOME }), schedule),
      policy: { lossThresholdPercent: 30 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.created).toHaveLength(0)
    expect(plan.retired).toHaveLength(0)
    expect(plan.conflicts[0]?.kind).toBe('ambiguous_match')
  })

  it('reads a floating iCal kickoff in the club time zone, not as UTC', () => {
    const external = ExternalFixtureSchema.parse({ externalId: 'ext-1', teamReference: '2. Herren', opponentName: 'TSV Süd', kickoffAt: '20260815T170000' })
    const fields = createFixtureMatchStrategy(resolver({ '2. Herren': TEAM_HOME }), schedule).fieldsOf(external)
    expect(fields.kickoffAt).toBe(Date.parse('2026-08-15T15:00:00Z'))
  })
})

describe('createFixtureMatchStrategy retirement', () => {
  it('leaves cancelled, played and past fixtures out of retirement and the loss threshold -- a feed rolling to a new season is no mass cancellation', () => {
    const plan = planSync({
      existing: [
        localFixture({ id: 'future', externalId: 'ext-future', kickoffAt: new Date('2026-08-15T15:00:00Z') }),
        localFixture({ id: 'cancelled', externalId: 'ext-cancelled', status: 'cancelled' }),
        localFixture({ id: 'played', externalId: 'ext-played', status: 'played', homeScore: 2, awayScore: 1 }),
        localFixture({ id: 'past', externalId: 'ext-past', kickoffAt: new Date('2026-05-01T15:00:00Z') }),
      ],
      incoming: [ExternalFixtureSchema.parse({ externalId: 'ext-future', teamReference: '2. Herren', opponentName: 'TSV Süd' })],
      match: createFixtureMatchStrategy(resolver({ '2. Herren': TEAM_HOME }), schedule),
      policy: { lossThresholdPercent: 30 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.retired).toHaveLength(0)
  })

  it('still retires an upcoming fixture that vanished from the source', () => {
    const plan = planSync({
      existing: [localFixture({ kickoffAt: new Date('2026-08-15T15:00:00Z') })],
      incoming: [],
      match: createFixtureMatchStrategy(resolver({}), schedule),
      policy: { lossThresholdPercent: 100 },
    })
    expect(plan.aborted).toBe(false)
    if (plan.aborted) return
    expect(plan.retired.map((local) => local.id)).toEqual(['local-1'])
  })
})

describe('createFixtureMatchStrategy.labelOf', () => {
  it('labels an iCal fixture by its raw title names instead of "Spiel ohne Gegner"', () => {
    const external = ExternalFixtureSchema.parse({ homeNameRaw: 'SV Nordstadt', awayNameRaw: 'TSV Süd' })
    expect(createFixtureMatchStrategy(resolver({}), schedule).labelOf(external)).toBe('SV Nordstadt – TSV Süd')
  })
})
