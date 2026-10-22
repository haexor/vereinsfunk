import { DEFAULT_MATCH_PLAYER_COLUMNS } from '@vereinsfunk/domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatPlayerMetric, matchPlayerRows, playerMetricHeader, playerRowName, playerRowSubtitle, readPlayerColumns, writePlayerColumns } from './playerboardVeoPlayers'

const PLAYER = '00000000-0000-4000-8000-000000000001'
const PERSON = '00000000-0000-4000-8000-000000000002'
const stat = (statType: string, value: number, periodValues: { period: number; value: number }[] = []) => ({ statType, category: 'attacking', value, periodValues })

describe('matchPlayerRows', () => {
  const players = [
    { jerseyNumber: 7, playerId: PLAYER, personId: PERSON, name: 'Ada Arnold', matchedManually: false, stats: [stat('football_goal_total', 2, [{ period: 1, value: 0 }, { period: 2, value: 2 }]), stat('matches_total', 1)] },
    { jerseyNumber: 12, playerId: null, personId: null, name: null, matchedManually: false, stats: [stat('football_attempts_total', 3)] },
    { jerseyNumber: 30, playerId: null, personId: null, name: null, matchedManually: false, stats: [stat('matches_total', 1), stat('football_goal_total', 0)] },
  ]

  it('builds one row per jersey with position and own row from the roster, without non-participants', () => {
    const rows = matchPlayerRows(players, [{ id: PLAYER, position: 'ST', isSelf: true }], null)
    expect(rows.map((row) => row.key)).toEqual(['jersey:7', 'jersey:12'])
    expect(rows[0]).toMatchObject({ name: 'Ada Arnold', position: 'ST', isSelf: true, personId: PERSON, values: { goals: 2, matches: 1 } })
    expect(rows[1]).toMatchObject({ name: null, position: null, isSelf: false, values: { total_attempts: 3, shots: 3 } })
  })

  it('uses the values of the chosen period', () => {
    const rows = matchPlayerRows(players, [], 1)
    // Halbzeit 1: Ada ohne Tor, ohne Halbzeitwerte faellt "Spiele" weg -- sie bleibt nur mit Position.
    expect(rows).toEqual([])
    expect(matchPlayerRows(players, [], 2)[0]?.values).toEqual({ goals: 2, goal_involvements: 2, total_events: 2 })
  })

  it('names jerseys without a player like Veo', () => {
    expect(playerRowName({ name: null, jerseyNumber: 12 })).toBe('Nummer 12')
    expect(playerRowSubtitle({ jerseyNumber: 7, position: 'IV' })).toBe('#7 · IV')
    expect(playerRowSubtitle({ jerseyNumber: null, position: null })).toBe('')
  })
})

describe('formatPlayerMetric', () => {
  it('formats with the unit of the metric and shows a missing value', () => {
    expect(formatPlayerMetric('distance_covered', 6.42)).toBe('6,4 km')
    expect(formatPlayerMetric('top_speed', 27)).toBe('27 km/h')
    expect(formatPlayerMetric('conversion_rate', 40)).toBe('40 %')
    expect(formatPlayerMetric('goals', 2, false)).toBe('2')
    expect(formatPlayerMetric('goals', undefined)).toBe('k. A.')
    expect(playerMetricHeader('minutes_played')).toBe('Erfasste Minuten (min)')
    expect(playerMetricHeader('goals')).toBe('Tore')
  })
})

describe('player columns in the browser storage', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads the stored choice and falls back to the default for broken or missing storage', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } })
    writePlayerColumns('columns', ['goals', 'assists'])
    expect(readPlayerColumns('columns', DEFAULT_MATCH_PLAYER_COLUMNS)).toEqual(['goals', 'assists'])
    store.set('columns', '{broken')
    expect(readPlayerColumns('columns', DEFAULT_MATCH_PLAYER_COLUMNS)).toEqual([...DEFAULT_MATCH_PLAYER_COLUMNS])
    store.set('columns', '["nope"]')
    expect(readPlayerColumns('columns', DEFAULT_MATCH_PLAYER_COLUMNS)).toEqual([...DEFAULT_MATCH_PLAYER_COLUMNS])

    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(readPlayerColumns('columns', ['goals'])).toEqual(['goals'])
    expect(() => writePlayerColumns('columns', ['goals'])).not.toThrow()
  })
})
