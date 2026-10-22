import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '@vereinsfunk/authorization'
import { describe, expect, it } from 'vitest'
import type { SupabaseClientFactory } from './app.js'
import type { RoleProvider } from './auth.js'
import { DEPARTMENT_ID, ORGANIZATION_ID, TEAM_ID, USER_ID, chain, moduleStatusProviderWith, signAccessToken, startApp } from './testSupport.js'

// Spec 002, PR 2: Spielauswertung lesen. Die Datenbank ist ein Fake; geprueft werden Reihenfolge der
// Pruefungen, gleiche 404 fuer unbekannt und fremd, und dass nur Schema-konforme Antworten rausgehen.

const FIXTURE_ID = '57000000-1000-4000-8000-000000000001'
const ANALYSIS_URL = `/v1/playerboard/teams/${TEAM_ID}/veo/matches/${FIXTURE_ID}/analysis`
const TRACKS_URL = `/v1/playerboard/teams/${TEAM_ID}/veo/matches/${FIXTURE_ID}/tracks`

const periods = [{ number: 1, startS: 605, endS: 2573, ownSide: 'left', confirmed: true }]
const analysis = {
  fixtureId: FIXTURE_ID, kickoffAt: '2026-09-23T14:54:40+00:00', opponentName: 'Gegner', isHome: true, ownScore: 2, opponentScore: 1,
  veoUrl: 'https://app.veo.co/matches/c1-vs-gegner/', analysisStatus: 'complete', analyticsVersion: '2', periods,
  availability: { events: { status: 'available' } }, teamStats: [], players: [],
  events: [{
    id: 'e1', teamAssociation: 'own', eventType: 'FootballGoal', jerseyNumber: 7, playerId: null, periodNumber: 1, periodTimeMs: 1000, videoTimeMs: 606000,
    x: 0.9, y: 0.5, endX: null, endY: null, outcome: 1, receiverJerseyNumber: null, assistJerseyNumber: null,
  }],
  heatmaps: [], passPossession: null, momentum: null, passingNetwork: null, hasReport: false, hasTracking: true,
}
const tracks = { sampleHz: 1, periods, tracks: [{ veoTrackId: 3, side: 'left', goalkeeper: false, jerseyNumber: 7, startS: 605, samples: 'AAEAAg==' }] }

type RpcCall = { name: string; args: Record<string, unknown> }

function rolesProvider(roles: Role[]): RoleProvider {
  return { async rolesForScope() { return roles } }
}

/** Service-Fake mit der Mannschaft; der Nutzer-Client beantwortet Sicht und Lesefunktionen. */
function clients(userRpc: Record<string, { data: unknown; error: unknown }>, calls: RpcCall[] = [], audits: unknown[] = []): SupabaseClientFactory {
  const service = {
    from: (name: string) => {
      if (name === 'audit_events') return { insert: async (row: unknown) => { audits.push(row); return { error: null } } }
      if (name !== 'teams') throw new Error(`unexpected service table in test fake: ${name}`)
      return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }, error: null })
    },
  }
  const user = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      const result = userRpc[name]
      if (!result) throw new Error(`unexpected user rpc in test fake: ${name}`)
      return result
    },
  }
  return { forUser: () => user as unknown as SupabaseClient, forService: () => service as unknown as SupabaseClient }
}

const visible = { playerboard_can_view_stats: { data: true, error: null } }

async function get(app: Awaited<ReturnType<typeof startApp>>, url: string) {
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` } })
}

describe('GET /v1/playerboard/teams/:teamId/veo/matches/:fixtureId/analysis and /tracks', () => {
  it('answers module_disabled before it checks the sight of the stats', async () => {
    const calls: RpcCall[] = []
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({}, calls), moduleStatusProvider: moduleStatusProviderWith([]) })
    for (const url of [ANALYSIS_URL, TRACKS_URL]) {
      const response = await get(app, url)
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ error: 'module_disabled' })
    }
    expect(calls).toEqual([])
  })

  it('needs sight of the team stats', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ playerboard_can_view_stats: { data: false, error: null } }) })
    for (const url of [ANALYSIS_URL, TRACKS_URL]) {
      const response = await get(app, url)
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ error: 'forbidden' })
    }
  })

  it('returns the analysis read through the user client', async () => {
    const calls: RpcCall[] = []
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ ...visible, playerboard_veo_match_analysis: { data: analysis, error: null } }, calls) })
    const response = await get(app, ANALYSIS_URL)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(analysis)
    expect(calls.at(-1)).toEqual({ name: 'playerboard_veo_match_analysis', args: { target_team_id: TEAM_ID, target_fixture_id: FIXTURE_ID } })
  })

  it('gives the same 404 for an unknown match and for one of another team', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ ...visible, playerboard_veo_match_analysis: { data: null, error: null }, playerboard_veo_match_tracks: { data: null, error: null } }) })
    const bodies = []
    for (const url of [ANALYSIS_URL, TRACKS_URL]) {
      const response = await get(app, url)
      expect(response.statusCode).toBe(404)
      const body = response.json()
      bodies.push({ error: body.error, keys: Object.keys(body).sort() })
    }
    expect(bodies).toEqual([{ error: 'not_found', keys: ['correlationId', 'error'] }, { error: 'not_found', keys: ['correlationId', 'error'] }])
  })

  it('maps a permission error of the read function to 403', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ ...visible, playerboard_veo_match_analysis: { data: null, error: { message: 'insufficient_permission', code: '42501' } } }) })
    expect((await get(app, ANALYSIS_URL)).statusCode).toBe(403)
  })

  it('does not send an answer that breaks the schema', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ ...visible, playerboard_veo_match_analysis: { data: { ...analysis, events: [{ ...analysis.events[0], x: 1.2 }] }, error: null } }) })
    const response = await get(app, ANALYSIS_URL)
    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect(response.json()).not.toHaveProperty('events')
  })

  it('returns the tracks and 404 when the match has none', async () => {
    const withTracks = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ ...visible, playerboard_veo_match_tracks: { data: tracks, error: null } }) })
    const response = await get(withTracks, TRACKS_URL)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(tracks)

    const withoutTracks = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ ...visible, playerboard_veo_match_tracks: { data: { ...tracks, tracks: [] }, error: null } }) })
    expect((await get(withoutTracks, TRACKS_URL)).statusCode).toBe(404)
  })
})

describe('Veo Analytics: GET .../veo/season and GET/PUT .../veo/views', () => {
  const SEASON_URL = `/v1/playerboard/teams/${TEAM_ID}/veo/season`
  const VIEWS_URL = `/v1/playerboard/teams/${TEAM_ID}/veo/views`
  const radar = { metrics: ['goals_scored', 'shots_on_goal', 'shots_to_goal_conversion_rate', 'win_ratio', 'passes_completed', 'possession_percent'], comparingTeamId: null, ownRange: ['2026-09-01', '2026-09-30'], comparingRange: ['2026-08-01', '2026-08-31'] }
  const send = async (app: Awaited<ReturnType<typeof startApp>>, payload: unknown) =>
    app.inject({ method: 'PUT', url: VIEWS_URL, headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` }, payload: payload as Record<string, unknown> })

  it('passes the filters of the season to the database', async () => {
    const calls: RpcCall[] = []
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ ...visible, playerboard_veo_team_season: { data: [], error: null } }, calls) })
    const response = await get(app, `${SEASON_URL}?kinds=match,cup&last=10&from=2026-08-01`)
    expect(response.statusCode).toBe(200)
    expect(calls.at(-1)).toEqual({ name: 'playerboard_veo_team_season', args: { target_team_id: TEAM_ID, from_date: '2026-08-01', to_date: null, kinds: ['match', 'cup'], fixture_ids: null, last_n: 10 } })
    expect((await get(app, `${SEASON_URL}?kinds=training`)).statusCode).toBe(400)
  })

  it('needs sight of the team stats for the season and the views', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ playerboard_can_view_stats: { data: false, error: null } }) })
    expect((await get(app, SEASON_URL)).statusCode).toBe(403)
    expect((await get(app, VIEWS_URL)).statusCode).toBe(403)
  })

  it('returns the saved views', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ ...visible, playerboard_veo_team_views: { data: { keyMetrics: [], radar: null }, error: null } }) })
    expect((await get(app, VIEWS_URL)).json()).toEqual({ keyMetrics: [], radar: null })
  })

  it('lets only coaches save, rejects unknown metrics and audits the change', async () => {
    const asPlayer = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({}) })
    expect((await send(asPlayer, { keyMetrics: ['goals_scored'], radar: null })).statusCode).toBe(403)

    const calls: RpcCall[] = []
    const audits: unknown[] = []
    const saved = { keyMetrics: ['goals_scored'], radar }
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients({ playerboard_veo_save_team_views: { data: saved, error: null } }, calls, audits) })
    const invalid = await send(app, { keyMetrics: ['expected_goals'], radar: null })
    expect(invalid.statusCode).toBe(422)
    expect(invalid.json()).toMatchObject({ error: 'invalid_metric' })

    const response = await send(app, saved)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(saved)
    expect(calls.at(-1)).toEqual({ name: 'playerboard_veo_save_team_views', args: { target_team_id: TEAM_ID, p_key_metrics: ['goals_scored'], p_radar: radar } })
    expect(audits).toHaveLength(1)
  })

  it('answers 404 when the comparison team is not available', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients({ playerboard_veo_save_team_views: { data: null, error: { message: 'comparing_team_not_available', code: '22023' } } }) })
    const response = await send(app, { keyMetrics: [], radar: { ...radar, comparingTeamId: '10000000-1200-4000-8000-000000000009' } })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
  })
})
