import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '@vereinsfunk/authorization'
import { describe, expect, it } from 'vitest'
import type { SupabaseClientFactory } from './app.js'
import type { RoleProvider } from './auth.js'
import { DEPARTMENT_ID, ORGANIZATION_ID, TEAM_ID, USER_ID, chain, moduleStatusProviderWith, signAccessToken, startApp } from './testSupport.js'

// Paket 052, PR 2: PlayerBoard-API. Die Fakes bedienen nur die Lesungen, die eine Route vor ihrer
// Rechtepruefung braucht (Mannschaft, Training, Foto, Kader-Eintrag ueber den Service-Client) --
// jede weitere Tabelle wirft, damit ein Schreibzugriff vor der Pruefung im Test auffliegt.

const TRAINING_ID = '52000000-5000-4000-8000-000000000001'
const PLAYER_ID = '52000000-3000-4000-8000-000000000001'
const PERSON_ID = '52000000-2000-4000-8000-000000000001'
const PHOTO_ID = '52000000-7000-4000-8000-000000000001'
const CATEGORY_ID = '52000000-4000-4000-8000-000000000001'

/** Erstellt einen Rollen-Provider, der fuer jeden abgefragten Scope dieselben Testrollen liefert. */
function rolesProvider(roles: Role[]): RoleProvider {
  return { async rolesForScope() { return roles } }
}

interface FakeOptions {
  userRpc?: Record<string, { data: unknown; error: unknown }>
  serviceRpc?: Record<string, { data: unknown; error: unknown }>
  userTables?: Record<string, unknown>
  serviceTables?: Record<string, unknown>
  audit?: Record<string, unknown>[]
}

/**
 * Erstellt getrennte Nutzer- und Service-Fakes mit expliziten Tabellen- und RPC-Antworten.
 * Unbekannte Zugriffe werfen; Audit-Eintraege werden optional gesammelt.
 */
function clients(options: FakeOptions = {}): SupabaseClientFactory {
  const baseService: Record<string, unknown> = {
    teams: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID },
    playerboard_trainings: { id: TRAINING_ID, team_id: TEAM_ID },
    playerboard_players: { id: PLAYER_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: TEAM_ID, directory_person_id: PERSON_ID },
    playerboard_training_photos: {
      id: PHOTO_ID, training_id: TRAINING_ID, storage_path: `${ORGANIZATION_ID}/${TEAM_ID}/${TRAINING_ID}/${PHOTO_ID}.jpg`, content_type: 'image/jpeg',
      size_bytes: 1000, public: false, consent_review_status: 'pending', all_recognizable_people_listed: false, uploaded_at: '2026-10-08T10:00:00Z', upload_completed_at: null,
    },
    playerboard_point_categories: { id: CATEGORY_ID, organization_id: ORGANIZATION_ID, scope: 'organization', department_id: null, team_id: null, name: 'Fairness', active: true, sort_order: 0, value_min: 0, value_max: 5 },
    ...options.serviceTables,
  }
  const table = (tables: Record<string, unknown>, label: string) => (name: string) => {
    if (name === 'audit_events') return { insert: async (row: Record<string, unknown>) => { options.audit?.push(row); return { error: null } } }
    if (!(name in tables)) throw new Error(`unexpected ${label} table in test fake: ${name}`)
    const value = tables[name]
    // { __count: n } bedient head-Abfragen mit count: 'exact'.
    if (value && typeof value === 'object' && '__count' in value) return chain({ data: null, error: null, count: (value as { __count: number }).__count })
    return chain({ data: value, error: null })
  }
  const rpc = (calls: Record<string, { data: unknown; error: unknown }>, label: string) => async (name: string) => {
    if (!(name in calls)) throw new Error(`unexpected ${label} rpc in test fake: ${name}`)
    return calls[name]
  }
  return {
    forUser: () => ({ from: table(options.userTables ?? {}, 'user'), rpc: rpc(options.userRpc ?? {}, 'user') }) as unknown as SupabaseClient,
    forService: () => ({ from: table(baseService, 'service'), rpc: rpc(options.serviceRpc ?? {}, 'service') }) as unknown as SupabaseClient,
  }
}

/** Sendet eine injizierte HTTP-Testanfrage mit einem signierten Token fuer USER_ID und optionalem Payload. */
async function call(app: Awaited<ReturnType<typeof startApp>>, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const token = await signAccessToken(USER_ID)
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) })
}

// Jede Schreibroute: Mannschaft/Training/Foto aufloesen, dann requirePermission auf training.manage
// bzw. playerboard.manage -- ein Spieler hat beides nicht, ein abgeschaltetes Modul sperrt alle.
const writeRoutes: { name: string; method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; url: string; payload?: unknown }[] = [
  { name: 'create player', method: 'POST', url: '/v1/playerboard/players', payload: { teamId: TEAM_ID, firstName: 'Mia', lastName: 'Keller' } },
  { name: 'update player', method: 'PATCH', url: `/v1/playerboard/players/${PLAYER_ID}`, payload: { jerseyNumber: 7 } },
  { name: 'remove player', method: 'DELETE', url: `/v1/playerboard/players/${PLAYER_ID}` },
  { name: 'invite player', method: 'POST', url: `/v1/playerboard/players/${PLAYER_ID}/invite`, payload: {} },
  { name: 'create training', method: 'POST', url: '/v1/playerboard/trainings', payload: { teamId: TEAM_ID, trainingDate: '2026-10-07' } },
  { name: 'update training', method: 'PATCH', url: `/v1/playerboard/trainings/${TRAINING_ID}`, payload: { status: 'saved' } },
  { name: 'delete training', method: 'DELETE', url: `/v1/playerboard/trainings/${TRAINING_ID}` },
  { name: 'save points', method: 'PUT', url: `/v1/playerboard/trainings/${TRAINING_ID}/points`, payload: { entries: [] } },
  { name: 'reserve photo upload', method: 'POST', url: `/v1/playerboard/trainings/${TRAINING_ID}/photos`, payload: { contentType: 'image/jpeg', sizeBytes: 1000 } },
  { name: 'complete photo', method: 'POST', url: `/v1/playerboard/photos/${PHOTO_ID}/complete` },
  { name: 'publish photo', method: 'PUT', url: `/v1/playerboard/photos/${PHOTO_ID}/public`, payload: { public: true } },
  { name: 'delete photo', method: 'DELETE', url: `/v1/playerboard/photos/${PHOTO_ID}` },
  { name: 'create category', method: 'POST', url: '/v1/playerboard/categories', payload: { scope: 'team', scopeId: TEAM_ID, name: 'Tore' } },
  { name: 'update category', method: 'PATCH', url: `/v1/playerboard/categories/${CATEGORY_ID}`, payload: { active: false } },
  { name: 'delete category', method: 'DELETE', url: `/v1/playerboard/categories/${CATEGORY_ID}` },
  { name: 'update settings', method: 'PUT', url: '/v1/playerboard/settings', payload: { scope: 'team', scopeId: TEAM_ID, patch: { publicPointsEnabled: true } } },
]

describe('PlayerBoard write routes', () => {
  for (const route of writeRoutes) {
    it(`${route.name}: 403 forbidden for a player`, async () => {
      const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients() })
      const response = await call(app, route.method, route.url, route.payload)
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ error: 'forbidden' })
    })

    it(`${route.name}: 403 module_disabled when PlayerBoard is off`, async () => {
      const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients(), moduleStatusProvider: moduleStatusProviderWith(['social_media']) })
      const response = await call(app, route.method, route.url, route.payload)
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ error: 'module_disabled', module: 'playerboard' })
    })
  }

  it('review: 403 for a player, module_disabled does not apply to consent.manage holders', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients() })
    const response = await call(app, 'POST', `/v1/playerboard/photos/${PHOTO_ID}/review`, { people: [], allRecognizablePeopleListed: true, makePublic: false })
    expect(response.statusCode).toBe(403)
  })
})

describe('PlayerBoard read routes', () => {
  it('reject a member without sight of the stats with 403', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ userRpc: { playerboard_can_view_stats: { data: false, error: null } } }) })
    for (const url of [`/v1/playerboard/teams/${TEAM_ID}/players`, `/v1/playerboard/teams/${TEAM_ID}/trainings`, `/v1/playerboard/teams/${TEAM_ID}/ranking`, `/v1/playerboard/trainings/${TRAINING_ID}`]) {
      const response = await call(app, 'GET', url)
      expect(response.statusCode, url).toBe(403)
      expect(response.json()).toMatchObject({ error: 'forbidden' })
    }
  })

  it('answer module_disabled before checking the stats visibility', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients(), moduleStatusProvider: moduleStatusProviderWith([]) })
    const response = await call(app, 'GET', `/v1/playerboard/teams/${TEAM_ID}/ranking`)
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'module_disabled' })
  })

  it('maps the ranking with shared ranks from the database', async () => {
    const app = await startApp({
      roleProvider: rolesProvider(['player']),
      supabaseClients: clients({ userRpc: {
        playerboard_can_view_stats: { data: true, error: null },
        playerboard_team_ranking: { data: [
          { player_id: PLAYER_ID, first_name: 'Mia', last_name: 'Keller', jersey_number: 7, rank: '1', total: '5', category_totals: { [CATEGORY_ID]: 5 } },
          { player_id: '52000000-3000-4000-8000-000000000002', first_name: 'Jonas', last_name: 'Albers', jersey_number: null, rank: '1', total: '5', category_totals: {} },
        ], error: null },
      } }),
    })
    const response = await call(app, 'GET', `/v1/playerboard/teams/${TEAM_ID}/ranking?from=2026-07-01`)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([
      { playerId: PLAYER_ID, firstName: 'Mia', lastName: 'Keller', jerseyNumber: 7, rank: 1, total: 5, categoryTotals: { [CATEGORY_ID]: 5 } },
      { playerId: '52000000-3000-4000-8000-000000000002', firstName: 'Jonas', lastName: 'Albers', jerseyNumber: null, rank: 1, total: 5, categoryTotals: {} },
    ])
  })

  it('shows e-mail addresses to coaches only', async () => {
    const roster = { data: [{ player_id: PLAYER_ID, directory_person_id: PERSON_ID, first_name: 'Mia', last_name: 'Keller', jersey_number: 7, position: null, active: true, has_account: false }], error: null }
    const fakes = clients({
      userRpc: { playerboard_can_view_stats: { data: true, error: null }, playerboard_team_roster: roster },
      serviceTables: { directory_people: [{ id: PERSON_ID, email: 'mia@example.local' }] },
    })
    const asPlayer = await call(await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: fakes }), 'GET', `/v1/playerboard/teams/${TEAM_ID}/players`)
    expect(asPlayer.json()[0]).not.toHaveProperty('email')
    const asCoach = await call(await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: fakes }), 'GET', `/v1/playerboard/teams/${TEAM_ID}/players`)
    expect(asCoach.json()[0]).toMatchObject({ email: 'mia@example.local' })
  })
})

describe('PlayerBoard coach flows', () => {
  it('creates a new person and squad entry in one RPC, deriving minority from the birth year', async () => {
    const calls: Record<string, unknown>[] = []
    const audit: Record<string, unknown>[] = []
    const fakes = clients({
      audit,
      userRpc: { playerboard_team_roster: { data: [{ player_id: PLAYER_ID, directory_person_id: PERSON_ID, first_name: 'Mia', last_name: 'Keller', jersey_number: 7, position: null, active: true, has_account: false }], error: null } },
      serviceTables: { directory_people: { email: null } },
    })
    const service = fakes.forService()
    fakes.forService = () => ({
      ...service,
      from: service.from.bind(service),
      rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, ...args }); return { data: { id: PLAYER_ID }, error: null } },
    }) as unknown as SupabaseClient
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: fakes })
    const response = await call(app, 'POST', '/v1/playerboard/players', { teamId: TEAM_ID, firstName: 'Mia', lastName: 'Keller', birthYear: new Date().getFullYear() - 12, jerseyNumber: 7 })
    expect(response.statusCode).toBe(201)
    expect(calls).toEqual([expect.objectContaining({ name: 'playerboard_create_player', target_team_id: TEAM_ID, target_is_minor: true, target_jersey_number: 7 })])
    expect(response.json()).toMatchObject({ id: PLAYER_ID, firstName: 'Mia', jerseyNumber: 7, email: null })
    expect(audit).toEqual([expect.objectContaining({ action: 'playerboard_player.created' })])
  })

  it('maps trigger errors of the points RPC to 422', async () => {
    const app = await startApp({
      roleProvider: rolesProvider(['team_manager']),
      supabaseClients: clients({ userRpc: { playerboard_set_training_points: { data: null, error: { message: 'point_value_out_of_range' } } } }),
    })
    const response = await call(app, 'PUT', `/v1/playerboard/trainings/${TRAINING_ID}/points`, { entries: [{ playerId: PLAYER_ID, categoryId: CATEGORY_ID, value: 99 }] })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'point_value_out_of_range' })
  })

  it('rejects duplicate player/category pairs in one save', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients() })
    const entry = { playerId: PLAYER_ID, categoryId: CATEGORY_ID, value: 1 }
    const response = await call(app, 'PUT', `/v1/playerboard/trainings/${TRAINING_ID}/points`, { entries: [entry, entry] })
    expect(response.statusCode).toBe(400)
  })

  it('asks for an e-mail when inviting a player without one', async () => {
    const app = await startApp({
      roleProvider: rolesProvider(['team_manager']),
      supabaseClients: clients({ serviceTables: { directory_people: { email: null, profile_id: null } } }),
    })
    const response = await call(app, 'POST', `/v1/playerboard/players/${PLAYER_ID}/invite`, {})
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'email_required' })
  })

  it('does not invite a player who already has an account', async () => {
    const app = await startApp({
      roleProvider: rolesProvider(['team_manager']),
      supabaseClients: clients({ serviceTables: { directory_people: { email: 'mia@example.local', profile_id: USER_ID } } }),
    })
    const response = await call(app, 'POST', `/v1/playerboard/players/${PLAYER_ID}/invite`, {})
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'player_has_account' })
  })

  it('refuses to delete a player who already has points', async () => {
    const app = await startApp({
      roleProvider: rolesProvider(['team_manager']),
      supabaseClients: clients({ serviceTables: { playerboard_point_entries: { __count: 3 } } }),
    })
    const response = await call(app, 'DELETE', `/v1/playerboard/players/${PLAYER_ID}`)
    expect(response.statusCode).toBe(409)
  })

  it('rejects public team page settings outside a team', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['organization_admin']), supabaseClients: clients() })
    const response = await call(app, 'PUT', '/v1/playerboard/settings', { scope: 'organization', scopeId: ORGANIZATION_ID, patch: { publicSlug: 'u13' } })
    expect(response.statusCode).toBe(400)
  })

  it('reports invalid photo consents with the affected people', async () => {
    const invalid = [{ directoryPersonId: PERSON_ID, consentRecordId: '52000000-6000-4000-8000-000000000002' }]
    const app = await startApp({
      roleProvider: rolesProvider(['team_manager']),
      supabaseClients: clients({ userRpc: { playerboard_review_photo_consent: { data: null, error: { message: 'photo_consent_invalid', details: JSON.stringify(invalid) } } } }),
    })
    const response = await call(app, 'POST', `/v1/playerboard/photos/${PHOTO_ID}/review`, {
      people: invalid, allRecognizablePeopleListed: true, makePublic: true,
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'photo_consent_invalid', invalid })
  })

  it('requires the explicit confirmation that every recognizable person is listed', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients() })
    const response = await call(app, 'POST', `/v1/playerboard/photos/${PHOTO_ID}/review`, { people: [], allRecognizablePeopleListed: false, makePublic: true })
    expect(response.statusCode).toBe(400)
  })

  // Paket 052, PR 3: Einwilligungsstand des Kaders fuer die Trainer-Oberflaeche.
  it('lists the photo consent of the squad for coaches only', async () => {
    const consents = { data: [
      { player_id: PLAYER_ID, directory_person_id: PERSON_ID, consent_record_id: '52000000-6000-4000-8000-000000000001' },
      { player_id: '52000000-3000-4000-8000-000000000002', directory_person_id: '52000000-2000-4000-8000-000000000002', consent_record_id: null },
    ], error: null }
    const fakes = clients({ serviceRpc: { playerboard_team_photo_consents: consents } })
    const url = `/v1/playerboard/teams/${TEAM_ID}/photo-consents`

    const asPlayer = await call(await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: fakes }), 'GET', url)
    expect(asPlayer.statusCode).toBe(403)
    const moduleOff = await call(await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: fakes, moduleStatusProvider: moduleStatusProviderWith(['social_media']) }), 'GET', url)
    expect(moduleOff.json()).toMatchObject({ error: 'module_disabled' })
    const asCoach = await call(await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: fakes }), 'GET', url)
    expect(asCoach.statusCode).toBe(200)
    expect(asCoach.json()).toEqual([
      { playerId: PLAYER_ID, directoryPersonId: PERSON_ID, consentRecordId: '52000000-6000-4000-8000-000000000001' },
      { playerId: '52000000-3000-4000-8000-000000000002', directoryPersonId: '52000000-2000-4000-8000-000000000002', consentRecordId: null },
    ])
  })

  it('returns the share path of a team with a public slug', async () => {
    const empty = { public_points_enabled: null, public_veo_stats_enabled: null, public_photos_enabled: null, public_slug: null }
    const app = await startApp({
      roleProvider: rolesProvider(['team_manager']),
      supabaseClients: clients({
        userTables: { organization_memberships: [], department_memberships: [], team_memberships: [{ id: 'membership' }] },
        serviceTables: {
          organizations: { name: 'SV Beispiel', slug: 'sv-beispiel' },
          departments: [{ id: DEPARTMENT_ID, name: 'Fussball' }],
          teams: [{ id: TEAM_ID, name: 'U13', department_id: DEPARTMENT_ID }],
          playerboard_settings: [
            { scope: 'organization', department_id: null, team_id: null, season_start: null, stats_visibility: null, overridable_fields: [], team_categories_allowed: null, public_sharing_allowed: null, ...empty },
            { scope: 'team', department_id: DEPARTMENT_ID, team_id: TEAM_ID, season_start: null, stats_visibility: null, overridable_fields: [], team_categories_allowed: null, public_sharing_allowed: null, ...empty, public_slug: 'u13' },
          ],
        },
      }),
    })
    const response = await call(app, 'GET', `/v1/organizations/${ORGANIZATION_ID}/playerboard/settings`)
    expect(response.statusCode).toBe(200)
    const entries = response.json() as { scope: string; publicPath: string | null; canEdit: boolean }[]
    expect(entries.map((entry) => [entry.scope, entry.publicPath])).toEqual([['organization', null], ['department', null], ['team', '/mannschaft/sv-beispiel/u13']])
  })
})

describe('PlayerBoard public team page', () => {
  /** Erstellt Service-RPC-Fakes fuer die oeffentliche Mannschaftsinfo und optionale weitere Antworten. */
  function publicClients(info: unknown[], extra: Record<string, { data: unknown; error: unknown }> = {}) {
    return clients({ serviceRpc: { playerboard_public_team_info: { data: info, error: null }, ...extra } })
  }

  it('answers 404 for an unknown or closed team page, without authentication', async () => {
    const app = await startApp({ supabaseClients: publicClients([]) })
    const response = await app.inject({ method: 'GET', url: '/v1/public/playerboard/sv-nordstadt/u13' })
    expect(response.statusCode).toBe(404)
  })

  it('rejects malformed slugs as not found', async () => {
    const app = await startApp({ supabaseClients: publicClients([]) })
    const response = await app.inject({ method: 'GET', url: '/v1/public/playerboard/SV%20Nordstadt/u13' })
    expect(response.statusCode).toBe(404)
  })

  it('serves the ranking with labels only and hides switched-off tabs', async () => {
    const info = [{ organization_name: 'SV Nordstadt', team_name: 'U13', points_enabled: true, veo_stats_enabled: false, photos_enabled: false }]
    const app = await startApp({ supabaseClients: publicClients(info, {
      playerboard_public_ranking: { data: [{ rank: '1', label: '#7 M. K.', total: '5', category_totals: [{ category: 'Fairness', points: 5 }] }], error: null },
    }) })
    const team = await app.inject({ method: 'GET', url: '/v1/public/playerboard/sv-nordstadt/u13' })
    expect(team.json()).toEqual({ organizationName: 'SV Nordstadt', teamName: 'U13', tabs: { points: true, veoStats: false, photos: false } })
    const ranking = await app.inject({ method: 'GET', url: '/v1/public/playerboard/sv-nordstadt/u13/ranking' })
    expect(ranking.json()).toEqual([{ rank: 1, label: '#7 M. K.', total: 5, categories: [{ category: 'Fairness', points: 5 }] }])
    const photos = await app.inject({ method: 'GET', url: '/v1/public/playerboard/sv-nordstadt/u13/photos' })
    expect(photos.statusCode).toBe(404)
  })
})
