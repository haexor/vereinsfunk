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

// audit_events ist append-only und hat fuer authenticated keinen Insert-Grant -- die API schreibt
// den Trail deshalb ausschliesslich ueber den Service-Client. Die Fakes erwarten den Insert
// entsprechend dort; ein Rueckfall auf den Nutzer-Client laesst den betroffenen Test an
// "unexpected table in test fake: audit_events" scheitern.
function serviceClientCapturingAudit(captured: Record<string, unknown>[]): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'audit_events') {
        return { insert: async (row: Record<string, unknown>) => { captured.push(row); return { error: null } } }
      }
      throw new Error(`unexpected table in service test fake: ${table}`)
    },
  } as unknown as SupabaseClient
}

// isAnyMemberOfOrganization (GET /v1/organizations/:id/policy-settings) queries all three
// membership tables in parallel with the same select().eq().eq().or().limit() chain -- this stub
// fakes that chain so policy-settings test fakes don't have to model it by hand each time.
function membershipRowsStub(rows: { id: string }[]) {
  return { select: () => ({ eq: () => ({ eq: () => ({ or: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }) }) }
}

// Ein generischer Query-Builder-Stub fuer Paket 011: die Aufrufer verketten eq()/is()/in() in
// wechselnder Reihenfolge und schliessen entweder mit maybeSingle()/single() ab oder awaiten die
// Kette direkt (kein PostgREST-Query-Builder ist wirklich ein Promise, aber beide sind thenable).
// chain() bildet beides identisch nach, unabhaengig davon, welche Filter dazwischen aufgerufen wurden.
// Alle policy_settings-Regelfelder auf "geerbt" (null), damit ein Test nur das eine Feld ueberschreiben
// muss, das er tatsaechlich pruefen will (Paket 011). fetchPolicyRuleRows laedt alle Ebenen einer
// Organisation in EINER Abfrage -- eine Regelzeile im Fake traegt deshalb ihre Ebene selbst
// (scope/department_id/team_id), statt sich auf die weggelassenen Filter des Stubs zu verlassen.
function emptyPolicyRuleColumns() {
  return {
    review_required: null, review_mode: null, review_stage_label: null, review_minimum_approvals: null, review_deadline_hours: null,
    minor_approval_required: null, self_approval_allowed: null, allow_same_reviewer_across_stages: null, allow_review_exemptions: null,
    media_requires_consent_check: null, allowed_presets: null, allowed_formats: null, allowed_channel_ids: null,
    forbidden_topics: [], required_hashtags: [], tone: null,
  }
}

function chain(result: { data: unknown; error: unknown }): PromiseLike<{ data: unknown; error: unknown }> & Record<string, unknown> {
  const builder: Record<string, unknown> = {
    eq: () => builder, is: () => builder, in: () => builder, or: () => builder, order: () => builder, limit: () => builder, range: () => builder, select: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => resolve(result),
  }
  return builder as PromiseLike<{ data: unknown; error: unknown }> & Record<string, unknown>
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

  it('allows the configured web origin and no other', async () => {
    process.env.WEB_BASE_URL = 'https://app.example.test/'
    try {
      const app = await startApp()
      const allowed = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: { origin: 'https://app.example.test', 'access-control-request-method': 'GET' },
      })
      // Der abschliessende Slash in der Konfiguration darf den Abgleich nicht kippen.
      expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.test')
      const foreign = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: { origin: 'https://angreifer.example.test', 'access-control-request-method': 'GET' },
      })
      expect(foreign.headers['access-control-allow-origin']).toBeUndefined()
    } finally {
      delete process.env.WEB_BASE_URL
    }
  })

  it('falls back to the local dev origin when WEB_BASE_URL is unset', async () => {
    const app = await startApp()
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: 'http://localhost:4200', 'access-control-request-method': 'GET' },
    })
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:4200')
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
    // Paket 011: die Route persistiert jetzt echt und prueft evaluateSubmitPermission vorher --
    // ohne eigene policy_settings/member_review_trust-Zeilen bleiben beide Pruefungen permissiv.
    const submissionClients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') return chain({ data: [], error: null })
            if (table === 'member_review_trust') return chain({ data: [], error: null })
            if (table === 'submissions') return { insert: () => chain({ data: { id: '10000000-4000-4000-8000-000000000001', status: 'draft' }, error: null }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used by this test') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: submissionClients })
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

  it('maps the platform-admin separation trigger on organization creation to 409', async () => {
    const rejectingClients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async () => ({ data: null, error: { message: 'platform_admin_cannot_hold_membership' } }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: rejectingClients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Betreiber-Verein e.V.', firstDepartmentName: 'Hauptabteilung' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'platform_admin_cannot_hold_membership' })
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
    const auditRows: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async () => ({ data: departmentRow.id, error: null }),
          from: (table: string) => {
            if (table === 'departments') return { select: () => ({ eq: () => ({ single: async () => ({ data: departmentRow, error: null }) }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit(auditRows),
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
    // Regression: der Audit-Trail lief ueber den Nutzer-Client und scheiterte an jeder Schreibung
    // still an "permission denied for table audit_events" (im Nachfolge-Review dieses PRs
    // gefunden) -- hier wird belegt, dass wirklich ein Eintrag entsteht.
    expect(auditRows[0]).toMatchObject({ action: 'department.created', entity_type: 'departments', actor_user_id: USER_ID })
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

  it('maps the platform-admin separation trigger on a direct membership insert to 409', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: 'P0001', message: 'platform_admin_cannot_hold_membership' } }) }) }),
          }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memberships',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, userId: '10000000-0000-4000-8000-000000000099', role: 'organization_viewer' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'platform_admin_cannot_hold_membership' })
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
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit([]),
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
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit([]),
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

  it('maps the platform-admin separation trigger on invitation accept to 409', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'platform_admin_cannot_hold_membership' } }) }) as unknown as SupabaseClient,
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
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'platform_admin_cannot_hold_membership' })
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
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async (fn: string) => {
            expect(fn).toBe('change_membership_role')
            return { data: rpcResult, error: null }
          },
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit([]),
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

  // Regression: revoke pruefte accepted_at/revoked_at nicht. Ein Widerruf auf einer bereits
  // angenommenen Einladung aenderte nichts an der Mitgliedschaft, setzte aber revoked_at und
  // schrieb einen irrefuehrenden Audit-Eintrag.
  it('refuses to revoke an invitation that was already accepted', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'invitations') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        organization_id: ORGANIZATION_ID,
                        department_id: null,
                        team_id: null,
                        email: 'invitee@example.com',
                        accepted_at: '2026-08-06T00:00:00+00:00',
                        revoked_at: null,
                      },
                      error: null,
                    }),
                  }),
                }),
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
      method: 'POST',
      url: `/v1/invitations/${INVITATION_ID}/revoke`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
  })

  // Regression: die Scope-Kette aus organizationId + departmentId wurde ungeprueft an
  // requirePermission gegeben -- ein department_admin einer FREMDEN Organisation kam damit durch
  // die Berechtigungspruefung fuer eine beliebige organizationId (kein Leck, weil der
  // zusammengesetzte Fremdschluessel auf invitations die Kombination auf null Zeilen filtert).
  it('rejects listing invitations for a department that does not belong to the organization', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/invitations?departmentId=${DEPARTMENT_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
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
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit([]),
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
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
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

  it('derives per-role capability fields from the actor\'s own rank (Paket 023)', async () => {
    const ownerUserId = '10000000-0000-4000-8000-000000000101'
    const editorUserId = '10000000-0000-4000-8000-000000000102'
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'profiles') {
              return { select: () => ({ in: async (_c: string, ids: string[]) => ({ data: ids.map((id) => ({ id, display_name: 'Person' })), error: null }) }) }
            }
            if (table === 'organization_memberships') {
              return { select: () => ({ eq: () => ({ range: async (from: number) => ({ data: from === 0 ? [{ id: '10000000-3000-4000-8000-000000000101', user_id: ownerUserId, role: 'organization_owner', expires_at: null }] : [], error: null }) }) }) }
            }
            if (table === 'department_memberships') {
              return { select: () => ({ eq: () => ({ range: async (from: number) => ({ data: from === 0 ? [{ id: '10000000-3000-4000-8000-000000000102', user_id: editorUserId, role: 'editor', expires_at: null, department_id: DEPARTMENT_ID }] : [], error: null }) }) }) }
            }
            return { select: () => ({ eq: () => ({ range: async () => ({ data: [], error: null }) }) }) }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    // organizationManagerRoleProvider returns ['organization_admin'] (rank 90) for every scope --
    // enough to manage the editor (rank 20) but not the organization_owner (rank 100).
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/members`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { userId: string; roles: { canChangeRole: boolean; canRemove: boolean; canSetExpiry: boolean }[] }[]
    const owner = body.find((member) => member.userId === ownerUserId)!.roles[0]!
    const editor = body.find((member) => member.userId === editorUserId)!.roles[0]!
    expect(owner).toMatchObject({ canChangeRole: false, canRemove: false, canSetExpiry: false })
    expect(editor).toMatchObject({ canChangeRole: true, canRemove: true, canSetExpiry: true })
  })

  it('maps an RLS rejection on a direct membership insert to a friendly invite_not_allowed error (Paket 023: invite_allowed = false)', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }) }) }),
          }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memberships',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, userId: '10000000-0000-4000-8000-000000000099', role: 'organization_viewer' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'invite_not_allowed' })
  })

  it('maps create_invitation\'s insufficient_permission to the same friendly invite_not_allowed error', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async (fn: string) => (fn === 'email_has_membership' ? { data: false, error: null } : { data: null, error: { code: 'P0001', message: 'insufficient_permission' } }),
          from: (table: string) => { throw new Error(`unexpected table in test fake: ${table}`) },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, email: 'closed-department@example.com', role: 'organization_viewer' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'invite_not_allowed' })
  })

  it('sets a membership expiry via the dedicated expiry endpoint, separately from a role change', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, user_id: USER_ID, role: 'organization_viewer' }, error: null }) }) }),
          }),
          rpc: async () => ({ data: { membershipId: MEMBERSHIP_ID, expiresAt: '2026-09-01T00:00:00+00:00' }, error: null }),
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit([]),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/memberships/${MEMBERSHIP_ID}/expiry?scope=organization`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expiresAt: '2026-09-01T00:00:00+00:00' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ expiresAt: '2026-09-01T00:00:00+00:00' })
  })
})

describe('policy settings', () => {
  it('resolves inherited effective policy values for a department without its own override', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
            if (table === 'department_memberships') return membershipRowsStub([])
            if (table === 'team_memberships') return membershipRowsStub([])
            if (table === 'departments') return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: DEPARTMENT_ID, name: 'Fussball' }], error: null }) }) }) }
            if (table === 'teams') return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }
            if (table === 'policy_settings') {
              return {
                select: () => ({
                  eq: async () => ({
                    data: [{ scope: 'organization', department_id: null, team_id: null, invite_allowed: false, posts_visible_org_wide: null }],
                    error: null,
                  }),
                }),
              }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      // organizations wird ueber den Service-Client gelesen (Rechte-Review-Fix): eine
      // Organisationsrolle ist fuer diese Route nicht Voraussetzung.
      forService: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/policy-settings`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as {
      scope: string
      inviteAllowed: { effective: boolean; ownValue: boolean | null; lockedByAncestor: boolean }
      postsVisibleOrgWide: { effective: boolean }
    }[]
    const org = body.find((entry) => entry.scope === 'organization')!
    const department = body.find((entry) => entry.scope === 'department')!
    expect(org.inviteAllowed).toMatchObject({ effective: false, ownValue: false, lockedByAncestor: false })
    // The department never set its own row -- it inherits the organization's false, and cannot
    // loosen it back to true itself (lockedByAncestor), while the untouched second flag stays true.
    expect(department.inviteAllowed).toMatchObject({ effective: false, ownValue: null, lockedByAncestor: true })
    expect(department.postsVisibleOrgWide.effective).toBe(true)
  })

  it('rejects setting a department-level policy without department.manage', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organization_id: ORGANIZATION_ID }, error: null }) }) }) }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/policy-settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'department', scopeId: DEPARTMENT_ID, flag: 'invite_allowed', value: false },
    })
    expect(response.statusCode).toBe(403)
  })

  it('resolves the organization name for a department admin without an organization role (Rechte-Review fix)', async () => {
    // organizations_select_member requires an organization-level role -- a department_admin
    // without one would see the user client's `organizations` table as empty/forbidden under
    // real RLS. The route must use the service client for this specific, non-sensitive lookup;
    // this fake makes the user client throw if it is ever queried for organizations, so the test
    // fails loudly if that regresses.
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organizations') throw new Error('organizations must be read via the service client here')
            if (table === 'organization_memberships') return membershipRowsStub([])
            if (table === 'department_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
            if (table === 'team_memberships') return membershipRowsStub([])
            if (table === 'departments') return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }
            if (table === 'teams') return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }
            if (table === 'policy_settings') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/policy-settings`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'organization', name: 'SV Test' })]))
  })

  it('rejects GET policy-settings for a user with no membership in the target organization', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') return membershipRowsStub([])
            if (table === 'department_memberships') return membershipRowsStub([])
            if (table === 'team_memberships') return membershipRowsStub([])
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/policy-settings`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
  })

  it('reports a non-existent organization as not_found instead of throwing', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
            if (table === 'department_memberships') return membershipRowsStub([])
            if (table === 'team_memberships') return membershipRowsStub([])
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/policy-settings`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(404)
  })

  it('applies a policy-setting update and returns the recalculated PolicySetting (PUT success path)', async () => {
    const auditRows: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') {
              return {
                select: () => ({
                  eq: async () => ({
                    data: [{ scope: 'organization', department_id: null, team_id: null, invite_allowed: false, posts_visible_org_wide: null }],
                    error: null,
                  }),
                }),
              }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async (fn: string) => {
            if (fn === 'set_policy_setting') return { data: { id: MEMBERSHIP_ID }, error: null }
            throw new Error(`unexpected rpc in test fake: ${fn}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { auditRows.push(row); return { error: null } } }
            if (table === 'organizations') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/policy-settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, flag: 'invite_allowed', value: false },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      scope: 'organization',
      name: 'SV Test',
      inviteAllowed: { effective: false, ownValue: false, canEdit: true },
    })
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]).toMatchObject({ action: 'policy_setting.changed', organization_id: ORGANIZATION_ID })
  })
})

describe('Paket 011: Freigaberouten, Vertrauen, Kontingente', () => {
  const STAGE_ID = '10000000-5000-4000-8000-000000000001'
  const OUTER_STAGE_ID = '10000000-5000-4000-8000-000000000009'
  const POST_VERSION_ID = '10000000-3000-4000-8000-000000000099'
  const POST_ID = '10000000-2000-4000-8000-000000000099'
  const APPROVAL_REQUEST_ID = '10000000-4000-4000-8000-000000000099'
  const OTHER_USER_ID = '10000000-0000-4000-8000-000000000002'

  it("rejects submitting a preset outside the department's allowed list with 422", async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') {
              return chain({ data: [{ id: 'p1', scope: 'department', department_id: DEPARTMENT_ID, team_id: null, ...emptyPolicyRuleColumns(), allowed_presets: ['match_result'] }], error: null })
            }
            if (table === 'member_review_trust') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetSlug: 'training_insight', communicationGoal: 'inform',
        requestedFormats: ['feed_image'], sourceMaterial: { facts: {}, observations: ['x'], quotes: [], doNotMention: [] },
      },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'preset_not_allowed' })
  })

  it("rejects submitting when the member's own trust record disallows it with 403", async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') return chain({ data: [], error: null })
            if (table === 'member_review_trust') return chain({ data: [{ scope: 'department', department_id: DEPARTMENT_ID, team_id: null, submit_allowed: false, review_requirement: 'inherit' }], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetSlug: 'training_insight', communicationGoal: 'inform',
        requestedFormats: ['feed_image'], sourceMaterial: { facts: {}, observations: ['x'], quotes: [], doNotMention: [] },
      },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'submit_not_allowed' })
  })

  it('rejects submitting with a teamId when the DEPARTMENT-level trust record disallows it, not just the team-level one', async () => {
    // Regression: fruehere Fassung pruefte bei vorhandener teamId ausschliesslich die
    // Team-Ebene und ignorierte die Abteilungsebene komplett -- eine Abteilungssperre liess sich
    // dadurch einfach durch Mitschicken einer teamId umgehen (beim Rechte-Review gefunden).
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') return chain({ data: [], error: null })
            if (table === 'member_review_trust') return chain({ data: [{ scope: 'department', department_id: DEPARTMENT_ID, team_id: null, submit_allowed: false, review_requirement: 'inherit' }], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, teamId: TEAM_ID, presetSlug: 'training_insight', communicationGoal: 'inform',
        requestedFormats: ['feed_image'], sourceMaterial: { facts: {}, observations: ['x'], quotes: [], doNotMention: [] },
      },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'submit_not_allowed' })
  })

  it('maps insufficient_permission from decide_approval_stage to 403', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'insufficient_permission' } }) }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-stages/${STAGE_ID}/decide`,
      headers: { authorization: `Bearer ${token}` },
      payload: { decision: 'approved' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('opens the next stage when decide_approval_stage reports the current one satisfied', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async () => ({ data: { stageId: STAGE_ID, stageStatus: 'satisfied', postStatus: 'awaiting_approval', nextStageId: '10000000-5000-4000-8000-000000000002' }, error: null }),
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-stages/${STAGE_ID}/decide`,
      headers: { authorization: `Bearer ${token}` },
      payload: { decision: 'approved' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ stageStatus: 'satisfied', nextStageId: '10000000-5000-4000-8000-000000000002' })
  })

  it('maps a channel outside the allowlist to 422 when scheduling a publication', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'channel_not_allowed' } }) }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/post-versions/${POST_VERSION_ID}/schedule`,
      headers: { authorization: `Bearer ${token}` },
      payload: { socialConnectionId: '10000000-8000-4000-8000-000000000001', scheduledFor: null },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'channel_not_allowed' })
  })

  it('hides the reviewer composition of a never-opened stage from the author, even after it was skipped', async () => {
    // Regression: eine abgelehnte innere Stufe setzt alle FOLGENDEN Stufen direkt aus 'pending' auf
    // 'skipped', ohne dass sie je 'open' waren. Eine Sichtbarkeitspruefung auf status === 'pending'
    // haette die Zusammensetzung der aeusseren Stufe dem Autor nach der Ablehnung offengelegt --
    // deshalb prueft die Route opened_at (beim Geheimnisse-Review gefunden).
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'post_versions') return chain({ data: { id: POST_VERSION_ID, created_by_user_id: USER_ID }, error: null })
            if (table === 'approval_requests') return chain({ data: { id: APPROVAL_REQUEST_ID, post_id: POST_ID, post_version_id: POST_VERSION_ID }, error: null })
            if (table === 'approval_stages') {
              return chain({
                data: [
                  {
                    id: STAGE_ID, position: 1, scope: 'department', label: 'Abteilung', mode: 'named', minimum_approvals: 1, is_minor_stage: false,
                    status: 'rejected', reviewer_snapshot: [{ userId: OTHER_USER_ID }], deadline_at: null, opened_at: new Date().toISOString(),
                  },
                  {
                    id: OUTER_STAGE_ID, position: 2, scope: 'organization', label: 'Verein', mode: 'named', minimum_approvals: 1, is_minor_stage: false,
                    status: 'skipped', reviewer_snapshot: [{ userId: OTHER_USER_ID }], deadline_at: null, opened_at: null,
                  },
                ],
                error: null,
              })
            }
            if (table === 'approval_decisions') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/post-versions/${POST_VERSION_ID}/approval`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    const stages = response.json().stages as { id: string; reviewerUserIds: string[] | null }[]
    expect(stages.find((stage) => stage.id === STAGE_ID)?.reviewerUserIds).toEqual([OTHER_USER_ID])
    expect(stages.find((stage) => stage.id === OUTER_STAGE_ID)?.reviewerUserIds).toBeNull()
  })

  it('rejects requesting approval with 422 and names the unfulfillable level', async () => {
    // Plan 011, "Verifikation": eine Route mit einer Stufe ohne auflösbaren Prueferkreis wird nicht
    // erzeugt -- sie wuerde den Beitrag lautlos fuer immer liegen lassen.
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'post_versions') return chain({ data: { id: POST_VERSION_ID, post_id: POST_ID, created_by_user_id: USER_ID, safety_flags: [] }, error: null })
            if (table === 'posts') return chain({ data: { id: POST_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, status: 'draft_ready' }, error: null })
            if (table === 'policy_settings') {
              return chain({ data: [{ id: 'p1', scope: 'department', department_id: DEPARTMENT_ID, team_id: null, ...emptyPolicyRuleColumns(), review_required: true }], error: null })
            }
            if (table === 'organization_memberships' || table === 'department_memberships' || table === 'team_memberships') return chain({ data: [], error: null })
            if (table === 'member_review_trust') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async () => { throw new Error('request_approval should not be called for an unfulfillable route') },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/post-versions/${POST_VERSION_ID}/request-approval`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'unfulfillable_stage', blockers: [{ kind: 'empty_reviewer_pool', stageLabel: 'Abteilung' }] })
  })

  it('resolves an organization-level approver into the reviewer snapshot of a DEPARTMENT stage', async () => {
    // Regression: der Prueferkreis einer "any_with_permission"-Stufe wurde nur aus den Rollen DER
    // EIGENEN Ebene gebildet. authz.has_department_permission reicht post.approve aber von der
    // Vereinsebene nach unten durch -- eine Abteilung ohne eigene "approver"-Rolle bekam deshalb
    // einen empty_reviewer_pool-Blocker, obwohl die Vereinsleitung freigeben darf.
    const rpcCalls: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'post_versions') return chain({ data: { id: POST_VERSION_ID, post_id: POST_ID, created_by_user_id: USER_ID, safety_flags: [] }, error: null })
            if (table === 'posts') return chain({ data: { id: POST_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, status: 'draft_ready' }, error: null })
            if (table === 'policy_settings') {
              return chain({ data: [{ id: 'p1', scope: 'department', department_id: DEPARTMENT_ID, team_id: null, ...emptyPolicyRuleColumns(), review_required: true }], error: null })
            }
            if (table === 'organization_memberships') return chain({ data: [{ user_id: OTHER_USER_ID, role: 'organization_admin' }], error: null })
            if (table === 'department_memberships' || table === 'team_memberships') return chain({ data: [], error: null })
            if (table === 'member_review_trust') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async (fn: string, args: Record<string, unknown>) => {
            rpcCalls.push({ fn, args })
            return { data: { postId: POST_ID, status: 'awaiting_approval', approvalRequestId: APPROVAL_REQUEST_ID }, error: null }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/post-versions/${POST_VERSION_ID}/request-approval`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(202)
    const sentStages = (rpcCalls[0]!.args as { stages: { position: number; scope: string; reviewerSnapshot: { userId: string }[] }[] }).stages
    expect(sentStages).toHaveLength(1)
    expect(sentStages[0]).toMatchObject({ position: 1, scope: 'department', reviewerSnapshot: [{ userId: OTHER_USER_ID }] })
  })

  it('rejects reading member review trust of an organization the caller does not belong to with 403', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships' || table === 'department_memberships' || table === 'team_memberships') return membershipRowsStub([])
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/member-review-trust`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
  })

  it('requires an organizationId when listing the stages waiting for the caller', async () => {
    // Ohne Organisationsbezug saehe eine Person mit Pruefrollen in mehreren Vereinen die Freigaben
    // aller ihrer Vereine in der Liste eines einzelnen.
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: () => { throw new Error('the query must be rejected before any table access') } }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/approval-stages/mine', headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('maps an exceeded quota to 409 naming the blocking limit when scheduling a publication', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'quota_exceeded: organization/day' } }) }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/post-versions/${POST_VERSION_ID}/schedule`,
      headers: { authorization: `Bearer ${token}` },
      payload: { socialConnectionId: '10000000-8000-4000-8000-000000000001', scheduledFor: null },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'quota_exceeded', detail: 'quota_exceeded: organization/day' })
  })
})
