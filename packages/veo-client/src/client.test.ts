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
  it('keeps every curated stat per jersey number with its values per period', () => {
    const players = parsePlayerStats(fixture('analysis-stats-match-all-players.json'))
    expect(players.map((player) => player.jerseyNumber)).toEqual([1, 2, 3, 5])
    const first = players[0]!
    expect(first.stats.map((stat) => stat.statType)).toContain('football_passes_completed_total')
    expect(first.stats.every((stat) => stat.category !== undefined)).toBe(true)
    const distance = first.stats.find((stat) => stat.statType === 'distance_total_meters')!
    expect(distance.category).toBe('physical')
    expect(distance.periodValues.map((period) => period.period)).toEqual([1, 2])
    expect(distance.periodValues.reduce((sum, period) => sum + period.value, 0)).toBe(distance.value)
  })

  it('drops unknown stat types, inherited keys and rows without a jersey number', () => {
    const players = parsePlayerStats({ items: [
      { player: { type: 'jersey_only', jersey_number: '5' }, stats: [{ type: 'toString', value: 1, periods: [] }, { type: 'football_touches_total', value: 4, periods: [] }, { type: 'sprints_total', value: 3, periods: [] }] },
      { player: { type: 'jersey_only', jersey_number: '5' }, stats: [{ type: 'sprints_total', value: 9, periods: [] }] },
      { player: { type: 'identified', jersey_number: null }, stats: [{ type: 'sprints_total', value: 1, periods: [] }] },
    ] })
    expect(players).toEqual([{ jerseyNumber: 5, stats: [{ statType: 'sprints_total', category: 'physical', value: 3, periodValues: [] }] }])
  })

  it('accepts leading zeroes, rejects non-numeric and unsafe jersey numbers', () => {
    const row = (jersey: string) => ({ items: [{ player: { type: 'jersey_only', jersey_number: jersey }, stats: [{ type: 'sprints_total', value: 1, periods: [] }] }] })
    expect(parsePlayerStats(row('07'))[0]?.jerseyNumber).toBe(7)
    expect(() => parsePlayerStats(row('7a'))).toThrowError(expect.objectContaining({ code: 'upstream_changed' }))
    expect(() => parsePlayerStats(row('7\n'))).toThrowError(VeoError)
    expect(parsePlayerStats(row('99999999999999999999'))).toEqual([])
  })

  it('rejects a period without a number as a changed shape', () => {
    expect(() => parsePlayerStats({ items: [{ player: { type: 'jersey_only', jersey_number: '5' }, stats: [{ type: 'sprints_total', value: 1, periods: [{ value: 1 }] }] }] }))
      .toThrowError(expect.objectContaining({ code: 'upstream_changed' }))
  })

  it('asks for all players of exactly one match with the Veo app headers', async () => {
    const { fetch, calls } = fakeFetch(json({ items: [] }))
    await fetchPlayerStats('token', { veoTeamId: 'team', veoMatchId: 'm1' }, { fetch })
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ type: 'match_all_players', match_id: 'm1', team_id: 'team' })
    expect((calls[0]?.init?.headers as Record<string, string>)['Veo-App-Id']).toBe('hazard')
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
    await expect(veoRequest('https://d1234example.cloudfront.net/recordings/x', {}, { fetch })).rejects.toThrow(/non-Veo host/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('allows Veo RAS on its CloudFront host', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(null, { status: 204 }))
    const { veoRequest } = await import('./http.js')
    await veoRequest('https://dt3kfuz4eo879.cloudfront.net/recordings/x/analytics', {}, { fetch })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not allow callers to enable automatic redirects', async () => {
    const fetch = vi.fn<FetchLike>(async (_input, init) => {
      expect(init?.redirect).toBe('manual')
      return new Response(null, { status: 204 })
    })
    await import('./http.js').then(({ veoRequest }) => veoRequest('https://app.veo.co/', { redirect: 'follow' }, { fetch }))
  })
})
