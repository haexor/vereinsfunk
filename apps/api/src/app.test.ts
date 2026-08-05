import type { SupabaseClient } from '@supabase/supabase-js'
import { SignJWT } from 'jose'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type BuildAppOptions, type SupabaseClientFactory } from './app.js'
import type { PlatformAdminProvider, RoleProvider } from './auth.js'

const TEST_JWT_SECRET = 'test-only-secret-at-least-32-characters-long'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = '10000000-1000-4000-8000-000000000001'
const DEPARTMENT_ID = '10000000-1100-4000-8000-000000000001'
const TEAM_ID = '10000000-1200-4000-8000-000000000001'
const INVITATION_ID = '10000000-2000-4000-8000-000000000001'
const MEMBERSHIP_ID = '10000000-3000-4000-8000-000000000001'

async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ aud: 'authenticated', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET))
}

const grantingRoleProvider: RoleProvider = {
  async rolesForScope() {
    return ['editor']
  },
}

const denyingRoleProvider: RoleProvider = {
  async rolesForScope() {
    return ['viewer']
  },
}

const organizationManagerRoleProvider: RoleProvider = {
  async rolesForScope() {
    return ['organization_admin']
  },
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = []
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())))

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET
  process.env.SECRET_BOX_KEYS = JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') })
  process.env.SECRET_BOX_CURRENT_KEY_VERSION = 'v1'
})

const nonAdminProvider: PlatformAdminProvider = { async statusFor() { return { isPlatformAdmin: false, isDefaultAdmin: false } } }
const adminProvider: PlatformAdminProvider = { async statusFor() { return { isPlatformAdmin: true, isDefaultAdmin: false } } }
const defaultAdminProvider: PlatformAdminProvider = { async statusFor() { return { isPlatformAdmin: true, isDefaultAdmin: true } } }

async function startApp(options: BuildAppOptions = {}) {
  const app = await buildApp({ logger: false, ...options })
  apps.push(app)
  return app
}

describe('api', () => {
  it('exposes a schema-valid health endpoint without authentication', async () => {
    const app = await startApp()
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok', service: 'api' })
  })

  it('rejects a request without a token', async () => {
    const app = await startApp()
    const response = await app.inject({ method: 'POST', url: '/v1/submissions', payload: {} })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('rejects a request with a forged signature', async () => {
    const app = await startApp()
    const forged = await new SignJWT({ aud: 'authenticated', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-completely-different-secret-value'))
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${forged}` },
      payload: {},
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('rejects malformed submissions once authenticated', async () => {
    const app = await startApp()
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('rejects a valid token without the required permission', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        organizationId: ORGANIZATION_ID,
        departmentId: DEPARTMENT_ID,
        presetSlug: 'training_insight',
        communicationGoal: 'inform',
        requestedFormats: ['feed_image'],
        sourceMaterial: { facts: {}, observations: ['Heute war Training.'], quotes: [], doNotMention: [] },
      },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })

  it('accepts a valid token with the required permission', async () => {
    const app = await startApp({ roleProvider: grantingRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        organizationId: ORGANIZATION_ID,
        departmentId: DEPARTMENT_ID,
        presetSlug: 'training_insight',
        communicationGoal: 'inform',
        requestedFormats: ['feed_image'],
        sourceMaterial: { facts: {}, observations: ['Heute war Training.'], quotes: [], doNotMention: [] },
      },
    })
    expect(response.statusCode).toBe(202)
  })
})

describe('onboarding', () => {
  it('rejects a profile update without organization.manage', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${ORGANIZATION_ID}/profile`,
      headers: { authorization: `Bearer ${token}` },
      payload: { legalName: 'Hijacked e.V.' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })

  it('rejects a logo upload whose content is not one of the supported formats', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkTestBoundary'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="variant"\r\n\r\nlight\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from('this is not an image'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/logo`,
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_logo' })
  })

  it('rejects a logo upload exceeding the size limit with 413, not an unhandled 500', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkTestBoundaryLarge'
    const oversized = Buffer.alloc(9 * 1024 * 1024, 0x41)
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="variant"\r\n\r\nlight\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`),
      oversized,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/brand/logo`,
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(response.statusCode).toBe(413)
    expect(response.json()).toMatchObject({ error: 'file_too_large' })
  })

  it('maps the SQL owner-limit rejection to 429, independent of any client-side check', async () => {
    const rejectingClients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async () => ({ data: null, error: { message: 'organization limit reached for this account' } }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: rejectingClients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Zu viele Vereine e.V.', firstDepartmentName: 'Hauptabteilung' },
    })
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ error: 'organization_limit_reached' })
  })
})

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
      label: 'Claude via haex-claude-proxy',
      protocol: 'anthropic',
      base_url: 'https://claude-proxy.internal',
      model: 'claude-opus-5',
      purpose: 'default',
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
        label: 'Claude via haex-claude-proxy',
        protocol: 'anthropic',
        baseUrl: 'https://claude-proxy.internal',
        model: 'claude-opus-5',
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
})

describe('structure, memberships and invitations', () => {
  it('rejects creating a department without department.manage', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/departments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Handball' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })

  it('creates a department via the create_department RPC', async () => {
    const departmentRow = {
      id: '10000000-1100-4000-8000-000000000099',
      organization_id: ORGANIZATION_ID,
      name: 'Handball',
      slug: 'handball',
      archived_at: null,
      created_at: '2026-08-06T10:00:00+00:00',
    }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async () => ({ data: departmentRow.id, error: null }),
          from: (table: string) => {
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            return { select: () => ({ eq: () => ({ single: async () => ({ data: departmentRow, error: null }) }) }) }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/departments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Handball' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ id: departmentRow.id, name: 'Handball', slug: 'handball' })
  })

  it('rejects an invitation payload whose role does not match its scope, before any DB call', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, email: 'person@example.com', role: 'department_admin' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('rejects an organization-level role for a department-scoped membership, before any DB call', async () => {
    // CreateMembershipRequestSchema validates role against scope itself (superRefine) -- an
    // organization-level role is never valid for a department-scoped membership, regardless of
    // the actor's rank. See packages/authorization's canAssignRole tests for the rank check
    // itself; every role that holds member.invite at a given level is already that level's
    // highest-ranked role, so a scope-valid rank violation cannot occur independently of an
    // invalid scope/role combination in this role model.
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memberships',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'department', scopeId: DEPARTMENT_ID, userId: '10000000-0000-4000-8000-000000000099', role: 'organization_admin' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('rejects organization_owner as a role for POST /v1/memberships, before any DB call', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memberships',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, userId: '10000000-0000-4000-8000-000000000099', role: 'organization_owner' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('rejects an invitation for an address that is already a member', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: true, error: null }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, email: 'already-member@example.com', role: 'organization_viewer' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'already_a_member' })
  })

  it('never returns the raw invitation token in the create response', async () => {
    const invitationRow = {
      id: '30000000-0000-4000-8000-000000000001',
      organization_id: ORGANIZATION_ID,
      department_id: null,
      team_id: null,
      email: 'invitee@example.com',
      role: 'organization_viewer',
      invited_by: USER_ID,
      expires_at: '2026-08-20T00:00:00+00:00',
      accepted_at: null,
      revoked_at: null,
      last_sent_at: '2026-08-06T00:00:00+00:00',
      send_count: 1,
      created_at: '2026-08-06T00:00:00+00:00',
    }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          // email_has_membership() checks whether the invitee is already a member (false here);
          // create_invitation() is the atomic RPC that replaces the former direct insert (see
          // apps/api/src/app.ts).
          rpc: async (fn: string) => (fn === 'email_has_membership' ? { data: false, error: null } : { data: invitationRow, error: null }),
          from: (table: string) => {
            if (table === 'organizations') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const capturedMessages: { to: string; subject: string; text: string }[] = []
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
      emailSender: { send: async (message) => { capturedMessages.push(message) } },
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, email: 'invitee@example.com', role: 'organization_viewer' },
    })
    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(Object.keys(body)).not.toContain('rawToken')
    expect(Object.keys(body)).not.toContain('token')
    expect(Object.keys(body)).not.toContain('tokenHash')
    // The raw token IS present in the captured outgoing email (that's the whole point of sending
    // it) -- extracting it from there proves it specifically never also leaks into the HTTP
    // response, rather than just asserting an absence that could be a fixture mistake.
    expect(capturedMessages).toHaveLength(1)
    const acceptUrlMatch = capturedMessages[0]!.text.match(/token=([a-f0-9]+)/)
    expect(acceptUrlMatch).not.toBeNull()
    expect(JSON.stringify(body)).not.toContain(acceptUrlMatch![1]!)
  })

  it('maps the resend send-count limit to 429 before touching the database', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, email: 'x@example.com', send_count: 10, accepted_at: null, revoked_at: null },
                  error: null,
                }),
              }),
            }),
          }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/invitations/${INVITATION_ID}/resend`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ error: 'resend_limit_reached' })
  })

  it('resends an invitation via the resend_invitation RPC', async () => {
    const existingRow = { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, email: 'invitee@example.com', send_count: 2, accepted_at: null, revoked_at: null }
    const resentRow = {
      id: INVITATION_ID,
      organization_id: ORGANIZATION_ID,
      department_id: null,
      team_id: null,
      email: 'invitee@example.com',
      role: 'organization_viewer',
      invited_by: USER_ID,
      expires_at: '2026-08-20T00:00:00+00:00',
      accepted_at: null,
      revoked_at: null,
      last_sent_at: '2026-08-06T00:00:00+00:00',
      send_count: 3,
      created_at: '2026-08-05T00:00:00+00:00',
    }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async () => ({ data: resentRow, error: null }),
          from: (table: string) => {
            if (table === 'invitations') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingRow, error: null }) }) }) }
            if (table === 'organizations') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/invitations/${INVITATION_ID}/resend`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: INVITATION_ID, sendCount: 3 })
  })

  it('maps an email/account mismatch on accept to 403', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'invitation_email_mismatch' } }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: 'some-raw-token' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'invitation_email_mismatch' })
  })

  it('maps an expired or unknown invitation on accept to 410', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'invitation_not_found_or_expired' } }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: 'some-raw-token' },
    })
    expect(response.statusCode).toBe(410)
    expect(response.json()).toMatchObject({ error: 'invitation_not_found_or_expired' })
  })

  it('refuses to remove the organization\'s responsible person', async () => {
    const membershipRow = { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, user_id: '10000000-0000-4000-8000-000000000099', role: 'organization_viewer' }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') {
              return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: membershipRow, error: null }) }) }) }
            }
            if (table === 'organization_profiles') {
              return {
                select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { responsible_person_profile_id: membershipRow.user_id }, error: null }) }) }),
              }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/memberships/${MEMBERSHIP_ID}?scope=organization`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'responsible_person_cannot_be_removed' })
  })

  it('maps the department content-delete trigger rejection to 409', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organization_id: ORGANIZATION_ID }, error: null }) }) }),
            delete: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: 'a department with existing posts cannot be deleted, archive it instead' } }) }) }),
          }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/departments/${DEPARTMENT_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'department_delete_blocked' })
  })

  // Regression: PostgREST reports no error when an RLS policy filters the DELETE's target row
  // out -- del.error is null and exactly zero rows come back, which used to be indistinguishable
  // from "deleted successfully" (found in this package's review).
  it('maps a silently RLS-filtered department delete to 403 instead of 204', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organization_id: ORGANIZATION_ID }, error: null }) }) }),
            delete: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }),
          }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/departments/${DEPARTMENT_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })

  it('changes a membership role atomically via the change_membership_role RPC', async () => {
    const existingRow = { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, user_id: '10000000-0000-4000-8000-000000000099', role: 'organization_viewer' }
    const rpcResult = { membershipId: MEMBERSHIP_ID, userId: existingRow.user_id, role: 'social_manager', expiresAt: null, fromRole: 'organization_viewer' }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingRow, error: null }) }) }) }
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async (fn: string) => {
            expect(fn).toBe('change_membership_role')
            return { data: rpcResult, error: null }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/memberships/${MEMBERSHIP_ID}?scope=organization`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'social_manager' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ membershipId: MEMBERSHIP_ID, role: 'social_manager', scope: 'organization' })
  })

  it('maps the change_membership_role RPC last-owner rejection to 409', async () => {
    // An organization_owner demoting another organization_owner passes the client-side rank
    // check (rank 100 <= 100, canRemoveRole has no organization_owner exception, see
    // packages/authorization) -- only prevent_last_owner_removal's count of remaining owners can
    // reject this, so the actor must itself be an organization_owner for the RPC to ever run.
    const ownerRoleProvider: RoleProvider = { async rolesForScope() { return ['organization_owner'] } }
    const existingRow = { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, user_id: '10000000-0000-4000-8000-000000000099', role: 'organization_owner' }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingRow, error: null }) }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async (fn: string) => {
            expect(fn).toBe('change_membership_role')
            return { data: null, error: { message: 'the last organization_owner cannot be removed' } }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: ownerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/memberships/${MEMBERSHIP_ID}?scope=organization`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'organization_admin' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'cannot_remove_last_owner' })
  })

  // Regression: pages/mitglieder.vue sendete fuer eine Team-Einladung nur teamId, nie die
  // Eltern-Abteilung -- CreateInvitationRequestSchema verlangt beides, jede Team-Einladung aus
  // der Oberflaeche schlug deshalb mit 400 fehl (im Nachfolge-Review dieses PRs gefunden).
  it('rejects a team-scoped invitation that omits the parent department', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, teamId: TEAM_ID, email: 'person@example.com', role: 'team_manager' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('accepts a team-scoped invitation that carries the parent department and names the team in the email', async () => {
    const invitationRow = {
      id: INVITATION_ID,
      organization_id: ORGANIZATION_ID,
      department_id: DEPARTMENT_ID,
      team_id: TEAM_ID,
      email: 'invitee@example.com',
      role: 'team_manager',
      invited_by: USER_ID,
      expires_at: '2026-08-20T00:00:00+00:00',
      accepted_at: null,
      revoked_at: null,
      last_sent_at: '2026-08-06T00:00:00+00:00',
      send_count: 1,
      created_at: '2026-08-06T00:00:00+00:00',
    }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async (fn: string) => (fn === 'email_has_membership' ? { data: false, error: null } : { data: invitationRow, error: null }),
          from: (table: string) => {
            if (table === 'teams') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, name: 'Erste Mannschaft' }, error: null }),
                  }),
                }),
              }
            }
            if (table === 'organizations') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const capturedMessages: { to: string; subject: string; text: string }[] = []
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
      emailSender: { send: async (message) => { capturedMessages.push(message) } },
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, teamId: TEAM_ID, email: 'invitee@example.com', role: 'team_manager' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ id: INVITATION_ID, teamId: TEAM_ID, emailDelivered: true })
    // resolveInvitationScope() liefert den echten Team-Namen, nicht den Vereinsnamen.
    expect(capturedMessages[0]!.text).toContain('Erste Mannschaft')
  })

  // Regression: die drei Mitgliedschaftstabellen werden ueber fetchAllRows() geblaettert, der
  // Profil-Nachschlag lief aber als ein einzelnes .in() ueber alle Nutzer-IDs -- betroffene
  // Mitglieder fielen jenseits der Kappungsgrenze still auf "Unbekannt" zurueck.
  it('resolves display names for a roster larger than one profiles lookup chunk', async () => {
    const memberCount = 250
    const organizationRows = Array.from({ length: memberCount }, (_, index) => ({
      id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      user_id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      role: 'organization_viewer',
      expires_at: null,
    }))
    const requestedChunkSizes: number[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'profiles') {
              return {
                select: () => ({
                  in: async (_column: string, values: string[]) => {
                    requestedChunkSizes.push(values.length)
                    return { data: values.map((id) => ({ id, display_name: `Person ${id.slice(-4)}` })), error: null }
                  },
                }),
              }
            }
            const rows = table === 'organization_memberships' ? organizationRows : []
            return { select: () => ({ eq: () => ({ range: async (from: number) => ({ data: from === 0 ? rows : [], error: null }) }) }) }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/members`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { displayName: string }[]
    expect(body).toHaveLength(memberCount)
    expect(body.filter((member) => member.displayName === 'Unbekannt')).toHaveLength(0)
    expect(requestedChunkSizes).toEqual([100, 100, 50])
  })
})
