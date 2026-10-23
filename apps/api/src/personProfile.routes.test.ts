import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { SupabaseClientFactory } from './app.js'
import type { Role } from '@vereinsfunk/authorization'
import type { RoleProvider } from './auth.js'
import { DEPARTMENT_ID, ORGANIZATION_ID, TEAM_ID, USER_ID, chain, signAccessToken, startApp } from './testSupport.js'

// Spielerprofil auf Vereinsebene: GET /v1/people/:id/profile. Die Sichtbarkeit entscheidet die
// Datenbankfunktion person_profile (supabase/tests/person_profile.test.sql); hier geht es um die
// Abbildung der Antwort, die Validierung und darum, dass "unbekannt" und "nicht sichtbar" gleich
// aussehen.

const PERSON_ID = '58000000-2000-4000-8000-000000000001'
const PLAYER_ID = '58000000-3000-4000-8000-000000000001'
const FAIRNESS_ID = '58000000-4000-4000-8000-000000000001'
const TORE_ID = '58000000-4000-4000-8000-000000000002'

const profileRow = {
  id: PERSON_ID, organizationId: ORGANIZATION_ID, firstName: 'Mia', lastName: 'Keller', status: 'active',
  teams: [{
    teamId: TEAM_ID, teamName: 'U13', playerId: PLAYER_ID, jerseyNumber: 7, position: 'Sturm', active: true, isSelf: false,
    rank: 1, total: 9, categoryTotals: { [TORE_ID]: 4, [FAIRNESS_ID]: 5 },
    veoMatches: [],
  }],
}

interface FakeOptions {
  profile?: unknown
  rpcError?: unknown
  // Zeile aus directory_people, die die Route nur fuer Trainer liest.
  person?: { email: string | null; profile_id: string | null }
  // Spaltenliste jeder select()-Abfrage auf directory_people, damit Tests sehen, was gelesen wird.
  directoryPeopleSelects?: string[]
}

/** Rollen-Provider, der fuer jeden abgefragten Scope dieselben Testrollen liefert. */
function rolesProvider(roles: Role[]): RoleProvider {
  return { async rolesForScope() { return roles } }
}

/** Fakes fuer den Nutzer-Client (nur person_profile) und den Service-Client (nur Kategorien); alles andere wirft. */
function clients(options: FakeOptions = {}, calls: { name: string; args: unknown }[] = []): SupabaseClientFactory {
  const categories = [
    { id: TORE_ID, name: 'Tore', scope: 'team', sort_order: 0 },
    { id: FAIRNESS_ID, name: 'Fairness', scope: 'organization', sort_order: 1 },
  ]
  return {
    forUser: () => ({
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args })
        if (name !== 'person_profile') throw new Error(`unexpected user rpc in test fake: ${name}`)
        return { data: options.profile === undefined ? profileRow : options.profile, error: options.rpcError ?? null }
      },
    }) as unknown as SupabaseClient,
    forService: () => ({
      from: (name: string) => {
        if (name === 'teams') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }, error: null })
        if (name === 'directory_people') {
          const result = chain({ data: options.person ?? { email: null, profile_id: null }, error: null })
          return { ...result, select: (columns: string) => { options.directoryPeopleSelects?.push(columns); return result } }
        }
        if (name !== 'playerboard_point_categories') throw new Error(`unexpected service table in test fake: ${name}`)
        return chain({ data: categories, error: null })
      },
    }) as unknown as SupabaseClient,
  }
}

async function get(app: Awaited<ReturnType<typeof startApp>>, url: string) {
  const token = await signAccessToken(USER_ID)
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })
}

describe('GET /v1/people/:id/profile', () => {
  it('maps the profile with category names in the order of the club levels', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients() })
    const response = await get(app, `/v1/people/${PERSON_ID}/profile`)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      id: PERSON_ID, firstName: 'Mia', lastName: 'Keller', status: 'active',
      teams: [{
        teamId: TEAM_ID, teamName: 'U13', playerId: PLAYER_ID, jerseyNumber: 7, position: 'Sturm', active: true, isSelf: false,
        rank: 1, total: 9,
        // Vereinsweite Kategorien vor Mannschaftskategorien, wie in der Rangliste.
        categories: [{ name: 'Fairness', points: 5 }, { name: 'Tore', points: 4 }],
        veoMatches: [],
      }],
    })
  })

  it('passes through the player\'s Veo matches for the visible team', async () => {
    const veoMatches = [{
      fixtureId: '58000000-5000-4000-8000-000000000001', kickoffAt: '2026-10-20T18:00:00.000Z', opponentName: 'FC Beispiel',
      jerseyNumber: 7, stats: { football_goal_total: 2, seconds_played_total: 3600 },
    }]
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ profile: { ...profileRow, teams: [{ ...profileRow.teams[0], veoMatches }] } }) })
    expect((await get(app, `/v1/people/${PERSON_ID}/profile`)).json().teams[0].veoMatches).toEqual(veoMatches)
  })

  it('does not let personal data be cached', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients() })
    expect((await get(app, `/v1/people/${PERSON_ID}/profile`)).headers['cache-control']).toBe('private, no-store')
    expect((await get(app, `/v1/people/${PERSON_ID}/profile?period=all`)).headers['cache-control']).toBe('private, no-store')
  })

  it('answers 401 without a login', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients() })
    const response = await app.inject({ method: 'GET', url: `/v1/people/${PERSON_ID}/profile` })
    expect(response.statusCode).toBe(401)
  })

  it('answers 400 for an id that is not a UUID', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients() })
    const response = await get(app, '/v1/people/mia/profile')
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('answers 404 when the database function returns null', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ profile: null }) })
    const response = await get(app, `/v1/people/${PERSON_ID}/profile`)
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
  })

  it('answers 500 instead of a half-filled profile when the database answer has the wrong shape', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ profile: { ...profileRow, teams: [{ teamId: TEAM_ID }] } }) })
    const response = await get(app, `/v1/people/${PERSON_ID}/profile`)
    expect(response.statusCode).toBe(500)
  })
})

describe('management fields', () => {
  it('leaves email and hasAccount out of a player\'s view, as keys', async () => {
    const selects: string[] = []
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ person: { email: 'mia@example.org', profile_id: 'x' }, directoryPeopleSelects: selects }) })
    const body = (await get(app, `/v1/people/${PERSON_ID}/profile`)).json()
    expect(body).not.toHaveProperty('email')
    expect(body).not.toHaveProperty('hasAccount')
    expect(selects).toEqual([])
  })

  it('adds email and account state for a coach of a visible team', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients({ person: { email: 'mia@example.org', profile_id: 'a0000000-0000-4000-8000-000000000001' } }) })
    expect((await get(app, `/v1/people/${PERSON_ID}/profile`)).json()).toMatchObject({ email: 'mia@example.org', hasAccount: true })
  })

  it('reports a missing address and no account for a coach', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients({ person: { email: null, profile_id: null } }) })
    expect((await get(app, `/v1/people/${PERSON_ID}/profile`)).json()).toMatchObject({ email: null, hasAccount: false })
  })

  it('never reads or returns a birth year or a minor flag, not even for a coach', async () => {
    const selects: string[] = []
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients({
      person: { email: 'mia@example.org', profile_id: null, birth_year: 2013, is_minor: true } as never,
      profile: { ...profileRow, birthYear: 2013, isMinor: true },
      directoryPeopleSelects: selects,
    }) })
    const body = (await get(app, `/v1/people/${PERSON_ID}/profile`)).json()
    expect(body).not.toHaveProperty('birthYear')
    expect(body).not.toHaveProperty('isMinor')
    expect(body).not.toHaveProperty('birth_year')
    expect(selects).toEqual(['email, profile_id'])
  })

  it('gives a coach without a visible team no management fields', async () => {
    const app = await startApp({ roleProvider: rolesProvider(['team_manager']), supabaseClients: clients({ profile: { ...profileRow, teams: [] } }) })
    const body = (await get(app, `/v1/people/${PERSON_ID}/profile`)).json()
    expect(body.teams).toEqual([])
    expect(body).not.toHaveProperty('email')
  })
})

describe('unknown and invisible people', () => {
  it('answer with the same body apart from the correlation id', async () => {
    const unknown = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ profile: null }) })
    const invisible = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({ profile: null }) })
    const first = await get(unknown, `/v1/people/${PERSON_ID}/profile`)
    const second = await get(invisible, '/v1/people/58000000-2000-4000-8000-0000000000ff/profile')
    const strip = (body: Record<string, unknown>) => ({ ...body, correlationId: undefined })
    expect(first.statusCode).toBe(404)
    expect(second.statusCode).toBe(404)
    expect(strip(first.json())).toEqual(strip(second.json()))
    expect(first.headers['cache-control']).toBe(second.headers['cache-control'])
  })
})

describe('period', () => {
  it('asks for the current season by default and passes the whole period through', async () => {
    const calls: { name: string; args: unknown }[] = []
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({}, calls) })
    await get(app, `/v1/people/${PERSON_ID}/profile`)
    await get(app, `/v1/people/${PERSON_ID}/profile?period=all`)
    expect(calls).toEqual([
      { name: 'person_profile', args: { target_person_id: PERSON_ID, period: 'season' } },
      { name: 'person_profile', args: { target_person_id: PERSON_ID, period: 'all' } },
    ])
  })

  it('answers 400 for an unknown period without asking the database', async () => {
    const calls: { name: string; args: unknown }[] = []
    const app = await startApp({ roleProvider: rolesProvider(['player']), supabaseClients: clients({}, calls) })
    const response = await get(app, `/v1/people/${PERSON_ID}/profile?period=foo`)
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
    expect(calls).toEqual([])
  })
})
