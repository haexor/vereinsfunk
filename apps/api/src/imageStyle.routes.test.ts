import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  chain,
  DEPARTMENT_ID,
  denyingRoleProvider,
  grantingRoleProvider,
  organizationManagerRoleProvider,
  ORGANIZATION_ID,
  signAccessToken,
  startApp,
  USER_ID,
} from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

const PRESET_ID = '47000000-0000-4000-8000-000000000001'
const FRAME_ASSET_ID = '47000000-0000-4000-8000-000000000002'
const LOGO_ASSET_ID = '47000000-0000-4000-8000-000000000003'

const BASE_FIELDS = {
  name: 'Standard',
  frameType: 'none' as const,
  frameStyle: null,
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
  id: PRESET_ID,
  organization_id: ORGANIZATION_ID,
  department_id: null,
  team_id: null,
  name: 'Standard',
  is_active: true,
  frame_type: 'none',
  frame_style: null,
  frame_color: null,
  frame_width_px: null,
  frame_corner_radius_px: null,
  frame_brand_asset_id: null,
  logo_enabled: false,
  logo_brand_asset_id: null,
  logo_position: 'bottom_right',
  logo_size_percent: null,
  logo_margin_percent: null,
  filter: 'original',
  created_by: USER_ID,
  created_at: '2026-08-19T10:00:00+00:00',
  updated_at: '2026-08-19T10:00:00+00:00',
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
      forUser: () =>
        userClient({ image_style_presets: chain({ data: [PRESET_ROW], error: null }) }),
      forService: () => {
        throw new Error('forService should not be called by this route')
      },
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: '/v1/image-style-presets',
      headers: { authorization: `Bearer ${token}` },
      query: { organizationId: ORGANIZATION_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().presets).toEqual([
      expect.objectContaining({ id: PRESET_ID, name: 'Standard', frameType: 'none' }),
    ])
  })
})

describe('POST /v1/image-style-presets', () => {
  it('rejects without brand.manage', async () => {
    // Der Handler loest departmentId/teamId (hier keine gesetzt) ueber resolveDirectoryScope auf,
    // bevor die Berechtigung geprueft wird -- der Nutzer-Client entsteht deshalb schon vor der
    // Ablehnung, ruft bei organisationsweitem Scope aber keine Tabelle auf.
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/image-style-presets',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID },
    })
    expect(response.statusCode).toBe(403)
  })

  it('creates an organization-wide preset', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          image_style_presets: { insert: () => chain({ data: PRESET_ROW, error: null }) },
        }),
      forService: () =>
        ({ from: () => ({ insert: async () => ({ error: null }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/image-style-presets',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      id: PRESET_ID,
      name: 'Standard',
      frameType: 'none',
      isActive: true,
    })
  })

  it('rejects a departmentId that does not belong to the organization', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ departments: chain({ data: null, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/image-style-presets',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID },
    })
    expect(response.statusCode).toBe(404)
  })

  it('rejects a frameBrandAssetId that is not a selectable, ready frame asset', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ brand_assets: chain({ data: null, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/image-style-presets',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...BASE_FIELDS,
        organizationId: ORGANIZATION_ID,
        frameType: 'custom',
        frameBrandAssetId: FRAME_ASSET_ID,
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_asset_reference' })
  })

  // logo_brand_asset_id ist nicht mehr auf kind='watermark' gepinnt (2026082002) -- jede
  // Logovariante aus LOGO_ASSET_KINDS ist waehlbar, u.a. das ueber die Marke-Seite hochgeladene
  // Hauptlogo (kind='logo_primary'/'logo_dark').
  it('accepts a logoBrandAssetId that references the main logo instead of a dedicated watermark upload', async () => {
    const updatedRow = {
      ...PRESET_ROW,
      logo_enabled: true,
      logo_brand_asset_id: LOGO_ASSET_ID,
      logo_size_percent: 12,
      logo_margin_percent: 4,
    }
    let insertedPayload: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () =>
        userClient({
          brand_assets: chain({
            data: {
              id: LOGO_ASSET_ID,
              kind: 'logo_primary',
              department_id: null,
              team_id: null,
              status: 'ready',
            },
            error: null,
          }),
          image_style_presets: {
            insert: (payload: Record<string, unknown>) => {
              insertedPayload = payload
              return chain({ data: updatedRow, error: null })
            },
          },
        }),
      forService: () =>
        ({ from: () => ({ insert: async () => ({ error: null }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/image-style-presets',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...BASE_FIELDS,
        organizationId: ORGANIZATION_ID,
        logoEnabled: true,
        logoBrandAssetId: LOGO_ASSET_ID,
        logoSizePercent: 12,
        logoMarginPercent: 4,
      },
    })
    expect(response.statusCode).toBe(201)
    expect(insertedPayload).toMatchObject({ logo_brand_asset_id: LOGO_ASSET_ID })
  })
})

describe('POST /v1/image-style-presets/preview', () => {
  const PREVIEW_URL = '/v1/image-style-presets/preview'

  async function tinyImage(): Promise<Buffer> {
    return sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer()
  }

  // organization_brand_profiles ist die einzige Service-Tabelle, die loadResolvedBrandColors ohne
  // department-/teamId abfragt (siehe routes/imageStyle.ts) -- null faellt auf die Default-Marke
  // zurueck, genau wie bei einem Verein ohne eigenes Markenprofil.
  function noAssetClients(): SupabaseClientFactory {
    return {
      forUser: () => userClient({}),
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_brand_profiles') return chain({ data: null, error: null })
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
  }

  async function preview(
    body: Record<string, unknown>,
    options: { clients?: SupabaseClientFactory; imageEffects?: unknown } = {},
  ) {
    const image = await tinyImage()
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: options.clients ?? noAssetClients(),
      samplePhotoLoader: async () => image,
      ...(options.imageEffects ? { imageEffects: options.imageEffects as never } : {}),
    })
    const token = await signAccessToken(USER_ID)
    return app.inject({
      method: 'POST',
      url: PREVIEW_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID, ...body },
    })
  }

  it('renders a preview for a plain, unstyled preset', async () => {
    const response = await preview({})
    expect(response.statusCode).toBe(200)
    const json = response.json()
    expect(json.filterProvider).toBe('sharp')
    expect(json.contentType).toBe('image/png')
    expect(Buffer.from(json.imageBase64, 'base64').length).toBeGreaterThan(0)
  })

  it('renders a preview for a draft that has no name yet', async () => {
    const { name: _name, ...withoutName } = BASE_FIELDS
    const response = await preview(withoutName)
    expect(response.statusCode).toBe(200)
  })

  it("rejects a G'MIC filter when no provider is configured", async () => {
    const response = await preview({ filter: 'gmic_vintage' })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'gmic_not_enabled' })
  })

  it("renders a G'MIC filter through an injected provider", async () => {
    const response = await preview(
      { filter: 'gmic_vintage' },
      {
        imageEffects: {
          id: 'fake-gmic',
          supports: (effect: string): effect is 'gmic_vintage' => effect === 'gmic_vintage',
          apply: async (_effect: string, buffer: Buffer) => buffer,
        },
      },
    )
    expect(response.statusCode).toBe(200)
    expect(response.json().filterProvider).toBe('fake-gmic')
  })

  it('rejects a frameBrandAssetId that is not a selectable, ready frame asset', async () => {
    const response = await preview(
      { frameType: 'custom', frameBrandAssetId: FRAME_ASSET_ID },
      {
        clients: {
          forUser: () => userClient({ brand_assets: chain({ data: null, error: null }) }),
          forService: () => ({}) as unknown as SupabaseClient,
        },
      },
    )
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_asset_reference' })
  })

  // loadSelectableBrandAsset (Nutzer-Client, oben) sieht die Zeile als bereit; downloadBrandAssetBuffer
  // (Service-Client, unten) trifft sie kurz danach als nicht mehr bereit an -- ein echter, wenn auch
  // seltener Race-Fall zwischen den beiden Abfragen, den beide Funktionen unveraendert schon abdecken.
  it('maps a brand asset that stops being ready between both checks to 422', async () => {
    const response = await preview(
      { frameType: 'custom', frameBrandAssetId: FRAME_ASSET_ID },
      {
        clients: {
          forUser: () =>
            userClient({
              brand_assets: chain({
                data: {
                  id: FRAME_ASSET_ID,
                  kind: 'frame',
                  department_id: null,
                  team_id: null,
                  status: 'ready',
                },
                error: null,
              }),
            }),
          forService: () =>
            ({
              from: (table: string) => {
                if (table === 'brand_assets') return chain({ data: null, error: null })
                if (table === 'organization_brand_profiles')
                  return chain({ data: null, error: null })
                throw new Error(`unexpected table in service test fake: ${table}`)
              },
            }) as unknown as SupabaseClient,
        },
      },
    )
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'brand_asset_not_ready' })
  })

  it('rejects without brand.manage', async () => {
    const image = await tinyImage()
    const app = await startApp({
      roleProvider: denyingRoleProvider,
      supabaseClients: noAssetClients(),
      samplePhotoLoader: async () => image,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: PREVIEW_URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...BASE_FIELDS, organizationId: ORGANIZATION_ID },
    })
    expect(response.statusCode).toBe(403)
  })

  // Eigene, sonst nirgends verwendete userId: checkRateLimit haelt seine Zaehler in einem
  // Modul-Singleton (routes/shared.ts), geteilt mit jedem anderen Test dieser Datei -- eine fremde
  // userId wuerde deren Zaehlerstand einfach fortsetzen statt bei 0 zu beginnen.
  it('rate-limits after too many preview requests from the same user', async () => {
    const rateLimitedUserId = '47000000-2000-4000-8000-000000000099'
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: {
        forUser: () => {
          throw new Error('forUser should not be called once rate-limited')
        },
        forService: () => {
          throw new Error('forService should not be called once rate-limited')
        },
      },
      samplePhotoLoader: async () => Buffer.alloc(0),
    })
    const token = await signAccessToken(rateLimitedUserId)
    let last: Awaited<ReturnType<typeof app.inject>> | undefined
    for (let attempt = 0; attempt < 31; attempt++) {
      last = await app.inject({
        method: 'POST',
        url: PREVIEW_URL,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      })
    }
    expect(last?.statusCode).toBe(429)
    expect(last?.json()).toMatchObject({ error: 'rate_limited' })
  })
})

describe('PATCH/DELETE /v1/image-style-presets/:id', () => {
  it("rejects PATCH without brand.manage on the preset's own scope", async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClient({ image_style_presets: chain({ data: PRESET_ROW, error: null }) }),
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/image-style-presets/${PRESET_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: BASE_FIELDS,
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
      method: 'PATCH',
      url: `/v1/image-style-presets/${PRESET_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: BASE_FIELDS,
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
            update: () => ({
              eq: () => ({
                select: () => ({ maybeSingle: async () => ({ data: updatedRow, error: null }) }),
              }),
            }),
          },
        }),
      forService: () =>
        ({ from: () => ({ insert: async () => ({ error: null }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/image-style-presets/${PRESET_ID}`,
      headers: { authorization: `Bearer ${token}` },
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
            delete: () => ({
              eq: async () => {
                deleted = true
                return { error: null }
              },
            }),
          },
        }),
      forService: () =>
        ({ from: () => ({ insert: async () => ({ error: null }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/image-style-presets/${PRESET_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
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
  const OTHER_VERSION_ID = '47000000-1000-4000-8000-000000000008'

  const MEDIA_ROW = {
    organization_id: ORGANIZATION_ID,
    post_version_id: POST_VERSION_ID,
    media_derivative_id: CURRENT_DERIVATIVE_ID,
  }
  const VERSION_ROW = { post_id: POST_ID }
  // posts.department_id ist NOT NULL -- ein Beitrag ohne Abteilung existiert nicht, und nur mit
  // gesetzter Abteilung laeuft ueberhaupt der Zweig, der department_brand_profiles aufloest.
  const EDITABLE_POST_ROW = {
    department_id: DEPARTMENT_ID,
    team_id: null,
    status: 'draft_ready',
    current_version_id: POST_VERSION_ID,
  }
  const SOURCE_ASSET_ROW = {
    bucket_id: 'raw-media',
    object_path: 'organizations/x/raw/original.png',
    mime_type: 'image/png',
    sha256: 'a'.repeat(64),
  }

  const LOGO_PRESET_ROW = {
    ...PRESET_ROW,
    id: PRESET_ID,
    logo_enabled: true,
    logo_brand_asset_id: LOGO_ASSET_ID,
    logo_position: 'bottom_right',
    logo_size_percent: 15,
    logo_margin_percent: 5,
  }

  // post_media/post_versions/media_derivatives laufen ueber die Service Role (ihre SELECT-Policies
  // kennen nur is_organization_member), posts und image_style_presets ueber den Nutzer-Client.
  function styleRenderClients(options: {
    postMedia?: unknown
    post?: unknown
    preset?: unknown
    mediaDerivative?: unknown
    sourceAsset?: unknown
    rpc?: { data: unknown; error: unknown }
    captured?: { uploadedPath?: string; rpcArgs?: Record<string, unknown> }
    sourcePhoto?: Buffer<ArrayBuffer>
    logoAsset?: Buffer<ArrayBuffer>
  }): SupabaseClientFactory {
    const captured = options.captured ?? {}
    return {
      forUser: () =>
        userClient({
          posts: chain({
            data: options.post === undefined ? EDITABLE_POST_ROW : options.post,
            error: null,
          }),
          image_style_presets: chain({
            data: options.preset === undefined ? PRESET_ROW : options.preset,
            error: null,
          }),
        }),
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'post_media')
              return chain({
                data: options.postMedia === undefined ? MEDIA_ROW : options.postMedia,
                error: null,
              })
            if (table === 'post_versions') return chain({ data: VERSION_ROW, error: null })
            if (table === 'media_derivatives')
              return chain({
                data:
                  options.mediaDerivative === undefined
                    ? { media_asset_id: SOURCE_ASSET_ID }
                    : options.mediaDerivative,
                error: null,
              })
            if (table === 'media_assets')
              return chain({
                data: options.sourceAsset === undefined ? SOURCE_ASSET_ROW : options.sourceAsset,
                error: null,
              })
            if (table === 'brand_assets')
              return chain({ data: { object_path: 'organizations/x/brand/logo.png' }, error: null })
            if (table === 'organization_brand_profiles') return chain({ data: null, error: null })
            if (table === 'department_brand_profiles') return chain({ data: null, error: null })
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
          storage: {
            from: (bucket: string) => ({
              download: async (path: string) => {
                if (bucket === 'raw-media')
                  return { data: new Blob([options.sourcePhoto ?? Buffer.alloc(0)]), error: null }
                if (bucket === 'brand-assets' && path === 'organizations/x/brand/logo.png')
                  return { data: new Blob([options.logoAsset ?? Buffer.alloc(0)]), error: null }
                throw new Error(`unexpected download: ${bucket}/${path}`)
              },
              upload: async (path: string) => {
                captured.uploadedPath = path
                return { error: null }
              },
              createSignedUrl: async () => ({
                data: { signedUrl: 'https://signed.example/rendered.png' },
                error: null,
              }),
            }),
          },
          rpc: async (name: string, args: Record<string, unknown>) => {
            if (name !== 'apply_image_style_render') throw new Error(`unexpected rpc: ${name}`)
            captured.rpcArgs = args
            return options.rpc ?? { data: NEW_DERIVATIVE_ID, error: null }
          },
        }) as unknown as SupabaseClient,
    }
  }

  async function styleRender(
    clients: SupabaseClientFactory,
    roleProvider = organizationManagerRoleProvider,
  ) {
    const app = await startApp({ roleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    return app.inject({
      method: 'POST',
      url: `/v1/post-media/${POST_MEDIA_ID}/style-render`,
      headers: { authorization: `Bearer ${token}` },
      payload: { stylePresetId: PRESET_ID },
    })
  }

  it('returns 404 when the post_media row does not exist', async () => {
    const response = await styleRender(styleRenderClients({ postMedia: null }))
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'post_media_not_found' })
  })

  it("rejects without post.edit on the post's own department scope", async () => {
    const response = await styleRender(styleRenderClients({}), denyingRoleProvider)
    expect(response.statusCode).toBe(403)
  })

  it('rejects once the post has been submitted for approval', async () => {
    const response = await styleRender(
      styleRenderClients({ post: { ...EDITABLE_POST_ROW, status: 'awaiting_approval' } }),
    )
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'post_not_editable' })
  })

  // Eine archivierte Fassung behaelt ihre post_media-Zeile, waehrend der Beitrag laengst wieder
  // 'draft_ready' ist -- ohne diese Sperre liesse sich der freigegebene Bildstand nachtraeglich
  // umschreiben.
  it('rejects a post_media row that belongs to an older, no longer current post version', async () => {
    const response = await styleRender(
      styleRenderClients({ post: { ...EDITABLE_POST_ROW, current_version_id: OTHER_VERSION_ID } }),
    )
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'post_version_not_current' })
  })

  it('rejects a preset that does not exist for this organization', async () => {
    const response = await styleRender(styleRenderClients({ preset: null }))
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'image_style_preset_not_found' })
  })

  it('rejects a preset that belongs to a different, non-inherited department', async () => {
    // Beitrag in DEPARTMENT_ID, Preset in einer anderen Abteilung -- nicht vererbt, also nicht waehlbar.
    const foreignDepartmentPreset = {
      ...PRESET_ROW,
      department_id: '47000000-9000-4000-8000-000000000001',
    }
    const response = await styleRender(styleRenderClients({ preset: foreignDepartmentPreset }))
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'image_style_preset_not_selectable' })
  })

  // media_assets nimmt auch video/mp4 auf und ensurePassThroughDerivative legt dafuer ein Derivat
  // an -- ungebremst liefe der MP4-Puffer in sharp und die Route antwortete mit 500.
  it('rejects a source media asset that is not an image', async () => {
    const response = await styleRender(
      styleRenderClients({ sourceAsset: { ...SOURCE_ASSET_ROW, mime_type: 'video/mp4' } }),
    )
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'source_media_asset_not_an_image' })
  })

  it('maps a race lost inside apply_image_style_render to 409 instead of 500', async () => {
    const sourcePhoto = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer()
    const clients = styleRenderClients({
      sourcePhoto,
      rpc: { data: null, error: { message: 'post_media_changed', code: 'P0001' } },
    })
    const response = await styleRender(clients)
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'post_media_changed' })
  })

  it('renders the preset onto the source photo and applies the new derivative to post_media', async () => {
    const sourcePhoto = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer()
    const logoAsset = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer()
    const captured: { uploadedPath?: string; rpcArgs?: Record<string, unknown> } = {}
    const clients = styleRenderClients({
      preset: LOGO_PRESET_ROW,
      sourcePhoto,
      logoAsset,
      captured,
    })

    const response = await styleRender(clients)
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      mediaDerivativeId: NEW_DERIVATIVE_ID,
      signedUrl: 'https://signed.example/rendered.png',
    })
    expect(captured.uploadedPath).toEqual(response.json().objectPath)
    expect(captured.rpcArgs).toMatchObject({
      p_post_media_id: POST_MEDIA_ID,
      p_actor_user_id: USER_ID,
      p_style_preset_id: PRESET_ID,
      p_expected_media_derivative_id: CURRENT_DERIVATIVE_ID,
      p_media_asset_id: SOURCE_ASSET_ID,
      p_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_mime_type: 'image/png',
    })
    const recipe = captured.rpcArgs!.p_recipe as {
      kind: string
      stylePresetId: string
      sourceMediaAssetId: string
      sourceSha256: string
      stylePresetSnapshot: Record<string, unknown>
    }
    expect(recipe).toMatchObject({
      kind: 'image_style_v1',
      stylePresetId: PRESET_ID,
      sourceMediaAssetId: SOURCE_ASSET_ID,
      sourceSha256: 'a'.repeat(64),
    })
    expect(recipe.stylePresetSnapshot).toMatchObject({
      logoEnabled: true,
      logoBrandAssetId: LOGO_ASSET_ID,
      filter: 'original',
      filterProvider: 'sharp',
    })
  })
})
