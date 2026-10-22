import { describe, expect, it } from 'vitest'
import type { VeoPassPossessionInput } from './veoMetrics.js'
import {
  DEFAULT_KEY_METRICS,
  DEFAULT_RADAR_METRICS,
  defaultRadarRanges,
  keyMetricDefinition,
  matchKeyMetrics,
  matchResult,
  progressionTicks,
  radarAxes,
  recentForm,
  seasonKeyMetrics,
  seasonThirdPercents,
  VEO_TEAM_KEY_METRICS,
  type VeoSeasonMatchInput,
} from './veoSeason.js'

const stat = (teamAssociation: 'own' | 'opponent', statType: string, value: number) => ({ teamAssociation, statType, value, periodValues: [] })

const side = (possessionSeconds: number, passStrings: [number, number][], passThirds: [number, number, number], possessionThirds: [number, number, number]) => ({
  possessionSeconds, passesCompleted: 50, possessionWon: 20, passStrings,
  passThirds: { defensive: passThirds[0], middle: passThirds[1], attacking: passThirds[2] },
  possessionThirds: { defensive: possessionThirds[0], middle: possessionThirds[1], attacking: possessionThirds[2] },
})

const passPossession: VeoPassPossessionInput[] = [
  // Halbzeit 1: 40 % Ballbesitz, Halbzeit 2: 61 % -> Mittel 50,5 (Veo mittelt die Halbzeiten).
  { periodNumber: 1, durationS: 2700, own: side(400, [[2, 9], [3, 4], [6, 1]], [10, 70, 20], [30, 50, 20]), opponent: side(600, [], [5, 5, 0], [1, 1, 1]) },
  { periodNumber: 2, durationS: 2700, own: side(610, [[5, 2], [11, 1]], [0, 30, 10], [10, 30, 0]), opponent: side(390, [], [0, 0, 0], [0, 0, 0]) },
]

const match = (overrides: Partial<VeoSeasonMatchInput> = {}): VeoSeasonMatchInput => ({
  fixtureId: 'f1', kickoffAt: '2026-09-05T10:00:00Z', ownScore: 2, opponentScore: 1,
  teamStats: [
    stat('own', 'football_goal_total', 2), stat('opponent', 'football_goal_total', 1),
    stat('own', 'football_shots_total', 6), stat('opponent', 'football_shots_total', 4),
    stat('own', 'football_corner_total', 3), stat('own', 'football_goal_kick_total', 7), stat('own', 'football_tackle_total', 10),
  ],
  passPossession,
  ...overrides,
})

describe('VEO_TEAM_KEY_METRICS', () => {
  it('holds the 35 metrics of Veo in its groups and knows the defaults', () => {
    expect(VEO_TEAM_KEY_METRICS).toHaveLength(35)
    expect(new Set(VEO_TEAM_KEY_METRICS.map((entry) => entry.id)).size).toBe(35)
    expect(VEO_TEAM_KEY_METRICS.filter((entry) => entry.group === 'combos').map((entry) => entry.id)).toEqual([
      'shots_to_goal_conversion_rate', 'total_attempts', 'total_attempts_conceded', 'attacking_events', 'defensive_events', 'win_ratio',
    ])
    expect([...DEFAULT_KEY_METRICS, ...DEFAULT_RADAR_METRICS].every((id) => keyMetricDefinition(id) !== null)).toBe(true)
    expect(keyMetricDefinition('shots_on_goal')).toMatchObject({ label: 'Schüsse', description: 'Schüsse, die kein Tor wurden' })
    expect(keyMetricDefinition('expected_goals')).toBeNull()
  })
})

describe('matchKeyMetrics', () => {
  it('derives possession, passes and pass strings of the own team like Veo', () => {
    const values = matchKeyMetrics(match())
    expect(values).toMatchObject({
      passes_completed: 100, possession_won: 40, possession_percent: 50.5,
      longest_pass_string: 11, three_to_five_passes: 6, six_or_more_passes: 2,
      // Paesse: 10/100/30 von 140; Ballbesitz: 40/80/20 von 140.
      pass_location_in_defensive_third: 7, pass_location_in_middle_third: 71, pass_location_in_attacking_third: 21,
      possession_location_in_defensive_third: 29, possession_location_in_middle_third: 57, possession_location_in_attacking_third: 14,
    })
    expect(values.possession_minutes).toBeCloseTo(1010 / 60)
  })

  it('derives the events and combos, with total attempts from goals and shots when Veo does not deliver them', () => {
    expect(matchKeyMetrics(match())).toMatchObject({
      goals_scored: 2, goals_conceded: 1, shots_on_goal: 6, shots_conceded: 4, kick_corner: 3, kick_goalie: 7, tackles: 10, foul: 0,
      total_attempts: 8, total_attempts_conceded: 5, shots_to_goal_conversion_rate: 25,
      // eigene: Tor 2 + Ecken 3 + Abschluesse 8 + Tacklings 10; Abstoesse zaehlen nicht.
      attacking_events: 23, defensive_events: 6, win_ratio: 100,
    })
  })

  it('leaves out what Veo did not deliver', () => {
    const values = matchKeyMetrics(match({ teamStats: [], passPossession: null, ownScore: null, opponentScore: null }))
    expect(values).toEqual({})
  })
})

describe('seasonKeyMetrics', () => {
  it('averages each metric over the matches that deliver it and rounds like Veo', () => {
    const season = seasonKeyMetrics([
      match(),
      match({ fixtureId: 'f2', ownScore: 1, opponentScore: 1, passPossession: null }),
      match({ fixtureId: 'f3', ownScore: 0, opponentScore: 3, teamStats: [], passPossession: null }),
    ])
    expect(season.get('goals_scored')).toEqual({ id: 'goals_scored', value: 1, matchCount: 3 })
    expect(season.get('win_ratio')).toEqual({ id: 'win_ratio', value: 33, matchCount: 3 })
    // Nur ein Spiel hat Ballbesitz: kein Durchschnitt ueber Spiele ohne Wert.
    expect(season.get('possession_percent')).toEqual({ id: 'possession_percent', value: 51, matchCount: 1 })
    expect(season.get('shots_on_goal')).toEqual({ id: 'shots_on_goal', value: 6, matchCount: 2 })
    expect(season.get('total_attempts')?.value).toBe(8)
    expect(seasonKeyMetrics([]).get('goals_scored')).toEqual({ id: 'goals_scored', value: null, matchCount: 0 })
  })

  it('averages the rounded third shares per match', () => {
    expect(seasonThirdPercents([match(), match({ passPossession: [passPossession[1]!] })], 'own', 'pass')).toEqual({ defensive: 4, middle: 73, attacking: 23 })
    expect(seasonThirdPercents([match({ passPossession: null })], 'opponent', 'possession')).toBeNull()
  })
})

describe('progression, form and radar', () => {
  it('divides the axis into seven round ticks', () => {
    expect(progressionTicks(5)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(progressionTicks(57)).toEqual([0, 10, 20, 30, 40, 50, 60])
    expect(progressionTicks(13)).toEqual([0, 2.5, 5, 7.5, 10, 12.5, 15])
    expect(progressionTicks(0)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1, 1.2])
  })

  it('lists the results of the last three matches before a kickoff, newest first', () => {
    const matches = [
      match({ fixtureId: 'a', kickoffAt: '2026-09-01T10:00:00Z', ownScore: 1, opponentScore: 0 }),
      match({ fixtureId: 'b', kickoffAt: '2026-09-08T10:00:00Z', ownScore: 1, opponentScore: 1 }),
      match({ fixtureId: 'c', kickoffAt: '2026-09-15T10:00:00Z', ownScore: 0, opponentScore: 2 }),
      match({ fixtureId: 'd', kickoffAt: '2026-09-22T10:00:00Z', ownScore: null, opponentScore: null }),
      match({ fixtureId: 'e', kickoffAt: '2026-09-29T10:00:00Z' }),
    ]
    expect(recentForm(matches, '2026-09-29T10:00:00Z')).toEqual([{ fixtureId: 'c', result: 'loss' }, { fixtureId: 'b', result: 'draw' }, { fixtureId: 'a', result: 'win' }])
    expect(matchResult({ ownScore: null, opponentScore: 1 })).toBeNull()
  })

  it('normalises each radar axis to the larger of both values times 0.9', () => {
    const own = new Map([['goals_scored', { id: 'goals_scored', value: 2, matchCount: 3 }], ['win_ratio', { id: 'win_ratio', value: 0, matchCount: 3 }]])
    const comparing = new Map([['goals_scored', { id: 'goals_scored', value: 4, matchCount: 2 }]])
    expect(radarAxes(['goals_scored', 'win_ratio', 'saves'], own, comparing)).toEqual([
      { id: 'goals_scored', own: 2, comparing: 4, ownRadius: 0.45, comparingRadius: 0.9 },
      { id: 'win_ratio', own: 0, comparing: null, ownRadius: 0, comparingRadius: 0 },
      { id: 'saves', own: null, comparing: null, ownRadius: 0, comparingRadius: 0 },
    ])
    expect(radarAxes(['goals_scored'], own, null)[0]).toMatchObject({ ownRadius: 0.9, comparing: null })
  })

  it('compares the last 30 days with the 30 days before by default', () => {
    expect(defaultRadarRanges(new Date('2026-10-22T08:00:00Z'))).toEqual({ ownRange: ['2026-09-23', '2026-10-22'], comparingRange: ['2026-08-24', '2026-09-22'] })
  })
})
