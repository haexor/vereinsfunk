import { describe, expect, it } from 'vitest'
import {
  comparePlayers,
  DEFAULT_LEADERBOARD_METRICS,
  DEFAULT_MATCH_PLAYER_COLUMNS,
  DEFAULT_SEASON_PLAYER_COLUMNS,
  isVeoParticipant,
  leaderboard,
  nextPlayerSort,
  PLAYER_CARD_PHYSICAL,
  PLAYER_CARD_SECTIONS,
  playerFocusTiles,
  playerMetricDefinition,
  playerMetricValues,
  playerStatsForPeriod,
  seasonPlayerRows,
  sortPlayerRows,
  validPlayerColumns,
  VEO_LEADERBOARD_METRICS,
  VEO_PLAYER_METRICS,
  veoPositionCode,
} from './veoPlayers.js'

const stat = (statType: string, value: number) => ({ statType, value })

describe('playerMetricValues', () => {
  it('maps the stored Veo stat types and derives what Veo derives (Inventar §2.0.3)', () => {
    const values = playerMetricValues([
      stat('football_goal_total', 2),
      stat('football_assist_total', 1),
      stat('football_attempts_total', 5),
      stat('football_passes_total', 40),
      stat('football_passes_completed_total', 31),
      stat('football_corner_total', 3),
      stat('football_foul_total', 1),
      stat('seconds_played_total', 2730),
      stat('distance_total_meters', 6420),
      stat('top_speed_kmh', 27.4),
    ])
    expect(values).toMatchObject({
      goals: 2,
      assists: 1,
      total_attempts: 5,
      shots: 3,
      passes_unsuccessful: 9,
      passes_success_rate: 78,
      goal_involvements: 3,
      conversion_rate: 40,
      // Vorlagen, Tore, Schuesse, Ecken und Fouls.
      total_events: 10,
      minutes_played: 46,
      distance_covered: 6.42,
      top_speed: 27.4,
    })
    expect(values.saves).toBeUndefined()
  })

  it('keeps values Veo sends and gives 0 % without attempts or passes', () => {
    const values = playerMetricValues([
      stat('football_shots_total', 4),
      stat('football_goal_total', 0),
      stat('football_attempts_total', 0),
      stat('football_passes_total', 0),
      stat('football_passes_completed_total', 0),
      stat('football_passes_unsuccessful_total', 2),
      stat('football_goal_involvement_total', 5),
      stat('football_conversion_rate', 0.25),
    ])
    expect(values).toMatchObject({ shots: 4, passes_unsuccessful: 2, passes_success_rate: 0, goal_involvements: 5, conversion_rate: 25 })
    expect(playerMetricValues([stat('football_attempts_total', 0)]).conversion_rate).toBe(0)
    expect(playerMetricValues([stat('sprints_total', 3)]).total_events).toBeUndefined()
  })

  it('takes the values of one period from periodValues', () => {
    const stats = [{ statType: 'football_goal_total', value: 3, periodValues: [{ period: 1, value: 1 }, { period: 2, value: 2 }] }, stat('sprints_total', 4)]
    expect(playerStatsForPeriod(stats, 2)).toEqual([{ statType: 'football_goal_total', value: 2 }])
    expect(playerStatsForPeriod(stats, null)).toHaveLength(2)
  })
})

describe('isVeoParticipant', () => {
  it('drops rows with nothing but zeros apart from matches and without a position', () => {
    expect(isVeoParticipant({ matches: 1, goals: 0 }, null)).toBe(false)
    expect(isVeoParticipant({ matches: 1, goals: 0 }, 'IV')).toBe(true)
    expect(isVeoParticipant({ matches: 1, sprints: 2 }, null)).toBe(true)
  })
})

describe('player table', () => {
  it('uses the default columns of Veo per match and across matches (Inventar §2.2, §2.1.2)', () => {
    expect(DEFAULT_MATCH_PLAYER_COLUMNS).toHaveLength(20)
    expect(DEFAULT_SEASON_PLAYER_COLUMNS).toEqual(['matches', 'total_attempts', 'goals', 'shots', 'conversion_rate', 'total_events', 'distance_covered', 'average_speed', 'sprints', 'minutes_played', 'high_intensity_runs'])
    for (const id of [...DEFAULT_MATCH_PLAYER_COLUMNS, ...DEFAULT_SEASON_PLAYER_COLUMNS, ...PLAYER_CARD_PHYSICAL, ...PLAYER_CARD_SECTIONS.flatMap((section) => section.metrics)]) {
      expect(playerMetricDefinition(id), id).not.toBeNull()
    }
    expect(new Set(VEO_PLAYER_METRICS.map((entry) => entry.id)).size).toBe(VEO_PLAYER_METRICS.length)
  })

  it('sorts names first, then jerseys, and numbers descending on the first click with missing values last', () => {
    const rows = [
      { name: null, jerseyNumber: 4, values: { goals: 3 } },
      { name: 'Ben', jerseyNumber: 9, values: {} },
      { name: 'Ada', jerseyNumber: 7, values: { goals: 1 } },
      { name: 'Ada', jerseyNumber: 2, values: { goals: 1 } },
    ]
    expect(sortPlayerRows(rows, { column: 'player', direction: 'asc' }).map((row) => row.jerseyNumber)).toEqual([2, 7, 9, 4])
    const sort = nextPlayerSort({ column: 'player', direction: 'asc' }, 'goals')
    expect(sort).toEqual({ column: 'goals', direction: 'desc' })
    expect(sortPlayerRows(rows, sort).map((row) => row.jerseyNumber)).toEqual([4, 2, 7, 9])
    expect(sortPlayerRows(rows, nextPlayerSort(sort, 'goals')).map((row) => row.jerseyNumber)).toEqual([2, 7, 4, 9])
    expect(nextPlayerSort({ column: 'goals', direction: 'desc' }, 'player')).toEqual({ column: 'player', direction: 'asc' })
  })

  it('falls back to the default columns when the stored choice is unusable', () => {
    expect(validPlayerColumns(['goals', 'nope', 'goals', 4], DEFAULT_SEASON_PLAYER_COLUMNS)).toEqual(['goals'])
    expect(validPlayerColumns('goals', DEFAULT_SEASON_PLAYER_COLUMNS)).toEqual([...DEFAULT_SEASON_PLAYER_COLUMNS])
    expect(validPlayerColumns([], DEFAULT_SEASON_PLAYER_COLUMNS)).toEqual([...DEFAULT_SEASON_PLAYER_COLUMNS])
  })
})

describe('player card', () => {
  it('reads the roster position as a Veo position code', () => {
    expect(veoPositionCode('TW')).toBe('GK')
    expect(veoPositionCode(' iv ')).toBe('CB')
    expect(veoPositionCode('Linksaußen')).toBe('LW')
    expect(veoPositionCode('ST / Kapitän')).toBe('ST')
    expect(veoPositionCode('Zehner')).toBe('AM')
    expect(veoPositionCode('Libero?')).toBeNull()
    expect(veoPositionCode(null)).toBeNull()
  })

  it('picks the four overview tiles by position and falls back like Veo (Inventar §2.3)', () => {
    expect(playerFocusTiles('TW')).toEqual(['goal_kicks', 'saves', 'passes_successful', 'recoveries'])
    expect(playerFocusTiles('Stürmer')).toEqual(['total_attempts', 'goals', 'assists', 'conversion_rate'])
    expect(playerFocusTiles('RV')).toEqual(playerFocusTiles('LV'))
    expect(playerFocusTiles(null)).toEqual(['distance_covered', 'top_speed', 'total_attempts', 'duels'])
  })
})

describe('season', () => {
  const ada = 'ada-id'
  const matches = [
    { players: [
      { jerseyNumber: 7, playerId: ada, personId: 'person-ada', name: 'Ada Arnold', stats: { football_goal_total: 2, football_attempts_total: 4, top_speed_kmh: 26, average_speed_kmh: 6, seconds_played_total: 3000, matches_total: 1 } },
      { jerseyNumber: 12, playerId: null, personId: null, name: null, stats: { football_goal_total: 1 } },
    ] },
    { players: [
      { jerseyNumber: 10, playerId: ada, personId: 'person-ada', name: 'Ada Arnold', stats: { football_goal_total: 1, football_attempts_total: 2, top_speed_kmh: 29, average_speed_kmh: 9, seconds_played_total: 1000, matches_total: 1 } },
      { jerseyNumber: 12, playerId: null, personId: null, name: null, stats: { football_goal_total: 0 } },
    ] },
  ]

  it('sums a player across changing jerseys and keeps unassigned jerseys apart (Inventar §2.1.2)', () => {
    const rows = seasonPlayerRows(matches)
    expect(rows.map((row) => row.key)).toEqual(['player:ada-id', 'jersey:12'])
    expect(rows[0]).toMatchObject({ jerseyNumber: 10, matchCount: 2, name: 'Ada Arnold' })
    expect(rows[0]?.values).toMatchObject({ goals: 3, total_attempts: 6, shots: 3, conversion_rate: 50, top_speed: 29, matches: 2, minutes_played: 67 })
    // 6 km/h ueber 3000 s und 9 km/h ueber 1000 s.
    expect(rows[0]?.values.average_speed).toBeCloseTo(6.75)
    expect(rows[1]?.values).toMatchObject({ goals: 1, matches: 2 })
  })

  it('ranks the top five above zero, sharing ranks on ties (Inventar §2.1.1)', () => {
    const rows = [
      { name: 'Ben', jerseyNumber: 9, values: { goals: 3 } },
      { name: 'Ada', jerseyNumber: 7, values: { goals: 3 } },
      { name: 'Cem', jerseyNumber: 4, values: { goals: 1 } },
      { name: 'Dana', jerseyNumber: 5, values: { goals: 0 } },
      { name: null, jerseyNumber: 12, values: {} },
    ]
    expect(leaderboard(rows, 'goals').map((entry) => [entry.rank, entry.row.name, entry.value])).toEqual([[1, 'Ada', 3], [1, 'Ben', 3], [3, 'Cem', 1]])
    expect(leaderboard(rows, 'saves')).toEqual([])
    expect(DEFAULT_LEADERBOARD_METRICS.every((id) => VEO_LEADERBOARD_METRICS.includes(id))).toBe(true)
    expect(VEO_LEADERBOARD_METRICS).not.toContain('passes_success_rate')
  })

  it('compares two players by group and marks the higher value (Inventar §2.1.5)', () => {
    const groups = comparePlayers({ goals: 3, matches: 2, top_speed: 25 }, { goals: 1, matches: 2 })
    expect(groups.map((group) => group.label)).toEqual(['Allgemein', 'Physis', 'Angriff'])
    expect(groups[0]?.rows).toEqual([{ id: 'matches', a: 2, b: 2, higher: null }])
    expect(groups[1]?.rows).toEqual([{ id: 'top_speed', a: 25, b: undefined, higher: 'a' }])
    expect(groups[2]?.rows).toEqual([{ id: 'goals', a: 3, b: 1, higher: 'a' }])
  })
})
