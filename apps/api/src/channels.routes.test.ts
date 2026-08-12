import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, ORGANIZATION_ID, USER_ID, chain, denyingRoleProvider, organizationManagerRoleProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'
import type { RoleProvider } from './auth.js'

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
    process.env.META_OAUTH_REDIRECT_URL = 'https://api.example.test'
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
      delete process.env.META_OAUTH_REDIRECT_URL
    }
  })

  // Die Oberflaeche uebergibt ownerDepartmentId auch beim Vereinskanal (als null). $fetch haengt
  // einen null-Wert als schluessellosen Query-Parameter an, Fastify liest ihn als leeren String --
  // vor der Normalisierung scheiterte damit jeder vereinseigene Verbindungsstart an der UUID-Pruefung.
  it('accepts an empty ownerDepartmentId query parameter for an organization-owned channel', async () => {
    process.env.META_OAUTH_REDIRECT_URL = 'https://api.example.test'
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
      delete process.env.META_OAUTH_REDIRECT_URL
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

