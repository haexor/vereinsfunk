import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, ORGANIZATION_ID, USER_ID, chain, denyingRoleProvider, organizationManagerRoleProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'
import type { RoleProvider } from './auth.js'

const META_ENVIRONMENT_KEYS = ['PUBLISHING_PROVIDER', 'META_APP_ID', 'META_APP_SECRET', 'META_OAUTH_REDIRECT_URL', 'API_PUBLIC_BASE_URL'] as const

function preserveEnvironment(keys: readonly string[]): () => void {
  const originalValues = new Map(keys.map((key) => [key, process.env[key]]))
  return () => {
    for (const [key, value] of originalValues) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe('Paket 012: Kanaele und Social-Accounts', () => {
  const CONNECTION_ID = '10000000-8000-4000-8000-000000000099'

  it('rejects granting a channel_scopes assignment when the actor lacks social_account.manage on the channel owner scope', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'social_connections') {
              return chain({ data: { organization_id: ORGANIZATION_ID, owner_scope: 'organization', owner_department_id: null }, error: null })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    // denyingRoleProvider returns 'viewer', which (like every role except organization_owner,
    // social_manager and department_admin) does not carry social_account.manage.
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/channels/${CONNECTION_ID}/scopes`,
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, canSchedule: true },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })

  it('redirects to the frontend with an error when the Meta OAuth callback is missing state', async () => {
    const app = await startApp()
    const response = await app.inject({ method: 'GET', url: '/v1/channels/connect/instagram/callback?error=access_denied' })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toContain('oauthError=denied')
  })

  it('redirects to the frontend with invalid_state when the callback state nonce is not found', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: () => { throw new Error('forUser should not be used by the unauthenticated callback') } }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'oauth_states') return chain({ data: null, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({ method: 'GET', url: '/v1/channels/connect/instagram/callback?code=abc&state=unknown-nonce' })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toContain('oauthError=invalid_state')
  })

  it('returns a Meta authorization URL from the connect/start endpoint for an authorized caller', async () => {
    const restoreEnvironment = preserveEnvironment(META_ENVIRONMENT_KEYS)
    process.env.PUBLISHING_PROVIDER = 'meta'
    process.env.META_APP_ID = 'meta-app-id'
    process.env.META_APP_SECRET = 'meta-app-secret'
    process.env.META_OAUTH_REDIRECT_URL = 'https://api.example.test'
    process.env.API_PUBLIC_BASE_URL = 'https://api.example.test'
    const socialManagerRoleProvider: RoleProvider = { async rolesForScope() { return ['social_manager'] } }
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: () => { throw new Error('forUser should not be used by connect/start') } }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'oauth_states') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    try {
      const app = await startApp({ roleProvider: socialManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET',
        url: `/v1/channels/connect/instagram/start?organizationId=${ORGANIZATION_ID}&ownerScope=organization`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { authorizationUrl: string }
      const authorizationUrl = new URL(body.authorizationUrl)
      expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('https://api.example.test/v1/channels/connect/instagram/callback')
    } finally {
      restoreEnvironment()
    }
  })

  it('rejects OAuth start while the fake publisher is active, even with a callback URL', async () => {
    const restoreEnvironment = preserveEnvironment(['PUBLISHING_PROVIDER', 'META_OAUTH_REDIRECT_URL'])
    process.env.PUBLISHING_PROVIDER = 'fake'
    process.env.META_OAUTH_REDIRECT_URL = 'https://api.example.test'
    const socialManagerRoleProvider: RoleProvider = { async rolesForScope() { return ['social_manager'] } }
    try {
      const app = await startApp({ roleProvider: socialManagerRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET',
        url: `/v1/channels/connect/instagram/start?organizationId=${ORGANIZATION_ID}&ownerScope=organization`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({ error: 'meta_not_configured' })
    } finally {
      restoreEnvironment()
    }
  })

  // Die Oberflaeche uebergibt ownerDepartmentId auch beim Vereinskanal (als null). $fetch haengt
  // einen null-Wert als schluessellosen Query-Parameter an, Fastify liest ihn als leeren String --
  // vor der Normalisierung scheiterte damit jeder vereinseigene Verbindungsstart an der UUID-Pruefung.
  it('accepts an empty ownerDepartmentId query parameter for an organization-owned channel', async () => {
    const restoreEnvironment = preserveEnvironment(META_ENVIRONMENT_KEYS)
    process.env.PUBLISHING_PROVIDER = 'meta'
    process.env.META_APP_ID = 'meta-app-id'
    process.env.META_APP_SECRET = 'meta-app-secret'
    process.env.META_OAUTH_REDIRECT_URL = 'https://api.example.test'
    process.env.API_PUBLIC_BASE_URL = 'https://api.example.test'
    const socialManagerRoleProvider: RoleProvider = { async rolesForScope() { return ['social_manager'] } }
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: () => { throw new Error('forUser should not be used by connect/start') } }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'oauth_states') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    try {
      const app = await startApp({ roleProvider: socialManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET',
        url: `/v1/channels/connect/instagram/start?organizationId=${ORGANIZATION_ID}&ownerScope=organization&ownerDepartmentId`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(200)
    } finally {
      restoreEnvironment()
    }
  })

  it('rejects a connect/start call whose ownerScope and ownerDepartmentId contradict each other', async () => {
    const socialManagerRoleProvider: RoleProvider = { async rolesForScope() { return ['social_manager'] } }
    const app = await startApp({ roleProvider: socialManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/channels/connect/instagram/start?organizationId=${ORGANIZATION_ID}&ownerScope=organization&ownerDepartmentId=${DEPARTMENT_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  // responsible_profile_id hat nur einen Fremdschluessel auf profiles: ohne diese Pruefung liesse
  // sich ein Mitglied eines fremden Vereins als verantwortliche Person eintragen.
  it('rejects a responsible person who is not a member of the channel organization', async () => {
    const socialManagerRoleProvider: RoleProvider = { async rolesForScope() { return ['social_manager'] } }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'social_connections') {
              return chain({ data: { organization_id: ORGANIZATION_ID, owner_scope: 'organization', owner_department_id: null }, error: null })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table.endsWith('_memberships')) return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: socialManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/channels/${CONNECTION_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { responsibleProfileId: '10000000-8000-4000-8000-000000000098' },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'responsible_not_a_member' })
  })

  // Plan 039: die einzige Kanal-Anlage ohne OAuth.
  describe('POST /v1/channels (website channels)', () => {
    const socialManagerRoleProvider: RoleProvider = { async rolesForScope() { return ['social_manager'] } }
    const basePayload = { organizationId: ORGANIZATION_ID, platform: 'website', displayName: 'Vereinsblog', websiteUrl: 'https://verein.example/blog', ownerScope: 'organization', ownerDepartmentId: null }

    it('rejects any platform other than website -- instagram/facebook stay OAuth-only', async () => {
      const app = await startApp({ roleProvider: socialManagerRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: '/v1/channels', headers: { authorization: `Bearer ${token}` }, payload: { ...basePayload, platform: 'instagram' },
      })
      expect(response.statusCode).toBe(422)
      expect(response.json()).toMatchObject({ error: 'platform_requires_oauth' })
    })

    it('rejects a website_url that resolves into the internal network (SSRF guard)', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () => ({ from: () => { throw new Error('forService should not be used once the SSRF guard rejects the request') } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: socialManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: '/v1/channels', headers: { authorization: `Bearer ${token}` }, payload: { ...basePayload, websiteUrl: 'https://169.254.169.254/blog' },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ error: 'website_url_not_allowed' })
    })

    // Zugangsdaten in der Adresse landeten sonst in einer Spalte, die jedes Vereinsmitglied lesen
    // darf, und zusaetzlich im Klartext im Audit-Protokoll (Review dieses PRs).
    it('rejects a website_url that carries embedded credentials', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () => ({ from: () => { throw new Error('forService should not be used once the credential guard rejects the request') } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: socialManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: '/v1/channels', headers: { authorization: `Bearer ${token}` }, payload: { ...basePayload, websiteUrl: 'https://redakteur:geheim@verein.example/blog' },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ error: 'website_url_not_allowed' })
    })

    it('rejects the request for a caller without social_account.manage', async () => {
      const app = await startApp({ roleProvider: denyingRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: '/v1/channels', headers: { authorization: `Bearer ${token}` }, payload: basePayload })
      expect(response.statusCode).toBe(403)
    })

    it('creates an organization-owned website channel, grants the owning scope, and canonicalizes the URL', async () => {
      const insertedRow = {
        id: CONNECTION_ID, platform: 'website', external_account_id: null, display_name: 'Vereinsblog', status: 'active',
        token_expires_at: null, last_verified_at: null, owner_scope: 'organization', owner_department_id: null, responsible_profile_id: null,
        purpose: null, confidential: false, archived_at: null, created_at: '2026-08-14T09:00:00+00:00', imprint_url: null, privacy_url: null,
        editorial_responsible_profile_id: null, editorial_responsible_note: null, website_url: 'https://verein.example/blog', max_characters: null,
      }
      let socialConnectionsInsertPayload: Record<string, unknown> | undefined
      let channelScopesInsertPayload: Record<string, unknown> | undefined
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'social_connections') {
                return { insert: (row: Record<string, unknown>) => { socialConnectionsInsertPayload = row; return { select: () => ({ single: async () => ({ data: insertedRow, error: null }) }) } } }
              }
              if (table === 'channel_scopes') {
                return {
                  insert: (row: Record<string, unknown>) => { channelScopesInsertPayload = row; return { error: null } },
                  select: () => chain({ data: [{ id: '10000000-9000-4000-8000-000000000001', scope: 'organization', department_id: null, team_id: null, can_schedule: true }], error: null }),
                }
              }
              if (table === 'audit_events') return { insert: async () => ({ error: null }) }
              throw new Error(`unexpected table in test fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: socialManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      // https:// und der abschliessende "/" auf der reinen Domain duerfen keinen zweiten
      // gespeicherten Wert ergeben (Entwurfsentscheidung, Step 1) -- hier ueber Grossschreibung im
      // Host, zusammen mit einem Fragmentbezeichner, der nie an den Server geht und deshalb keinen
      // zweiten Kanal ergeben darf (Review dieses PRs).
      const response = await app.inject({
        method: 'POST', url: '/v1/channels', headers: { authorization: `Bearer ${token}` },
        payload: { ...basePayload, websiteUrl: 'https://Verein.example/blog#oben' },
      })
      expect(response.statusCode).toBe(201)
      expect(socialConnectionsInsertPayload).toMatchObject({ platform: 'website', website_url: 'https://verein.example/blog', owner_scope: 'organization', owner_department_id: null })
      expect(channelScopesInsertPayload).toMatchObject({ social_connection_id: CONNECTION_ID, scope: 'organization', can_schedule: true })
      expect(response.json()).toMatchObject({ id: CONNECTION_ID, platform: 'website', websiteUrl: 'https://verein.example/blog', externalAccountId: null, maxCharacters: null })
    })

    it('maps a duplicate website_url for the same club to 409', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'social_connections') return { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) }) }
              throw new Error(`unexpected table in test fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: socialManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: '/v1/channels', headers: { authorization: `Bearer ${token}` }, payload: basePayload })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: 'website_url_already_connected' })
    })
  })

  // Plan 039, PR 1 Step 3: der Verein legt die Laengengrenze selbst fest, null setzt sie auf die
  // globale Plattform-Vorgabe zurueck.
  it('PATCH /v1/channels/:id writes a per-channel maxCharacters override', async () => {
    const socialManagerRoleProvider: RoleProvider = { async rolesForScope() { return ['social_manager'] } }
    let updatePayload: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'social_connections') return chain({ data: { organization_id: ORGANIZATION_ID, owner_scope: 'organization', owner_department_id: null }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'social_connections') {
              return {
                update: (payload: Record<string, unknown>) => {
                  updatePayload = payload
                  return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: CONNECTION_ID, platform: 'website', external_account_id: null, display_name: 'Vereinsblog', status: 'active', token_expires_at: null, last_verified_at: null, owner_scope: 'organization', owner_department_id: null, responsible_profile_id: null, purpose: null, confidential: false, archived_at: null, created_at: '2026-08-14T09:00:00+00:00', imprint_url: null, privacy_url: null, editorial_responsible_profile_id: null, editorial_responsible_note: null, website_url: 'https://verein.example/blog', max_characters: 1500 }, error: null }) }) }) }
                },
              }
            }
            if (table === 'channel_scopes') return chain({ data: [], error: null })
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: socialManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: `/v1/channels/${CONNECTION_ID}`, headers: { authorization: `Bearer ${token}` }, payload: { maxCharacters: 1500 },
    })
    expect(response.statusCode).toBe(200)
    expect(updatePayload).toMatchObject({ max_characters: 1500 })
    expect(response.json()).toMatchObject({ maxCharacters: 1500 })
  })

  it('maps the organization_only_flag rejection to 422 when a department tries to set a channel-only policy flag', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async () => ({ data: null, error: { message: 'organization_only_flag' } }),
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/policy-settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'department', scopeId: DEPARTMENT_ID, flag: 'allow_department_owned_channels', value: true },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'organization_only_flag' })
  })
})
