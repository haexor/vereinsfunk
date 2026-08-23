import { describe, expect, it } from 'vitest'
import {
  DEPARTMENT_ID,
  ORGANIZATION_ID,
  TEAM_ID,
  USER_ID,
  brandLimitsService,
  chain,
  denyingRoleProvider,
  organizationManagerRoleProvider,
  signAccessToken,
  startApp,
} from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

describe('Paket 013: Marke, Branding-Assets und Schriften', () => {
  const BRAND_ORGANIZATION_UPDATE = {
    primaryColor: '#163a2c',
    accentColor: '#caff4a',
    displayFontKey: 'manrope',
    bodyFontKey: 'dm_sans',
  }

  it('rejects an organization brand update without brand.manage', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: BRAND_ORGANIZATION_UPDATE,
    })
    expect(response.statusCode).toBe(403)
  })

  it('updates the organization brand profile with its persistent analysis website', async () => {
    const captured: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table !== 'organization_brand_profiles')
              throw new Error(`unexpected table in test fake: ${table}`)
            return {
              update: (payload: Record<string, unknown>) => {
                captured.push(payload)
                return chain({
                  data: {
                    organization_id: ORGANIZATION_ID,
                    primary_color: '#163a2c',
                    accent_color: '#caff4a',
                    background_color: '#f6f4ec',
                    text_color: '#122820',
                    on_primary_color: '#ffffff',
                    display_font_key: 'manrope',
                    body_font_key: 'dm_sans',
                    display_font_asset_id: null,
                    body_font_asset_id: null,
                    logo_asset_id: null,
                    website_url: 'https://verein.example.org',
                    allow_department_overrides: true,
                    locked_fields: [],
                  },
                  error: null,
                })
              },
            }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...BRAND_ORGANIZATION_UPDATE, websiteUrl: 'https://verein.example.org' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ websiteUrl: 'https://verein.example.org' })
    expect(captured).toContainEqual(expect.objectContaining({ website_url: 'https://verein.example.org' }))
  })

  it('updates the organization brand profile with a logoAssetId that resolves to a selectable, ready logo asset', async () => {
    const LOGO_ASSET_ID = '10000000-9000-4000-8000-000000000002'
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') {
              return chain({
                data: {
                  id: LOGO_ASSET_ID,
                  organization_id: ORGANIZATION_ID,
                  department_id: null,
                  team_id: null,
                  kind: 'logo_mark',
                  status: 'ready',
                },
                error: null,
              })
            }
            if (table === 'organization_brand_profiles') {
              return {
                update: () =>
                  chain({
                    data: {
                      organization_id: ORGANIZATION_ID,
                      primary_color: '#163a2c',
                      accent_color: '#caff4a',
                      background_color: '#f6f4ec',
                      text_color: '#122820',
                      on_primary_color: '#ffffff',
                      display_font_key: 'manrope',
                      body_font_key: 'dm_sans',
                      display_font_asset_id: null,
                      body_font_asset_id: null,
                      logo_asset_id: LOGO_ASSET_ID,
                      website_url: null,
                      allow_department_overrides: true,
                      locked_fields: [],
                    },
                    error: null,
                  }),
              }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...BRAND_ORGANIZATION_UPDATE, logoAssetId: LOGO_ASSET_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ logoAssetId: LOGO_ASSET_ID })
  })

  it('rejects an organization logoAssetId whose kind is not a logo-ish kind', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') {
              return chain({
                data: {
                  id: '10000000-9000-4000-8000-000000000003',
                  organization_id: ORGANIZATION_ID,
                  department_id: null,
                  team_id: null,
                  kind: 'font',
                  status: 'ready',
                },
                error: null,
              })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...BRAND_ORGANIZATION_UPDATE,
        logoAssetId: '10000000-9000-4000-8000-000000000003',
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_asset_reference' })
  })

  it('rejects a font/logo asset reference that does not resolve to a selectable, ready asset', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') return chain({ data: null, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...BRAND_ORGANIZATION_UPDATE,
        displayFontAssetId: '10000000-9000-4000-8000-000000000001',
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_asset_reference' })
  })

  it('rejects a brand asset upload whose content is not a recognizable image', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkAssetBoundary'
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="organizationId"\r\n\r\n${ORGANIZATION_ID}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nlogo_mark\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.txt"\r\nContent-Type: text/plain\r\n\r\n`,
      ),
      Buffer.from('this is not an image'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_logo' })
  })

  it('rejects a font upload that is not a recognizable font container', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkFontBoundary'
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="organizationId"\r\n\r\n${ORGANIZATION_ID}\r\n`,
      ),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nfont\r\n`),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="font.ttf"\r\nContent-Type: font/ttf\r\n\r\n`,
      ),
      Buffer.from('this is not a font'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_font' })
  })

  it('rejects a brand asset request with a teamId but no departmentId', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkScopeBoundary'
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="organizationId"\r\n\r\n${ORGANIZATION_ID}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="teamId"\r\n\r\n${TEAM_ID}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nwordmark\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      Buffer.from('not really a png'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('returns 404 when confirming the license of a brand asset that does not exist', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') return chain({ data: null, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () => {
            throw new Error('forService should not be used before the existence check')
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets/10000000-9000-4000-8000-000000000099/confirm-license',
      headers: { authorization: `Bearer ${token}` },
      payload: { licenseHolder: 'Verein', confirmed: true },
    })
    expect(response.statusCode).toBe(404)
  })

  it('rejects confirming a license on an asset that is not a font', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') {
              return chain({
                data: {
                  id: '10000000-9000-4000-8000-000000000001',
                  organization_id: ORGANIZATION_ID,
                  department_id: null,
                  team_id: null,
                  kind: 'logo_mark',
                },
                error: null,
              })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () => {
            throw new Error('forService should not be used before the kind check')
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets/10000000-9000-4000-8000-000000000001/confirm-license',
      headers: { authorization: `Bearer ${token}` },
      payload: { licenseHolder: 'Verein', confirmed: true },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'not_a_font_asset' })
  })

  it('confirms a font license and moves the asset to ready', async () => {
    const captured: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') {
              return chain({
                data: {
                  id: '10000000-9000-4000-8000-000000000001',
                  organization_id: ORGANIZATION_ID,
                  department_id: null,
                  team_id: null,
                  kind: 'font',
                },
                error: null,
              })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') {
              return {
                update: (values: Record<string, unknown>) => {
                  captured.push(values)
                  return chain({
                    data: {
                      id: '10000000-9000-4000-8000-000000000001',
                      organization_id: ORGANIZATION_ID,
                      department_id: null,
                      team_id: null,
                      kind: 'font',
                      object_path: 'organizations/x/brand/organization/font-abc.woff2',
                      mime_type: 'font/woff2',
                      byte_size: 1234,
                      width: null,
                      height: null,
                      font_family: 'Custom Sans',
                      font_weight: 400,
                      font_style: 'normal',
                      license_holder: 'Verein',
                      license_note: null,
                      license_confirmed_at: '2026-08-07T00:00:00.000+00:00',
                      status: 'ready',
                      rejection_reason: null,
                      created_at: '2026-08-07T00:00:00.000+00:00',
                    },
                    error: null,
                  })
                },
              }
            }
            if (table === 'audit_events')
              return {
                insert: async (row: Record<string, unknown>) => {
                  captured.push(row)
                  return { error: null }
                },
              }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets/10000000-9000-4000-8000-000000000001/confirm-license',
      headers: { authorization: `Bearer ${token}` },
      payload: { licenseHolder: 'Verein', confirmed: true },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ready', licenseHolder: 'Verein' })
  })

  it('returns 404 for a department brand update when the department does not exist', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return chain({ data: null, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/departments/${DEPARTMENT_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { primaryColor: '#112233' },
    })
    expect(response.statusCode).toBe(404)
  })

  it('rejects a department brand update without brand.manage in that department', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments')
              return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/departments/${DEPARTMENT_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { primaryColor: '#112233' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('updates a department brand profile', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments')
              return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            if (table === 'department_brand_profiles') {
              return {
                upsert: () =>
                  chain({
                    data: {
                      organization_id: ORGANIZATION_ID,
                      department_id: DEPARTMENT_ID,
                      primary_color: '#112233',
                      accent_color: null,
                      logo_asset_id: null,
                      display_font_asset_id: null,
                      body_font_asset_id: null,
                      allow_team_overrides: true,
                      locked_fields: [],
                    },
                    error: null,
                  }),
              }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService({ allow_department_overrides: true, locked_fields: [] }),
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/departments/${DEPARTMENT_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { primaryColor: '#112233' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ primaryColor: '#112233', departmentId: DEPARTMENT_ID })
  })

  it('updates a team brand profile', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'teams')
              return chain({
                data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID },
                error: null,
              })
            if (table === 'team_brand_profiles') {
              return {
                upsert: () =>
                  chain({
                    data: {
                      organization_id: ORGANIZATION_ID,
                      department_id: DEPARTMENT_ID,
                      team_id: TEAM_ID,
                      primary_color: '#445566',
                      accent_color: null,
                      logo_asset_id: null,
                      display_font_asset_id: null,
                      body_font_asset_id: null,
                    },
                    error: null,
                  }),
              }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService(
        { allow_department_overrides: true, locked_fields: [] },
        { allow_team_overrides: true, locked_fields: [] },
      ),
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/teams/${TEAM_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { primaryColor: '#445566' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ primaryColor: '#445566', teamId: TEAM_ID })
  })

  // Der vom Verein gesetzte Rahmen muss beim SCHREIBEN greifen: resolveBrand wuerde einen
  // unerlaubten Wert zwar ignorieren, aber die Abteilung saehe ihn gespeichert im Formular stehen
  // und nirgends wirken.
  it('rejects a department brand override when the organization forbids department branding', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments')
              return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService({ allow_department_overrides: false, locked_fields: [] }),
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/departments/${DEPARTMENT_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { primaryColor: '#112233' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('overrides_not_allowed')
  })

  it('rejects a department brand override on a field the organization locked', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments')
              return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService({
        allow_department_overrides: true,
        locked_fields: ['primaryColor'],
      }),
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/departments/${DEPARTMENT_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { primaryColor: '#112233' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'field_locked', field: 'primaryColor' })
  })

  it('lets a department clear a locked field back to inherited', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments')
              return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            if (table === 'department_brand_profiles') {
              return {
                upsert: () =>
                  chain({
                    data: {
                      organization_id: ORGANIZATION_ID,
                      department_id: DEPARTMENT_ID,
                      primary_color: null,
                      accent_color: null,
                      logo_asset_id: null,
                      display_font_asset_id: null,
                      body_font_asset_id: null,
                      allow_team_overrides: true,
                      locked_fields: [],
                    },
                    error: null,
                  }),
              }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService({
        allow_department_overrides: true,
        locked_fields: ['primaryColor'],
      }),
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/departments/${DEPARTMENT_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { primaryColor: null },
    })
    expect(response.statusCode).toBe(200)
  })

  it('rejects a team brand override when its department forbids team branding', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'teams')
              return chain({
                data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID },
                error: null,
              })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService(
        { allow_department_overrides: true, locked_fields: [] },
        { allow_team_overrides: false, locked_fields: [] },
      ),
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/teams/${TEAM_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { primaryColor: '#445566' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('overrides_not_allowed')
  })

  it('rejects a team brand override on a field the organization locked, even when the department does not repeat it', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'teams')
              return chain({
                data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID },
                error: null,
              })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService(
        { allow_department_overrides: true, locked_fields: ['accentColor'] },
        { allow_team_overrides: true, locked_fields: [] },
      ),
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/teams/${TEAM_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { accentColor: '#445566' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'field_locked', field: 'accentColor' })
  })

  it('accepts an organization-wide logo_primary through the generic asset endpoint (no more use_organization_logo_endpoint block)', async () => {
    // Die dedizierte Route ist entfallen -- der Scope-Block, der logo_primary/logo_dark auf
    // Vereinsebene bisher ablehnte, ist mit ihr weg. Garbage-Bytes reichen, um das zu belegen: ohne
    // den Block laeuft die Anfrage bis zur Bildvalidierung durch (invalid_logo), nicht mehr bis zum
    // fruehen 400 use_organization_logo_endpoint.
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkOrgLogoBoundary'
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="organizationId"\r\n\r\n${ORGANIZATION_ID}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nlogo_primary\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      Buffer.from('not really a png'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('invalid_logo')
  })

  it('rejects deleting a brand asset without brand.manage in its scope', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') {
              return chain({
                data: {
                  organization_id: ORGANIZATION_ID,
                  department_id: null,
                  team_id: null,
                  status: 'ready',
                },
                error: null,
              })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () => {
            throw new Error('forService should not be used before the permission check')
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/brand/assets/10000000-9000-4000-8000-000000000004',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
  })

  // Deckt zugleich die Mandantentrennung ab: ein Asset eines fremden Vereins ist ueber
  // brand_assets_select fuer den Nutzer-Client unsichtbar (siehe supabase/tests/
  // brand_assets_and_fonts.test.sql, "18: Mandantentrennung") und liefert deshalb hier dieselbe
  // maybeSingle()-Null-Antwort wie ein echt nicht existierendes Asset -- die Route erreicht in
  // beiden Faellen niemals die Service Role.
  it('returns 404 when deleting a brand asset that does not exist (or belongs to another organization, invisible via RLS)', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') return chain({ data: null, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () => {
            throw new Error('forService should not be used before the existence check')
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/brand/assets/10000000-9000-4000-8000-000000000099',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(404)
  })

  it('soft-deletes a brand asset (status=deleted) and records an audit event', async () => {
    const ASSET_ID = '10000000-9000-4000-8000-000000000005'
    let auditAction: unknown
    let rpcArgs: unknown
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') {
              return chain({
                data: {
                  organization_id: ORGANIZATION_ID,
                  department_id: null,
                  team_id: null,
                  status: 'ready',
                },
                error: null,
              })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async (name: string, args: Record<string, unknown>) => {
            if (name !== 'delete_brand_asset_if_unused') throw new Error(`unexpected rpc: ${name}`)
            rpcArgs = args
            return { data: ASSET_ID, error: null }
          },
          from: (table: string) => {
            if (table === 'audit_events') {
              return {
                insert: (payload: { action: unknown }) => {
                  auditAction = payload.action
                  return chain({ data: null, error: null })
                },
              }
            }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/brand/assets/${ASSET_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(204)
    expect(rpcArgs).toEqual({ target_asset_id: ASSET_ID })
    expect(auditAction).toBe('brand_asset.deleted')
  })

  it('returns 404 when the asset was already deleted, without recording another audit event', async () => {
    const ASSET_ID = '10000000-9000-4000-8000-000000000006'
    let auditCalled = false
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') {
              return chain({
                data: {
                  organization_id: ORGANIZATION_ID,
                  department_id: null,
                  team_id: null,
                  status: 'deleted',
                },
                error: null,
              })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async () => ({ data: null, error: null }),
          from: () => {
            auditCalled = true
            return { insert: () => chain({ data: null, error: null }) }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/brand/assets/${ASSET_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(404)
    expect(auditCalled).toBe(false)
  })

  it('returns 409 when the asset is still referenced by a brand profile or image style preset', async () => {
    const ASSET_ID = '10000000-9000-4000-8000-000000000007'
    let auditCalled = false
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'brand_assets') {
              return chain({
                data: {
                  organization_id: ORGANIZATION_ID,
                  department_id: null,
                  team_id: null,
                  status: 'ready',
                },
                error: null,
              })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async () => ({ data: null, error: { message: 'brand_asset_referenced' } }),
          from: () => {
            auditCalled = true
            return { insert: () => chain({ data: null, error: null }) }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/brand/assets/${ASSET_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'asset_referenced' })
    expect(auditCalled).toBe(false)
  })
})

describe('Paket 048: KI-gestuetzte Markenerkennung aus der Vereins-Homepage', () => {
  it('rejects starting an analysis without brand.manage', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
      payload: { websiteUrl: 'https://verein.example.org' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('starts an analysis and returns the job id from the RPC', async () => {
    let capturedArgs: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async (name: string, args: Record<string, unknown>) => {
            if (name !== 'start_brand_website_analysis') throw new Error(`unexpected rpc: ${name}`)
            capturedArgs = args
            return { data: { jobId: '48000000-9000-4000-8000-000000000001' }, error: null }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
      payload: { websiteUrl: 'https://verein.example.org' },
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ jobId: '48000000-9000-4000-8000-000000000001' })
    // requested_by kommt aus der authentifizierten Session, nicht vom Client-Body (RPC traut Client nicht).
    expect(capturedArgs).toMatchObject({
      p_organization_id: ORGANIZATION_ID,
      p_website_url: 'https://verein.example.org',
      p_requested_by: USER_ID,
    })
  })

  // Ohne diese Vorabpruefung waere die Antwort auf ein gewoehnliches "http://..." eine 500: das
  // CHECK auf brand_website_analysis_jobs.website_url ('^https://') schlaegt in der RPC zu, und
  // dieser Fehler ist keiner der beiden abgebildeten Faelle.
  it.each([
    ['http://verein.example.org', 'plain http'],
    ['https://192.168.10.5', 'a private address'],
    ['https://intranet.internal', 'an internal hostname'],
  ])('rejects %s as a target the server must not fetch (%s)', async (websiteUrl) => {
    let rpcCalled = false
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async () => {
            rpcCalled = true
            return { data: null, error: null }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
      payload: { websiteUrl },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('website_url_not_allowed')
    expect(rpcCalled).toBe(false)
  })

  it('maps a running analysis to 409 instead of silently duplicating it', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async () => ({ data: null, error: { message: 'analysis_in_progress' } }),
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
      payload: { websiteUrl: 'https://verein.example.org' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toBe('analysis_in_progress')
  })

  it('rejects reading the analysis status without brand.manage', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
  })

  it('reports 404 when no analysis has ever run for this club', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({ from: () => chain({ data: null, error: null }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(404)
  })

  it('reports a pending job without a result', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () =>
            chain({ data: { status: 'pending', result: null, error_reason: null }, error: null }),
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'pending', result: null, errorReason: null })
  })

  it('mints a fresh signed url for every staged logo candidate on each read instead of a stored, possibly expired one', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () =>
            chain({
              data: {
                status: 'succeeded',
                result: {
                  primaryColor: '#163a2c',
                  accentColor: '#caff4a',
                  backgroundColor: '#f6f4ec',
                  textColor: '#122820',
                  onPrimaryColor: '#ffffff',
                  suggestedFontPairingKey: 'manrope_dm_sans',
                  detectedFontFamily: 'Roboto, sans-serif',
                  logoCandidates: [
                    {
                      objectPath: `organizations/${ORGANIZATION_ID}/brand/analysis-staging/abc.png`,
                      mimeType: 'image/png',
                    },
                  ],
                },
                error_reason: null,
              },
              error: null,
            }),
          storage: {
            from: (bucket: string) => ({
              createSignedUrl: async (path: string) => {
                expect(bucket).toBe('brand-assets')
                expect(path).toBe(`organizations/${ORGANIZATION_ID}/brand/analysis-staging/abc.png`)
                return {
                  data: { signedUrl: 'https://signed.example/logo-candidate.png' },
                  error: null,
                }
              },
            }),
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'succeeded',
      result: {
        suggestedFontPairingKey: 'manrope_dm_sans',
        logoCandidate: {
          signedUrl: 'https://signed.example/logo-candidate.png',
          mimeType: 'image/png',
        },
        logoCandidates: [
          { signedUrl: 'https://signed.example/logo-candidate.png', mimeType: 'image/png' },
        ],
      },
    })
  })

  it('does not sign malformed or cross-organization staged logo paths', async () => {
    let signingCalled = false
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () =>
            chain({
              data: {
                status: 'succeeded',
                result: {
                  primaryColor: '#163a2c',
                  accentColor: '#caff4a',
                  backgroundColor: '#f6f4ec',
                  textColor: '#122820',
                  onPrimaryColor: '#ffffff',
                  suggestedFontPairingKey: null,
                  detectedFontFamily: null,
                  logoCandidates: [
                    {
                      objectPath: 'organizations/other/brand/analysis-staging/abc.png',
                      mimeType: 'image/png',
                    },
                    {
                      objectPath: `organizations/${ORGANIZATION_ID}/brand/analysis-staging/abc.png`,
                      mimeType: 'application/pdf',
                    },
                  ],
                },
                error_reason: null,
              },
              error: null,
            }),
          storage: {
            from: () => ({
              createSignedUrl: async () => {
                signingCalled = true
                return {
                  data: { signedUrl: 'https://signed.example/logo-candidate.png' },
                  error: null,
                }
              },
            }),
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(signingCalled).toBe(false)
    expect(response.json()).toMatchObject({ result: { logoCandidate: null, logoCandidates: [] } })
  })

  it('returns the first eight of nine valid stored logo candidates without signing the ninth', async () => {
    const paths = Array.from(
      { length: 9 },
      (_, index) => `organizations/${ORGANIZATION_ID}/brand/analysis-staging/${index}.png`,
    )
    const signedPaths: string[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () =>
            chain({
              data: {
                status: 'succeeded',
                result: {
                  primaryColor: '#163a2c',
                  accentColor: '#caff4a',
                  backgroundColor: '#f6f4ec',
                  textColor: '#122820',
                  onPrimaryColor: '#ffffff',
                  suggestedFontPairingKey: null,
                  detectedFontFamily: null,
                  logoCandidates: paths.map((objectPath) => ({
                    objectPath,
                    mimeType: 'image/png',
                  })),
                },
                error_reason: null,
              },
              error: null,
            }),
          storage: {
            from: () => ({
              createSignedUrl: async (path: string) => {
                signedPaths.push(path)
                return {
                  data: { signedUrl: `https://signed.example/${path.split('/').at(-1)}` },
                  error: null,
                }
              },
            }),
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(signedPaths).toEqual(paths.slice(0, 8))
    expect(response.json().result.logoCandidates).toHaveLength(8)
  })

  it('reports a failed analysis with its error reason and no result', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () =>
            chain({
              data: { status: 'failed', result: null, error_reason: 'website_unreachable' },
              error: null,
            }),
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'failed',
      result: null,
      errorReason: 'website_unreachable',
    })
  })
})

describe('Paket 049: KI-gestuetzte Markenerkennung auf Abteilungsebene', () => {
  it('rejects starting a department analysis without brand.manage in that department', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments')
              return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/departments/${DEPARTMENT_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
      payload: { websiteUrl: 'https://abteilung.example.org' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('returns 404 for a department analysis when the department does not exist', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return chain({ data: null, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/departments/${DEPARTMENT_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
      payload: { websiteUrl: 'https://abteilung.example.org' },
    })
    expect(response.statusCode).toBe(404)
  })

  it('starts a department analysis and passes p_department_id (not the organization fallback) to the RPC', async () => {
    let capturedArgs: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments')
              return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async (name: string, args: Record<string, unknown>) => {
            if (name !== 'start_brand_website_analysis') throw new Error(`unexpected rpc: ${name}`)
            capturedArgs = args
            return { data: { jobId: '49000000-9000-4000-8000-000000000001' }, error: null }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/departments/${DEPARTMENT_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
      payload: { websiteUrl: 'https://abteilung.example.org' },
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ jobId: '49000000-9000-4000-8000-000000000001' })
    expect(capturedArgs).toMatchObject({
      p_organization_id: ORGANIZATION_ID,
      p_website_url: 'https://abteilung.example.org',
      p_requested_by: USER_ID,
      p_department_id: DEPARTMENT_ID,
    })
  })

  it('maps a running department analysis to 409 instead of silently duplicating it', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments')
              return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async () => ({ data: null, error: { message: 'analysis_in_progress' } }),
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/departments/${DEPARTMENT_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
      payload: { websiteUrl: 'https://abteilung.example.org' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toBe('analysis_in_progress')
  })

  it('rejects reading a department analysis status without brand.manage in that department', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments')
              return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/departments/${DEPARTMENT_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
  })

  it('reports a succeeded department analysis, filtered by department_id rather than organization_id', async () => {
    let filteredBy: Record<string, unknown> = {}
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments')
              return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () => {
            const builder = chain({
              data: {
                status: 'succeeded',
                result: {
                  primaryColor: '#163a2c',
                  accentColor: '#caff4a',
                  backgroundColor: '#f6f4ec',
                  textColor: '#122820',
                  onPrimaryColor: '#ffffff',
                  suggestedFontPairingKey: null,
                  detectedFontFamily: null,
                  logoCandidates: [],
                },
                error_reason: null,
              },
              error: null,
            }) as unknown as Record<string, unknown>
            const originalEq = builder.eq as (...args: unknown[]) => unknown
            builder.eq = (...args: unknown[]) => {
              filteredBy = { column: args[0], value: args[1] }
              return originalEq(...args)
            }
            return builder
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/departments/${DEPARTMENT_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'succeeded',
      result: { primaryColor: '#163a2c' },
    })
    expect(filteredBy).toEqual({ column: 'department_id', value: DEPARTMENT_ID })
  })
})
