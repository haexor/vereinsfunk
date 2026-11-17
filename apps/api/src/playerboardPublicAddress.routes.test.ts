import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { SupabaseClientFactory } from './app.js'
import { ORGANIZATION_ID, chain, startApp } from './testSupport.js'

// Die oeffentliche Mannschaftsseite wird ueber Verein, Abteilung und Mannschaft gemeinsam
// aufgeloest (ADR-014). Jede Abweichung -- unbekannt, geschlossen, nicht zusammenpassend, frueherer
// zweiteiliger Pfad -- liefert dieselbe 404-Antwort, ohne Daten und ohne Weiterleitung.

const DEPARTMENT_A = '53000000-1100-4000-8000-00000000000a'
const DEPARTMENT_B = '53000000-1100-4000-8000-00000000000b'
const TEAM_A = '53000000-1200-4000-8000-00000000000a'
const TEAM_B = '53000000-1200-4000-8000-00000000000b'
const TRAINING_ID = '53000000-5000-4000-8000-000000000001'

interface Recorder {
  rpc: { name: string; args: Record<string, unknown> }[]
  brand: { table: string; column: string; value: unknown }[]
}

const KNOWN_TEAM_SLUGS = new Set(['u13', 'trainings', 'ranking', 'veo', 'photos'])

const infoRow = (departmentId: string, teamId: string) => ({
  organization_name: 'SV Nordstadt', team_name: 'U13', points_enabled: true, trainings_enabled: true, veo_stats_enabled: true, photos_enabled: true,
  organization_id: ORGANIZATION_ID, department_id: departmentId, team_id: teamId,
})

/** Verein sv-nordstadt mit zwei Abteilungen und je einer Mannschaft u13: die Info-Funktion antwortet nur fuer genau diese Slugs. */
function clients(record: Recorder, rpcData: Record<string, unknown> = {}): SupabaseClientFactory {
  const infoByDepartment: Record<string, unknown[]> = {
    handball: [infoRow(DEPARTMENT_A, TEAM_A)],
    fussball: [infoRow(DEPARTMENT_B, TEAM_B)],
  }
  const brandTable = (table: string) => {
    const builder = chain({ data: null, error: null })
    builder.eq = (column: string, value: unknown) => { record.brand.push({ table, column, value }); return builder }
    return builder
  }
  const service = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      record.rpc.push({ name, args })
      if (name === 'playerboard_public_team_info') {
        const known = args.org_slug === 'sv-nordstadt' && KNOWN_TEAM_SLUGS.has(args.team_slug as string)
        return { data: known ? infoByDepartment[args.department_slug as string] ?? [] : [], error: null }
      }
      return { data: name in rpcData ? rpcData[name] : [], error: null }
    },
    from: (table: string) => {
      if (table === 'organizations') return chain({ data: { timezone: 'Europe/Berlin' }, error: null })
      if (table === 'playerboard_settings') return chain({ data: [], error: null })
      if (table.endsWith('_brand_profiles')) return brandTable(table)
      throw new Error(`unexpected service table in test fake: ${table}`)
    },
  } as unknown as SupabaseClient
  return { forUser: () => { throw new Error('the public routes never use the user client') }, forService: () => service }
}

const emptyRecorder = (): Recorder => ({ rpc: [], brand: [] })
const get = (app: Awaited<ReturnType<typeof startApp>>, url: string) => app.inject({ method: 'GET', url })
const notFoundShape = (response: { statusCode: number; json: () => unknown }) => ({ status: response.statusCode, keys: Object.keys(response.json() as object).sort(), error: (response.json() as { error: string }).error })

describe('public PlayerBoard address validation', () => {
  it.each([
    ['uppercase club', '/SV-Nordstadt/handball/u13'],
    ['uppercase department', '/sv-nordstadt/Handball/u13'],
    ['uppercase team', '/sv-nordstadt/handball/U13'],
    ['club of 201 characters', `/${'a'.repeat(201)}/handball/u13`],
    ['department of 201 characters', `/sv-nordstadt/${'a'.repeat(201)}/u13`],
    ['team of 81 characters', `/sv-nordstadt/handball/${'a'.repeat(81)}`],
    ['dot segment as department', '/sv-nordstadt/%2E%2E/u13'],
    ['dot segment as team', '/sv-nordstadt/handball/%2E%2E'],
    ['double hyphen', '/sv-nordstadt/hand--ball/u13'],
  ])('answers 404 before any RPC for %s', async (_name, path) => {
    const record = emptyRecorder()
    const app = await startApp({ supabaseClients: clients(record) })
    const response = await get(app, `/v1/public/playerboard${path}`)
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
    expect(record.rpc).toEqual([])
  })

  it('accepts the maximum segment lengths', async () => {
    const record = emptyRecorder()
    const app = await startApp({ supabaseClients: clients(record) })
    await get(app, `/v1/public/playerboard/${'a'.repeat(200)}/${'b'.repeat(200)}/${'c'.repeat(80)}`)
    expect(record.rpc).toEqual([{ name: 'playerboard_public_team_info', args: { org_slug: 'a'.repeat(200), department_slug: 'b'.repeat(200), team_slug: 'c'.repeat(80) } }])
  })
})

describe('public PlayerBoard answers for addresses that resolve to nothing', () => {
  it('returns the identical 404 for unknown, closed and mismatching addresses', async () => {
    const record = emptyRecorder()
    const app = await startApp({ supabaseClients: clients(record) })
    const responses = await Promise.all([
      get(app, '/v1/public/playerboard/sv-nordstadt/unbekannt/u13'),
      get(app, '/v1/public/playerboard/anderer-verein/handball/u13'),
      get(app, '/v1/public/playerboard/sv-nordstadt/kein-sport/u13/ranking'),
      get(app, '/v1/public/playerboard/sv-nordstadt/handball/unbekannt'),
    ])
    expect(new Set(responses.map((response) => JSON.stringify(notFoundShape(response)))).size).toBe(1)
    expect(notFoundShape(responses[0]!)).toEqual({ status: 404, keys: ['correlationId', 'error'], error: 'not_found' })
  })

  it('answers every earlier two-segment shape with the same 404, no redirect', async () => {
    const record = emptyRecorder()
    const app = await startApp({ supabaseClients: clients(record) })
    const retired = await Promise.all([
      get(app, '/v1/public/playerboard/sv-nordstadt/u13'),
      get(app, `/v1/public/playerboard/sv-nordstadt/u13/trainings/${TRAINING_ID}`),
      get(app, '/v1/public/playerboard/sv-nordstadt/handball/u13/ranking/extra'),
    ])
    for (const response of retired) {
      expect(notFoundShape(response)).toEqual({ status: 404, keys: ['correlationId', 'error'], error: 'not_found' })
      expect(response.headers.location).toBeUndefined()
    }
    expect(record.rpc).toEqual([])
  })

  it('answers the earlier sub-endpoint shapes that read as a three-segment address with the generic 404', async () => {
    const record = emptyRecorder()
    const app = await startApp({ supabaseClients: clients(record) })
    for (const sub of ['trainings', 'ranking', 'veo', 'photos']) {
      const response = await get(app, `/v1/public/playerboard/sv-nordstadt/u13/${sub}`)
      expect(notFoundShape(response)).toEqual({ status: 404, keys: ['correlationId', 'error'], error: 'not_found' })
      expect(response.headers.location).toBeUndefined()
    }
  })

  it('answers 404 for a training of another team', async () => {
    const record = emptyRecorder()
    const app = await startApp({ supabaseClients: clients(record, { playerboard_public_training: null }) })
    const response = await get(app, `/v1/public/playerboard/sv-nordstadt/handball/u13/trainings/${TRAINING_ID}`)
    expect(response.statusCode).toBe(404)
    expect(record.rpc.at(-1)).toMatchObject({ name: 'playerboard_public_training', args: { department_slug: 'handball', team_slug: 'u13', target_training_id: TRAINING_ID } })
  })
})

describe('public PlayerBoard presentation of same-named teams', () => {
  it.each([
    ['handball', DEPARTMENT_A, TEAM_A],
    ['fussball', DEPARTMENT_B, TEAM_B],
  ])('loads brand colors for the team of department %s', async (departmentSlug, departmentId, teamId) => {
    const record = emptyRecorder()
    const app = await startApp({ supabaseClients: clients(record) })
    const response = await get(app, `/v1/public/playerboard/sv-nordstadt/${departmentSlug}/u13`)
    expect(response.statusCode).toBe(200)
    expect(record.rpc[0]).toEqual({ name: 'playerboard_public_team_info', args: { org_slug: 'sv-nordstadt', department_slug: departmentSlug, team_slug: 'u13' } })
    expect(record.brand).toContainEqual({ table: 'department_brand_profiles', column: 'department_id', value: departmentId })
    expect(record.brand).toContainEqual({ table: 'team_brand_profiles', column: 'team_id', value: teamId })
    expect(record.brand.filter((entry) => entry.value === (departmentId === DEPARTMENT_A ? DEPARTMENT_B : DEPARTMENT_A) || entry.value === (teamId === TEAM_A ? TEAM_B : TEAM_A))).toEqual([])
  })

  it('never puts an internal id into a public response', async () => {
    const record = emptyRecorder()
    const training = { trainingDate: '2026-10-22', entries: [{ label: '#7 M. K.', category: 'Fairness', value: 5 }] }
    const app = await startApp({ supabaseClients: clients(record, {
      playerboard_public_trainings: [{ training_id: TRAINING_ID, training_date: '2026-10-22' }],
      playerboard_public_training: training,
      playerboard_public_ranking: [{ rank: '1', label: '#7 M. K.', total: '5', category_totals: [] }],
    }) })
    const urls = ['', '/trainings', `/trainings/${TRAINING_ID}`, '/ranking', '/veo', '/photos']
    for (const suffix of urls) {
      const response = await get(app, `/v1/public/playerboard/sv-nordstadt/handball/u13${suffix}`)
      expect(response.statusCode, suffix).toBe(200)
      const body = JSON.stringify(response.json())
      for (const id of [ORGANIZATION_ID, DEPARTMENT_A, TEAM_A]) expect(body).not.toContain(id)
      expect(body).not.toMatch(/organization_id|department_id|team_id|organizationId|departmentId|teamId/)
    }
  })

  it.each(['trainings', 'ranking', 'veo', 'photos'])('still reaches the info and sub-endpoints of a team called %s', async (teamSlug) => {
    const record = emptyRecorder()
    const app = await startApp({ supabaseClients: clients(record, { playerboard_public_ranking: [], playerboard_public_trainings: [], playerboard_public_veo_stats: [], playerboard_public_photos: [] }) })
    const info = await get(app, `/v1/public/playerboard/sv-nordstadt/handball/${teamSlug}`)
    expect(info.statusCode).toBe(200)
    expect(info.json()).toMatchObject({ teamName: 'U13' })
    for (const sub of ['trainings', 'ranking', 'veo', 'photos']) {
      const response = await get(app, `/v1/public/playerboard/sv-nordstadt/handball/${teamSlug}/${sub}`)
      expect(response.statusCode, `${teamSlug}/${sub}`).toBe(200)
    }
    expect(record.rpc.every((call) => call.args.team_slug === teamSlug && call.args.department_slug === 'handball')).toBe(true)
  })
})
