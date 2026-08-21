import { describe, expect, it } from 'vitest'
import { chain, DEPARTMENT_ID, denyingRoleProvider, grantingRoleProvider, organizationManagerRoleProvider, ORGANIZATION_ID, signAccessToken, startApp, USER_ID } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

const PRESET_ID = '47100000-0000-4000-8000-000000000001'
const MEDIA_ASSET_ID_1 = '47100000-0000-4000-8000-000000000002'
const MEDIA_ASSET_ID_2 = '47100000-0000-4000-8000-000000000003'

const PRESET_ROW = {
  id: PRESET_ID, organization_id: ORGANIZATION_ID, department_id: null, team_id: null,
  name: 'Standard', is_active: true, kind: 'diagonal_split', divider_color: 'primary', divider_width_px: 6, corner_radius_px: null,
  created_by: USER_ID, created_at: '2026-08-20T10:00:00+00:00', updated_at: '2026-08-20T10:00:00+00:00',
}

function userClient(tables: Record<string, unknown>): SupabaseClient {
  return {
    from: (table: string) => {
      if (table in tables) return tables[table]
      throw new Error(`unexpected table in test fake: ${table}`)
    },
  } as unknown as SupabaseClient
}

describe('GET /v1/photo-layout-presets', () => {
  it('lists presets for the organization without a separate permission gate -- RLS filters visibility', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ photo_layout_presets: chain({ data: [PRESET_ROW], error: null }) }),
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET', url: '/v1/photo-layout-presets', headers: { authorization: `Bearer ${token}` }, query: { organizationId: ORGANIZATION_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().presets).toEqual([expect.objectContaining({ id: PRESET_ID, name: 'Standard', kind: 'diagonal_split' })])
  })
})

describe('POST /v1/photo-layout-presets', () => {
  it('rejects without brand.manage', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: (table: string) => { throw new Error(`unexpected table in test fake: ${table}`) } }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/photo-layout-presets', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, name: 'Standard', kind: 'diagonal_split', dividerColor: 'primary', dividerWidthPx: 6, cornerRadiusPx: null },
    })
    expect(response.statusCode).toBe(403)
  })

  it('creates an organization-wide preset', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ photo_layout_presets: { insert: () => chain({ data: PRESET_ROW, error: null }) } }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/photo-layout-presets', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, name: 'Standard', kind: 'diagonal_split', dividerColor: 'primary', dividerWidthPx: 6, cornerRadiusPx: null },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ id: PRESET_ID, name: 'Standard', kind: 'diagonal_split', isActive: true })
  })

  it('rejects a departmentId that does not belong to the organization', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ departments: chain({ data: null, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/photo-layout-presets', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, name: 'Standard', kind: 'diagonal_split', dividerColor: 'primary', dividerWidthPx: 6, cornerRadiusPx: null },
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('PATCH/DELETE /v1/photo-layout-presets/:id', () => {
  it("rejects PATCH without brand.manage on the preset's own scope", async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ photo_layout_presets: chain({ data: PRESET_ROW, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: `/v1/photo-layout-presets/${PRESET_ID}`, headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Standard', kind: 'diagonal_split', dividerColor: 'primary', dividerWidthPx: 6, cornerRadiusPx: null },
    })
    expect(response.statusCode).toBe(403)
  })

  it('deletes a preset the caller has brand.manage on', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ photo_layout_presets: { select: () => chain({ data: PRESET_ROW, error: null }), delete: () => chain({ data: null, error: null }) } }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'DELETE', url: `/v1/photo-layout-presets/${PRESET_ID}`, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(204)
  })
})

describe('POST /v1/photo-layout-presets/render', () => {
  const departmentsTable = chain({ data: { organization_id: ORGANIZATION_ID }, error: null })

  it('rejects without post.create on the department scope', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ departments: departmentsTable }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/photo-layout-presets/render', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetId: PRESET_ID, mediaAssetIds: [MEDIA_ASSET_ID_1, MEDIA_ASSET_ID_2] },
    })
    expect(response.statusCode).toBe(403)
  })

  it('rejects when the number of photos does not match the preset kind', async () => {
    // grid_2x2 verlangt genau 4 Fotos -- die Anfrage schickt nur 2 (weiterhin >= dem globalen
    // Contract-Minimum von 2, faellt also nicht schon an der Zod-Validierung durch).
    const gridPreset = { ...PRESET_ROW, kind: 'grid_2x2' }
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ departments: departmentsTable, photo_layout_presets: chain({ data: gridPreset, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/photo-layout-presets/render', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetId: PRESET_ID, mediaAssetIds: [MEDIA_ASSET_ID_1, MEDIA_ASSET_ID_2] },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'photo_layout_wrong_photo_count' })
  })

  it('rejects an inactive preset', async () => {
    const inactivePreset = { ...PRESET_ROW, is_active: false }
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ departments: departmentsTable, photo_layout_presets: chain({ data: inactivePreset, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/photo-layout-presets/render', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetId: PRESET_ID, mediaAssetIds: [MEDIA_ASSET_ID_1, MEDIA_ASSET_ID_2] },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'photo_layout_preset_not_active' })
  })

  it('rejects a team-scoped preset -- the attach flow has no team scope to select it from', async () => {
    const teamPreset = { ...PRESET_ROW, department_id: DEPARTMENT_ID, team_id: '10000000-1200-4000-8000-000000000001' }
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ departments: departmentsTable, photo_layout_presets: chain({ data: teamPreset, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/photo-layout-presets/render', headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetId: PRESET_ID, mediaAssetIds: [MEDIA_ASSET_ID_1, MEDIA_ASSET_ID_2] },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'photo_layout_preset_not_selectable' })
  })
})
