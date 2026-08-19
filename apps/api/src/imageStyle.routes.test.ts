import sharp from 'sharp'
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

describe('POST /v1/post-media/:postMediaId/style-render', () => {
  const POST_MEDIA_ID = '47000000-1000-4000-8000-000000000001'
  const POST_VERSION_ID = '47000000-1000-4000-8000-000000000002'
  const POST_ID = '47000000-1000-4000-8000-000000000003'
  const SOURCE_ASSET_ID = '47000000-1000-4000-8000-000000000004'
  const CURRENT_DERIVATIVE_ID = '47000000-1000-4000-8000-000000000005'
  const LOGO_ASSET_ID = '47000000-1000-4000-8000-000000000006'
  const NEW_DERIVATIVE_ID = '47000000-1000-4000-8000-000000000007'

  const MEDIA_ROW = { id: POST_MEDIA_ID, organization_id: ORGANIZATION_ID, post_version_id: POST_VERSION_ID, media_derivative_id: CURRENT_DERIVATIVE_ID }
  const VERSION_ROW = { post_id: POST_ID }
  const EDITABLE_POST_ROW = { department_id: null, team_id: null, status: 'draft_ready' }

  const LOGO_PRESET_ROW = {
    ...PRESET_ROW,
    id: PRESET_ID, logo_enabled: true, logo_brand_asset_id: LOGO_ASSET_ID, logo_position: 'bottom_right', logo_size_percent: 15, logo_margin_percent: 5,
  }

  it('returns 404 when the post_media row does not exist', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ post_media: chain({ data: null, error: null }) }),
      forService: () => { throw new Error('forService should not be called before post_media is found') },
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/post-media/${POST_MEDIA_ID}/style-render`, headers: { authorization: `Bearer ${token}` }, payload: { stylePresetId: PRESET_ID },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'post_media_not_found' })
  })

  it('rejects without post.edit on the post\'s own department scope', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          post_media: chain({ data: MEDIA_ROW, error: null }),
          post_versions: chain({ data: VERSION_ROW, error: null }),
          posts: chain({ data: EDITABLE_POST_ROW, error: null }),
        }),
      forService: () => { throw new Error('forService should not be called before permission is granted') },
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/post-media/${POST_MEDIA_ID}/style-render`, headers: { authorization: `Bearer ${token}` }, payload: { stylePresetId: PRESET_ID },
    })
    expect(response.statusCode).toBe(403)
  })

  it('rejects once the post has been submitted for approval', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          post_media: chain({ data: MEDIA_ROW, error: null }),
          post_versions: chain({ data: VERSION_ROW, error: null }),
          posts: chain({ data: { ...EDITABLE_POST_ROW, status: 'awaiting_approval' }, error: null }),
        }),
      forService: () => { throw new Error('forService should not be called once the post is not editable') },
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/post-media/${POST_MEDIA_ID}/style-render`, headers: { authorization: `Bearer ${token}` }, payload: { stylePresetId: PRESET_ID },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'post_not_editable' })
  })

  it('rejects a preset that does not exist for this organization', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          post_media: chain({ data: MEDIA_ROW, error: null }),
          post_versions: chain({ data: VERSION_ROW, error: null }),
          posts: chain({ data: EDITABLE_POST_ROW, error: null }),
          image_style_presets: chain({ data: null, error: null }),
        }),
      forService: () => { throw new Error('forService should not be called before the preset is resolved') },
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/post-media/${POST_MEDIA_ID}/style-render`, headers: { authorization: `Bearer ${token}` }, payload: { stylePresetId: PRESET_ID },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'image_style_preset_not_found' })
  })

  it('rejects a preset that belongs to a different, non-inherited department', async () => {
    const foreignDepartmentPreset = { ...PRESET_ROW, department_id: DEPARTMENT_ID }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          post_media: chain({ data: MEDIA_ROW, error: null }),
          post_versions: chain({ data: VERSION_ROW, error: null }),
          posts: chain({ data: EDITABLE_POST_ROW, error: null }), // organisationsweiter Beitrag, kein departmentId
          image_style_presets: chain({ data: foreignDepartmentPreset, error: null }),
        }),
      forService: () => { throw new Error('forService should not be called for a non-selectable preset') },
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/post-media/${POST_MEDIA_ID}/style-render`, headers: { authorization: `Bearer ${token}` }, payload: { stylePresetId: PRESET_ID },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'image_style_preset_not_selectable' })
  })

  it('renders the preset onto the source photo and applies the new derivative to post_media', async () => {
    const sourcePhoto = await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer()
    const logoAsset = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer()

    const captured: { uploadedPath?: string; rpcArgs?: Record<string, unknown> } = {}
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          post_media: chain({ data: MEDIA_ROW, error: null }),
          post_versions: chain({ data: VERSION_ROW, error: null }),
          posts: chain({ data: EDITABLE_POST_ROW, error: null }),
          image_style_presets: chain({ data: LOGO_PRESET_ROW, error: null }),
          media_derivatives: chain({ data: { media_asset_id: SOURCE_ASSET_ID }, error: null }),
        }),
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'media_assets') return chain({ data: { bucket_id: 'raw-media', object_path: 'organizations/x/raw/original.png', sha256: 'a'.repeat(64) }, error: null })
            if (table === 'brand_assets') return chain({ data: { object_path: 'organizations/x/brand/logo.png' }, error: null })
            if (table === 'organization_brand_profiles') return chain({ data: null, error: null })
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
          storage: {
            from: (bucket: string) => ({
              download: async (path: string) => {
                if (bucket === 'raw-media' && path === 'organizations/x/raw/original.png') return { data: new Blob([sourcePhoto]), error: null }
                if (bucket === 'brand-assets' && path === 'organizations/x/brand/logo.png') return { data: new Blob([logoAsset]), error: null }
                throw new Error(`unexpected download: ${bucket}/${path}`)
              },
              upload: async (path: string) => {
                captured.uploadedPath = path
                return { error: null }
              },
              createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/rendered.png' }, error: null }),
            }),
          },
          rpc: async (name: string, args: Record<string, unknown>) => {
            if (name !== 'apply_image_style_render') throw new Error(`unexpected rpc: ${name}`)
            captured.rpcArgs = args
            return { data: NEW_DERIVATIVE_ID, error: null }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/post-media/${POST_MEDIA_ID}/style-render`, headers: { authorization: `Bearer ${token}` }, payload: { stylePresetId: PRESET_ID },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ mediaDerivativeId: NEW_DERIVATIVE_ID, signedUrl: 'https://signed.example/rendered.png' })
    expect(captured.uploadedPath).toEqual(response.json().objectPath)
    expect(captured.rpcArgs).toMatchObject({
      p_post_media_id: POST_MEDIA_ID,
      p_actor_user_id: USER_ID,
      p_style_preset_id: PRESET_ID,
      p_media_asset_id: SOURCE_ASSET_ID,
      p_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_mime_type: 'image/png',
    })
    const recipe = captured.rpcArgs!.p_recipe as { kind: string; stylePresetId: string; sourceMediaAssetId: string; sourceSha256: string; stylePresetSnapshot: Record<string, unknown> }
    expect(recipe).toMatchObject({ kind: 'image_style_v1', stylePresetId: PRESET_ID, sourceMediaAssetId: SOURCE_ASSET_ID, sourceSha256: 'a'.repeat(64) })
    expect(recipe.stylePresetSnapshot).toMatchObject({ logoEnabled: true, logoBrandAssetId: LOGO_ASSET_ID, filter: 'original' })
  })
})
