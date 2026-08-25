import { describe, expect, it } from 'vitest'
import {
  DEPARTMENT_ID, denyingRoleProvider, grantingRoleProvider, nonAdminProvider, organizationManagerRoleProvider, ORGANIZATION_ID, USER_ID,
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
  // Die Pruefung und die Reservierung laufen seit dem Review-Fix atomar in
  // reserve_storage_upload() (Migration 2026081303) -- die Route ruft nur noch diese eine RPC auf.
  it('rejects an upload once the organization storage limit is already reached', async () => {
    let capturedParams: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async (name: string, params: Record<string, unknown>) => {
            if (name !== 'reserve_storage_upload') throw new Error(`unexpected rpc in storage test fake: ${name}`)
            capturedParams = params
            return { data: null, error: { message: 'storage_limit_reached: organization/1000/1000' } }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients, uploads: { create: async () => { throw new Error('uploads.create should not be reached once storage is full') }, complete: async () => ({ accepted: true }) } })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/media/uploads', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 10 },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'storage_limit_reached', scope: 'organization', limitBytes: 1000, usedBytes: 1000 })
    expect(capturedParams).toMatchObject({ target_organization: ORGANIZATION_ID, target_department: DEPARTMENT_ID, announced_bytes: 10 })
  })

  // Org-level posting: ohne Abteilung entfaellt das departments/<id>-Segment im Objektpfad, und
  // reserve_storage_upload bekommt target_department null (kein Abteilungs-Speicherkontingent).
  // Der Pfad wird an zwei Stellen gebaut -- hier fuer die Reservierung, in SupabaseUploadService
  // .create() fuer die signierte URL. Laufen sie auseinander, liegt die Reservierung auf einem
  // anderen Objekt als die Bytes und /complete laedt ins Leere, deshalb pruefen beide Zusicherungen
  // denselben String.
  it('reserves an organization-level upload without a department segment in the object path', async () => {
    let capturedParams: Record<string, unknown> | undefined
    let capturedCreate: { departmentId: string | null; assetId: string } | undefined
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async (name: string, params: Record<string, unknown>) => {
            if (name !== 'reserve_storage_upload') throw new Error(`unexpected rpc in storage test fake: ${name}`)
            capturedParams = params
            return { data: { id: params.target_asset_id, organization_id: ORGANIZATION_ID, department_id: null, byte_size: 10, upload_status: 'initiated' }, error: null }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: grantingRoleProvider, supabaseClients: clients,
      uploads: {
        create: async (input) => { capturedCreate = input; return { uploadUrl: 'https://storage.invalid/x', objectPath: 'x', expiresAt: new Date().toISOString() } },
        complete: async () => ({ accepted: true }),
      },
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/media/uploads', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: null, filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 10 },
    })
    expect(response.statusCode).toBe(201)
    expect(capturedParams).toMatchObject({ target_organization: ORGANIZATION_ID, target_department: null })
    expect(capturedParams?.target_object_path).toBe(`organizations/${ORGANIZATION_ID}/assets/${capturedCreate?.assetId}/foto.jpg`)
    expect(capturedCreate?.departmentId).toBeNull()
  })

  it('accepts an upload under the limit and issues the upload URL after the RPC reservation succeeds', async () => {
    const reservationRow = { id: '10000000-9000-4000-8000-000000000001', organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, byte_size: 10, upload_status: 'initiated' }
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ rpc: async () => ({ data: reservationRow, error: null }) }) as unknown as SupabaseClient,
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
    expect(response.json()).toMatchObject({ uploadUrl: 'https://storage.invalid/x' })
  })
})
