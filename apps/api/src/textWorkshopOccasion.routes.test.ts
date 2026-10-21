import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'
import { chain, DEPARTMENT_ID, grantingRoleProvider, ORGANIZATION_ID, signAccessToken, startApp, USER_ID } from './testSupport.js'

const FIXTURE_ID = '3f000000-6000-4000-8000-000000000001'
const CLUB_EVENT_ID = '3f000000-7000-4000-8000-000000000001'
const OTHER_DEPARTMENT_ID = '3f000000-1100-4000-8000-000000000002'
const SESSION_ID = '3f000000-0000-4000-8000-000000000001'

function fixtureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, kind: 'match', competition: null,
    is_home: true, own_team_label: 'Erste', opponent_name: 'TSV Sued', kickoff_at: '2026-10-25T13:00:00Z', kickoff_time_confirmed: true,
    venue_name: 'Sportplatz Nord', venue_address: null, status: 'scheduled', home_score: null, away_score: null, note: null,
    announcement_dismissed_at: null, result_dismissed_at: null, source_id: null, source_updated_at: '2026-10-20T04:00:00Z',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-20T04:00:00Z',
    ...overrides,
  }
}

function clubEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CLUB_EVENT_ID, organization_id: ORGANIZATION_ID, department_id: null, team_id: null, title: 'Sommerfest', description: null,
    category: 'festival', starts_at: '2026-11-01T15:00:00Z', ends_at: null, all_day: false, location_name: null, location_address: null,
    registration_url: null, status: 'scheduled', invitation_dismissed_at: null, source_id: null, source_updated_at: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z',
    ...overrides,
  }
}

const SOCIAL_CONNECTIONS = [{ id: 'channel-instagram', platform: 'instagram', status: 'active', archived_at: null, responsible_profile_id: null }]
const CHANNEL_SCOPES = [{ social_connection_id: 'channel-instagram', scope: 'organization', department_id: null, team_id: null, can_schedule: true }]

function clientsFor(options: { fixture?: Record<string, unknown>; clubEvent?: Record<string, unknown>; onRpc?: (params: Record<string, unknown>) => void; onSessionUpdate?: (values: Record<string, unknown>) => void }): SupabaseClientFactory {
  return {
    forUser: () => ({
      from: (table: string) => {
        if (table === 'fixtures') return chain({ data: options.fixture ?? null, error: null })
        if (table === 'club_events') return chain({ data: options.clubEvent ?? null, error: null })
        if (table === 'organizations') return chain({ data: { timezone: 'Europe/Berlin' }, error: null })
        if (table === 'policy_settings') {
          return { select: (columns: string) => chain({ data: columns === 'require_channel_responsible' ? { require_channel_responsible: false } : [], error: null }) }
        }
        if (table === 'social_connections') return chain({ data: SOCIAL_CONNECTIONS, error: null })
        if (table === 'channel_scopes') return chain({ data: CHANNEL_SCOPES, error: null })
        if (table === 'text_generation_platform_defaults') return chain({ data: [], error: null })
        throw new Error(`unexpected table in test fake: ${table}`)
      },
    }) as unknown as SupabaseClient,
    forService: () => ({
      from: (table: string) => {
        if (table === 'platform_settings') return chain({ data: null, error: null })
        if (table === 'llm_provider_configurations') return chain({ data: [{ id: '3f000000-9000-4000-8000-000000000001' }], error: null })
        if (table === 'composition_sessions') return { update: (values: Record<string, unknown>) => { options.onSessionUpdate?.(values); return chain({ data: null, error: null }) } }
        throw new Error(`unexpected service table: ${table}`)
      },
      rpc: async (_name: string, params: Record<string, unknown>) => {
        options.onRpc?.(params)
        return { data: { sessionId: SESSION_ID, candidateIds: ['3f000000-0000-4000-8000-000000000002'] }, error: null }
      },
    }) as unknown as SupabaseClient,
  }
}

async function inject(clients: SupabaseClientFactory, request: { method: 'GET' | 'POST'; url: string; payload?: Record<string, unknown> }) {
  const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
  const token = await signAccessToken(USER_ID)
  return app.inject({ ...request, headers: { authorization: `Bearer ${token}` } })
}

const sessionPayload = {
  organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, communicationGoal: 'invite', requestedFormats: ['text_post'],
  targetPlatforms: ['instagram'], sourceMaterial: { facts: { opponent: 'vom Client geaendert' }, observations: ['Wir freuen uns auf euch'], quotes: [] },
}

describe('Textwerkstatt: Anlass aus dem Kalender', () => {
  it('previews the facts of a fixture with their source state and the suggested goal', async () => {
    const response = await inject(clientsFor({ fixture: fixtureRow() }), { method: 'GET', url: `/v1/text-workshop/occasion?organizationId=${ORGANIZATION_ID}&departmentId=${DEPARTMENT_ID}&fixtureId=${FIXTURE_ID}` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      kind: 'fixture', id: FIXTURE_ID, label: 'Spiel gegen TSV Sued', missing: [], capturedAt: '2026-10-20T04:00:00Z', suggestedGoal: 'invite',
      facts: { opponent: 'TSV Sued', location: 'Sportplatz Nord' },
    })
    expect(response.json().facts.date).toMatch(/25\.10\.2026/)
  })

  it('names what the source is missing and still prefills the rest', async () => {
    const response = await inject(clientsFor({ clubEvent: clubEventRow() }), { method: 'GET', url: `/v1/text-workshop/occasion?organizationId=${ORGANIZATION_ID}&departmentId=${DEPARTMENT_ID}&clubEventId=${CLUB_EVENT_ID}` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ kind: 'club_event', label: 'Sommerfest', missing: ['Ort'], facts: { title: 'Sommerfest' } })
    expect(response.json().facts.location).toBeUndefined()
  })

  it('rejects a fixture of another department', async () => {
    const response = await inject(clientsFor({ fixture: fixtureRow({ department_id: OTHER_DEPARTMENT_ID }) }), { method: 'GET', url: `/v1/text-workshop/occasion?organizationId=${ORGANIZATION_ID}&departmentId=${DEPARTMENT_ID}&fixtureId=${FIXTURE_ID}` })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'fixture_not_found_in_department' })
  })

  it('links the session to the fixture and generates from the facts the API derived itself', async () => {
    let rpcParams: Record<string, unknown> | undefined
    let sessionUpdate: Record<string, unknown> | undefined
    const response = await inject(
      clientsFor({ fixture: fixtureRow(), onRpc: (params) => { rpcParams = params }, onSessionUpdate: (values) => { sessionUpdate = values } }),
      { method: 'POST', url: '/v1/text-workshop/sessions', payload: { ...sessionPayload, fixtureId: FIXTURE_ID } },
    )
    expect(response.statusCode).toBe(202)
    const sourceMaterial = rpcParams?.p_source_material as { facts: Record<string, unknown>; observations: string[] }
    expect(sourceMaterial.facts.opponent).toBe('TSV Sued')
    expect(sourceMaterial.facts.location).toBe('Sportplatz Nord')
    expect(sourceMaterial.observations).toEqual(['Wir freuen uns auf euch'])
    expect(sessionUpdate).toMatchObject({
      fixture_id: FIXTURE_ID, club_event_id: null, source_revision_at: '2026-10-20T04:00:00Z',
      source_prefill_snapshot: { opponent: 'TSV Sued', location: 'Sportplatz Nord' },
      source_provenance: { opponent: { source: 'fixture', sourceId: FIXTURE_ID, capturedAt: '2026-10-20T04:00:00Z' } },
    })
  })

  it('does not start a session for a fixture outside the scope', async () => {
    let rpcCalled = false
    const response = await inject(
      clientsFor({ fixture: fixtureRow({ department_id: OTHER_DEPARTMENT_ID }), onRpc: () => { rpcCalled = true } }),
      { method: 'POST', url: '/v1/text-workshop/sessions', payload: { ...sessionPayload, fixtureId: FIXTURE_ID } },
    )
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'fixture_not_found_in_department' })
    expect(rpcCalled).toBe(false)
  })

  it('keeps a session without occasion unlinked', async () => {
    let sessionUpdated = false
    const response = await inject(clientsFor({ onSessionUpdate: () => { sessionUpdated = true } }), { method: 'POST', url: '/v1/text-workshop/sessions', payload: sessionPayload })
    expect(response.statusCode).toBe(202)
    expect(sessionUpdated).toBe(false)
  })
})
