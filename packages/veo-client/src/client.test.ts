import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fetchPlayerStats, fetchTeamStats, listClubTeams, listMatches, listOwnClubs, parseMatchList, parsePlayerStats, parseTeamStats } from './client.js'
import { VeoError } from './errors.js'
import type { FetchLike } from './http.js'

// Aufgezeichnete Veo-Antworten aus playerboard, anonymisiert (IDs, Vereins- und Gegnernamen).
/** Liest eine aufgezeichnete Antwort aus __fixtures__. */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8'))
}

/** Antwortet nacheinander mit den gegebenen Antworten und merkt sich die Aufrufe. */
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

describe('parseMatchList', () => {
  it('reads a recorded match list with the nested team id and the aggregated score', () => {
    const matches = parseMatchList(fixture('matches-list-response.json'))
    expect(matches).toHaveLength(2)
    expect(matches[0]).toEqual({
      veoMatchId: '00000000-0000-4000-8000-000000000001',
      veoTeamId: '00000000-0000-4000-8000-000000000002',
      start: '2026-09-23T14:54:40.829Z',
      title: 'Testverein U14 vs. Gegner Nord U14',
      opponentName: 'Gegner Nord U14',
      homeOrAway: 'home',
      hasAnalytics: true,
      score: { own: 7, opponent: 5 },
    })
  })

  it('rejects a flattened team__id instead of the nested team object', () => {
    const [first] = fixture('matches-list-response.json') as Record<string, unknown>[]
    const flattened: Record<string, unknown> = { ...first, team__id: 'x' }
    delete flattened.team
    expect(() => parseMatchList([flattened])).toThrowError(expect.objectContaining({ code: 'upstream_changed' }))
  })

  it('treats an incomplete score as no score', () => {
    const [first] = fixture('matches-list-response.json') as Record<string, unknown>[]
    const matches = parseMatchList([{ ...first, info: { stats: { score_aggregated: { own: 2, opponent: null } } } }])
    expect(matches[0]?.score).toBeNull()
  })
})

describe('listMatches', () => {
  const page = fixture('matches-list-response.json') as unknown[]

  it('stops after a short page', async () => {
    const { fetch, calls } = fakeFetch(json(page))
    const matches = await listMatches('token', { veoClubSlug: 'club', veoTeamSlug: 'team' }, { fetch })
    expect(matches).toHaveLength(2)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.hostname).toBe('app.veo.co')
    expect(calls[0]?.url.searchParams.get('team')).toBe('team')
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer token')
  })

  it('reads further pages and stops when Veo ignores the page parameter', async () => {
    const { fetch, calls } = fakeFetch(json(page), json(page))
    const matches = await listMatches('token', { veoClubSlug: 'club', veoTeamSlug: 'team' }, { fetch, pageSize: 2 })
    expect(matches).toHaveLength(2)
    expect(calls.map((call) => call.url.searchParams.get('page'))).toEqual(['1', '2'])
  })

  it('ends at a 404 behind the last page', async () => {
    const { fetch } = fakeFetch(json(page), json({ detail: 'Invalid page.' }, 404))
    expect(await listMatches('token', { veoClubSlug: 'club', veoTeamSlug: 'team' }, { fetch, pageSize: 2 })).toHaveLength(2)
  })

  it('fails closed instead of silently truncating a full history at maxPages', async () => {
    const { fetch } = fakeFetch(json(page))
    await expect(listMatches('token', { veoClubSlug: 'club', veoTeamSlug: 'team' }, { fetch, pageSize: 2, maxPages: 1 })).rejects.toMatchObject({ code: 'upstream_error' })
  })

  it('reports a rejected token as auth_expired and a server error as upstream_error', async () => {
    await expect(listMatches('token', { veoClubSlug: 'c', veoTeamSlug: 't' }, { fetch: fakeFetch(json({}, 401)).fetch })).rejects.toMatchObject({ code: 'auth_expired' })
    await expect(listMatches('token', { veoClubSlug: 'c', veoTeamSlug: 't' }, { fetch: fakeFetch(json({}, 502)).fetch })).rejects.toMatchObject({ code: 'upstream_error' })
  })
})

describe('team stats', () => {
  it('maps every stat of both team associations with the match id of each item', () => {
    const rows = parseTeamStats(fixture('analysis-stats-response.json'))
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map((row) => row.teamAssociation))).toEqual(new Set(['own', 'opponent']))
    expect(rows.find((row) => row.statType === 'football_goal_total' && row.teamAssociation === 'own')).toMatchObject({
      veoMatchId: '00000000-0000-4000-8000-000000000004', category: 'attacking', value: 2,
      periodValues: [{ period: 1, value: 0 }, { period: 2, value: 2 }],
    })
  })

  it('never fabricates a stat Veo did not return', () => {
    const rows = parseTeamStats({ items: [{ match_id: 'm', team_association: 'own', stats: [{ type: 'a', category: { id: 'physical' }, value: 1, periods: [] }] }] })
    expect(rows.map((row) => row.statType)).toEqual(['a'])
    expect(parseTeamStats({ items: [] })).toEqual([])
  })

  it('rejects an unexpected shape', () => {
    expect(() => parseTeamStats({ data: [] })).toThrowError(expect.objectContaining({ code: 'upstream_changed' }))
  })

  it('requests all matches of one Veo team grouped by team association', async () => {
    const { fetch, calls } = fakeFetch(json({ items: [] }))
    await fetchTeamStats('token', { veoTeamId: 'team', veoMatchIds: ['m1', 'm2'] }, { fetch })
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ type: 'team_match', team_id: 'team', match_ids: ['m1', 'm2'], group_by: 'team_association' })
  })
})

describe('player stats', () => {
  it('keeps the nine curated stats per jersey number, also for numbers without a squad entry', () => {
    const players = parsePlayerStats(fixture('analysis-stats-player-response.json'))
    expect(players.map((player) => player.jerseyNumber)).toEqual([7, 10, 99])
    const seven = players.find((player) => player.jerseyNumber === 7)!
    expect(seven.stats).toHaveLength(9)
    expect(seven.stats.map((stat) => stat.statType)).not.toContain('football_touches_total')
    expect(seven.stats.find((stat) => stat.statType === 'top_speed_kmh')).toEqual({ statType: 'top_speed_kmh', category: 'physical', value: 27.8 })
  })

  it('accepts leading zeroes, rejects non-numeric and unsafe jersey numbers', () => {
    const stat = [{ type: 'sprints_total', value: 1 }]
    expect(parsePlayerStats({ items: [{ jersey_number: '07', stats: stat }] })[0]?.jerseyNumber).toBe(7)
    expect(() => parsePlayerStats({ items: [{ jersey_number: '7a', stats: stat }] })).toThrowError(expect.objectContaining({ code: 'upstream_changed' }))
    expect(() => parsePlayerStats({ items: [{ jersey_number: '7\n', stats: stat }] })).toThrowError(VeoError)
    expect(parsePlayerStats({ items: [{ jersey_number: '99999999999999999999', stats: stat }] })).toEqual([])
  })

  it('ignores inherited keys and keeps the first of duplicate jersey and stat pairs', () => {
    const players = parsePlayerStats({ items: [
      { jersey_number: '5', stats: [{ type: 'toString', value: 1 }, { type: 'sprints_total', value: 3 }] },
      { jersey_number: '5', stats: [{ type: 'sprints_total', value: 9 }] },
    ] })
    expect(players).toEqual([{ jerseyNumber: 5, stats: [{ statType: 'sprints_total', category: 'physical', value: 3 }] }])
  })

  it('sends team_id and exactly one match per request', async () => {
    const { fetch, calls } = fakeFetch(json({ items: [] }))
    await fetchPlayerStats('token', { veoTeamId: 'team', veoMatchId: 'm1' }, { fetch })
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ type: 'cross_match', team_id: 'team', group_by: 'player', match_ids: ['m1'] })
  })
})

describe('clubs and teams', () => {
  it('lists own clubs and the teams of a club', async () => {
    const { fetch, calls } = fakeFetch(json([{ slug: 'sv', name: 'SV' }]), json([{ slug: 'u14', name: 'U14', match_count: 3 }]))
    expect(await listOwnClubs('token', { fetch })).toEqual([{ slug: 'sv', name: 'SV' }])
    expect(await listClubTeams('token', 'sv/../x', { fetch })).toEqual([{ slug: 'u14', name: 'U14' }])
    expect(calls[1]?.url.pathname).toBe('/api/app/clubs/sv%2F..%2Fx/teams/')
  })
})

describe('host allowlist', () => {
  it('never calls a host outside Veo', async () => {
    const fetch = vi.fn<FetchLike>()
    const { veoRequest } = await import('./http.js')
    await expect(veoRequest('https://example.com/', {}, { fetch })).rejects.toThrow(/non-Veo host/)
    await expect(veoRequest('http://app.veo.co/', {}, { fetch })).rejects.toThrow(/non-Veo host/)
    await expect(veoRequest('https://app.veo.co:8443/', {}, { fetch })).rejects.toThrow(/non-Veo host/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not allow callers to enable automatic redirects', async () => {
    const fetch = vi.fn<FetchLike>(async (_input, init) => {
      expect(init?.redirect).toBe('manual')
      return new Response(null, { status: 204 })
    })
    await import('./http.js').then(({ veoRequest }) => veoRequest('https://app.veo.co/', { redirect: 'follow' }, { fetch }))
  })
})
