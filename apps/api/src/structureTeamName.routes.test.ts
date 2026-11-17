import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { SupabaseClientFactory } from './app.js'
import type { RoleProvider } from './auth.js'
import { DEPARTMENT_ID, ORGANIZATION_ID, TEAM_ID, USER_ID, chain, signAccessToken, startApp } from './testSupport.js'

// Der Unique-Index teams_active_url_slug_unique verhindert zwei aktive Mannschaften mit demselben
// normalisierten Namen in einer Abteilung (ADR-014). Die API antwortet darauf mit 409
// team_name_taken, schreibt kein Audit-Ereignis und reicht jede andere 23505 als Fehler weiter.

const departmentAdmin: RoleProvider = { async rolesForScope() { return ['department_admin'] } }
const TEAM_NAME_TAKEN = { code: '23505', message: 'duplicate key value violates unique constraint "teams_active_url_slug_unique"' }
const OTHER_DUPLICATE = { code: '23505', message: 'duplicate key value violates unique constraint "teams_external_unique"' }

function clients(writeError: { code: string; message: string }, audit: unknown[]): SupabaseClientFactory {
  const user = {
    from: (table: string) => {
      if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
      if (table !== 'teams') throw new Error(`unexpected user table in test fake: ${table}`)
      const builder = chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }, error: null })
      builder.insert = () => chain({ data: null, error: writeError })
      builder.update = () => chain({ data: null, error: writeError })
      return builder
    },
  } as unknown as SupabaseClient
  const service = { from: (table: string) => (table === 'audit_events' ? { insert: async (row: unknown) => { audit.push(row); return { error: null } } } : chain({ data: null, error: null })) } as unknown as SupabaseClient
  return { forUser: () => user, forService: () => service }
}

async function send(writeError: { code: string; message: string }, request: { method: 'POST' | 'PATCH'; url: string; payload: unknown }) {
  const audit: unknown[] = []
  const app = await startApp({ roleProvider: departmentAdmin, supabaseClients: clients(writeError, audit) })
  const token = await signAccessToken(USER_ID)
  const response = await app.inject({ ...request, headers: { authorization: `Bearer ${token}` }, payload: request.payload as Record<string, unknown> })
  return { response, audit }
}

const requests = {
  create: { method: 'POST' as const, url: `/v1/departments/${DEPARTMENT_ID}/teams`, payload: { name: 'U13' } },
  rename: { method: 'PATCH' as const, url: `/v1/teams/${TEAM_ID}`, payload: { name: 'U13' } },
  unarchive: { method: 'PATCH' as const, url: `/v1/teams/${TEAM_ID}`, payload: { archived: false } },
}

describe('team name collision on the public address', () => {
  it.each(Object.entries(requests))('answers 409 team_name_taken when %s hits the team name index', async (_name, request) => {
    const { response, audit } = await send(TEAM_NAME_TAKEN, request)
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'team_name_taken' })
    expect(audit).toEqual([])
  })

  it.each(Object.entries(requests))('does not map another unique violation on %s', async (_name, request) => {
    const { response, audit } = await send(OTHER_DUPLICATE, request)
    expect(response.statusCode).toBe(500)
    expect(audit).toEqual([])
  })
})
