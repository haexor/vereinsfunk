import { describe, expect, it, vi } from 'vitest'
import { INVITATION_ID, ORGANIZATION_ID, USER_ID, adminProvider, chain, defaultAdminProvider, nonAdminProvider, signAccessToken, startApp } from './testSupport.js'
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

  it('does not let the UI enable publishing when this deployment has no live provider', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ from: (table: string) => {
        if (table === 'publishing_provider_configurations' || table === 'publishing_provider_secrets') return chain({ data: [], error: null })
        throw new Error(`unexpected table in publishing configuration test: ${table}`)
      } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/platform-settings/publishing_enabled',
      headers: { authorization: `Bearer ${token}` },
      payload: { value: true },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'publishing_not_configured' })
  })

  it('does not enable live publishing until every active provider has both runtime records', async () => {
    vi.stubEnv('PUBLISHING_MODE', 'live')
    vi.stubEnv('PUBLISHING_PROVIDER', 'meta')
    vi.stubEnv('META_OAUTH_REDIRECT_URL', 'https://api.example.test/v1/channels/connect')
    vi.stubEnv('API_PUBLIC_BASE_URL', 'https://api.example.test')
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ from: (table: string) => {
        if (table === 'publishing_provider_configurations' || table === 'publishing_provider_secrets') return chain({ data: [], error: null })
        throw new Error(`unexpected table in publishing configuration test: ${table}`)
      } }) as unknown as SupabaseClient,
    }
    try {
      const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'PUT', url: '/v1/platform-settings/publishing_enabled', headers: { authorization: `Bearer ${token}` }, payload: { value: true } })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: 'publishing_not_configured' })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('reports a publishing provider secret only when a separate secret record exists', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ from: (table: string) => {
        if (table === 'publishing_provider_configurations') return chain({ data: [{ provider: 'meta', client_id: 'meta-client', graph_version: 'v21.0', updated_at: '2026-08-18T10:00:00+00:00' }], error: null })
        if (table === 'publishing_provider_secrets') return chain({ data: [], error: null })
        throw new Error(`unexpected table in publishing provider list test: ${table}`)
      } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/publishing-providers', headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([{ provider: 'meta', clientId: 'meta-client', graphVersion: 'v21.0', hasSecret: false, updatedAt: '2026-08-18T10:00:00+00:00' }])
  })

  it('stores publishing provider metadata and encrypted secret through one atomic RPC', async () => {
    let rpcName: string | undefined
    let rpcPayload: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ rpc: (name: string, payload: Record<string, unknown>) => {
        rpcName = name
        rpcPayload = payload
        return { single: async () => ({ data: { provider: 'meta', client_id: 'meta-client', graph_version: 'v21.0', updated_at: '2026-08-18T10:00:00+00:00' }, error: null }) }
      } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'PUT', url: '/v1/publishing-providers/meta', headers: { authorization: `Bearer ${token}` }, payload: { clientId: 'meta-client', clientSecret: 'never-return-this-secret', graphVersion: 'v21.0' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ provider: 'meta', clientId: 'meta-client', hasSecret: true })
    expect(JSON.stringify(response.json())).not.toContain('never-return-this-secret')
    expect(rpcName).toBe('upsert_publishing_provider_configuration')
    expect(rpcPayload?.target_client_secret_ciphertext).toBeTruthy()
    expect(JSON.stringify(rpcPayload)).not.toContain('never-return-this-secret')
    // JSON.stringify allein liesse einen Bug durchrutschen, der das Secret unverschluesselt als
    // Byte-Array statt als String serialisiert -- deshalb zusaetzlich die entschluesselten Bytes
    // gegen den Klartext vergleichen und die verwendete Schluesselversion pruefen.
    const ciphertext = Buffer.from((rpcPayload?.target_client_secret_ciphertext as string).slice(2), 'hex')
    expect(ciphertext.equals(Buffer.from('never-return-this-secret', 'utf8'))).toBe(false)
    expect(rpcPayload?.target_key_version).toBe('v1')
  })

  it('maps the separation trigger when inviting an existing club member to 409, before any email is sent', async () => {
    const rejectingClients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async () => ({ data: null, error: { message: 'member_cannot_become_platform_admin' } }),
          auth: { admin: { inviteUserByEmail: async () => { throw new Error('must not send an email for a rejected invitation') } } },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: rejectingClients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform-admin-invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'lena@example.local' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'member_cannot_become_platform_admin' })
  })

  it('maps an already-admin email to 409 already_platform_admin', async () => {
    const rejectingClients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ rpc: async () => ({ data: null, error: { message: 'already_platform_admin' } }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: rejectingClients })
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform-admin-invitations',
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
      payload: { email: 'other-admin@example.local' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'already_platform_admin' })
  })

  it('maps a still-open invitation for the same address to 409 invitation_already_open', async () => {
    const rejectingClients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ rpc: async () => ({ data: null, error: { message: 'invitation_already_open' } }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: rejectingClients })
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform-admin-invitations',
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
      payload: { email: 'pending@example.local' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'invitation_already_open' })
  })

  it('creates a platform admin invitation and emails a never-before-registered address, without leaking the raw token', async () => {
    const invitationRow = {
      id: INVITATION_ID, email: 'invitee@example.com', invited_by: USER_ID,
      expires_at: '2026-09-02T00:00:00+00:00', accepted_at: null, revoked_at: null,
      last_sent_at: '2026-08-19T00:00:00+00:00', send_count: 1, created_at: '2026-08-19T00:00:00+00:00',
    }
    const authRedirects: string[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async () => ({ data: invitationRow, error: null }),
          auth: {
            admin: {
              inviteUserByEmail: async (email: string, options?: { redirectTo?: string }) => {
                expect(email).toBe('invitee@example.com')
                authRedirects.push(options?.redirectTo ?? '')
                return { data: { user: {} }, error: null }
              },
            },
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform-admin-invitations',
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
      payload: { email: 'invitee@example.com' },
    })
    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body).toMatchObject({ email: 'invitee@example.com', emailDelivered: true })
    expect(Object.keys(body)).not.toContain('rawToken')
    expect(Object.keys(body)).not.toContain('token')
    expect(Object.keys(body)).not.toContain('tokenHash')
    expect(authRedirects).toHaveLength(1)
    const passwordRedirect = new URL(authRedirects[0]!).searchParams.get('redirect')
    const acceptRedirect = new URL(passwordRedirect!, 'http://localhost').searchParams.get('redirect')
    expect(acceptRedirect).toContain('/plattform-admin-einladung?token=')
    const acceptUrlMatch = acceptRedirect?.match(/token=([a-f0-9]+)/)
    expect(acceptUrlMatch).not.toBeNull()
    expect(JSON.stringify(body)).not.toContain(acceptUrlMatch![1]!)
  })

  it('sends an existing account a magic link continuing to the platform admin invitation', async () => {
    const invitationRow = {
      id: INVITATION_ID, email: 'existing@example.com', invited_by: USER_ID,
      expires_at: '2026-09-02T00:00:00+00:00', accepted_at: null, revoked_at: null,
      last_sent_at: '2026-08-19T00:00:00+00:00', send_count: 1, created_at: '2026-08-19T00:00:00+00:00',
    }
    const magicLinkOptions: { shouldCreateUser?: boolean; emailRedirectTo?: string }[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async () => ({ data: invitationRow, error: null }),
          auth: {
            admin: { inviteUserByEmail: async () => ({ data: { user: null }, error: { code: 'email_exists', message: 'already registered' } }) },
            signInWithOtp: async (input: { email: string; options: { shouldCreateUser?: boolean; emailRedirectTo?: string } }) => {
              magicLinkOptions.push(input.options)
              return { data: {}, error: null }
            },
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform-admin-invitations',
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
      payload: { email: 'existing@example.com' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ emailDelivered: true })
    expect(magicLinkOptions).toHaveLength(1)
    expect(magicLinkOptions[0]).toMatchObject({ shouldCreateUser: false })
    expect(decodeURIComponent(magicLinkOptions[0]!.emailRedirectTo!)).toContain('/plattform-admin-einladung?token=')
  })

  it('lists open platform admin invitations', async () => {
    const rows = [{
      id: INVITATION_ID, email: 'invitee@example.com', invited_by: USER_ID,
      expires_at: '2026-09-02T00:00:00+00:00', accepted_at: null, revoked_at: null,
      last_sent_at: '2026-08-19T00:00:00+00:00', send_count: 1, created_at: '2026-08-19T00:00:00+00:00',
    }]
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ from: () => chain({ data: rows, error: null }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'GET',
      url: '/v1/platform-admin-invitations',
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([{
      id: INVITATION_ID, email: 'invitee@example.com', invitedBy: USER_ID,
      expiresAt: '2026-09-02T00:00:00+00:00', acceptedAt: null, revokedAt: null,
      lastSentAt: '2026-08-19T00:00:00+00:00', sendCount: 1, createdAt: '2026-08-19T00:00:00+00:00',
    }])
  })

  it('maps a resend of a missing invitation to 404 not_found', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table !== 'platform_admin_invitations') throw new Error(`unexpected table: ${table}`)
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform-admin-invitations/${INVITATION_ID}/resend`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
  })

  it('maps a resend within the cooldown to 429 resend_rate_limited', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table !== 'platform_admin_invitations') throw new Error(`unexpected table: ${table}`)
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email: 'invitee@example.com', accepted_at: null, revoked_at: null }, error: null }) }) }) }
          },
          rpc: async () => ({ data: null, error: { message: 'resent at most once per hour' } }),
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform-admin-invitations/${INVITATION_ID}/resend`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ error: 'resend_rate_limited' })
  })

  it('maps a resend past the send limit to 429 resend_limit_reached', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table !== 'platform_admin_invitations') throw new Error(`unexpected table: ${table}`)
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email: 'invitee@example.com', accepted_at: null, revoked_at: null }, error: null }) }) }) }
          },
          rpc: async () => ({ data: null, error: { message: 'resend_limit_reached' } }),
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform-admin-invitations/${INVITATION_ID}/resend`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ error: 'resend_limit_reached' })
  })

  it('reports emailDelivered: false without failing the request when resend email delivery fails', async () => {
    const invitationRow = {
      id: INVITATION_ID, email: 'invitee@example.com', invited_by: USER_ID,
      expires_at: '2026-09-02T00:00:00+00:00', accepted_at: null, revoked_at: null,
      last_sent_at: '2026-08-19T00:00:00+00:00', send_count: 2, created_at: '2026-08-19T00:00:00+00:00',
    }
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table !== 'platform_admin_invitations') throw new Error(`unexpected table: ${table}`)
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email: 'invitee@example.com', accepted_at: null, revoked_at: null }, error: null }) }) }) }
          },
          rpc: async () => ({ data: invitationRow, error: null }),
          auth: { admin: { inviteUserByEmail: async () => ({ data: null, error: { message: 'smtp unavailable' } }) } },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform-admin-invitations/${INVITATION_ID}/resend`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ emailDelivered: false })
  })

  it('revokes an open platform admin invitation', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table !== 'platform_admin_invitations') throw new Error(`unexpected table: ${table}`)
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { accepted_at: null, revoked_at: null }, error: null }) }) }),
              update: () => ({
                eq: () => ({
                  is: () => ({
                    is: () => ({
                      select: () => ({
                        maybeSingle: async () => ({
                          data: {
                            id: INVITATION_ID, email: 'invitee@example.com', invited_by: USER_ID,
                            expires_at: '2026-09-02T00:00:00+00:00', accepted_at: null, revoked_at: '2026-08-19T12:00:00+00:00',
                            last_sent_at: '2026-08-19T00:00:00+00:00', send_count: 1, created_at: '2026-08-19T00:00:00+00:00',
                          },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform-admin-invitations/${INVITATION_ID}/revoke`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ revokedAt: '2026-08-19T12:00:00+00:00' })
  })

  it('answers 404 when the invitation is accepted between the read and the atomic revoke (Review-Fix)', async () => {
    // Der vorige select() sieht noch eine offene Einladung, aber das update() selbst trifft dank
    // is('accepted_at', null)/is('revoked_at', null) keine Zeile mehr -- genau das Race, das die
    // fruehere zweistufige Pruefung uebersehen haette (im Code-Review gefunden).
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table !== 'platform_admin_invitations') throw new Error(`unexpected table: ${table}`)
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { accepted_at: null, revoked_at: null }, error: null }) }) }),
              update: () => ({
                eq: () => ({
                  is: () => ({
                    is: () => ({
                      select: () => ({
                        maybeSingle: async () => ({ data: null, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform-admin-invitations/${INVITATION_ID}/revoke`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
  })

  it('maps an email/token mismatch on platform admin invitation accept to 403', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'invitation_email_mismatch' } }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: nonAdminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform-admin-invitations/accept',
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
      payload: { token: 'raw-token' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'invitation_email_mismatch' })
  })

  it('accepts a platform admin invitation without requiring platform-admin rights beforehand', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: USER_ID, error: null }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform-admin-invitations/accept',
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
      payload: { token: 'raw-token' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ isPlatformAdmin: true, isDefaultAdmin: false })
  })

  it('reports the accepting account`s real status instead of a hardcoded one (Review-Fix)', async () => {
    // accept_platform_admin_invitation() inserts with "on conflict (user_id) do nothing" -- a
    // hardcoded { isPlatformAdmin: true, isDefaultAdmin: false } response could never reflect an
    // account that was already the default admin by the time it accepted.
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: USER_ID, error: null }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: defaultAdminProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform-admin-invitations/accept',
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
      payload: { token: 'raw-token' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ isPlatformAdmin: true, isDefaultAdmin: true })
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
      task_kind: 'text_generation', structured_output_required: true,
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
      task_kind: 'text_generation', structured_output_required: true,
      is_active: true,
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

describe('text generation platform defaults', () => {
  const DEFAULT_ROWS = [
    { platform: 'facebook', max_characters: 2200, updated_at: '2026-08-13T10:00:00+00:00' },
    { platform: 'instagram', max_characters: 2200, updated_at: '2026-08-13T10:00:00+00:00' },
  ]

  // Die Leseroute traegt bewusst nur requireAuth: die Textwerkstatt muss die Vorgabe vorbefuellen
  // koennen. Ohne diesen Test wuerde ein spaeter hinzugefuegtes requirePlatformAdmin die
  // Textwerkstatt fuer normale Mitglieder lautlos brechen.
  it('lets a plain member read every platform default', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table !== 'text_generation_platform_defaults') throw new Error(`unexpected table in test fake: ${table}`)
            return chain({ data: DEFAULT_ROWS, error: null })
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ platformAdminProvider: nonAdminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET', url: '/v1/text-generation-platform-defaults', headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([
      { platform: 'facebook', maxCharacters: 2200, updatedAt: '2026-08-13T10:00:00+00:00' },
      { platform: 'instagram', maxCharacters: 2200, updatedAt: '2026-08-13T10:00:00+00:00' },
    ])
  })

  it('refuses to change a platform default without platform administration', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called once the platform-admin check fails') },
    }
    const app = await startApp({ platformAdminProvider: nonAdminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: '/v1/text-generation-platform-defaults/instagram',
      headers: { authorization: `Bearer ${token}` }, payload: { maxCharacters: 2000 },
    })
    expect(response.statusCode).toBe(403)
  })

  it('records the writing platform admin on the updated row', async () => {
    let updatePayload: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table !== 'text_generation_platform_defaults') throw new Error(`unexpected table in test fake: ${table}`)
            return {
              update: (payload: Record<string, unknown>) => {
                updatePayload = payload
                return chain({ data: { platform: 'instagram', max_characters: 2000, updated_at: '2026-08-14T09:00:00+00:00' }, error: null })
              },
            }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: '/v1/text-generation-platform-defaults/instagram',
      headers: { authorization: `Bearer ${token}` }, payload: { maxCharacters: 2000 },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ platform: 'instagram', maxCharacters: 2000, updatedAt: '2026-08-14T09:00:00+00:00' })
    expect(updatePayload).toEqual({ max_characters: 2000, updated_by: USER_ID })
  })

  // Die Route aendert nur bestehende Seed-Zeilen. Eine fehlende Zeile ist ein 404 -- vorher lief
  // sie ueber single() und damit in einen 500 aus PGRST116.
  it('answers 404 when the platform has no default row to update', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table !== 'text_generation_platform_defaults') throw new Error(`unexpected table in test fake: ${table}`)
            return { update: () => chain({ data: null, error: null }) }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: '/v1/text-generation-platform-defaults/facebook',
      headers: { authorization: `Bearer ${token}` }, payload: { maxCharacters: 2000 },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'text_generation_platform_default_not_found' })
  })

  it('rejects a platform the text workshop has no default row for', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called for an unknown platform') },
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: '/v1/text-generation-platform-defaults/threads',
      headers: { authorization: `Bearer ${token}` }, payload: { maxCharacters: 2000 },
    })
    expect(response.statusCode).toBe(400)
  })
})

// Plan 042, PR 3 Step 1: the text workshop (a plain member) cannot see GET /v1/llm-providers
// (requirePlatformAdmin), but needs to know whether the temperature regler has any effect --
// the Anthropic adapter never sends it.
describe('text generation capabilities', () => {
  function serviceReturning(rows: { protocol: string }[], onSelect?: (columns: string) => void): SupabaseClientFactory {
    return {
      forUser: () => { throw new Error('forUser should not be called by this route') },
      forService: () =>
        ({
          from: (table: string) => {
            if (table !== 'llm_provider_configurations') throw new Error(`unexpected table in test fake: ${table}`)
            return { select: (columns: string) => { onSelect?.(columns); return chain({ data: rows, error: null }) } }
          },
        }) as unknown as SupabaseClient,
    }
  }

  it('reports temperatureSupported: false for an active anthropic provider', async () => {
    const app = await startApp({ platformAdminProvider: nonAdminProvider, supabaseClients: serviceReturning([{ protocol: 'anthropic' }]) })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-capabilities', headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ temperatureSupported: false })
  })

  it('reports temperatureSupported: true for an active openai provider, reachable without platform admin', async () => {
    const app = await startApp({ platformAdminProvider: nonAdminProvider, supabaseClients: serviceReturning([{ protocol: 'openai' }]) })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-capabilities', headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ temperatureSupported: true })
  })

  // Der Worker generiert nur mit einer Konfiguration, die auch ein Geheimnis hat (der !inner-Join in
  // loadActiveTextProvider). Ohne denselben Join meldete diese Route das Protokoll einer Zeile, die
  // nie generiert -- und blendete den Regler passend dazu falsch ein oder aus. Das Filtern erledigt
  // PostgREST, hier bleibt die Form der Abfrage zu sichern.
  it('asks for the same secret-bearing configurations the worker generates with', async () => {
    let columns: string | undefined
    const app = await startApp({ platformAdminProvider: nonAdminProvider, supabaseClients: serviceReturning([{ protocol: 'openai' }], (selected) => { columns = selected }) })
    const token = await signAccessToken(USER_ID)
    expect((await app.inject({ method: 'GET', url: '/v1/text-generation-capabilities', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)
    expect(columns).toContain('llm_provider_secrets!inner')
  })

  it('reports temperatureSupported: false when no text provider is active', async () => {
    const app = await startApp({ platformAdminProvider: nonAdminProvider, supabaseClients: serviceReturning([]) })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-capabilities', headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ temperatureSupported: false })
  })
})
