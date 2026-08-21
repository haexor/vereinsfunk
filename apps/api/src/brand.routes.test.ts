import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, ORGANIZATION_ID, TEAM_ID, USER_ID, brandLimitsService, chain, denyingRoleProvider, organizationManagerRoleProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

describe('Paket 013: Marke, Branding-Assets und Schriften', () => {
  const BRAND_ORGANIZATION_UPDATE = {
    primaryColor: '#163a2c',
    accentColor: '#caff4a',
    backgroundColor: '#f6f4ec',
    textColor: '#122820',
    onPrimaryColor: '#ffffff',
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

  it('updates the organization brand profile including the new color roles', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table !== 'organization_brand_profiles') throw new Error(`unexpected table in test fake: ${table}`)
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
                    allow_department_overrides: true,
                    locked_fields: [],
                    logo_path: null,
                    logo_dark_path: null,
                  },
                  error: null,
                }),
            }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: BRAND_ORGANIZATION_UPDATE,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ backgroundColor: '#f6f4ec', textColor: '#122820', onPrimaryColor: '#ffffff' })
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
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...BRAND_ORGANIZATION_UPDATE, displayFontAssetId: '10000000-9000-4000-8000-000000000001' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_asset_reference' })
  })

  it('rejects a brand asset upload whose content is not a recognizable image', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkAssetBoundary'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="organizationId"\r\n\r\n${ORGANIZATION_ID}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nlogo_mark\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from('this is not an image'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
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
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="organizationId"\r\n\r\n${ORGANIZATION_ID}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nfont\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="font.ttf"\r\nContent-Type: font/ttf\r\n\r\n`),
      Buffer.from('this is not a font'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
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
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="organizationId"\r\n\r\n${ORGANIZATION_ID}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="teamId"\r\n\r\n${TEAM_ID}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nwordmark\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from('not really a png'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
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
      forService: () => ({ from: () => { throw new Error('forService should not be used before the existence check') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
              return chain({ data: { id: '10000000-9000-4000-8000-000000000001', organization_id: ORGANIZATION_ID, department_id: null, team_id: null, kind: 'logo_mark' }, error: null })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used before the kind check') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
              return chain({ data: { id: '10000000-9000-4000-8000-000000000001', organization_id: ORGANIZATION_ID, department_id: null, team_id: null, kind: 'font' }, error: null })
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
            if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { captured.push(row); return { error: null } } }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
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
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            if (table === 'department_brand_profiles') {
              return { upsert: () => chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, primary_color: '#112233', accent_color: null, logo_asset_id: null, display_font_asset_id: null, body_font_asset_id: null, allow_team_overrides: true, locked_fields: [] }, error: null }) }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService({ allow_department_overrides: true, locked_fields: [] }),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
            if (table === 'teams') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }, error: null })
            if (table === 'team_brand_profiles') {
              return { upsert: () => chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: TEAM_ID, primary_color: '#445566', accent_color: null, logo_asset_id: null, display_font_asset_id: null, body_font_asset_id: null }, error: null }) }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService({ allow_department_overrides: true, locked_fields: [] }, { allow_team_overrides: true, locked_fields: [] }),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService({ allow_department_overrides: false, locked_fields: [] }),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService({ allow_department_overrides: true, locked_fields: ['primaryColor'] }),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            if (table === 'department_brand_profiles') {
              return { upsert: () => chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, primary_color: null, accent_color: null, logo_asset_id: null, display_font_asset_id: null, body_font_asset_id: null, allow_team_overrides: true, locked_fields: [] }, error: null }) }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService({ allow_department_overrides: true, locked_fields: ['primaryColor'] }),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
            if (table === 'teams') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService({ allow_department_overrides: true, locked_fields: [] }, { allow_team_overrides: false, locked_fields: [] }),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
            if (table === 'teams') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: brandLimitsService({ allow_department_overrides: true, locked_fields: ['accentColor'] }, { allow_team_overrides: true, locked_fields: [] }),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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

  it('refuses an organization-wide logo through the generic asset endpoint', async () => {
    // logo_path/logo_dark_path pflegt nur der dedizierte Endpunkt -- sonst zeigte der
    // denormalisierte Zeiger nach dem Upload auf ein Asset mit Status 'replaced'.
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkOrgLogoBoundary'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="organizationId"\r\n\r\n${ORGANIZATION_ID}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nlogo_primary\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from('irrelevant -- the scope check runs before the file is read'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('use_organization_logo_endpoint')
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
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
    expect(capturedArgs).toMatchObject({ p_organization_id: ORGANIZATION_ID, p_website_url: 'https://verein.example.org', p_requested_by: USER_ID })
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
      forService: () => ({ rpc: async () => { rpcCalled = true; return { data: null, error: null } } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
      forService: () => ({ rpc: async () => ({ data: null, error: { message: 'analysis_in_progress' } }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
      forService: () => ({ from: () => chain({ data: null, error: null }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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
      forService: () => ({ from: () => chain({ data: { status: 'pending', result: null, error_reason: null }, error: null }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'pending', result: null, errorReason: null })
  })

  it('mints a fresh signed url for the staged logo candidate on every read instead of a stored, possibly expired one', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () =>
            chain({
              data: {
                status: 'succeeded',
                result: {
                  primaryColor: '#163a2c', accentColor: '#caff4a', backgroundColor: '#f6f4ec', textColor: '#122820', onPrimaryColor: '#ffffff',
                  suggestedFontPairingKey: 'manrope_dm_sans', detectedFontFamily: 'Roboto, sans-serif',
                  logoObjectPath: 'organizations/x/brand/analysis-staging/abc.png', logoMimeType: 'image/png',
                },
                error_reason: null,
              },
              error: null,
            }),
          storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string) => { expect(bucket).toBe('brand-assets'); expect(path).toBe('organizations/x/brand/analysis-staging/abc.png'); return { data: { signedUrl: 'https://signed.example/logo-candidate.png' }, error: null } } }) },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'succeeded',
      result: { suggestedFontPairingKey: 'manrope_dm_sans', logoCandidate: { signedUrl: 'https://signed.example/logo-candidate.png', mimeType: 'image/png' } },
    })
  })

  it('reports a failed analysis with its error reason and no result', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ from: () => chain({ data: { status: 'failed', result: null, error_reason: 'website_unreachable' }, error: null }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/website-analysis`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'failed', result: null, errorReason: 'website_unreachable' })
  })
})

