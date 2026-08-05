import type { SupabaseClient } from '@supabase/supabase-js'
import { SignJWT } from 'jose'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type BuildAppOptions, type SupabaseClientFactory } from './app.js'
import type { PlatformAdminProvider, RoleProvider } from './auth.js'

const TEST_JWT_SECRET = 'test-only-secret-at-least-32-characters-long'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = '10000000-1000-4000-8000-000000000001'
const DEPARTMENT_ID = '10000000-1100-4000-8000-000000000001'

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
