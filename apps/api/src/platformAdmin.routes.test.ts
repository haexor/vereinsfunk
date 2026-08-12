import { describe, expect, it } from 'vitest'
import { ORGANIZATION_ID, USER_ID, adminProvider, defaultAdminProvider, nonAdminProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

describe('platform administration', () => {
  it('reports non-admin status without requiring platform-admin rights', async () => {
    const app = await startApp({ platformAdminProvider: nonAdminProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me/platform-admin-status',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ isPlatformAdmin: false, isDefaultAdmin: false })
  })

  it('rejects a non-admin on a platform-admin-only route', async () => {
    const app = await startApp({ platformAdminProvider: nonAdminProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: '/v1/platform-settings',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })

  it('returns contact, media storage, and calendar activity for one organization to a platform admin', async () => {
    const activityCount = { data: null, count: 3, error: null }
    const detailClients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'organizations') {
              return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: ORGANIZATION_ID, name: 'SV Test', slug: 'sv-test', timezone: 'Europe/Berlin', created_at: '2026-08-11T10:00:00+00:00' }, error: null }) }) }) }
            }
            if (table === 'organization_profiles') {
              return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { legal_name: 'SV Test e.V.', street: 'Testweg', house_number: '7', postal_code: '01067', city: 'Dresden', country_code: 'DE', contact_email: 'kontakt@sv-test.example', contact_phone: '+49 351 123', website_url: 'https://sv-test.example', responsible_person_profile_id: USER_ID }, error: null }) }) }) }
            }
            if (table === 'profiles') {
              return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: 'Lena Test' }, error: null }) }) }) }
            }
            if (table === 'organization_memberships' || table === 'departments') {
              return {
                select: (columns: string, options?: { head?: boolean }) => {
                  if (options?.head) return { eq: async () => ({ data: null, count: table === 'organization_memberships' ? 4 : 2, error: null }) }
                  if (table === 'organization_memberships' && columns === 'user_id') {
                    return {
                      eq: () => ({
                        eq: () => ({
                          or: () => ({
                            order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { user_id: USER_ID }, error: null }) }) }),
                          }),
                        }),
                      }),
                    }
                  }
                  throw new Error(`unexpected organization membership query: ${columns}`)
                },
              }
            }
            if (table === 'media_assets') {
              return {
                select: (_columns: string, options?: { head?: boolean }) => {
                  if (options?.head) return { eq: () => ({ ilike: () => ({ gte: async () => activityCount }) }) }
                  return { eq: () => ({ neq: () => ({ order: () => ({ range: async () => ({ data: [{ byte_size: 1024 }, { byte_size: 512 }], error: null }) }) }) }) }
                },
              }
            }
            if (table === 'media_derivatives') {
              return { select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [{ byte_size: 2048 }], error: null }) }) }) }) }
            }
            if (table === 'posts') return { select: () => ({ eq: () => ({ gte: async () => activityCount }) }) }
            if (table === 'post_variants') return { select: () => ({ eq: () => ({ eq: () => ({ gte: async () => activityCount }) }) }) }
            throw new Error(`unexpected table in detail test fake: ${table}`)
          },
          auth: {
            admin: {
              getUserById: async () => ({ data: { user: { email: 'owner@sv-test.example' } }, error: null }),
            },
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: detailClients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/platform-admin/organizations/${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      organizationId: ORGANIZATION_ID,
      contact: { responsiblePersonName: 'Lena Test', email: 'kontakt@sv-test.example', ownerAccountEmail: 'owner@sv-test.example' },
      storage: { rawMediaBytes: 1536, renderedMediaBytes: 2048, totalMediaBytes: 3584 },
      activity: { day: { posts: 3, reels: 3, videoAssets: 3 }, week: { posts: 3 } },
    })
  })

  it('rejects an unknown platform settings key with 400', async () => {
    const app = await startApp({ platformAdminProvider: adminProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/platform-settings/unknown_key',
      headers: { authorization: `Bearer ${token}` },
      payload: { value: 5 },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('maps the separation trigger when promoting an existing club member to 409', async () => {
    const rejectingClients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async () => ({ data: null, error: { message: 'member_cannot_become_platform_admin' } }),
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: rejectingClients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform-admins',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'lena@example.local' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'member_cannot_become_platform_admin' })
  })

  it('rejects a non-default admin deleting another admin', async () => {
    const app = await startApp({ platformAdminProvider: adminProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/platform-admins/10000000-0000-4000-8000-000000000002',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })

  it('lets the default admin delete another admin', async () => {
    const deletingClients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }),
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: defaultAdminProvider, supabaseClients: deletingClients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/platform-admins/10000000-0000-4000-8000-000000000002',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(204)
  })

  it('maps the trigger rejection of deleting the default admin to 400', async () => {
    const rejectingClients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: () => ({
            delete: () => ({ eq: async () => ({ error: { message: 'the default platform admin cannot be deleted' } }) }),
          }),
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: defaultAdminProvider, supabaseClients: rejectingClients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/platform-admins/${USER_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'cannot_delete_default_admin' })
  })

  it('never returns the plaintext or ciphertext API key for an LLM provider configuration', async () => {
    const configRow = {
      id: 'a0000000-0000-4000-8000-000000000001',
      label: 'OpenAI-compatible proxy',
      protocol: 'openai',
      base_url: 'https://llm-proxy.internal/v1',
      model: 'approved-text-model',
      purpose: 'default',
      task_kind: 'text_generation', temperature: 0.2, max_output_tokens: 1200, structured_output_required: true,
      priority: 100,
      is_active: true,
      system_prompt_override: null,
    }
    const llmProviderClients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'llm_provider_configurations') {
              return { insert: () => ({ select: () => ({ single: async () => ({ data: configRow, error: null }) }) }) }
            }
            if (table === 'llm_provider_secrets') {
              return { insert: async () => ({ error: null }) }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: llmProviderClients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/llm-providers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        label: 'OpenAI-compatible proxy',
        protocol: 'openai',
        baseUrl: 'https://llm-proxy.internal/v1',
        model: 'approved-text-model',
        apiKey: 'super-secret-bearer-token',
      },
    })
    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.hasSecret).toBe(true)
    expect(JSON.stringify(body)).not.toContain('super-secret-bearer-token')
    expect(Object.keys(body)).not.toContain('apiKey')
    expect(Object.keys(body)).not.toContain('apiKeyCiphertext')
  })

  it('rejects activating a stored provider without an implemented adapter', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({
        from: (table: string) => {
          if (table !== 'llm_provider_configurations') throw new Error(`unexpected table in test fake: ${table}`)
          // Seit dem Anthropic-Adapter ist nicht mehr das Protokoll der unimplementierte Teil,
          // sondern die Aufgabenart -- fuer Bild und Video gibt es im Worker keinen Generator.
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { protocol: 'openai', task_kind: 'image_generation' }, error: null }) }) }) }
        },
      }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: '/v1/llm-providers/a0000000-0000-4000-8000-000000000001',
      headers: { authorization: `Bearer ${token}` }, payload: { isActive: true },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'unsupported_provider_configuration' })
  })

  it('re-validates an already-active provider even when the patch does not touch isActive', async () => {
    // isActive faengt oben schon ab, wenn es explizit mitgeschickt wird. Ein Patch, der isActive
    // gar nicht erwaehnt, darf eine bereits aktive, unimplementierte Konfiguration nicht
    // unbemerkt am Adapter-Check vorbei aendern lassen.
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({
        from: (table: string) => {
          if (table !== 'llm_provider_configurations') throw new Error(`unexpected table in test fake: ${table}`)
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { protocol: 'legacy-unsupported', task_kind: 'text_generation', is_active: true }, error: null }) }) }) }
        },
      }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: '/v1/llm-providers/a0000000-0000-4000-8000-000000000001',
      headers: { authorization: `Bearer ${token}` }, payload: { label: 'renamed' },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'unsupported_provider_configuration' })
  })

  it('accepts a provider on the anthropic protocol', async () => {
    const configRow = {
      id: 'a0000000-0000-4000-8000-000000000002',
      label: 'Claude via haex-claude-proxy', protocol: 'anthropic', base_url: 'https://claude-proxy.example/v1',
      model: 'claude-opus-4-8', purpose: 'default',
      task_kind: 'text_generation', temperature: 0.2, max_output_tokens: 1200, structured_output_required: true,
      priority: 100, is_active: true,
    }
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({
        from: (table: string) => {
          if (table === 'llm_provider_configurations') return { insert: () => ({ select: () => ({ single: async () => ({ data: configRow, error: null }) }) }) }
          if (table === 'llm_provider_secrets') return { insert: async () => ({ error: null }) }
          throw new Error(`unexpected table in test fake: ${table}`)
        },
      }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/llm-providers',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Claude via haex-claude-proxy', protocol: 'anthropic', baseUrl: 'https://claude-proxy.example/v1', model: 'claude-opus-4-8', apiKey: 'super-secret-bearer-token' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ protocol: 'anthropic', hasSecret: true })
  })

  it('refuses to list models behind a base url that points into the internal network', async () => {
    // Die Adresse kommt aus dem Formular: ohne diese Pruefung waere die Modell-Abfrage ein
    // Server-zu-Server-Proxy ins eigene Netz, auch fuer eine Plattform-Administration.
    const app = await startApp({ platformAdminProvider: adminProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/llm-providers/models',
      headers: { authorization: `Bearer ${token}` },
      payload: { protocol: 'openai', baseUrl: 'https://llm-proxy.internal/v1', apiKey: 'super-secret-bearer-token' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'base_url_not_allowed' })
  })

  it('refuses to list models without platform administration', async () => {
    const app = await startApp({
      platformAdminProvider: { async statusFor() { return { isPlatformAdmin: false, isDefaultAdmin: false } } },
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/llm-providers/models',
      headers: { authorization: `Bearer ${token}` },
      payload: { protocol: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'super-secret-bearer-token' },
    })
    expect(response.statusCode).toBe(403)
  })
})

