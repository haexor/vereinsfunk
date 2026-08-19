import { describe, expect, it } from 'vitest'
import { chain, DEPARTMENT_ID, denyingRoleProvider, grantingRoleProvider, organizationManagerRoleProvider, ORGANIZATION_ID, signAccessToken, startApp, USER_ID } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

const PRESET_ID = '47000000-0000-4000-8000-000000000001'
const FRAME_ASSET_ID = '47000000-0000-4000-8000-000000000002'

const BASE_FIELDS = {
  name: 'Standard',
  frameType: 'none' as const,
  frameColor: null,
  frameWidthPx: null,
  frameCornerRadiusPx: null,
  frameBrandAssetId: null,
  logoEnabled: false,
  logoBrandAssetId: null,
  logoPosition: 'bottom_right' as const,
  logoSizePercent: null,
  logoMarginPercent: null,
  filter: 'original' as const,
}

const PRESET_ROW = {
  id: PRESET_ID, organization_id: ORGANIZATION_ID, department_id: null, team_id: null,
  name: 'Standard', is_active: true,
  frame_type: 'none', frame_color: null, frame_width_px: null, frame_corner_radius_px: null, frame_brand_asset_id: null,
  logo_enabled: false, logo_brand_asset_id: null, logo_position: 'bottom_right', logo_size_percent: null, logo_margin_percent: null,
  filter: 'original', created_by: USER_ID, created_at: '2026-08-19T10:00:00+00:00', updated_at: '2026-08-19T10:00:00+00:00',
}

function userClient(tables: Record<string, unknown>): SupabaseClient {
  return {
    from: (table: string) => {
      if (table in tables) return tables[table]
      throw new Error(`unexpected table in test fake: ${table}`)
    },
  } as unknown as SupabaseClient
}

describe('GET /v1/image-style-presets', () => {
  it('lists presets for the organization without a separate permission gate -- RLS filters visibility', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ image_style_presets: chain({ data: [PRESET_ROW], error: null }) }),
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET', url: '/v1/image-style-presets', headers: { authorization: `Bearer ${token}` }, query: { organizationId: ORGANIZATION_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().presets).toEqual([expect.objectContaining({ id: PRESET_ID, name: 'Standard', frameType: 'none' })])
  })
})

describe('POST /v1/image-style-presets', () => {
  it('rejects without brand.manage', async () => {
    // Der Handler loest departmentId/teamId (hier keine gesetzt) ueber resolveDirectoryScope auf,
    // bevor die Berechtigung geprueft wird -- der Nutzer-Client entsteht deshalb schon vor der
    // Ablehnung, ruft bei organisationsweitem Scope aber keine Tabelle auf.
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: (table: string) => { throw new Error(`unexpected table in test fake: ${table}`) } }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/image-style-presets', headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID },
    })
    expect(response.statusCode).toBe(403)
  })

  it('creates an organization-wide preset', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ image_style_presets: { insert: () => chain({ data: PRESET_ROW, error: null }) } }),
      forService: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/image-style-presets', headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ id: PRESET_ID, name: 'Standard', frameType: 'none', isActive: true })
  })

  it('rejects a departmentId that does not belong to the organization', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ departments: chain({ data: null, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/image-style-presets', headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID },
    })
    expect(response.statusCode).toBe(404)
  })

  it('rejects a frameBrandAssetId that is not a selectable, ready frame asset', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ brand_assets: chain({ data: null, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/image-style-presets', headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID, frameType: 'custom', frameBrandAssetId: FRAME_ASSET_ID },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_asset_reference' })
  })
})

describe('PATCH/DELETE /v1/image-style-presets/:id', () => {
  it('rejects PATCH without brand.manage on the preset\'s own scope', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ image_style_presets: chain({ data: PRESET_ROW, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: `/v1/image-style-presets/${PRESET_ID}`, headers: { authorization: `Bearer ${token}` }, payload: BASE_FIELDS,
    })
    expect(response.statusCode).toBe(403)
  })

  it('returns 404 for a preset invisible to (or nonexistent for) the caller', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ image_style_presets: chain({ data: null, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: `/v1/image-style-presets/${PRESET_ID}`, headers: { authorization: `Bearer ${token}` }, payload: BASE_FIELDS,
    })
    expect(response.statusCode).toBe(404)
  })

  it('updates a preset', async () => {
    const updatedRow = { ...PRESET_ROW, name: 'Herbstlich', filter: 'warm' }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          image_style_presets: {
            select: () => chain({ data: PRESET_ROW, error: null }),
            update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: updatedRow, error: null }) }) }) }),
          },
        }),
      forService: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: `/v1/image-style-presets/${PRESET_ID}`, headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, name: 'Herbstlich', filter: 'warm' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ name: 'Herbstlich', filter: 'warm' })
  })

  it('deletes a preset', async () => {
    let deleted = false
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          image_style_presets: {
            select: () => chain({ data: PRESET_ROW, error: null }),
            delete: () => ({ eq: async () => { deleted = true; return { error: null } } }),
          },
        }),
      forService: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'DELETE', url: `/v1/image-style-presets/${PRESET_ID}`, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(204)
    expect(deleted).toBe(true)
  })
})
