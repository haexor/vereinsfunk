import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PlayerboardVeoKeyMetricIdSchema } from '@vereinsfunk/contracts'
import { VEO_TEAM_KEY_METRICS } from '@vereinsfunk/domain'
import { describe, expect, it } from 'vitest'
import { filterFromQuery, filterToQuery, formatKeyMetric, keyMetricCaption, seasonFilter } from './playerboardVeoAnalytics'

const registry = readFileSync(join(import.meta.dirname, '../modules/registry.ts'), 'utf8')
const migration = readFileSync(join(import.meta.dirname, '../../../../supabase/migrations/2026102201_playerboard_veo_season.sql'), 'utf8')

describe('playerboardVeoAnalytics', () => {
  it('keeps the key metric catalogue the same in domain, contracts and the database', () => {
    const domain = VEO_TEAM_KEY_METRICS.map((metric) => metric.id)
    expect(domain).toEqual(PlayerboardVeoKeyMetricIdSchema.options)
    for (const id of domain) expect(migration).toContain(`'${id}'`)
  })

  it('starts with the last ten matches of every kind like Veo', () => {
    expect(filterFromQuery({})).toEqual({ mode: 'last', last: 10, from: '', to: '', kinds: [], fixtureIds: [] })
    expect(seasonFilter(filterFromQuery({}))).toEqual({ last: 10 })
    expect(filterToQuery(filterFromQuery({}))).toEqual({})
  })

  it('keeps the filter in the URL and back', () => {
    const range = filterFromQuery({ von: '2026-08-01', bis: '2026-10-31', art: 'match,cup,training' })
    expect(range).toMatchObject({ mode: 'range', from: '2026-08-01', to: '2026-10-31', kinds: ['match', 'cup'] })
    expect(filterToQuery(range)).toEqual({ von: '2026-08-01', bis: '2026-10-31', art: 'match,cup' })
    expect(seasonFilter(range)).toEqual({ from: '2026-08-01', to: '2026-10-31', kinds: ['match', 'cup'] })
    expect(filterToQuery(filterFromQuery({ anzahl: '5' }))).toEqual({ anzahl: '5' })
    expect(filterFromQuery({ anzahl: '7' }).last).toBe(10)
  })

  it('lets a selection of matches replace every other filter', () => {
    const selection = filterFromQuery({ spiele: 'a,b', art: 'cup', anzahl: '3' })
    expect(selection).toMatchObject({ mode: 'selection', fixtureIds: ['a', 'b'] })
    expect(seasonFilter(selection)).toEqual({ fixtureIds: ['a', 'b'] })
    expect(filterToQuery(selection)).toEqual({ spiele: 'a,b' })
  })

  it('formats key metrics with their unit and explains partial averages', () => {
    expect(formatKeyMetric('possession_percent', 51)).toBe('51 %')
    expect(formatKeyMetric('possession_minutes', 16.8)).toBe('16,8 min')
    expect(formatKeyMetric('goals_scored', 2.3)).toBe('2,3')
    expect(formatKeyMetric('goals_scored', null)).toBe('–')
    expect(keyMetricCaption({ id: 'shots_on_goal', value: 6, matchCount: 2 }, 3)).toBe('Durchschnitt Schüsse · aus 2 von 3 Spielen')
    expect(keyMetricCaption({ id: 'win_ratio', value: 33, matchCount: 3 }, 3)).toBe('Siegquote')
    expect(keyMetricCaption({ id: 'win_ratio', value: null, matchCount: 0 }, 3)).toBe('Noch kein Spiel mit Veo-Analyse.')
  })

  it('links Veo Analytics in the PlayerBoard sidebar', () => {
    expect(registry).toContain("{ label: 'Veo Analytics', to: '/playerboard/analytics', icon: BarChart3 }")
  })
})
