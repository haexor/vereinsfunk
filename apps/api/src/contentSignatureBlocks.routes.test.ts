import { describe, expect, it } from 'vitest'
import { chain, DEPARTMENT_ID, denyingRoleProvider, grantingRoleProvider, ORGANIZATION_ID, organizationManagerRoleProvider, signAccessToken, startApp, USER_ID } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

const BLOCK_ID = '48000000-0000-4000-8000-000000000001'

const BASE_FIELDS = {
  name: 'Standard-CTA',
  body: 'Mehr auf unserer Website: https://verein.example',
}

const BLOCK_ROW = {
  id: BLOCK_ID, organization_id: ORGANIZATION_ID, department_id: null,
  name: 'Standard-CTA', body: 'Mehr auf unserer Website: https://verein.example', is_active: true,
  created_by: USER_ID, created_at: '2026-08-23T10:00:00+00:00', updated_at: '2026-08-23T10:00:00+00:00',
}

function userClient(tables: Record<string, unknown>): SupabaseClient {
  return {
    from: (table: string) => {
      if (table in tables) return tables[table]
      throw new Error(`unexpected table in test fake: ${table}`)
    },
  } as unknown as SupabaseClient
}

describe('GET /v1/content-signature-blocks', () => {
  it('lists blocks for the organization without a separate permission gate -- RLS filters visibility', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ content_signature_blocks: chain({ data: [BLOCK_ROW], error: null }) }),
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET', url: '/v1/content-signature-blocks', headers: { authorization: `Bearer ${token}` }, query: { organizationId: ORGANIZATION_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().blocks).toEqual([expect.objectContaining({ id: BLOCK_ID, name: 'Standard-CTA', departmentId: null })])
  })
})

describe('POST /v1/content-signature-blocks', () => {
  it('rejects without post.create', async () => {
    // Der Handler loest departmentId (hier keines gesetzt) ueber resolveDirectoryScope auf, bevor
    // die Berechtigung geprueft wird -- der Nutzer-Client entsteht deshalb schon vor der Ablehnung,
    // ruft bei organisationsweitem Scope aber keine Tabelle auf.
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: (table: string) => { throw new Error(`unexpected table in test fake: ${table}`) } }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-signature-blocks', headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID },
    })
    expect(response.statusCode).toBe(403)
  })

  it('creates an organization-wide block', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ content_signature_blocks: { insert: () => chain({ data: BLOCK_ROW, error: null }) } }),
      forService: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-signature-blocks', headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ id: BLOCK_ID, name: 'Standard-CTA', isActive: true, departmentId: null })
  })

  it('creates a department-scoped block', async () => {
    const departmentRow = { ...BLOCK_ROW, department_id: DEPARTMENT_ID }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          departments: chain({ data: { organization_id: ORGANIZATION_ID }, error: null }),
          content_signature_blocks: { insert: () => chain({ data: departmentRow, error: null }) },
        }),
      forService: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-signature-blocks', headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ departmentId: DEPARTMENT_ID })
  })

  it('rejects a departmentId that does not belong to the organization', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ departments: chain({ data: null, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-signature-blocks', headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID },
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('PATCH/DELETE /v1/content-signature-blocks/:id', () => {
  it('rejects PATCH without post.create on the block\'s own scope', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ content_signature_blocks: chain({ data: BLOCK_ROW, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: `/v1/content-signature-blocks/${BLOCK_ID}`, headers: { authorization: `Bearer ${token}` }, payload: BASE_FIELDS,
    })
    expect(response.statusCode).toBe(403)
  })

  it('returns 404 for a block invisible to (or nonexistent for) the caller', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ content_signature_blocks: chain({ data: null, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: `/v1/content-signature-blocks/${BLOCK_ID}`, headers: { authorization: `Bearer ${token}` }, payload: BASE_FIELDS,
    })
    expect(response.statusCode).toBe(404)
  })

  it('validates PATCH input before querying the block', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => { throw new Error('invalid input must not query Supabase') },
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: `/v1/content-signature-blocks/${BLOCK_ID}`, headers: { authorization: `Bearer ${token}` }, payload: { name: '', body: BASE_FIELDS.body },
    })
    expect(response.statusCode).toBe(400)
  })

  it('updates a block', async () => {
    const updatedRow = { ...BLOCK_ROW, name: 'Herbst-CTA', is_active: false }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          content_signature_blocks: {
            select: () => chain({ data: BLOCK_ROW, error: null }),
            update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: updatedRow, error: null }) }) }) }),
          },
        }),
      forService: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: `/v1/content-signature-blocks/${BLOCK_ID}`, headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, name: 'Herbst-CTA', isActive: false },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ name: 'Herbst-CTA', isActive: false })
  })

  it('deletes a block', async () => {
    let deleted = false
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          content_signature_blocks: {
            select: () => chain({ data: BLOCK_ROW, error: null }),
            delete: ({ count }: { count: string }) => ({ eq: async () => { deleted = count === 'exact'; return { count: 1, error: null } } }),
          },
        }),
      forService: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'DELETE', url: `/v1/content-signature-blocks/${BLOCK_ID}`, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(204)
    expect(deleted).toBe(true)
  })

  it('returns 404 and does not audit when the block is concurrently deleted', async () => {
    let auditRecorded = false
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          content_signature_blocks: {
            select: () => chain({ data: BLOCK_ROW, error: null }),
            delete: () => ({ eq: async () => ({ count: 0, error: null }) }),
          },
        }),
      forService: () => ({ from: () => ({ insert: async () => { auditRecorded = true; return { error: null } } }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'DELETE', url: `/v1/content-signature-blocks/${BLOCK_ID}`, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(404)
    expect(auditRecorded).toBe(false)
  })
})
