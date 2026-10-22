import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { VeoError, type FetchLike, type VeoPlayerStats } from '@vereinsfunk/veo-client'
import { describe, expect, it } from 'vitest'
import { buildVeoAnalysis, mapPassPossession, type VeoAnalysisDeps } from './veoAnalysisSync.js'

// Anonymisierte Veo-Antworten aus dem Testabruf (packages/veo-client/src/__fixtures__/README.md).
const FIXTURES = join(import.meta.dirname, '../../../packages/veo-client/src/__fixtures__')
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Je Endpunkt die passende Testdatei; `overrides` ersetzt einzelne Antworten.
const ROUTES: [RegExp, string][] = [
  [/\/feature-processing-status\/$/, 'feature-processing-status.json'],
  [/\/periods\/$/, 'periods.json'],
  [/\/recordings\/[^/]+\/analytics$/, 'ras-analytics.json'],
  [/\/recordings\/[^/]+\/match-details$/, 'ras-match-details.json'],
  [/\/match-events$/, 'match-events.json'],
  [/\/analysis\/player-heatmaps\/$/, 'analysis-player-heatmaps.json'],
  [/\/match-momentum$/, 'match-momentum.json'],
  [/\/passing-network$/, 'passing-network.json'],
  [/\/match-report\/$/, 'match-report.json'],
  [/\/player-tracking$/, 'player-tracking.json'],
  [/\/api\/app\/matches\/[^/]+\/$/, 'match-detail.json'],
]

function veoFetch(overrides: Record<string, () => Response> = {}) {
  const calls: URL[] = []
  const fetch: FetchLike = async (input) => {
    const url = new URL(input)
    calls.push(url)
    const route = ROUTES.find(([pattern]) => pattern.test(url.pathname))
    if (!route) throw new Error(`unexpected Veo call ${url.pathname}`)
    const override = overrides[route[1]]
    return override ? override() : json(fixture(route[1]))
  }
  return { fetch, calls }
}

function deps(fetch: FetchLike): VeoAnalysisDeps & { pauses: number } {
  const state = { pauses: 0 }
  return Object.assign(state, {
    retry: <T>(attempt: () => Promise<T>) => attempt(),
    pause: async () => { state.pauses += 1 },
    http: { fetch },
  })
}

const players: VeoPlayerStats[] = [{ jerseyNumber: 1, stats: [{ statType: 'seconds_played_total', category: 'physical', value: 4100, periodValues: [{ period: 1, value: 1968 }, { period: 2, value: 2132 }] }] }]
const request = { accessToken: 'token', veoMatchId: 'm', veoTeamId: 't', fetchTracks: true, players }

describe('buildVeoAnalysis', () => {
  it('builds a complete package with normalised locations, heatmaps per period, passes and tracks', async () => {
    const { fetch, calls } = veoFetch()
    const dependencies = deps(fetch)
    const analysis = await buildVeoAnalysis(request, dependencies)

    expect(analysis).toMatchObject({ status: 'complete', analyticsVersion: '2', veoMatchSlug: 'example-slug' })
    expect(analysis.periods.map((period) => [period.number, period.ownSide])).toEqual([[1, 'left'], [2, 'right']])
    expect(analysis.events.some((event) => event.eventType === 'possession' || event.eventType.endsWith('_target'))).toBe(false)
    // Testabruf: eigene Schuesse liegen in Halbzeit 2 roh bei x ~ 0,24; normiert greift die eigene Mannschaft nach rechts an.
    const ownShotsSecondHalf = analysis.events.filter((event) => event.teamAssociation === 'own' && event.periodNumber === 2 && event.eventType === 'FootballShot' && event.x !== null)
    expect(ownShotsSecondHalf.length).toBeGreaterThan(0)
    expect(ownShotsSecondHalf.reduce((sum, event) => sum + event.x!, 0) / ownShotsSecondHalf.length).toBeGreaterThan(0.5)
    expect(analysis.events.find((event) => event.eventType === 'pass')).toMatchObject({ endX: expect.any(Number), endY: expect.any(Number) })

    expect(new Set(analysis.heatmaps.map((heatmap) => heatmap.periodNumber))).toEqual(new Set([0, 1, 2]))
    expect(analysis.heatmaps.find((heatmap) => heatmap.jerseyNumber === 1 && heatmap.periodNumber === 2)?.secondsPlayed).toBe(2132)
    expect(analysis.passPossession).toHaveLength(2)
    expect(analysis.passingNetwork?.map((network) => network.periodNumber)).toEqual([0, 1, 2])
    expect(analysis.report).not.toBeNull()
    expect(analysis.tracks?.length).toBeGreaterThan(0)
    expect(analysis.availability).toMatchObject({ events: { status: 'available' }, tracking: { status: 'available' }, report: { status: 'available' } })

    // 30-s-Fenster ueber beide Halbzeiten (1968 s und 2173 s), mit Pause nach jedem Abruf.
    const trackingCalls = calls.filter((url) => url.pathname.endsWith('/player-tracking'))
    expect(trackingCalls).toHaveLength(Math.ceil(1968 / 30) + Math.ceil(2173 / 30))
    expect(dependencies.pauses).toBe(trackingCalls.length)
    expect(calls.filter((url) => url.hostname === 'dt3kfuz4eo879.cloudfront.net')).toHaveLength(2)
  })

  it('reports every loaded window of the tracks against their total', async () => {
    const { fetch } = veoFetch()
    const reported: [number, number][] = []
    await buildVeoAnalysis(request, { ...deps(fetch), onTracks: async (done, total) => { reported.push([done, total]) } })
    const total = Math.ceil(1968 / 30) + Math.ceil(2173 / 30)
    expect(reported).toHaveLength(total + 1)
    expect(reported[0]).toEqual([0, total])
    expect(reported.at(-1)).toEqual([total, total])
  })

  it('keeps stored tracks and does not fetch them again', async () => {
    const { fetch, calls } = veoFetch()
    const analysis = await buildVeoAnalysis({ ...request, fetchTracks: false }, deps(fetch))
    expect(analysis.tracks).toBeNull()
    expect(analysis.availability.tracking).toEqual({ status: 'available' })
    expect(calls.some((url) => url.pathname.endsWith('/player-tracking'))).toBe(false)
  })

  it('marks a part Veo does not provide for this match instead of failing', async () => {
    const { fetch } = veoFetch({ 'match-momentum.json': () => json({}, 404), 'match-report.json': () => json({}, 404) })
    const analysis = await buildVeoAnalysis({ ...request, fetchTracks: false }, deps(fetch))
    expect(analysis.momentum).toBeNull()
    expect(analysis.availability.momentum).toEqual({ status: 'unavailable', reason: 'not_provided' })
    expect(analysis.availability.report).toEqual({ status: 'unavailable', reason: 'not_provided' })
    expect(analysis.status).toBe('complete')
  })

  it('checks the report endpoint even when the processing flag says it is unavailable', async () => {
    const { fetch, calls } = veoFetch({
      'feature-processing-status.json': () => json({ analytics: 'completed', match_report: { available: false } }),
    })
    const analysis = await buildVeoAnalysis({ ...request, fetchTracks: false }, deps(fetch))
    expect(analysis.report).not.toBeNull()
    expect(calls.some((url) => url.pathname.endsWith('/match-report/'))).toBe(true)
  })

  it('keeps a shot view available when the match has no shots', async () => {
    const { fetch } = veoFetch({ 'match-events.json': () => json({ events: [] }) })
    const analysis = await buildVeoAnalysis({ ...request, fetchTracks: false }, deps(fetch))
    expect(analysis.events).toEqual([])
    expect(analysis.availability.shots).toEqual({ status: 'available' })
  })

  it('stays pending without periods and asks for nothing that needs them', async () => {
    const { fetch, calls } = veoFetch({ 'periods.json': () => json(fixture('periods-missing.json')) })
    const analysis = await buildVeoAnalysis(request, deps(fetch))
    expect(analysis).toMatchObject({ status: 'pending', events: [], heatmaps: [], tracks: null })
    expect(analysis.availability.events).toEqual({ status: 'pending', reason: 'periods_missing' })
    expect(calls.some((url) => url.pathname.endsWith('/match-events'))).toBe(false)
  })

  it('stays pending while Veo is still processing', async () => {
    const { fetch } = veoFetch({ 'feature-processing-status.json': () => json({ analytics: 'processing', ai_detection: 'processing', match_report: { available: false } }) })
    const analysis = await buildVeoAnalysis(request, deps(fetch))
    expect(analysis.status).toBe('pending')
    expect(analysis.availability.heatmaps).toEqual({ status: 'pending', reason: 'veo_processing' })
  })

  it('reports a match Veo does not know as unavailable', async () => {
    const { fetch } = veoFetch({ 'match-detail.json': () => json({}, 404) })
    expect(await buildVeoAnalysis(request, deps(fetch))).toMatchObject({ status: 'unavailable', veoMatchSlug: null })
  })

  it('throws on a failing request so the sync can leave the package out', async () => {
    const { fetch } = veoFetch({ 'match-events.json': () => json({}, 502) })
    let retried = 0
    const retry = <T>(attempt: () => Promise<T>) => { retried += 1; return attempt() }
    await expect(buildVeoAnalysis(request, { ...deps(fetch), retry })).rejects.toBeInstanceOf(VeoError)
    expect(retried).toBeGreaterThan(0)
  })
})

describe('mapPassPossession', () => {
  const periods = [{ number: 1, startS: 0, endS: 100, ownSide: 'right' as const, confirmed: false }]
  const side = (passesX: number[], possession: number) => ({ passStrings: [[3, 2]] as [number, number][], passLocations: passesX.map((x) => ({ x, y: 0.5 })), possessionLocations: { defensive: possession, middle: 0, attacking: 0 } })

  it('maps the right side to the own team when it defends right and counts thirds from its view', () => {
    const left = side([0.1], 5)
    const right = side([0.1, 0.5], 7)
    const [period] = mapPassPossession([{
      startS: 0, endS: 100,
      possessionSeconds: { L: 30, R: 40 }, passesCompleted: { L: 1, R: 2 }, possessionWon: { L: 3, R: 4 },
      passStrings: { L: left.passStrings, R: right.passStrings }, passLocations: { L: left.passLocations, R: right.passLocations },
      possessionLocations: { L: left.possessionLocations, R: right.possessionLocations },
    }], periods)!
    expect(period?.own).toMatchObject({ possessionSeconds: 40, passesCompleted: 2, passThirds: { defensive: 0, middle: 1, attacking: 1 }, possessionThirds: { defensive: 7 } })
    expect(period?.opponent).toMatchObject({ possessionSeconds: 30, passThirds: { defensive: 1, middle: 0, attacking: 0 } })
    expect(period?.durationS).toBe(100)
  })

  it('ignores RAS periods whose bounds do not match and returns null without data', () => {
    expect(mapPassPossession(null, periods)).toBeNull()
    expect(mapPassPossession([], periods)).toBeNull()
  })
})
