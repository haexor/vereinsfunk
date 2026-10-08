import { describe, expect, it } from 'vitest'
import { formatStatValue, matchOutcome, ownTeamTotals, playerSeasonRows, scoreLabel, seasonRecord, statLabel, teamStatsByCategory } from './playerboardVeo'

const stat = (teamAssociation: 'own' | 'opponent', statType: string, value: number, category = 'attacking') => ({ teamAssociation, statType, category, value })

describe('playerboardVeo', () => {
  it('labels and formats Veo values with units, playing time in minutes', () => {
    expect(statLabel('top_speed_kmh')).toBe('Höchstgeschw.')
    expect(statLabel('football_pass_accuracy_total')).toBe('pass accuracy')
    expect(formatStatValue('seconds_played_total', 4140)).toBe('69 min')
    expect(formatStatValue('distance_total_meters', 2382)).toBe('2.382 m')
    expect(formatStatValue('top_speed_kmh', 27.84)).toBe('27,8 km/h')
    expect(formatStatValue('sprints_total', 4)).toBe('4')
  })

  it('counts wins, draws and losses only for matches with a final score', () => {
    const matches = [
      { ownScore: 3, opponentScore: 1, teamStats: [] },
      { ownScore: 2, opponentScore: 2, teamStats: [] },
      { ownScore: 0, opponentScore: 1, teamStats: [] },
      { ownScore: null, opponentScore: null, teamStats: [] },
    ]
    expect(seasonRecord(matches)).toEqual({ games: 3, wins: 1, draws: 1, losses: 1, goalsFor: 5, goalsAgainst: 4 })
    expect(scoreLabel(matches[3]!)).toBe('–')
    expect(matchOutcome(matches[0]!)).toBe('win')
    expect(matchOutcome(matches[2]!)).toBe('loss')
  })

  it('pairs own and opponent values per category and sums the own side over the season', () => {
    const stats = [stat('own', 'football_goal_total', 2), stat('opponent', 'football_goal_total', 1), stat('own', 'football_foul_total', 3, 'discipline')]
    expect(teamStatsByCategory(stats)).toEqual([
      { category: 'attacking', rows: [{ statType: 'football_goal_total', own: 2, opponent: 1 }] },
      { category: 'discipline', rows: [{ statType: 'football_foul_total', own: 3, opponent: null }] },
    ])
    expect(ownTeamTotals([{ ownScore: 2, opponentScore: 1, teamStats: stats }, { ownScore: 1, opponentScore: 0, teamStats: [stat('own', 'football_goal_total', 1)] }]))
      .toEqual([{ statType: 'football_goal_total', value: 3 }, { statType: 'football_foul_total', value: 3 }])
  })

  it('sums player values, keeps the top speed maximum and averages the mean speed', () => {
    const player = (value: number, top: number, average: number) => ({
      key: 'p1', label: '#7 Anton Test', jerseyNumber: 7,
      stats: [
        { statType: 'sprints_total', category: 'physical', value },
        { statType: 'top_speed_kmh', category: 'physical', value: top },
        { statType: 'average_speed_kmh', category: 'physical', value: average },
      ],
    })
    const rows = playerSeasonRows([
      { players: [player(3, 25, 6), { key: 'p2', label: '#4', jerseyNumber: 4, stats: [] }] },
      { players: [player(5, 28, 8)] },
    ])
    expect(rows).toEqual([{ key: 'p1', label: '#7 Anton Test', jerseyNumber: 7, games: 2, values: { sprints_total: 8, top_speed_kmh: 28, average_speed_kmh: 7 } }])
  })
})
