import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  analyticsVersionOf,
  fetchMatchDetail,
  fetchMatchDetails,
  fetchMatchEvents,
  fetchMomentum,
  fetchPassingNetwork,
  fetchPeriods,
  fetchPlayerHeatmaps,
  fetchProcessingStatus,
  fetchRasStatus,
  fetchTrackingWindow,
  parseMatchDetails,
  parseMatchEvents,
  parsePlayerHeatmaps,
  parseTrackingWindow,
} from './analysis.js'
import type { FetchLike } from './http.js'
import { fetchMatchReport, parseMatchReport } from './matchReport.js'

// Anonymisierte Antworten aus dem Testabruf vom 2026-10-21 (siehe __fixtures__/README.md).
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8'))
}

function fakeFetch(...responses: Response[]) {
  const calls: { url: URL; init: RequestInit | undefined }[] = []
  const fetch: FetchLike = async (input, init) => {
    calls.push({ url: new URL(input), init })
    const next = responses.shift()
    if (!next) throw new Error('no more fake responses')
    return next
  }
  return { fetch, calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const headersOf = (init: RequestInit | undefined) => (init?.headers ?? {}) as Record<string, string>

describe('match detail, periods and status', () => {
  it('reads slug, recording and the speed thresholds of the team', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('match-detail.json')))
    expect(await fetchMatchDetail('token', 'm/1', { fetch })).toEqual({
      veoMatchId: '00000000-0000-0000-0000-000000000001', slug: 'example-slug', recordingId: '00000000-0000-0000-0000-000000000001',
      hsrThresholdKmh: 19, sprintThresholdKmh: 23,
    })
    expect(calls[0]?.url.pathname).toBe('/api/app/matches/m%2F1/')
  })

  it('numbers periods in kickoff order and keeps the unconfirmed flag only for display', async () => {
    const periods = fixture('periods.json') as unknown[]
    const { fetch } = fakeFetch(json([...periods].reverse()))
    expect(await fetchPeriods('token', 'slug', { fetch })).toEqual([
      { number: 1, startS: 605, endS: 2573, ownSide: 'left', confirmed: false },
      { number: 2, startS: 3268, endS: 5441, ownSide: 'right', confirmed: false },
    ])
  })

  it('returns no periods for a recording without periods', async () => {
    const { fetch } = fakeFetch(json(fixture('periods-missing.json')))
    expect(await fetchPeriods('token', 'slug', { fetch })).toEqual([])
  })

  it('reads the processing status', async () => {
    const { fetch } = fakeFetch(json(fixture('feature-processing-status.json')))
    expect(await fetchProcessingStatus('token', 'slug', { fetch })).toEqual({ analytics: 'completed', aiDetection: 'completed', matchReportAvailable: true })
  })

  it('reads the RAS status without an Authorization header and derives analytics version 2', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('ras-analytics.json')))
    const status = await fetchRasStatus('rec', { fetch })
    expect(status?.analyticsVersion).toBe('2')
    expect(status?.parts['player-tracking']).toBe('completed')
    expect(status?.parts).not.toHaveProperty('id')
    expect(calls[0]?.url.href).toBe('https://dt3kfuz4eo879.cloudfront.net/recordings/rec/analytics')
    expect(headersOf(calls[0]?.init)).not.toHaveProperty('authorization')
  })

  it('derives older analytics versions like the Veo app', () => {
    expect(analyticsVersionOf({ 'ball-tracking': 'completed' })).toBe('1')
    expect(analyticsVersionOf({ 'ball-tracking': 'x', 'match-details': 'x', 'shot-details': 'x' })).toBe('1.1')
    expect(analyticsVersionOf({ 'ball-tracking': 'x', 'match-details': 'x', 'shot-details': 'x', 'match-report': 'x' })).toBe('2')
  })

  it('maps 404 to null, a rejected token to auth_expired and a server error to upstream_error', async () => {
    expect(await fetchMatchDetail('token', 'm', { fetch: fakeFetch(json({}, 404)).fetch })).toBeNull()
    await expect(fetchMatchDetail('token', 'm', { fetch: fakeFetch(json({}, 401)).fetch })).rejects.toMatchObject({ code: 'auth_expired' })
    await expect(fetchMatchDetail('token', 'm', { fetch: fakeFetch(json({}, 502)).fetch })).rejects.toMatchObject({ code: 'upstream_error' })
    await expect(fetchRasStatus('rec', { fetch: fakeFetch(json({}, 403)).fetch })).rejects.toMatchObject({ code: 'upstream_error' })
  })
})

describe('match events', () => {
  const events = parseMatchEvents(fixture('match-events.json'))

  it('reads both teams with jersey, period and raw location', () => {
    expect(events).toHaveLength(127)
    expect(new Set(events.map((event) => event.team))).toEqual(new Set(['own', 'opponent']))
    const shot = events.find((event) => event.eventType === 'FootballShot' && event.x !== null)!
    expect(shot.periodNumber).toBeGreaterThanOrEqual(1)
    expect(typeof shot.z).toBe('number')
  })

  it('keeps target and receiver of a pass', () => {
    const pass = events.find((event) => event.eventType === 'pass')!
    expect(pass.receiver).toMatchObject({ x: expect.any(Number), z: expect.any(Number) })
  })

  it('keeps events without location with x and z null', () => {
    const unlocated = events.filter((event) => event.x === null)
    expect(unlocated.length).toBeGreaterThan(0)
    expect(unlocated.every((event) => event.z === null)).toBe(true)
  })

  it('treats a missing or negative jersey as no jersey and reads an assist given as jersey number', () => {
    const base = { id: 'e', team: 'Own', eventType: 'FootballGoal', periodId: 1, periodTimeMs: 0, videoTimeMs: 0, x: 0.9, z: 0.5, outcome: 1 }
    const [noJersey, assisted] = parseMatchEvents({ events: [
      { ...base, playerJersey: '-1' },
      { ...base, id: 'f', playerJersey: '9', attributes: [{ label: 'FootballAssist', type: 'string', value: '7' }] },
    ] })
    expect(noJersey?.jerseyNumber).toBeNull()
    expect(assisted).toMatchObject({ jerseyNumber: 9, assistJerseyNumber: 7 })
  })

  it('rejects an unknown team value as a changed shape', () => {
    expect(() => parseMatchEvents({ events: [{ id: 'e', team: 'Home', eventType: 'pass', periodTimeMs: 0, videoTimeMs: 0 }] }))
      .toThrowError(expect.objectContaining({ code: 'upstream_changed' }))
  })

  it('asks for aggregated duels on the MES host', async () => {
    const { fetch, calls } = fakeFetch(json({ events: [] }))
    expect(await fetchMatchEvents('token', 'm', { fetch })).toEqual([])
    expect(calls[0]?.url.href).toBe('https://app.veo.co/api/mes/v2/m/match-events?aggregatedDuels=true')
    expect(headersOf(calls[0]?.init).authorization).toBe('Bearer token')
  })
})

describe('player heatmaps', () => {
  it('decodes the 60 x 30 matrix of each player', () => {
    const heatmaps = parsePlayerHeatmaps(fixture('analysis-player-heatmaps.json'))
    expect(heatmaps).toHaveLength(3)
    expect(heatmaps[0]).toMatchObject({ width: 60, height: 30, directionOfPlay: 'leftToRight' })
    expect(heatmaps[0]?.cells).toHaveLength(1800)
    expect(Math.max(...heatmaps[0]!.cells)).toBe(255)
  })

  it('rejects a matrix whose cells do not match its size', () => {
    const broken = { items: [{ player: { jersey_number: '3' }, matrix: { values: Buffer.from([1, 2, 3]).toString('base64'), width: 2, height: 2, direction_of_play: 'leftToRight' } }] }
    expect(() => parsePlayerHeatmaps(broken)).toThrowError(expect.objectContaining({ code: 'upstream_changed' }))
  })

  it('sends the time window with Veo smoothing', async () => {
    const { fetch, calls } = fakeFetch(json({ items: [] }))
    await fetchPlayerHeatmaps('token', { veoTeamId: 't', veoMatchId: 'm', startS: 605, endS: 2573 }, { fetch })
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ type: 'match_all_players', match_id: 'm', team_id: 't', start_time: 605, end_time: 2573, smoothing: 1.5 })
  })
})

describe('passes and possession (RAS)', () => {
  it('reads both periods per side and drops the clip lists of pass strings', () => {
    const periods = parseMatchDetails(fixture('ras-match-details.json'))
    expect(periods).toHaveLength(2)
    expect(periods[0]?.startS).toBe(605)
    expect(periods[0]?.passStrings.L.every((entry) => entry.length === 2)).toBe(true)
    expect(periods[0]?.possessionLocations.L).toMatchObject({ defensive: expect.any(Number), middle: expect.any(Number), attacking: expect.any(Number) })
  })

  it('does not call RAS without periods', async () => {
    const { fetch, calls } = fakeFetch()
    expect(await fetchMatchDetails('rec', [], { fetch })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('sends one filter per period and no Authorization header', async () => {
    const { fetch, calls } = fakeFetch(json([]))
    await fetchMatchDetails('rec', [{ startS: 605, endS: 2573 }, { startS: 3268, endS: 5441 }], { fetch })
    expect(calls[0]?.url.search).toBe('?filters=605,2573&filters=3268,5441')
    expect(headersOf(calls[0]?.init)).not.toHaveProperty('authorization')
  })
})

describe('momentum and passing network', () => {
  it('reads the momentum curve and maps 404 to null', async () => {
    const curve = await fetchMomentum('token', 'm', { fetch: fakeFetch(json(fixture('match-momentum.json'))).fetch })
    expect(curve?.[0]).toEqual([expect.any(Number), expect.any(Number)])
    expect(await fetchMomentum('token', 'm', { fetch: fakeFetch(json({}, 404)).fetch })).toBeNull()
  })

  it('sends period numbers with sides and reads jerseys as numbers', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('passing-network.json')))
    const network = await fetchPassingNetwork('token', 'm', [{ number: 1, ownSide: 'left' }, { number: 2, ownSide: 'right' }], { fetch })
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ team: 'Own', periods: [{ periodId: 1, ownSide: 'left' }, { periodId: 2, ownSide: 'right' }] })
    expect(network?.nodes.length).toBeGreaterThan(0)
    expect(typeof network?.nodes[0]?.jerseyNumber).toBe('number')
    expect(typeof network?.edges[0]?.fromJersey).toBe('number')
  })

  it('does not ask for a passing network without periods', async () => {
    const { fetch, calls } = fakeFetch()
    expect(await fetchPassingNetwork('token', 'm', [], { fetch })).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('player tracking', () => {
  it('flattens a window into samples sorted by time, with -1 jerseys as null', () => {
    const samples = parseTrackingWindow(fixture('player-tracking.json'))
    expect(samples.length).toBeGreaterThan(0)
    expect(samples.map((sample) => sample.t)).toEqual([...samples.map((sample) => sample.t)].sort((a, b) => a - b))
    expect(samples.some((sample) => sample.jerseyNumber === null)).toBe(true)
    expect(samples.every((sample) => sample.jerseyNumber === null || sample.jerseyNumber >= 0)).toBe(true)
  })

  it('rejects a non-numeric time key', () => {
    expect(() => parseTrackingWindow({ abc: [[1, 1, 0.5, 0.5, 7, 0, 0, 0]] })).toThrowError(expect.objectContaining({ code: 'upstream_changed' }))
  })

  it('asks for a whole-second window start and treats 404 as no data', async () => {
    const { fetch, calls } = fakeFetch(json({}, 404))
    expect(await fetchTrackingWindow('token', 'm', 605.7, { fetch })).toEqual([])
    expect(calls[0]?.url.searchParams.get('start')).toBe('605')
  })
})

describe('match report', () => {
  it('keeps the sections and drops names, crests and videos', () => {
    const report = parseMatchReport(fixture('match-report.json'))
    expect(report.view).toBe('advanced')
    expect(report.attacking?.goals?.periods).toHaveLength(2)
    expect(report.passing?.pass_strings?.full_time.own.length).toBeGreaterThan(0)
    expect(report.physical?.speed_zones?.thresholds).toEqual({ hsr_kmh: 19, sprint_kmh: 23 })
    const text = JSON.stringify(report)
    expect(text).not.toMatch(/"(name|short_name|crest_url|videos|url|title)"/)
  })

  it('rejects a report without the overview as a changed shape', () => {
    const report = { ...(fixture('match-report.json') as Record<string, unknown>) }
    delete report.overview
    expect(() => parseMatchReport(report)).toThrowError(expect.objectContaining({ code: 'upstream_changed' }))
  })

  it('maps a missing report to null', async () => {
    expect(await fetchMatchReport('token', 'm', { fetch: fakeFetch(json({}, 404)).fetch })).toBeNull()
  })
})
