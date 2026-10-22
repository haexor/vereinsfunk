import { describe, expect, it } from 'vitest'
import {
  comparisonRows,
  comparisonShares,
  matchMinute,
  momentumSeries,
  passStringSummary,
  shotsFromEvents,
  shotSummary,
  thirdShares,
  type VeoEventInput,
  type VeoPassPossessionInput,
} from './veoMetrics.js'

const periods = [
  { number: 1, startS: 537, endS: 3262, ownSide: 'right' as const },
  { number: 2, startS: 3976, endS: 6678, ownSide: 'left' as const },
]

const stat = (teamAssociation: 'own' | 'opponent', statType: string, first: number, second: number) => ({
  teamAssociation, statType, value: first + second, periodValues: [{ period: 1, value: first }, { period: 2, value: second }],
})

const side = (possessionSeconds: number, passesCompleted: number, passStrings: [number, number][], thirds: [number, number, number]) => ({
  possessionSeconds, passesCompleted, possessionWon: 10, passStrings,
  passThirds: { defensive: thirds[0], middle: thirds[1], attacking: thirds[2] },
  possessionThirds: { defensive: thirds[0] * 10, middle: thirds[1] * 10, attacking: thirds[2] * 10 },
})

// Werte aus dem lokalen Abgleich der C1 (Spiel vom 23.09., 7:5), Ketten gekuerzt.
const passPossession: VeoPassPossessionInput[] = [
  { periodNumber: 1, durationS: 2725, own: side(400.133, 99, [[2, 16], [3, 9], [4, 1]], [8, 82, 9]), opponent: side(533.5, 132, [[3, 9], [6, 1], [7, 1]], [8, 112, 12]) },
  { periodNumber: 2, durationS: 2702, own: side(478.378, 114, [[3, 6], [5, 1], [12, 1]], [1, 100, 13]), opponent: side(873.706, 192, [[3, 15], [9, 1]], [12, 166, 14]) },
]

const event = (id: string, eventType: string, teamAssociation: 'own' | 'opponent', videoTimeMs: number, location: [number, number] | null = null, jerseyNumber: number | null = 7): VeoEventInput => ({
  id, eventType, teamAssociation, jerseyNumber, playerId: null, periodNumber: 1, periodTimeMs: videoTimeMs - 537_000, videoTimeMs,
  x: location?.[0] ?? null, y: location?.[1] ?? null, assistJerseyNumber: null,
})

describe('comparisonRows', () => {
  const teamStats = [
    stat('own', 'football_goal_total', 4, 3), stat('opponent', 'football_goal_total', 1, 4),
    stat('own', 'football_shots_total', 7, 8), stat('opponent', 'football_shots_total', 11, 12),
    stat('own', 'football_corner_total', 2, 2), stat('opponent', 'football_corner_total', 4, 2),
  ]

  it('derives total attempts from goals and shots without a goal and orders the rows like Veo', () => {
    const rows = comparisonRows(teamStats, passPossession, null)
    expect(rows.map((entry) => entry.key)).toEqual([
      'football_goal_total', 'football_attempts_total', 'football_shots_total',
      'possession_percent', 'possession_minutes', 'passes_completed', 'possession_won', 'football_corner_total',
    ])
    expect(rows[1]).toMatchObject({ own: 22, opponent: 28, losing: 'own' })
    expect(rows[0]).toMatchObject({ own: 7, opponent: 5, losing: 'opponent' })
  })

  it('keeps the attempts Veo delivers', () => {
    const rows = comparisonRows([...teamStats, stat('own', 'football_attempts_total', 11, 11)], null, null)
    expect(rows.find((entry) => entry.key === 'football_attempts_total')).toMatchObject({ own: 22, opponent: 0 })
  })

  it('rounds possession per side and shows the time out of possession in minutes', () => {
    const rows = comparisonRows([], passPossession, null)
    // eigene 878,5 s, Gegner 1407,2 s von 5427 s
    expect(rows.find((entry) => entry.key === 'possession_percent')).toMatchObject({ own: 38, opponent: 62, unit: 'percent' })
    expect(rows.find((entry) => entry.key === 'possession_minutes')).toMatchObject({ own: 15, opponent: 23, unassigned: 52, unit: 'minutes' })
    expect(rows.find((entry) => entry.key === 'passes_completed')).toMatchObject({ own: 213, opponent: 324 })
  })

  it('uses the values of one period and 0 where a period has none', () => {
    const rows = comparisonRows([...teamStats, { teamAssociation: 'own' as const, statType: 'football_penalty_total', value: 1, periodValues: [{ period: 1, value: 1 }] }], passPossession, 2)
    expect(rows.find((entry) => entry.key === 'football_goal_total')).toMatchObject({ own: 3, opponent: 4 })
    expect(rows.find((entry) => entry.key === 'football_penalty_total')).toMatchObject({ own: 0, opponent: 0, losing: null })
    expect(rows.find((entry) => entry.key === 'possession_percent')).toMatchObject({ own: 35, opponent: 65 })
  })

  it('splits a bar into own, out of possession and opponent', () => {
    const shares = comparisonShares({ own: 15, opponent: 23, unassigned: 52 })
    expect(shares.own).toBeCloseTo(16.67, 1)
    expect(shares.opponent).toBeCloseTo(25.56, 1)
    expect(shares.unassigned).toBeCloseTo(57.78, 1)
    expect(comparisonShares({ own: 0, opponent: 0, unassigned: null })).toEqual({ own: 0, unassigned: 0, opponent: 0 })
  })
})

describe('shotsFromEvents and shotSummary', () => {
  const events = [
    event('s1', 'FootballShot', 'own', 1_000_000, [0.9, 0.5]),
    event('g1', 'FootballGoal', 'own', 1_000_700, null, 9),
    event('s2', 'FootballShot', 'own', 1_100_000, [0.7, 0.5]),
    event('s3', 'FootballShot', 'opponent', 1_200_000, [0.95, 0.4]),
    // 11 s nach dem Schuss: kein Zusammenhang mehr.
    event('g2', 'FootballGoal', 'opponent', 1_211_000),
    event('s4', 'FootballShot', 'own', 1_300_000),
  ]

  it('merges a goal with the shot of the same team up to 10 s before it and takes the shot location', () => {
    const shots = shotsFromEvents(events)
    expect(shots.map((shot) => [shot.id, shot.goal])).toEqual([['g1', true], ['s2', false], ['s3', false], ['g2', true], ['s4', false]])
    expect(shots[0]).toMatchObject({ x: 0.9, y: 0.5, jerseyNumber: 9, videoTimeMs: 1_000_700 })
    expect(shots.find((shot) => shot.id === 'g2')).toMatchObject({ x: null, y: null })
  })

  it('counts goals, shots without a goal and total attempts with conversion rates inside and outside the box', () => {
    const own = shotsFromEvents(events).filter((shot) => shot.team === 'own')
    expect(shotSummary(own)).toEqual({
      goals: 1, shots: 2, total: 3, conversionRate: 33,
      // im Strafraum: g1; ausserhalb: s2; s4 ohne Ort zaehlt nur in den Gesamtzahlen.
      insideBoxConversionRate: 100, outsideBoxConversionRate: 0, insideBoxShare: 50, outsideBoxShare: 50,
    })
    expect(shotSummary([])).toMatchObject({ total: 0, conversionRate: null, insideBoxShare: null })
  })
})

describe('thirdShares', () => {
  it('gives the share of passes and possession per third from the team view, per period or summed', () => {
    const passes = thirdShares(passPossession, 'own', null, 'pass')!
    expect(passes.middle).toBeCloseTo(182 / 213)
    expect(passes.defensive + passes.middle + passes.attacking).toBeCloseTo(1)
    expect(thirdShares(passPossession, 'opponent', 1, 'possession')).toEqual({ defensive: 80 / 1320, middle: 1120 / 1320, attacking: 120 / 1320 })
    expect(thirdShares(null, 'own', null, 'pass')).toBeNull()
  })
})

describe('passStringSummary', () => {
  it('counts strings from three passes, groups ten and more and merges the periods by length', () => {
    const own = passStringSummary(passPossession, 'own', null)
    expect(own.bars).toEqual([
      { length: 3, count: 15 }, { length: 4, count: 1 }, { length: 5, count: 1 }, { length: 6, count: 0 },
      { length: 7, count: 0 }, { length: 8, count: 0 }, { length: 9, count: 0 }, { length: 10, count: 1 },
    ])
    expect(own).toMatchObject({ threeToFive: 17, sixOrMore: 1, longest: 12 })
    expect(passStringSummary(passPossession, 'opponent', 1)).toMatchObject({ threeToFive: 9, sixOrMore: 2, longest: 7 })
    expect(passStringSummary(null, 'own', null)).toMatchObject({ threeToFive: 0, longest: null })
  })
})

describe('momentumSeries', () => {
  const raw: [number, number | null][] = [[100, 0.4], [600, 0.5], [700, -0.2], [3500, 0.3], [4000, 0.6], [4100, null]]

  it('turns the sign towards the home team and leaves gaps outside the periods', () => {
    // Eigene Mannschaft zu Hause verteidigt in Halbzeit 1 rechts: Veo dreht das Vorzeichen.
    expect(momentumSeries(raw, periods, true).points).toEqual([[100, null], [600, -0.5], [700, 0.2], [3500, null], [4000, 0.6], [4100, null]])
    expect(momentumSeries(raw, periods, false).points).toEqual([[100, null], [600, 0.5], [700, -0.2], [3500, null], [4000, -0.6], [4100, null]])
  })

  it('reports the share of action on either side', () => {
    expect(momentumSeries(raw, periods, true)).toMatchObject({ homeShare: 67, awayShare: 33 })
    expect(momentumSeries([], periods, true)).toMatchObject({ homeShare: null, awayShare: null })
  })
})

describe('matchMinute', () => {
  it('counts from minute 1 and continues the second period after the first one', () => {
    expect(matchMinute(periods, 1, 0)).toBe(1)
    expect(matchMinute(periods, 1, 125_499)).toBe(3)
    // Halbzeit 1 dauert 2725 s = 45:25
    expect(matchMinute(periods, 2, 0)).toBe(46)
    expect(matchMinute(periods, 2, 60_000)).toBe(47)
  })
})
