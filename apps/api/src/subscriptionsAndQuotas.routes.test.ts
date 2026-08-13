import { describe, expect, it } from 'vitest'
import {
  chain, DEPARTMENT_ID, denyingRoleProvider, grantingRoleProvider, nonAdminProvider, organizationManagerRoleProvider, ORGANIZATION_ID, USER_ID,
  signAccessToken, startApp,
} from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

const POST_VERSION_ID = '10000000-3000-4000-8000-000000000001'
const SOCIAL_CONNECTION_ID = '10000000-8000-4000-8000-000000000001'

// Plan 021, "Verifikation PR 2": 403 ohne platform_admins-Eintrag fuer alle neuen
// Plattform-Admin-Routen -- requirePlatformAdmin scheitert bereits vor jedem Datenbankzugriff,
// deshalb genuegt hier ein Client, der bei Aufruf wirft.
describe('platform-admin subscription routes without a platform_admins entry', () => {
  const throwingClients: SupabaseClientFactory = {
    forUser: () => { throw new Error('forUser should not be reached') },
    forService: () => { throw new Error('forService should not be reached') },
  }

  const cases: { method: 'GET' | 'POST' | 'PATCH' | 'PUT'; url: string; payload: Record<string, unknown> }[] = [
    { method: 'GET', url: '/v1/platform-admin/subscription-plans', payload: {} },
    { method: 'POST', url: '/v1/platform-admin/subscription-plans', payload: { key: 'pro', displayName: 'Pro', monthlyPriceCents: 1000, storageBytes: 1000, maxTeams: null, maxDepartments: null, contentLimits: [{ mediaOrigin: 'own_upload', maxPerMonth: 10, maxDurationSeconds: null }] } },
    { method: 'PATCH', url: '/v1/platform-admin/subscription-plans/free', payload: { displayName: 'Kostenlos+' } },
    { method: 'PUT', url: '/v1/platform-admin/subscription-plans/free/content-limits', payload: { contentLimits: [{ mediaOrigin: 'own_upload', maxPerMonth: 10, maxDurationSeconds: null }] } },
    { method: 'PUT', url: `/v1/platform-admin/organizations/${ORGANIZATION_ID}/subscription`, payload: { planKey: 'free' } },
    { method: 'PUT', url: `/v1/platform-admin/organizations/${ORGANIZATION_ID}/content-limit-overrides`, payload: { mediaOrigin: 'own_upload', maxPerMonth: 5, maxDurationSeconds: null, overrideReason: 'Test' } },
  ]

  for (const testCase of cases) {
    it(`rejects ${testCase.method} ${testCase.url}`, async () => {
      const app = await startApp({ platformAdminProvider: nonAdminProvider, supabaseClients: throwingClients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: testCase.method, url: testCase.url, headers: { authorization: `Bearer ${token}` }, payload: testCase.payload })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ error: 'forbidden' })
    })
  }
})

describe('POST /v1/subscription/plan', () => {
  it('rejects a plan change without billing.manage', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/subscription/plan', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, planKey: 'starter' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })
})

describe('POST /v1/organizations/:orgId/departments -- structure_limit_reached mapping', () => {
  it('maps the enforce_structure_limit() trigger error to 409 structure_limit_reached', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'structure limit reached for this organization' } }) }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be reached once the RPC itself fails') },
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/organizations/${ORGANIZATION_ID}/departments`, headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Zu viel' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'structure_limit_reached' })
  })
})

describe('POST /v1/post-versions/:id/schedule -- content quota mapping', () => {
  it('maps content_quota_exceeded to 409, not the pre-existing quota_exceeded branch', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'content_quota_exceeded: own_upload/12' } }) }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be reached') },
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/post-versions/${POST_VERSION_ID}/schedule`, headers: { authorization: `Bearer ${token}` },
      payload: { socialConnectionId: SOCIAL_CONNECTION_ID, scheduledFor: null },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'content_quota_exceeded', detail: 'content_quota_exceeded: own_upload/12' })
  })

  it('maps content_duration_exceeded to 409', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'content_duration_exceeded: ai_video/10' } }) }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be reached') },
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/post-versions/${POST_VERSION_ID}/schedule`, headers: { authorization: `Bearer ${token}` },
      payload: { socialConnectionId: SOCIAL_CONNECTION_ID, scheduledFor: null },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'content_duration_exceeded', detail: 'content_duration_exceeded: ai_video/10' })
  })

  it('still maps the pre-existing channel_quotas quota_exceeded error to 409', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'quota_exceeded: organization/day' } }) }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be reached') },
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/post-versions/${POST_VERSION_ID}/schedule`, headers: { authorization: `Bearer ${token}` },
      payload: { socialConnectionId: SOCIAL_CONNECTION_ID, scheduledFor: null },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'quota_exceeded' })
  })
})

describe('POST /v1/media/uploads -- storage_limit_reached', () => {
  // organization.storageBytes (1000) already fully used -- any announced size is rejected before
  // the (unreachable) uploads.create() call, matching "checked when the signed URL is issued".
  function storageServiceClient(usedBytes: number): SupabaseClient {
    return {
      from: (table: string) => {
        if (table === 'organization_subscriptions') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
        if (table === 'storage_limits') return chain({ data: null, error: null })
        if (table === 'media_assets') return { insert: async () => ({ error: null }) }
        throw new Error(`unexpected table in storage test fake: ${table}`)
      },
      rpc: async (name: string, params: Record<string, unknown>) => {
        if (name === 'effective_limits') return { data: [{ storage_bytes: 1000, max_teams: null, max_departments: null }], error: null }
        if (name === 'storage_usage_bytes') return { data: params.target_department ? usedBytes : usedBytes, error: null }
        throw new Error(`unexpected rpc in storage test fake: ${name}`)
      },
    } as unknown as SupabaseClient
  }

  it('rejects an upload once the organization storage limit is already reached', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => storageServiceClient(1000),
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients, uploads: { create: async () => { throw new Error('uploads.create should not be reached once storage is full') }, complete: async () => ({ accepted: true }) } })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/media/uploads', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 10 },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'storage_limit_reached', scope: 'organization', limitBytes: 1000, usedBytes: 1000 })
  })

  it('accepts an upload under the limit and reserves a media_assets row before issuing the upload URL', async () => {
    const reservationRows: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => {
        const base = storageServiceClient(0)
        return {
          ...base,
          from: (table: string) => {
            if (table === 'media_assets') return { insert: async (row: Record<string, unknown>) => { reservationRows.push(row); return { error: null } } }
            return (base as unknown as { from: (t: string) => unknown }).from(table)
          },
        } as unknown as SupabaseClient
      },
    }
    const app = await startApp({
      roleProvider: grantingRoleProvider, supabaseClients: clients,
      uploads: { create: async () => ({ uploadUrl: 'https://storage.invalid/x', objectPath: 'x', expiresAt: new Date().toISOString() }), complete: async () => ({ accepted: true }) },
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/media/uploads', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 10 },
    })
    expect(response.statusCode).toBe(201)
    expect(reservationRows[0]).toMatchObject({ organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, byte_size: 10, upload_status: 'initiated' })
  })
})
