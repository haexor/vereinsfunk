import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '@vereinsfunk/authorization'
import { createSecretBox } from '@vereinsfunk/secrets'
import { VeoError, type FetchLike, type LoginBrowser, type LoginLocator, type LoginPage } from '@vereinsfunk/veo-client'
import { describe, expect, it } from 'vitest'
import type { SupabaseClientFactory } from './app.js'
import type { RoleProvider } from './auth.js'
import { openVeoLinkToken, sealVeoLinkToken } from './routes/playerboard/veoLinkToken.js'
import { DEPARTMENT_ID, ORGANIZATION_ID, TEAM_ID, USER_ID, chain, signAccessToken, startApp } from './testSupport.js'

// Paket 053, PR 2: Veo verbinden und abgleichen. Browser und Veo sind Fakes; geprueft wird, dass
// Passwort und Cookie nie in einer Antwort oder unversiegelt in der Datenbank landen.

const SOURCE_ID = '53000000-2000-4000-8000-000000000001'
const RUN_ID = '53000000-6000-4000-8000-000000000001'
const COOKIE = 'sessionid=very-secret-cookie'
const PASSWORD = 'very-secret-password'
const box = createSecretBox({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1')

/** Liefert fuer jeden Scope dieselben Rollen. */
function rolesProvider(roles: Role[]): RoleProvider {
  return { async rolesForScope() { return roles } }
}

type RpcCall = { name: string; args: Record<string, unknown> }

/** Service-Fake mit Mannschaft, optionaler Veo-Verbindung und aufgezeichneten RPC-Aufrufen. */
function clients(options: {
  link?: Record<string, unknown> | null
  rpc?: Record<string, { data: unknown; error: unknown }>
  userRpc?: Record<string, { data: unknown; error: unknown }>
  tables?: Record<string, unknown>
  calls?: RpcCall[]
} = {}): SupabaseClientFactory {
  const tables: Record<string, unknown> = {
    teams: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID },
    playerboard_veo_links: options.link ?? null,
    integration_sync_runs: [],
    ...options.tables,
  }
  const service = {
    from: (name: string) => {
      if (name === 'audit_events') return { insert: async () => ({ error: null }) }
      if (!(name in tables)) throw new Error(`unexpected service table in test fake: ${name}`)
      return chain({ data: tables[name], error: null })
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      options.calls?.push({ name, args })
      const result = options.rpc?.[name]
      if (!result) throw new Error(`unexpected service rpc in test fake: ${name}`)
      return result
    },
  }
  const user = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      options.calls?.push({ name, args })
      const result = options.userRpc?.[name]
      if (!result) throw new Error(`unexpected user rpc in test fake: ${name}`)
      return result
    },
  }
  return {
    forUser: () => user as unknown as SupabaseClient,
    forService: () => service as unknown as SupabaseClient,
  }
}

/** Browser-Fake: landet nach der Anmeldung in der App und setzt das Session-Cookie. */
function fakeBrowser(options: { fails?: boolean } = {}) {
  const filled: string[] = []
  let current = 'https://app.veo.co/accounts/login/'
  const locator = (): LoginLocator => ({
    first: () => locator(),
    waitFor: async () => undefined,
    fill: async (value) => { filled.push(value) },
    press: async () => { current = options.fails ? 'https://app.veo.co/accounts/login/?error=1' : 'https://app.veo.co/matches/' },
    click: async () => { throw new Error('no banner') },
  })
  const page: LoginPage = { goto: async () => undefined, locator: () => locator(), getByRole: () => locator(), waitForURL: async () => undefined, url: () => current }
  const browser: LoginBrowser = {
    newContext: async () => ({ newPage: async () => page, cookies: async () => [{ name: 'sessionid', value: 'very-secret-cookie' }] }),
    close: async () => undefined,
  }
  return { launchBrowser: async () => browser, filled }
}

/** Veo-Fake: stille OIDC-Anmeldung, ein Verein mit zwei Mannschaften. */
const veoFetch: FetchLike = async (input) => {
  const url = new URL(input)
  if (url.pathname === '/oidc/auth') {
    const location = `${url.searchParams.get('redirect_uri')}?code=abc&state=${url.searchParams.get('state')}`
    return new Response(null, { status: 303, headers: { location } })
  }
  if (url.pathname === '/oidc/token') return Response.json({ access_token: 'access', expires_in: 3600, token_type: 'Bearer' })
  if (url.pathname === '/api/app/clubs/') return Response.json([{ slug: 'tsv', name: 'TSV' }])
  if (url.pathname === '/api/app/clubs/tsv/teams/') return Response.json([{ slug: 'u13', name: 'TSV U13' }, { slug: 'u15', name: 'TSV U15' }])
  throw new Error(`unexpected Veo request ${url.pathname}`)
}

/** Sendet eine Anfrage mit Token fuer USER_ID. */
async function call(app: Awaited<ReturnType<typeof startApp>>, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const token = await signAccessToken(USER_ID)
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...headers }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) })
}

/** Ein gueltiger Link-Token fuer TEAM_ID und USER_ID mit der Auswahl tsv/u13. */
function validLinkToken() {
  return sealVeoLinkToken(box, { teamId: TEAM_ID, userId: USER_ID, cookie: COOKIE, teams: [{ clubSlug: 'tsv', clubName: 'TSV', teamSlug: 'u13', teamName: 'TSV U13' }] })
}

describe('POST /v1/playerboard/veo/login', () => {
  it('rejects a player', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients(), veo: { ...fakeBrowser(), fetch: veoFetch } })
    const response = await call(app, 'POST', '/v1/playerboard/veo/login', { teamId: TEAM_ID, email: 'coach@example.local', password: PASSWORD })
    expect(response.statusCode).toBe(403)
  })

  it('logs in through the browser and returns the clubs with a sealed link token', async () => {
    const browser = fakeBrowser()
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients(), veo: { launchBrowser: browser.launchBrowser, fetch: veoFetch } })
    const response = await call(app, 'POST', '/v1/playerboard/veo/login', { teamId: TEAM_ID, email: 'coach@example.local', password: PASSWORD })

    expect(response.statusCode).toBe(200)
    expect(browser.filled).toEqual(['coach@example.local', PASSWORD])
    const body = response.json()
    expect(body.clubs).toEqual([{ slug: 'tsv', name: 'TSV', teams: [{ slug: 'u13', name: 'TSV U13' }, { slug: 'u15', name: 'TSV U15' }] }])
    expect(response.body).not.toContain('very-secret')
    expect(openVeoLinkToken(box, body.linkToken, { teamId: TEAM_ID, userId: USER_ID })?.cookie).toBe(COOKIE)
  })

  it('answers a wrong password with veo_login_failed', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients(), veo: { ...fakeBrowser({ fails: true }), fetch: veoFetch } })
    const response = await call(app, 'POST', '/v1/playerboard/veo/login', { teamId: TEAM_ID, email: 'coach@example.local', password: PASSWORD })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'veo_login_failed' })
  })

  it('answers a broken Veo with veo_unavailable', async () => {
    const failing: FetchLike = async () => { throw new VeoError('upstream_error', 'down') }
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients(), veo: { ...fakeBrowser(), fetch: failing } })
    const response = await call(app, 'POST', '/v1/playerboard/veo/login', { teamId: TEAM_ID, email: 'coach@example.local', password: PASSWORD })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({ error: 'veo_unavailable' })
  })
})

describe('POST /v1/playerboard/veo/link', () => {
  it('rejects a token of another person or team', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients() })
    const foreign = sealVeoLinkToken(box, { teamId: TEAM_ID, userId: '10000000-0000-4000-8000-000000000099', cookie: COOKIE, teams: [] })
    const response = await call(app, 'POST', '/v1/playerboard/veo/link', { teamId: TEAM_ID, linkToken: foreign, veoClubSlug: 'tsv', veoTeamSlug: 'u13' })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_link_token' })
  })

  it('accepts only a Veo team seen at login', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients() })
    const response = await call(app, 'POST', '/v1/playerboard/veo/link', { teamId: TEAM_ID, linkToken: validLinkToken(), veoClubSlug: 'tsv', veoTeamSlug: 'u17' })
    expect(response.statusCode).toBe(422)
  })

  it('stores the cookie sealed to the source and queues the first sync', async () => {
    const calls: RpcCall[] = []
    const app = await startApp({
      roleProvider: rolesProvider(['team_manager']),
      supabaseClients: clients({
        calls,
        link: { team_id: TEAM_ID, organization_id: ORGANIZATION_ID, integration_source_id: SOURCE_ID, veo_club_name: 'TSV', veo_team_name: 'TSV U13', consecutive_failures: 3, last_error_code: 'auth_expired' },
        rpc: {
          playerboard_veo_link_team: { data: SOURCE_ID, error: null },
          enqueue_integration_sync: { data: [{ result: 'acquired', run_id: RUN_ID }], error: null },
        },
      }),
    })
    const response = await call(app, 'POST', '/v1/playerboard/veo/link', { teamId: TEAM_ID, linkToken: validLinkToken(), veoClubSlug: 'tsv', veoTeamSlug: 'u13' })

    expect(response.statusCode).toBe(201)
    const link = calls.find((entry) => entry.name === 'playerboard_veo_link_team')!.args
    // Neu verbinden behaelt die Quelle; das Cookie ist mit ihrer ID als AAD versiegelt.
    expect(link).toMatchObject({ p_team_id: TEAM_ID, p_source_id: SOURCE_ID, p_veo_club_slug: 'tsv', p_veo_team_slug: 'u13', p_veo_team_name: 'TSV U13', p_key_version: 'v1' })
    const ciphertext = Buffer.from(String(link.p_secret_ciphertext).slice(2), 'hex')
    expect(ciphertext.toString('utf8')).not.toContain('very-secret')
    expect(box.open(ciphertext, 'v1', `integration-source:${SOURCE_ID}`)).toBe(COOKIE)
    expect(calls.find((entry) => entry.name === 'enqueue_integration_sync')!.args).toMatchObject({ target_source_id: SOURCE_ID, target_triggered_by: USER_ID })
  })
})

describe('POST /v1/playerboard/veo/sync', () => {
  const link = { team_id: TEAM_ID, organization_id: ORGANIZATION_ID, integration_source_id: SOURCE_ID, veo_club_name: 'TSV', veo_team_name: 'TSV U13', consecutive_failures: 0, last_error_code: null }

  it('needs a link', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients() })
    const response = await call(app, 'POST', '/v1/playerboard/veo/sync', { teamId: TEAM_ID })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'veo_not_linked' })
  })

  it('queues a run with the given idempotency key', async () => {
    const calls: RpcCall[] = []
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients({ calls, link, rpc: { enqueue_integration_sync: { data: [{ result: 'acquired', run_id: RUN_ID }], error: null } } }) })
    const response = await call(app, 'POST', '/v1/playerboard/veo/sync', { teamId: TEAM_ID }, { 'idempotency-key': 'sync-1' })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ runId: RUN_ID, state: 'queued' })
    expect(calls[0]!.args).toMatchObject({ target_request_idempotency_key: 'sync-1' })
  })

  it('reports a running sync with 409', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients({ link, rpc: { enqueue_integration_sync: { data: [{ result: 'already_running', run_id: RUN_ID }], error: null } } }) })
    const response = await call(app, 'POST', '/v1/playerboard/veo/sync', { teamId: TEAM_ID })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'sync_already_running', runId: RUN_ID })
  })

  it('does not queue a disabled source', async () => {
    const app = await startApp({
      roleProvider: rolesProvider(['team_manager']),
      supabaseClients: clients({ link, rpc: { enqueue_integration_sync: { data: null, error: { message: 'source_disabled' } } } }),
    })
    const response = await call(app, 'POST', '/v1/playerboard/veo/sync', { teamId: TEAM_ID })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'source_disabled' })
  })

  it('rejects a player', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ link }) })
    const response = await call(app, 'POST', '/v1/playerboard/veo/sync', { teamId: TEAM_ID })
    expect(response.statusCode).toBe(403)
  })
})

describe('GET /v1/playerboard/veo/status', () => {
  it('flags an expired session for reconnecting', async () => {
    const app = await startApp({
      roleProvider: rolesProvider(['player']),
      supabaseClients: clients({ link: { team_id: TEAM_ID, organization_id: ORGANIZATION_ID, integration_source_id: SOURCE_ID, veo_club_name: 'TSV', veo_team_name: 'TSV U13', consecutive_failures: 3, last_error_code: 'auth_expired' } }),
    })
    const response = await call(app, 'GET', `/v1/playerboard/veo/status?teamId=${TEAM_ID}`)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ linked: true, veoTeamName: 'TSV U13', needsReconnect: true, consecutiveFailures: 3, runs: [] })
  })
})

describe('GET /v1/playerboard/teams/:teamId/veo/matches', () => {
  const match = {
    fixtureId: '53000000-3000-4000-8000-000000000001', kickoffAt: '2026-09-05T10:00:00+00:00', opponentName: 'Gegner', isHome: true, ownScore: 2, opponentScore: 1,
    teamStats: [], players: [{ jerseyNumber: 7, playerId: null, name: null, matchedManually: false, stats: [] }],
  }

  it('needs sight of the team stats', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ userRpc: { playerboard_can_view_stats: { data: false, error: null } } }) })
    const response = await call(app, 'GET', `/v1/playerboard/teams/${TEAM_ID}/veo/matches`)
    expect(response.statusCode).toBe(403)
  })

  it('passes the range to the database and returns the matches', async () => {
    const calls: RpcCall[] = []
    const app = await startApp({
      roleProvider: rolesProvider(['player']),
      supabaseClients: clients({ calls, userRpc: { playerboard_can_view_stats: { data: true, error: null }, playerboard_veo_team_matches: { data: [match], error: null } } }),
    })
    const response = await call(app, 'GET', `/v1/playerboard/teams/${TEAM_ID}/veo/matches?from=2026-08-01`)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([match])
    expect(calls.find((entry) => entry.name === 'playerboard_veo_team_matches')!.args).toEqual({ target_team_id: TEAM_ID, from_date: '2026-08-01', to_date: null })
  })
})

describe('PUT /v1/playerboard/veo/assignments', () => {
  const body = { fixtureId: '53000000-3000-4000-8000-000000000001', jerseyNumber: 7, playerId: '53000000-4000-4000-8000-000000000001', applyToUnassigned: true }
  const tables = { playerboard_veo_matches: { team_id: TEAM_ID } }

  it('rejects a player', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ tables }) })
    const response = await call(app, 'PUT', '/v1/playerboard/veo/assignments', body)
    expect(response.statusCode).toBe(403)
  })

  it('assigns through the database function and reports how many matches changed', async () => {
    const calls: RpcCall[] = []
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients({ calls, tables, userRpc: { playerboard_veo_assign_jersey: { data: 3, error: null } } }) })
    const response = await call(app, 'PUT', '/v1/playerboard/veo/assignments', body)
    expect(response.json()).toEqual({ changed: 3 })
    expect(calls[0]!.args).toEqual({ p_fixture_id: body.fixtureId, p_jersey_number: 7, p_player_id: body.playerId, p_apply_to_unassigned: true })
  })

  it('answers a player who already has a number with 409', async () => {
    const app = await startApp({
      roleProvider: rolesProvider(['team_manager']),
      supabaseClients: clients({ tables, userRpc: { playerboard_veo_assign_jersey: { data: null, error: { message: 'player_already_assigned', code: '23505' } } } }),
    })
    const response = await call(app, 'PUT', '/v1/playerboard/veo/assignments', body)
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'player_already_assigned' })
  })
})

describe('Veo conflicts', () => {
  const link = { team_id: TEAM_ID, organization_id: ORGANIZATION_ID, integration_source_id: SOURCE_ID, veo_club_name: 'TSV', veo_team_name: 'TSV U13', consecutive_failures: 0, last_error_code: null }
  const CONFLICT_ID = '53000000-7000-4000-8000-000000000001'
  const FREE = '53000000-3000-4000-8000-000000000001'
  const TAKEN = '53000000-3000-4000-8000-000000000002'

  it('lists open conflicts with the candidates that are still free', async () => {
    const app = await startApp({
      roleProvider: rolesProvider(['team_manager']),
      supabaseClients: clients({
        link,
        tables: {
          integration_sync_conflicts: [{ id: CONFLICT_ID, source_id: SOURCE_ID, label: 'Gamma am 19.09.2026 12:30', current_value: `${FREE},${TAKEN}`, incoming_value: '2026-09-19T10:30:00Z' }],
          fixtures: [{ id: FREE, kickoff_at: '2026-09-19T10:00:00+00:00', opponent_name: 'Alpha', is_home: null }, { id: TAKEN, kickoff_at: '2026-09-19T11:00:00+00:00', opponent_name: 'Beta', is_home: true }],
          playerboard_veo_matches: [{ fixture_id: TAKEN }],
        },
      }),
    })
    const response = await call(app, 'GET', `/v1/playerboard/veo/conflicts?teamId=${TEAM_ID}`)
    expect(response.json()).toEqual([{
      id: CONFLICT_ID, label: 'Gamma am 19.09.2026 12:30', veoStart: '2026-09-19T10:30:00Z',
      candidates: [{ fixtureId: FREE, kickoffAt: '2026-09-19T10:00:00+00:00', opponentName: 'Alpha', isHome: null }],
    }])
  })

  it('resolves to a fixture and starts a sync right away', async () => {
    const calls: RpcCall[] = []
    const app = await startApp({
      roleProvider: rolesProvider(['team_manager']),
      supabaseClients: clients({
        calls,
        link,
        tables: { integration_sync_conflicts: { source_id: SOURCE_ID } },
        rpc: {
          playerboard_veo_resolve_conflict: { data: null, error: null },
          enqueue_integration_sync: { data: [{ result: 'acquired', run_id: RUN_ID }], error: null },
        },
      }),
    })
    const response = await call(app, 'POST', `/v1/playerboard/veo/conflicts/${CONFLICT_ID}/resolve`, { action: 'fixture', fixtureId: FREE })
    expect(response.statusCode).toBe(202)
    expect(calls.map((entry) => entry.name)).toEqual(['playerboard_veo_resolve_conflict', 'enqueue_integration_sync'])
    expect(calls[0]!.args).toMatchObject({ p_conflict_id: CONFLICT_ID, p_action: 'fixture', p_fixture_id: FREE, p_user_id: USER_ID })
  })

  it('rejects a player', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ link, tables: { integration_sync_conflicts: { source_id: SOURCE_ID } } }) })
    const response = await call(app, 'POST', `/v1/playerboard/veo/conflicts/${CONFLICT_ID}/resolve`, { action: 'ignore' })
    expect(response.statusCode).toBe(403)
  })
})

describe('veo link token', () => {
  it('cannot be opened for another team, after expiry or when tampered with', () => {
    const now = Date.now()
    const token = sealVeoLinkToken(box, { teamId: TEAM_ID, userId: USER_ID, cookie: COOKIE, teams: [] }, now)
    expect(openVeoLinkToken(box, token, { teamId: TEAM_ID, userId: USER_ID }, now)?.cookie).toBe(COOKIE)
    expect(openVeoLinkToken(box, token, { teamId: DEPARTMENT_ID, userId: USER_ID }, now)).toBeNull()
    expect(openVeoLinkToken(box, token, { teamId: TEAM_ID, userId: USER_ID }, now + 16 * 60_000)).toBeNull()
    expect(openVeoLinkToken(box, `${token.slice(0, -2)}AA`, { teamId: TEAM_ID, userId: USER_ID }, now)).toBeNull()
    expect(openVeoLinkToken(box, 'garbage', { teamId: TEAM_ID, userId: USER_ID }, now)).toBeNull()
  })
})
