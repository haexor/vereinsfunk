import type { SupabaseClient } from '@supabase/supabase-js'
import type { SocialPublisher } from '@vereinsfunk/publishing'
import { createChainSigner, createSecretBox } from '@vereinsfunk/secrets'
import { SignJWT } from 'jose'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type BuildAppOptions, type SupabaseClientFactory } from './app.js'
import type { PlatformAdminProvider, RoleProvider } from './auth.js'
import { ciphertextToBytea } from './secretBox.js'

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

// Paket 025: POST /v1/submissions legt bei vollstaendigem Quellmaterial jetzt echt einen
// post/post_version an (Service Role, keine Insert-Policy fuer authenticated) -- dieser Fake
// deckt genau die Schreibfolge ab, die der Handler dafuer auslöst.
function draftCreationServiceClient(
  ids: { postId?: string; postVersionId?: string } = {},
  captured: { versionRow?: Record<string, unknown> } = {},
): SupabaseClient {
  const postId = ids.postId ?? '20000000-0000-4000-8000-000000000001'
  const postVersionId = ids.postVersionId ?? '20000000-1000-4000-8000-000000000001'
  return {
    from: (table: string) => {
      if (table === 'posts') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: postId }, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'post_versions') {
        return {
          insert: (row: Record<string, unknown>) => {
            captured.versionRow = row
            return { select: () => ({ single: async () => ({ data: { id: postVersionId }, error: null }) }) }
          },
        }
      }
      if (table === 'post_variants') return { insert: async () => ({ error: null }) }
      if (table === 'audit_events') return { insert: async () => ({ error: null }) }
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

function chain(result: { data: unknown; error: unknown; count?: number }): PromiseLike<{ data: unknown; error: unknown; count?: number }> & Record<string, unknown> {
  const builder: Record<string, unknown> = {
    eq: () => builder, is: () => builder, in: () => builder, or: () => builder, order: () => builder, limit: () => builder, range: () => builder, select: () => builder, filter: () => builder,
    // Paket 019 (GET .../content-suggestions) verkettet zusaetzlich neq()/gte()/lte()/not() --
    // dieselbe Ignorierhaltung wie bei eq()/is()/in() oben, das Ergebnis steht schon fest.
    neq: () => builder, gte: () => builder, lte: () => builder, not: () => builder, lt: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: (value: { data: unknown; error: unknown; count?: number }) => unknown) => resolve(result),
  }
  return builder as PromiseLike<{ data: unknown; error: unknown; count?: number }> & Record<string, unknown>
}

// Eigene Funktionsgrenze, damit TS eine `let`-Variable, die innerhalb einer Fake-Closure
// zugewiesen wird, an der Leseseite nicht ueber alle Zuweisungen der ganzen Testfunktion hinweg
// auf `never` verengt.
function readField(record: Record<string, unknown> | null, field: string): unknown {
  return record ? record[field] : undefined
}

// Die Grenzen, die eine hoehere Ebene setzt, liest die API bewusst ueber die Service Role: ob eine
// Sperre greift, darf nicht davon abhaengen, ob die Aufruferin das Vereinsprofil selbst lesen darf.
function brandLimitsService(
  organization: { allow_department_overrides: boolean; locked_fields: string[] } | null,
  department: { allow_team_overrides: boolean; locked_fields: string[] } | null = null,
) {
  return () =>
    ({
      from: (table: string) => {
        if (table === 'organization_brand_profiles') return chain({ data: organization, error: null })
        if (table === 'department_brand_profiles') return chain({ data: department, error: null })
        throw new Error(`unexpected table in service fake: ${table}`)
      },
    }) as unknown as SupabaseClient
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
    const captured: { versionRow?: Record<string, unknown> } = {}
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
      forService: () => draftCreationServiceClient({}, captured),
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
    // Paket 025: vollstaendiges Quellmaterial (keine missingFacts) erzeugt jetzt einen echten
    // post/post_version statt nur einer Vorschau.
    expect(response.json()).toMatchObject({ status: 'queued', postId: '20000000-0000-4000-8000-000000000001', postVersionId: '20000000-1000-4000-8000-000000000001' })
    // Plans/025, STOP-Bedingung: schedule_publication/available-channels lesen
    // effective_config_snapshot->'config'->'allowedChannelIds' direkt -- eine Regression zur
    // unveraenderten EffectiveConfig-Verschachtelung (config.policies.allowedChannelIds) waere ein
    // stiller Policy-Bypass, den kein Testfehler anzeigen wuerde.
    const snapshot = captured.versionRow!.effective_config_snapshot as { config: Record<string, unknown> }
    expect(snapshot.config).toHaveProperty('allowedChannelIds')
    expect(snapshot.config).not.toHaveProperty('policies')
  })

  // Paket 025: nur der vollstaendige Fall (keine missingFacts) legt einen Entwurf an --
  // forService wirft hier absichtlich, um zu beweisen, dass der facts_required-Zweig keinen
  // Schreibzugriff ausloest.
  it('does not create a draft when required facts are missing', async () => {
    const submissionClients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') return chain({ data: [], error: null })
            if (table === 'member_review_trust') return chain({ data: [], error: null })
            if (table === 'submissions') return { insert: () => chain({ data: { id: '10000000-4000-4000-8000-000000000002', status: 'draft' }, error: null }) }
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
        sourceMaterial: { facts: {}, observations: [], quotes: [{ text: 'Toller Tag!', approved: true }], doNotMention: [] },
      },
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ status: 'facts_required' })
    expect(response.json().postId).toBeUndefined()
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
              return { select: () => ({ eq: async () => ({ data: null, count: table === 'organization_memberships' ? 4 : 2, error: null }) }) }
            }
            if (table === 'media_assets') {
              return {
                select: (_columns: string, options?: { head?: boolean }) => {
                  if (options?.head) return { eq: () => ({ ilike: () => ({ gte: async () => activityCount }) }) }
                  return { eq: () => ({ order: () => ({ range: async () => ({ data: [{ byte_size: 1024 }, { byte_size: 512 }], error: null }) }) }) }
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
      contact: { responsiblePersonName: 'Lena Test', email: 'kontakt@sv-test.example' },
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
            return { select: () => ({ eq: () => ({ order: () => ({ range: async (from: number) => ({ data: from === 0 ? rows : [], error: null }) }) }) }) }
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
              return { select: () => ({ eq: () => ({ order: () => ({ range: async (from: number) => ({ data: from === 0 ? [{ id: '10000000-3000-4000-8000-000000000101', user_id: ownerUserId, role: 'organization_owner', expires_at: null }] : [], error: null }) }) }) }) }
            }
            if (table === 'department_memberships') {
              return { select: () => ({ eq: () => ({ order: () => ({ range: async (from: number) => ({ data: from === 0 ? [{ id: '10000000-3000-4000-8000-000000000102', user_id: editorUserId, role: 'editor', expires_at: null, department_id: DEPARTMENT_ID }] : [], error: null }) }) }) }) }
            }
            return { select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) }
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
            if (table === 'approval_route_changes') return chain({ data: [], error: null })
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
    expect(response.json().routeChanges).toEqual([])
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
    // Paket 024: request_approval() nimmt "stages" nicht mehr vom Aufrufer entgegen -- die
    // TS-seitige Route hier ist nur noch eine VORSCHAU fuer den 422-Blocker-Fall, nicht mehr das,
    // was an die RPC geht (die leitet ihre eigene Route selbst ab, siehe authz.resolve_review_route).
    // Beobachtbar bleibt deshalb nur noch, DASS die Vorschau keinen Blocker meldet -- welche
    // reviewerUserIds sie konkret berechnet, deckt weiterhin resolveReviewRoute()/
    // buildStageDefinitions() in packages/domain bzw. den uebrigen API-Tests dieser Datei ab.
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
    expect(rpcCalls[0]).toMatchObject({ fn: 'request_approval', args: { target_post_version_id: POST_VERSION_ID } })
  })

  it('reresolves an approval route and returns the newly opened stage', async () => {
    const rpcCalls: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async (fn: string, args: Record<string, unknown>) => {
            rpcCalls.push({ fn, args })
            return { data: { postId: POST_ID, approvalRequestId: APPROVAL_REQUEST_ID, status: 'awaiting_approval', firstStageId: STAGE_ID }, error: null }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${APPROVAL_REQUEST_ID}/reresolve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Medienverantwortliche ist ausgetreten, neue Person benannt.' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ approvalRequestId: APPROVAL_REQUEST_ID, status: 'awaiting_approval', firstStageId: STAGE_ID })
    expect(rpcCalls[0]).toMatchObject({
      fn: 'reresolve_approval_route',
      args: { target_approval_request_id: APPROVAL_REQUEST_ID, reason: 'Medienverantwortliche ist ausgetreten, neue Person benannt.' },
    })
  })

  it('rejects a reresolve reason shorter than ten characters with 400, before ever calling the RPC', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => { throw new Error('reresolve_approval_route should not be called for an invalid reason') } }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${APPROVAL_REQUEST_ID}/reresolve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'zu kurz' },
    })
    expect(response.statusCode).toBe(400)
  })

  it.each([
    ['not_found', 404],
    ['insufficient_permission', 403],
    ['author_cannot_reresolve', 403],
    ['invalid_status', 409],
    ['route_has_rejected_stage', 409],
    ['ambiguous_stage_mapping', 409],
    ['reason_required', 400],
    ['empty_reviewer_snapshot', 422],
  ] as const)('maps %s from reresolve_approval_route to %i', async (message, status) => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message } }) }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${APPROVAL_REQUEST_ID}/reresolve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Eine ausreichend lange Begruendung fuer den Test.' },
    })
    expect(response.statusCode).toBe(status)
  })

  it('lists only stalled approval requests -- overdue or invalidated, not the merely open one', async () => {
    const OVERDUE_REQUEST_ID = '10000000-4000-4000-8000-000000000010'
    const INVALIDATED_REQUEST_ID = '10000000-4000-4000-8000-000000000011'
    const HEALTHY_REQUEST_ID = '10000000-4000-4000-8000-000000000012'
    const OVERDUE_POST_ID = '10000000-2000-4000-8000-000000000010'
    const INVALIDATED_POST_ID = '10000000-2000-4000-8000-000000000011'
    const HEALTHY_POST_ID = '10000000-2000-4000-8000-000000000012'
    const OVERDUE_VERSION_ID = '10000000-3000-4000-8000-000000000010'
    const INVALIDATED_VERSION_ID = '10000000-3000-4000-8000-000000000011'
    const HEALTHY_VERSION_ID = '10000000-3000-4000-8000-000000000012'
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'approval_requests') {
              return chain({
                data: [
                  { id: OVERDUE_REQUEST_ID, post_id: OVERDUE_POST_ID, post_version_id: OVERDUE_VERSION_ID, invalidated_at: null },
                  { id: INVALIDATED_REQUEST_ID, post_id: INVALIDATED_POST_ID, post_version_id: INVALIDATED_VERSION_ID, invalidated_at: new Date().toISOString() },
                  { id: HEALTHY_REQUEST_ID, post_id: HEALTHY_POST_ID, post_version_id: HEALTHY_VERSION_ID, invalidated_at: null },
                ],
                error: null,
              })
            }
            if (table === 'approval_stages') {
              return chain({
                data: [
                  { approval_request_id: OVERDUE_REQUEST_ID, deadline_at: new Date(Date.now() - 60_000).toISOString() },
                  { approval_request_id: INVALIDATED_REQUEST_ID, deadline_at: null },
                  { approval_request_id: HEALTHY_REQUEST_ID, deadline_at: new Date(Date.now() + 60_000).toISOString() },
                ],
                error: null,
              })
            }
            if (table === 'posts') {
              return chain({
                data: [
                  { id: OVERDUE_POST_ID, department_id: DEPARTMENT_ID },
                  { id: INVALIDATED_POST_ID, department_id: DEPARTMENT_ID },
                  { id: HEALTHY_POST_ID, department_id: DEPARTMENT_ID },
                ],
                error: null,
              })
            }
            if (table === 'post_versions') {
              return chain({
                data: [
                  { id: OVERDUE_VERSION_ID, title: 'Überfälliger Beitrag' },
                  { id: INVALIDATED_VERSION_ID, title: 'Invalidierter Beitrag' },
                ],
                error: null,
              })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/approval-requests/stalled?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { approvalRequestId: string; isOverdue: boolean; invalidated: boolean }[]
    expect(body.map((row) => row.approvalRequestId).sort()).toEqual([INVALIDATED_REQUEST_ID, OVERDUE_REQUEST_ID].sort())
    expect(body.find((row) => row.approvalRequestId === OVERDUE_REQUEST_ID)).toMatchObject({ isOverdue: true, invalidated: false })
    expect(body.find((row) => row.approvalRequestId === INVALIDATED_REQUEST_ID)).toMatchObject({ isOverdue: false, invalidated: true })
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

  it('keeps stalled stages in the list waiting for the caller and flags them overdue', async () => {
    // Eine Frist darf weder zustimmen noch blockieren (Plan 011). mark_stalled_approval_stages()
    // setzt eine ueberfaellige Stufe auf 'stalled' -- ein Filter nur auf 'open' haette sie aus genau
    // der Liste entfernt, in der die zustaendige Person sie noch entscheiden soll.
    const statusFilters: unknown[][] = []
    const stageRow = {
      id: STAGE_ID, position: 1, scope: 'department', label: 'Abteilung', mode: 'named', minimum_approvals: 1, is_minor_stage: false,
      status: 'stalled', reviewer_snapshot: [{ userId: USER_ID }], deadline_at: new Date(Date.now() - 3_600_000).toISOString(),
    }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table !== 'approval_stages') throw new Error(`unexpected table in test fake: ${table}`)
            const builder: Record<string, unknown> = {
              select: () => builder,
              eq: () => builder,
              in: (column: string, values: unknown[]) => {
                if (column === 'status') statusFilters.push(values)
                return builder
              },
              order: () => builder,
              range: () => builder,
              then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => resolve({ data: [stageRow], error: null }),
            }
            return builder
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/approval-stages/mine?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(statusFilters).toEqual([['open', 'stalled']])
    expect(response.json()).toMatchObject([{ id: STAGE_ID, status: 'stalled', isOverdue: true }])
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

describe('Paket 025: Inhalts-Pipeline schliessen (Entwurfserzeugung und Veroeffentlichung)', () => {
  const PUBLICATION_ID = '25000000-1000-4000-8000-000000000001'
  const PUB_POST_VERSION_ID = '25000000-2000-4000-8000-000000000001'
  const PUB_POST_ID = '25000000-3000-4000-8000-000000000001'
  const PUB_SOCIAL_CONNECTION_ID = '25000000-4000-4000-8000-000000000001'

  function publicationRow(overrides: Record<string, unknown> = {}) {
    return {
      id: PUBLICATION_ID, organization_id: ORGANIZATION_ID, post_version_id: PUB_POST_VERSION_ID,
      social_connection_id: PUB_SOCIAL_CONNECTION_ID, platform: 'facebook', status: 'queued',
      scheduled_for: null, idempotency_key: 'publish:test:facebook:conn',
      ...overrides,
    }
  }

  function readOnlyClients(overrides: Record<string, unknown> = {}): SupabaseClientFactory {
    return {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'publications') return chain({ data: publicationRow(overrides), error: null })
            if (table === 'post_versions') return chain({ data: { id: PUB_POST_VERSION_ID, post_id: PUB_POST_ID, caption: 'Hallo Welt' }, error: null })
            if (table === 'posts') return chain({ data: { id: PUB_POST_ID, department_id: DEPARTMENT_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used by this test') } }) as unknown as SupabaseClient,
    }
  }

  describe('POST /v1/publications/:id/execute', () => {
    it('reports a non-existent publication as not_found', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'publications') return chain({ data: null, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(404)
    })

    it('rejects a caller without post.publish in the department', async () => {
      const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: readOnlyClients() })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(403)
    })

    it('rejects a publication scheduled for the future with 409 not_due_yet, no Hatchet cron auto-executes it', async () => {
      const app = await startApp({
        roleProvider: organizationManagerRoleProvider,
        supabaseClients: readOnlyClients({ scheduled_for: new Date(Date.now() + 60_000).toISOString() }),
      })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: 'not_due_yet' })
    })

    it('rejects with 409 invalid_status when the compare-and-set loses the race', async () => {
      // status ist bereits nicht mehr 'queued' (paralleler Aufruf/frueherer Versuch) -- die
      // Update-Eq-Kette (status='queued') trifft dann keine Zeile.
      const clients: SupabaseClientFactory = {
        ...readOnlyClients(),
        forService: () => ({ from: (table: string) => { if (table === 'publications') return { update: () => chain({ data: null, error: null }) }; throw new Error(`unexpected table in service fake: ${table}`) } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: 'invalid_status' })
    })

    it('rejects with 422 when the post version has no approved media derivative yet', async () => {
      // Ausgangslage (plans/025): ohne die Upload-/Freigabepipeline (002/003) hat jede aus Paket
      // 025 entstehende post_version keine post_media-Zeilen. FakePublisher/MetaPublisher lehnen
      // eine Veroeffentlichung ohne Medium unconditional ab -- erwartetes Verhalten, kein Bug.
      const clients: SupabaseClientFactory = {
        ...readOnlyClients(),
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'publications') return { update: () => chain({ data: { id: PUBLICATION_ID }, error: null }) }
              if (table === 'social_connections') return chain({ data: { external_account_id: 'page-123' }, error: null })
              if (table === 'social_connection_secrets') {
                const sealed = createSecretBox({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1').seal('fake-access-token', PUB_SOCIAL_CONNECTION_ID)
                return chain({ data: { token_ciphertext: ciphertextToBytea(sealed.ciphertext), token_key_version: 'v1' }, error: null })
              }
              if (table === 'post_media') return chain({ data: [], error: null })
              // chain() liefert zusaetzlich zum insert() die select().eq().order().limit().maybeSingle()-Kette
              // fuer die naechste attempt_number (Code-Review zu PR #25: attempt_number darf nicht mehr
              // hartkodiert 1 sein, unique(publication_id,attempt_number) wuerde sonst einen Retry sprengen).
              if (table === 'publication_attempts') return { ...chain({ data: null, error: null }), insert: async () => ({ error: null }) }
              if (table === 'publication_media_grants') return { update: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }
              throw new Error(`unexpected table in service fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(422)
      expect(response.json()).toMatchObject({ error: 'validation_failed' })
    })

    it('publishes successfully once an approved media derivative exists, records the attempt and audits it', async () => {
      process.env.API_PUBLIC_BASE_URL = 'https://api.example.test'
      try {
        const auditCaptured: Record<string, unknown>[] = []
        const grantsRevoked: Record<string, unknown>[] = []
        const clients: SupabaseClientFactory = {
          ...readOnlyClients(),
          forService: () =>
            ({
              from: (table: string) => {
                if (table === 'publications') return { update: () => chain({ data: { id: PUBLICATION_ID }, error: null }) }
                if (table === 'social_connections') return chain({ data: { external_account_id: 'page-123' }, error: null })
                if (table === 'social_connection_secrets') {
                  const sealed = createSecretBox({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1').seal('fake-access-token', PUB_SOCIAL_CONNECTION_ID)
                  return chain({ data: { token_ciphertext: ciphertextToBytea(sealed.ciphertext), token_key_version: 'v1' }, error: null })
                }
                if (table === 'post_media') return chain({ data: [{ position: 0, media_derivative_id: '25000000-5000-4000-8000-000000000001' }], error: null })
                if (table === 'media_derivatives') return chain({ data: [{ id: '25000000-5000-4000-8000-000000000001', sha256: 'a'.repeat(64), mime_type: 'image/png', status: 'ready' }], error: null })
                if (table === 'publication_media_grants') {
                  return {
                    insert: async () => ({ error: null }),
                    update: (payload: Record<string, unknown>) => ({ eq: () => ({ is: async () => { grantsRevoked.push(payload); return { error: null } } }) }),
                  }
                }
                if (table === 'publication_attempts') return { ...chain({ data: null, error: null }), insert: async () => ({ error: null }) }
                if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { auditCaptured.push(row); return { error: null } } }
                throw new Error(`unexpected table in service fake: ${table}`)
              },
            }) as unknown as SupabaseClient,
        }
        const publisher: SocialPublisher = {
          async validate() { return { valid: true, errors: [] } },
          async publish() { return { externalId: 'fb_post_1', status: 'published', permalink: 'https://facebook.com/fb_post_1' } },
          async reconcile() { return { externalId: 'fb_post_1', status: 'published' } },
        }
        const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients, publisher })
        const token = await signAccessToken(USER_ID)
        const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({ id: PUBLICATION_ID, status: 'published', externalId: 'fb_post_1', permalink: 'https://facebook.com/fb_post_1' })
        expect(auditCaptured).toMatchObject([{ action: 'post.published', entity_id: PUBLICATION_ID }])
        // Code-Review zu PR #25: Grants muessen nach einem abgeschlossenen Versuch widerrufen werden,
        // sonst bleibt das Medium die volle TTL unauthentifiziert abrufbar.
        expect(grantsRevoked).toHaveLength(1)
        expect(grantsRevoked[0]).toHaveProperty('revoked_at')
      } finally {
        delete process.env.API_PUBLIC_BASE_URL
      }
    })

    it('classifies an unrecognizable publish() failure as unknown/action_required and returns 502', async () => {
      // Code-Review zu PR #25: der catch-Zweig blieb bisher ungetestet. Ohne Status-Code im
      // Fehlertext (anders als MetaPublishers "... (404)") kann keine 4xx/5xx-Unterscheidung
      // getroffen werden -- das ist der dokumentierte 'unknown'-Fall aus der Klassifikation.
      const publicationUpdates: Record<string, unknown>[] = []
      const attemptsCaptured: Record<string, unknown>[] = []
      const clients: SupabaseClientFactory = {
        ...readOnlyClients(),
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'publications') return { update: (payload: Record<string, unknown>) => { publicationUpdates.push(payload); return chain({ data: { id: PUBLICATION_ID }, error: null }) } }
              if (table === 'social_connections') return chain({ data: { external_account_id: 'page-123' }, error: null })
              if (table === 'social_connection_secrets') {
                const sealed = createSecretBox({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1').seal('fake-access-token', PUB_SOCIAL_CONNECTION_ID)
                return chain({ data: { token_ciphertext: ciphertextToBytea(sealed.ciphertext), token_key_version: 'v1' }, error: null })
              }
              if (table === 'post_media') return chain({ data: [], error: null })
              if (table === 'publication_attempts') return { ...chain({ data: null, error: null }), insert: async (row: Record<string, unknown>) => { attemptsCaptured.push(row); return { error: null } } }
              if (table === 'publication_media_grants') return { update: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }
              throw new Error(`unexpected table in service fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const publisher: SocialPublisher = {
        async validate() { return { valid: true, errors: [] } },
        async publish() { throw new Error('graph api unreachable') },
        async reconcile() { return { externalId: 'x', status: 'unknown' } },
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients, publisher })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(502)
      expect(response.json()).toMatchObject({ error: 'publish_failed' })
      expect(publicationUpdates.at(-1)).toMatchObject({ status: 'action_required' })
      expect(attemptsCaptured.at(-1)).toMatchObject({ status: 'failed', error_class: 'unknown' })
    })
  })

  describe('GET /v1/media-grants/:token', () => {
    it('rejects an unknown token with 404, without requiring authentication', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () => ({ from: (table: string) => { if (table === 'publication_media_grants') return chain({ data: null, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const response = await app.inject({ method: 'GET', url: '/v1/media-grants/does-not-exist' })
      expect(response.statusCode).toBe(404)
    })

    it('rejects an expired grant with 404, same as an unknown token', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'publication_media_grants') return chain({ data: { media_derivative_id: 'deriv-1', expires_at: new Date(Date.now() - 1000).toISOString(), revoked_at: null }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const response = await app.inject({ method: 'GET', url: '/v1/media-grants/expired-token' })
      expect(response.statusCode).toBe(404)
    })

    it('rejects a revoked grant with 404, same as an unknown token', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'publication_media_grants') return chain({ data: { media_derivative_id: 'deriv-1', expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: new Date().toISOString() }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const response = await app.inject({ method: 'GET', url: '/v1/media-grants/revoked-token' })
      expect(response.statusCode).toBe(404)
    })

    it('serves the referenced derivative bytes with the correct content-type and marks the grant accessed', async () => {
      let accessedAtSet = false
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'publication_media_grants') {
                return {
                  ...chain({ data: { media_derivative_id: 'deriv-1', expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null }, error: null }),
                  update: () => ({ eq: async () => { accessedAtSet = true; return { error: null } } }),
                }
              }
              if (table === 'media_derivatives') return chain({ data: { bucket_id: 'rendered-media', object_path: 'org/dep/asset/deriv-1.png', mime_type: 'image/png', status: 'ready' }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
            storage: { from: () => ({ download: async () => ({ data: new Blob([Buffer.from('fake-image-bytes')]), error: null }) }) },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const response = await app.inject({ method: 'GET', url: '/v1/media-grants/valid-token' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('image/png')
      expect(response.rawPayload.toString()).toBe('fake-image-bytes')
      expect(accessedAtSet).toBe(true)
    })
  })
})

describe('Paket 013: Marke, Branding-Assets und Schriften', () => {
  const BRAND_ORGANIZATION_UPDATE = {
    primaryColor: '#163a2c',
    accentColor: '#caff4a',
    backgroundColor: '#f6f4ec',
    textColor: '#122820',
    onPrimaryColor: '#ffffff',
    tone: 'nahbar',
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
                    tone: 'nahbar',
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
              return { upsert: () => chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, primary_color: '#112233', accent_color: null, tone: null, logo_asset_id: null, display_font_asset_id: null, body_font_asset_id: null, allow_team_overrides: true, locked_fields: [] }, error: null }) }
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
              return { upsert: () => chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: TEAM_ID, primary_color: '#445566', accent_color: null, tone: null, logo_asset_id: null, display_font_asset_id: null, body_font_asset_id: null }, error: null }) }
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
              return { upsert: () => chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, primary_color: null, accent_color: null, tone: null, logo_asset_id: null, display_font_asset_id: null, body_font_asset_id: null, allow_team_overrides: true, locked_fields: [] }, error: null }) }
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

describe('Paket 014: Integrationsrahmen und Mitgliederverzeichnis', () => {
  const SOURCE_ID = '14000000-2000-4000-8000-000000000001'
  const RUN_ID = '14000000-4000-4000-8000-000000000001'
  const PERSON_ID = '14000000-3000-4000-8000-000000000001'

  // team_manager traegt directory.read, aber nicht department.manage -- die genaue Trennung, die
  // das Rechtekonzept aus plans/014 verlangt (Basisfelder lesen/schreiben ja, Elternkontakt nein).
  const directoryReaderRoleProvider: RoleProvider = { async rolesForScope() { return ['team_manager'] } }

  // Fuer eine ablehnende Berechtigungspruefung ohne departmentId/teamId im Request beruehrt der
  // Handler die Datenbank nie (resolveDirectoryScope/resolveMembershipScope kehren sofort zurueck)
  // -- ohne diesen Stub wuerde bereits das Konstruieren des echten Supabase-User-Clients an
  // fehlenden SUPABASE_URL/SUPABASE_ANON_KEY in der Testumgebung scheitern (500 statt 403).
  const noDbClients: SupabaseClientFactory = {
    forUser: () => ({ from: () => { throw new Error('no database access expected before the permission check') } }) as unknown as SupabaseClient,
    forService: () => ({ from: () => { throw new Error('no database access expected before the permission check') } }) as unknown as SupabaseClient,
  }

  it('rejects creating an integration source without integration.manage', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: noDbClients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/integration-sources`,
      headers: { authorization: `Bearer ${token}` },
      payload: { transport: 'file', providerKey: 'csv', displayName: 'Mitgliederliste', enabledDomains: ['people'] },
    })
    expect(response.statusCode).toBe(403)
  })

  it('creates an organization-wide integration source', async () => {
    const audit: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: () => { throw new Error('resolveDirectoryScope should not query anything for an organization-wide source') } }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'integration_sources') {
              return {
                insert: () =>
                  chain({
                    data: {
                      id: SOURCE_ID, organization_id: ORGANIZATION_ID, transport: 'file', provider_key: 'csv', display_name: 'Mitgliederliste',
                      enabled_domains: ['people'], department_id: null, endpoint_url: null, field_mapping: {}, sync_cron: null,
                      loss_threshold_percent: 30, enabled: true, last_sync_at: null, last_sync_status: null, created_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
              }
            }
            if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { audit.push(row); return { error: null } } }
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/integration-sources`,
      headers: { authorization: `Bearer ${token}` },
      payload: { transport: 'file', providerKey: 'csv', displayName: 'Mitgliederliste', enabledDomains: ['people'] },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ id: SOURCE_ID, transport: 'file', displayName: 'Mitgliederliste' })
    expect(audit).toHaveLength(1)
    expect(audit[0]?.action).toBe('integration_source.created')
  })

  it('refuses to store an ical endpoint that points into the internal network', async () => {
    // Ohne diese Pruefung waere die API ein Server-zu-Server-Proxy: die Adresse kommt vom Verein,
    // abgerufen wird sie aus dem Netz der API (siehe outboundFetch.ts). Der Wert darf gar nicht
    // erst gespeichert werden, damit auch ein spaeterer Lauf ihn nicht mehr vorfindet.
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: () => { throw new Error('no lookup expected for an organization-scoped source') } }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('nothing may be written for a blocked endpoint') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/integration-sources`,
      headers: { authorization: `Bearer ${token}` },
      payload: { transport: 'ical', providerKey: 'ical', displayName: 'Spielplan', enabledDomains: ['fixtures'], endpointUrl: 'https://169.254.169.254/latest/meta-data/' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'endpoint_not_allowed' })
  })

  it('refuses a sync run on a disabled source', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'integration_sources') {
              return chain({
                data: {
                  organization_id: ORGANIZATION_ID, department_id: null, transport: 'file', endpoint_url: null,
                  enabled_domains: ['people'], field_mapping: {}, loss_threshold_percent: 30, enabled: false,
                },
                error: null,
              })
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
      url: `/v1/integration-sources/${SOURCE_ID}/sync`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mode: 'dry_run', domain: 'people' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'source_disabled' })
  })

  it('rejects a sync run for a transport this package does not implement', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'integration_sources') {
              return chain({
                data: {
                  organization_id: ORGANIZATION_ID, department_id: null, transport: 'http', endpoint_url: 'https://example.invalid',
                  enabled_domains: ['people'], field_mapping: {}, loss_threshold_percent: 30, enabled: true,
                },
                error: null,
              })
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
      url: `/v1/integration-sources/${SOURCE_ID}/sync`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mode: 'dry_run', domain: 'people' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'transport_not_implemented' })
  })

  it('runs a CSV dry-run sync end to end: new people are proposed, nothing is written', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'integration_sources') {
              return chain({
                data: {
                  organization_id: ORGANIZATION_ID, department_id: null, transport: 'file', endpoint_url: null,
                  enabled_domains: ['people'], field_mapping: { Vorname: 'firstName', Nachname: 'lastName' },
                  loss_threshold_percent: 30, enabled: true,
                },
                error: null,
              })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async () => ({ data: [{ result: 'acquired', run_id: RUN_ID }], error: null }),
          from: (table: string) => {
            if (table === 'directory_people') return chain({ data: [], error: null })
            if (table === 'departments') return chain({ data: [], error: null })
            if (table === 'teams') return chain({ data: [], error: null })
            if (table === 'integration_sync_conflicts') {
              return {
                select: () => chain({ data: [], error: null }), // ignore_permanently-Nachschlag: keine vorherigen Laeufe
                insert: (rows: Record<string, unknown>[]) =>
                  chain({
                    data: rows.map((row, index) => ({ id: `14000000-5000-4000-8000-00000000000${index}`, resolution: 'pending', resolved_at: null, created_at: new Date().toISOString(), ...row })),
                    error: null,
                  }),
              }
            }
            if (table === 'integration_sync_runs') {
              // Der Lauf wird vor dem ersten Schreibvorgang angelegt ('running') und danach mit
              // Status und Zaehlern aktualisiert -- der Fake bildet beide Schritte ab.
              return {
                insert: () => chain({ data: { id: RUN_ID }, error: null }),
                update: (row: Record<string, unknown>) =>
                  chain({
                    data: {
                      id: RUN_ID, organization_id: ORGANIZATION_ID, source_id: SOURCE_ID, domain: 'people', mode: 'dry_run',
                      created_count: 0, updated_count: 0, retired_count: 0, skipped_count: 0, conflict_count: 0, error_class: null,
                      started_at: new Date().toISOString(), ...row,
                    },
                    error: null,
                  }),
              }
            }
            // die abschliessende Aktualisierung von last_sync_at/last_sync_status
            if (table === 'integration_sources') return { update: () => chain({ data: null, error: null }) }
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkSyncBoundary'
    const csv = 'Vorname,Nachname\r\nAnna,Beck\r\n'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\ndry_run\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="domain"\r\n\r\npeople\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="mitglieder.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      Buffer.from(csv),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: `/v1/integration-sources/${SOURCE_ID}/sync`,
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(response.statusCode).toBe(200)
    const json = response.json()
    expect(json.run).toMatchObject({ mode: 'dry_run', status: 'succeeded', createdCount: 1, updatedCount: 0 })
    expect(json.conflicts).toEqual([])
  })

  it('confines a department-scoped source to its own department -- a mismatched department name in the file becomes a conflict, never a cross-department write', async () => {
    // Regression: resolveDepartmentId/resolveTeamId duerfen fuer eine abteilungsgebundene Quelle
    // nur die EIGENE Abteilung kennen. Der Fake unterscheidet bewusst zwischen den beiden moeglichen
    // Abfragen (eq('id', ...) vs. eq('organization_id', ...)) -- eine echte Postgres-Abfrage wuerde
    // das ebenfalls tun, chain() im Rest dieser Datei kann es nicht, weil es Filterargumente ignoriert.
    const departmentQueries: { column: string; value: unknown }[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'integration_sources') {
              return chain({
                data: {
                  organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, transport: 'file', endpoint_url: null,
                  enabled_domains: ['people'], field_mapping: { Vorname: 'firstName', Nachname: 'lastName', Abteilung: 'departmentName' },
                  loss_threshold_percent: 30, enabled: true,
                },
                error: null,
              })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async () => ({ data: [{ result: 'acquired', run_id: RUN_ID }], error: null }),
          from: (table: string) => {
            if (table === 'directory_people') return chain({ data: [], error: null })
            if (table === 'departments') {
              return {
                select: () => ({
                  eq: (column: string, value: unknown) => {
                    departmentQueries.push({ column, value })
                    const rows = column === 'id' && value === DEPARTMENT_ID
                      ? [{ id: DEPARTMENT_ID, name: 'Fußball' }]
                      : [{ id: DEPARTMENT_ID, name: 'Fußball' }, { id: 'other-department', name: 'Handball' }]
                    return chain({ data: rows, error: null })
                  },
                }),
              }
            }
            if (table === 'teams') return chain({ data: [], error: null })
            if (table === 'integration_sync_conflicts') {
              return {
                select: () => chain({ data: [], error: null }), // ignore_permanently-Nachschlag: keine vorherigen Laeufe
                insert: (rows: Record<string, unknown>[]) =>
                  chain({
                    data: rows.map((row, index) => ({ id: `14000000-5000-4000-8000-00000000000${index}`, resolution: 'pending', resolved_at: null, created_at: new Date().toISOString(), ...row })),
                    error: null,
                  }),
              }
            }
            if (table === 'integration_sync_runs') {
              return {
                insert: () => chain({ data: { id: RUN_ID }, error: null }),
                update: (row: Record<string, unknown>) =>
                  chain({
                    data: {
                      id: RUN_ID, organization_id: ORGANIZATION_ID, source_id: SOURCE_ID, domain: 'people', mode: 'dry_run',
                      created_count: 0, updated_count: 0, retired_count: 0, skipped_count: 0, conflict_count: 0, error_class: null,
                      started_at: new Date().toISOString(), ...row,
                    },
                    error: null,
                  }),
              }
            }
            if (table === 'integration_sources') return { update: () => chain({ data: null, error: null }) }
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkScopedSyncBoundary'
    const csv = 'Vorname,Nachname,Abteilung\r\nAnna,Beck,Handball\r\n'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\ndry_run\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="domain"\r\n\r\npeople\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="mitglieder.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      Buffer.from(csv),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: `/v1/integration-sources/${SOURCE_ID}/sync`,
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(response.statusCode).toBe(200)
    const json = response.json()
    expect(json.run).toMatchObject({ createdCount: 0 })
    expect(json.conflicts).toHaveLength(1)
    expect(json.conflicts[0]).toMatchObject({ kind: 'unknown_structure' })
    // Kein Rohwert der Datei landet im Konflikt (Datenminimierung -- siehe apps/api/src/app.ts,
    // Kommentar bei incomingValue).
    expect(json.conflicts[0].incomingValue).toBeNull()
    expect(departmentQueries).toContainEqual({ column: 'id', value: DEPARTMENT_ID })
    expect(departmentQueries.some((query) => query.column === 'organization_id')).toBe(false)
  })

  it('rejects creating a directory person without directory.read', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: noDbClients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/directory-people`,
      headers: { authorization: `Bearer ${token}` },
      payload: { firstName: 'Mia', lastName: 'Muster' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('lets a team_manager create a directory person without guardian fields', async () => {
    const audit: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: () => { throw new Error('no lookup expected for an organization-scoped person') } }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'directory_people') {
              return {
                insert: () =>
                  chain({
                    data: {
                      id: PERSON_ID, organization_id: ORGANIZATION_ID, department_id: null, team_id: null, first_name: 'Mia', last_name: 'Muster',
                      birth_year: null, is_minor: false, status: 'active', left_at: null, joined_at: null, profile_id: null, became_adult_at: null,
                      source_id: null, created_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
              }
            }
            if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { audit.push(row); return { error: null } } }
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: directoryReaderRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/directory-people`,
      headers: { authorization: `Bearer ${token}` },
      payload: { firstName: 'Mia', lastName: 'Muster' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ firstName: 'Mia', lastName: 'Muster', isMinor: false })
    expect(audit).toHaveLength(1)
  })

  it('does not let the caller declare a person with a minor birth year an adult', async () => {
    // isMinor darf den Schutz nur anheben: sonst umginge ein Aufrufer mit `isMinor: false` sowohl
    // den CHECK auf einen Elternkontakt als auch die strengere Freigaberoute (derselbe
    // wiederkehrende Fund wie bei den security-definer-RPCs aus 011/012).
    let capturedInsert: Record<string, unknown> | null = null
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: () => { throw new Error('no lookup expected for an organization-scoped person') } }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'directory_people') {
              return {
                insert: (row: Record<string, unknown>) => {
                  capturedInsert = row
                  return chain({
                    data: {
                      id: PERSON_ID, organization_id: ORGANIZATION_ID, department_id: null, team_id: null, first_name: 'Mia', last_name: 'Muster',
                      birth_year: 2015, is_minor: true, status: 'active', left_at: null, joined_at: null, profile_id: null, became_adult_at: null,
                      source_id: null, created_at: new Date().toISOString(),
                    },
                    error: null,
                  })
                },
              }
            }
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/directory-people`,
      headers: { authorization: `Bearer ${token}` },
      payload: { firstName: 'Mia', lastName: 'Muster', birthYear: 2015, isMinor: false, guardianEmail: 'eltern@example.com' },
    })
    expect(response.statusCode).toBe(201)
    expect(capturedInsert).toMatchObject({ is_minor: true })
  })

  it('bumps source_updated_at on a manual edit to a synced field, so a stale re-sync cannot silently overwrite it', async () => {
    // Regression: createPeopleMatchStrategy.localUpdatedAtOf (packages/member-directory) vergleicht
    // source_updated_at, nicht das generische updated_at -- ohne diesen Stempel waere eine manuelle
    // Korrektur beim naechsten Sync-Lauf unsichtbar und die (aeltere) Quelle haette wieder gewonnen.
    let capturedUpdate: Record<string, unknown> | null = null
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table !== 'directory_people') throw new Error(`unexpected table in test fake: ${table}`)
            return chain({ data: { organization_id: ORGANIZATION_ID, department_id: null, team_id: null }, error: null })
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'directory_people') {
              return {
                update: (payload: Record<string, unknown>) => {
                  capturedUpdate = payload
                  return chain({
                    data: {
                      id: PERSON_ID, organization_id: ORGANIZATION_ID, department_id: null, team_id: null, first_name: 'Mia', last_name: 'Musterfrau',
                      birth_year: null, is_minor: false, status: 'active', left_at: null, joined_at: null, profile_id: null, became_adult_at: null,
                      source_id: '68000000-2000-4000-8000-000000000001', created_at: new Date().toISOString(),
                    },
                    error: null,
                  })
                },
              }
            }
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: directoryReaderRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/directory-people/${PERSON_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { lastName: 'Musterfrau' },
    })
    expect(response.statusCode).toBe(200)
    expect(capturedUpdate).toMatchObject({ last_name: 'Musterfrau' })
    expect(typeof readField(capturedUpdate, 'source_updated_at')).toBe('string')

    // Ein Feld, das planSync nicht vergleicht (z. B. joinedAt), darf source_updated_at nicht
    // veraendern -- sonst wuerde jede Aenderung, auch eine belanglose, die naechste Sync-Uebernahme
    // blockieren.
    capturedUpdate = null
    const irrelevantResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/directory-people/${PERSON_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { joinedAt: '2020-01-01' },
    })
    expect(irrelevantResponse.statusCode).toBe(200)
    expect(capturedUpdate).not.toHaveProperty('source_updated_at')
  })

  it('rejects setting a guardian contact without department.manage, even with directory.read', async () => {
    const app = await startApp({ roleProvider: directoryReaderRoleProvider, supabaseClients: noDbClients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/directory-people`,
      headers: { authorization: `Bearer ${token}` },
      payload: { firstName: 'Mia', lastName: 'Muster', guardianEmail: 'eltern@example.com' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('rejects reading the guardian contact without department.manage', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'directory_people') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: null, team_id: null }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: directoryReaderRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/directory-people/${PERSON_ID}/guardian-contact`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
  })

  it('returns the guardian contact for a caller with department.manage, and audits the read', async () => {
    const audit: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'directory_people') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: null, team_id: null }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'directory_people') return chain({ data: { guardian_name: 'Erika Muster', guardian_email: 'eltern@example.com' }, error: null })
            if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { audit.push(row); return { error: null } } }
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/directory-people/${PERSON_ID}/guardian-contact`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ guardianName: 'Erika Muster', guardianEmail: 'eltern@example.com' })
    expect(audit).toHaveLength(1)
    expect(audit[0]?.action).toBe('directory_person.guardian_read')
  })

  it('reads and updates the caller\'s own profile display name, self-service, without touching organization data', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table !== 'profiles') throw new Error(`unexpected table in test fake: ${table}`)
            return { select: () => chain({ data: { id: USER_ID, display_name: 'Alte Anzeige', avatar_path: null }, error: null }) }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const getResponse = await app.inject({ method: 'GET', url: '/v1/me/profile', headers: { authorization: `Bearer ${token}` } })
    expect(getResponse.statusCode).toBe(200)
    expect(getResponse.json()).toEqual({ id: USER_ID, displayName: 'Alte Anzeige', avatarPath: null })

    const updateClients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table !== 'profiles') throw new Error(`unexpected table in test fake: ${table}`)
            return { update: () => chain({ data: { id: USER_ID, display_name: 'Neue Anzeige', avatar_path: null }, error: null }) }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const updateApp = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: updateClients })
    const patchResponse = await updateApp.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: 'Neue Anzeige' },
    })
    expect(patchResponse.statusCode).toBe(200)
    expect(patchResponse.json()).toMatchObject({ displayName: 'Neue Anzeige' })
  })

  it('replays an idempotent sync without reading import rows a second time', async () => {
    const rpcCalls: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table !== 'integration_sources') throw new Error(`unexpected user table: ${table}`)
          return chain({
            data: {
              organization_id: ORGANIZATION_ID, department_id: null, transport: 'file', endpoint_url: null,
              enabled_domains: ['people'], field_mapping: {}, loss_threshold_percent: 30, enabled: true,
            }, error: null,
          })
        },
      }) as unknown as SupabaseClient,
      forService: () => ({
        rpc: async (_name: string, args: Record<string, unknown>) => {
          rpcCalls.push(args)
          return { data: [{ result: 'replay', run_id: RUN_ID }], error: null }
        },
        from: (table: string) => {
          if (table === 'integration_sync_runs') return chain({
            data: {
              id: RUN_ID, organization_id: ORGANIZATION_ID, source_id: SOURCE_ID, domain: 'people', mode: 'apply', status: 'succeeded',
              created_count: 1, updated_count: 0, retired_count: 0, skipped_count: 0, conflict_count: 0, error_class: null,
              started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
            }, error: null,
          })
          if (table === 'integration_sync_conflicts') return chain({ data: [], error: null })
          throw new Error(`replay must not read or write ${table}`)
        },
      }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkReplayBoundary'
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\napply\r\n--${boundary}\r\nContent-Disposition: form-data; name="domain"\r\n\r\npeople\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="never-read.csv"\r\nContent-Type: text/csv\r\n\r\nVorname\nAnna\r\n--${boundary}--\r\n`)
    const response = await app.inject({
      method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'replay-001', 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ run: { id: RUN_ID, status: 'succeeded' }, idempotencyKey: 'replay-001' })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toMatchObject({ target_source_id: SOURCE_ID, target_mode: 'apply', target_request_idempotency_key: 'replay-001' })
  })

  it('rejects a competing apply before import data is parsed', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: () => chain({
          data: {
            organization_id: ORGANIZATION_ID, department_id: null, transport: 'file', endpoint_url: null,
            enabled_domains: ['people'], field_mapping: {}, loss_threshold_percent: 30, enabled: true,
          }, error: null,
        }),
      }) as unknown as SupabaseClient,
      forService: () => ({
        rpc: async () => ({ data: [{ result: 'already_running', run_id: RUN_ID }], error: null }),
        from: () => { throw new Error('a competing request must not touch domain data') },
      }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkConcurrentBoundary'
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\napply\r\n--${boundary}\r\nContent-Disposition: form-data; name="domain"\r\n\r\npeople\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="never-read.csv"\r\nContent-Type: text/csv\r\n\r\nVorname\nAnna\r\n--${boundary}--\r\n`)
    const response = await app.inject({
      method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'concurrent-001', 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'sync_already_running' })
  })

  it('cancels a running sync and records an audit event', async () => {
    const audit: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table !== 'integration_sources') throw new Error(`unexpected user table: ${table}`)
          return chain({ data: { organization_id: ORGANIZATION_ID, department_id: null }, error: null })
        },
      }) as unknown as SupabaseClient,
      forService: () => ({
        from: (table: string) => {
          if (table === 'integration_sync_runs') {
            return {
              select: () => chain({ data: { id: RUN_ID, status: 'running' }, error: null }),
              update: () => chain({
                data: {
                  id: RUN_ID, organization_id: ORGANIZATION_ID, source_id: SOURCE_ID, domain: 'people', mode: 'apply', status: 'cancelled',
                  created_count: 0, updated_count: 0, retired_count: 0, skipped_count: 0, conflict_count: 0, error_class: 'cancelled_by_operator',
                  started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
                },
                error: null,
              }),
            }
          }
          if (table === 'integration_sources') return { update: () => chain({ data: null, error: null }) }
          if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { audit.push(row); return { error: null } } }
          throw new Error(`unexpected service table: ${table}`)
        },
      }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/integration-sources/${SOURCE_ID}/sync-runs/${RUN_ID}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: RUN_ID, status: 'cancelled' })
    expect(audit).toHaveLength(1)
    expect(audit[0]?.action).toBe('integration_source.sync_cancelled')
  })

  it('rejects cancelling a sync run that already finished', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table !== 'integration_sources') throw new Error(`unexpected user table: ${table}`)
          return chain({ data: { organization_id: ORGANIZATION_ID, department_id: null }, error: null })
        },
      }) as unknown as SupabaseClient,
      forService: () => ({
        from: (table: string) => {
          if (table === 'integration_sync_runs') return { select: () => chain({ data: { id: RUN_ID, status: 'succeeded' }, error: null }) }
          throw new Error(`a finished run must not be updated: ${table}`)
        },
      }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/integration-sources/${SOURCE_ID}/sync-runs/${RUN_ID}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'sync_not_running' })
  })

  it('rejects cancelling a sync run without integration.manage', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table !== 'integration_sources') throw new Error(`unexpected user table: ${table}`)
          return chain({ data: { organization_id: ORGANIZATION_ID, department_id: null }, error: null })
        },
      }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('a denied request must not touch the run row') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/integration-sources/${SOURCE_ID}/sync-runs/${RUN_ID}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
  })
})

describe('Paket 019: Mannschaften, Spielplaene, Ergebnisse und Veranstaltungen', () => {
  const SOURCE_ID = '19000000-2000-4000-8000-000000000001'
  const RUN_ID = '19000000-4000-4000-8000-000000000001'
  const FIXTURE_ID = '19000000-6000-4000-8000-000000000001'
  const OTHER_FIXTURE_ID = '19000000-6000-4000-8000-000000000002'
  const CLUB_EVENT_ID = '19000000-7000-4000-8000-000000000001'
  const OTHER_DEPARTMENT_ID = '19000000-1100-4000-8000-000000000099'

  function integrationSource(overrides: Record<string, unknown> = {}) {
    return {
      organization_id: ORGANIZATION_ID, department_id: null, transport: 'file', endpoint_url: null,
      enabled_domains: ['teams'], field_mapping: {}, loss_threshold_percent: 30, enabled: true,
      ...overrides,
    }
  }

  function sourceOnlyUserClient(source: Record<string, unknown>): SupabaseClient {
    return {
      from: (table: string) => {
        if (table === 'integration_sources') return chain({ data: source, error: null })
        throw new Error(`unexpected table in test fake: ${table}`)
      },
    } as unknown as SupabaseClient
  }

  function syncMultipartBody(mode: string, domain: string, csv: string) {
    const boundary = '----vereinsfunkP19SyncBoundary'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\n${mode}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="domain"\r\n\r\n${domain}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="import.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      Buffer.from(csv),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    return { boundary, body }
  }

  // Gemeinsame Buchhaltungstabellen fuer jeden Sync-Lauf (dasselbe Muster wie die Paket-014-
  // Personen-Tests oben): integration_sync_conflicts (ignore_permanently-Nachschlag + Konflikt-
  // Insert), integration_sync_runs, das last_sync_at-Update und der Audit-Eintrag sind fuer jeden
  // Lauf gleich, unabhaengig von domain/mode. Anders als bei den Paket-014-Tests wird die reale
  // Eingabe von integration_sync_runs.insert() hier durchgereicht (...row) statt durch feste
  // Zaehlwerte ersetzt -- damit belegen die Assertions in den Tests unten tatsaechlich, was der
  // echte Sync-Lauf berechnet hat, nicht nur, dass irgendein Insert stattfand. Nur die jeweilige
  // Fachtabelle (teams/fixtures/club_events/departments) unterscheidet sich je Test (tables).
  function syncServiceClient(tables: Record<string, unknown>): SupabaseClient {
    let mode = 'dry_run'
    let domain = 'teams'
    return {
      rpc: async (_name: string, args: { target_mode?: string; target_domain?: string }) => {
        mode = args.target_mode ?? mode
        domain = args.target_domain ?? domain
        return { data: [{ result: 'acquired', run_id: RUN_ID }], error: null }
      },
      from: (table: string) => {
        if (table === 'organizations') return chain({ data: { timezone: 'Europe/Berlin' }, error: null })
        if (table === 'integration_sync_conflicts') {
          return {
            select: () => chain({ data: [], error: null }),
            insert: (rows: Record<string, unknown>[]) =>
              chain({
                data: rows.map((row, index) => ({ id: `19000000-5000-4000-8000-${String(index).padStart(12, '0')}`, resolution: 'pending', resolved_at: null, created_at: new Date().toISOString(), ...row })),
                error: null,
              }),
          }
        }
        if (table === 'integration_sync_runs') {
          return {
            update: (row: Record<string, unknown>) => chain({
              data: {
                id: RUN_ID, organization_id: ORGANIZATION_ID, source_id: SOURCE_ID,
                domain, mode, error_class: null, started_at: new Date().toISOString(), ...row,
              },
              error: null,
            }),
          }
        }
        if (table === 'integration_sources') return { update: () => chain({ data: null, error: null }) }
        if (table === 'audit_events') return { insert: async () => ({ error: null }) }
        if (table in tables) return tables[table]
        throw new Error(`unexpected table in service test fake: ${table}`)
      },
    } as unknown as SupabaseClient
  }

  describe('teams sync', () => {
    it('creates a new team via dry-run and apply: name, resolved department, ageGroup/competition pass through', async () => {
      const csv = 'Name,Abteilung,Altersklasse,Liga\r\nErste Mannschaft,Fußball,Herren,Kreisliga A\r\n'
      const fieldMapping = { Name: 'name', Abteilung: 'departmentName', Altersklasse: 'ageGroup', Liga: 'competition' }
      let capturedInsertRows: Record<string, unknown>[] = []

      const buildClients = (): SupabaseClientFactory => ({
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: null, enabled_domains: ['teams'], field_mapping: fieldMapping })),
        forService: () =>
          syncServiceClient({
            teams: { ...chain({ data: [], error: null }), insert: (rows: Record<string, unknown>[]) => { capturedInsertRows = rows; return chain({ data: null, error: null }) } },
            departments: chain({ data: [{ id: DEPARTMENT_ID, name: 'Fußball' }], error: null }),
          }),
      })
      const token = await signAccessToken(USER_ID)

      const dryRunApp = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: buildClients() })
      const dryRun = syncMultipartBody('dry_run', 'teams', csv)
      const dryRunResponse = await dryRunApp.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${dryRun.boundary}` }, payload: dryRun.body,
      })
      expect(dryRunResponse.statusCode).toBe(200)
      expect(dryRunResponse.json().run).toMatchObject({ mode: 'dry_run', createdCount: 1, updatedCount: 0 })
      expect(capturedInsertRows).toHaveLength(0) // dry_run schreibt nichts

      const applyApp = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: buildClients() })
      const apply = syncMultipartBody('apply', 'teams', csv)
      const applyResponse = await applyApp.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${apply.boundary}` }, payload: apply.body,
      })
      expect(applyResponse.statusCode).toBe(200)
      expect(applyResponse.json().run).toMatchObject({ mode: 'apply', createdCount: 1, updatedCount: 0 })
      expect(capturedInsertRows).toEqual([
        { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, name: 'Erste Mannschaft', age_group: 'Herren', competition: 'Kreisliga A', source_id: SOURCE_ID, external_id: null, source_updated_at: null },
      ])
    })

    it('treats an unresolvable departmentName as an unknown_structure conflict, not a crash', async () => {
      const csv = 'Name,Abteilung\r\nZweite Mannschaft,Handball\r\n'
      const fieldMapping = { Name: 'name', Abteilung: 'departmentName' }
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: DEPARTMENT_ID, enabled_domains: ['teams'], field_mapping: fieldMapping })),
        forService: () =>
          syncServiceClient({
            teams: chain({ data: [], error: null }),
            // Eine abteilungsgebundene Quelle kennt nur ihre eigene Abteilung -- 'Handball' ist ihr unbekannt.
            departments: chain({ data: [{ id: DEPARTMENT_ID, name: 'Fußball' }], error: null }),
          }),
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('dry_run', 'teams', csv)
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(200)
      const json = response.json()
      expect(json.run).toMatchObject({ createdCount: 0 })
      expect(json.conflicts).toHaveLength(1)
      expect(json.conflicts[0]).toMatchObject({ kind: 'unknown_structure' })
    })

    it('updates an existing team\'s competition on a second sync run', async () => {
      const csv = 'Name,ExterneId,Abteilung,Altersklasse,Liga\r\nErste Mannschaft,ext-team-1,Fußball,Herren,Kreisliga A\r\n'
      const fieldMapping = { Name: 'name', ExterneId: 'externalId', Abteilung: 'departmentName', Altersklasse: 'ageGroup', Liga: 'competition' }
      const existingTeamRow = {
        id: TEAM_ID, name: 'Erste Mannschaft', department_id: DEPARTMENT_ID, age_group: 'Herren', competition: 'Kreisliga B',
        source_id: SOURCE_ID, external_id: 'ext-team-1', source_updated_at: null, updated_at: '2026-08-01T00:00:00Z',
      }
      let capturedUpdate: Record<string, unknown> | null = null
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: DEPARTMENT_ID, enabled_domains: ['teams'], field_mapping: fieldMapping })),
        forService: () =>
          syncServiceClient({
            teams: { ...chain({ data: [existingTeamRow], error: null }), update: (patch: Record<string, unknown>) => { capturedUpdate = patch; return chain({ data: null, error: null }) } },
            departments: chain({ data: [{ id: DEPARTMENT_ID, name: 'Fußball' }], error: null }),
          }),
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('apply', 'teams', csv)
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().run).toMatchObject({ createdCount: 0, updatedCount: 1 })
      expect(capturedUpdate).toMatchObject({ competition: 'Kreisliga A', department_id: DEPARTMENT_ID, age_group: 'Herren' })
    })

    it('turns a team with neither a resolvable departmentName nor a department-scoped source into an invalid_record conflict', async () => {
      // Weder departmentName (nicht gemappt) noch eine abteilungsgebundene Quelle (department_id
      // null) -- handleTeamsSync's applicableCreated-Filter faengt genau diesen Fall ab, statt an
      // der NOT-NULL-Spalte departments_id zu scheitern (siehe apps/api/src/app.ts, Zeile ~879).
      const csv = 'Name\r\nJugendmannschaft\r\n'
      const fieldMapping = { Name: 'name' }
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: null, enabled_domains: ['teams'], field_mapping: fieldMapping })),
        forService: () =>
          syncServiceClient({
            teams: chain({ data: [], error: null }),
            departments: chain({ data: [{ id: DEPARTMENT_ID, name: 'Fußball' }], error: null }),
          }),
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('dry_run', 'teams', csv)
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(200)
      const json = response.json()
      expect(json.run).toMatchObject({ createdCount: 0 })
      expect(json.conflicts).toHaveLength(1)
      expect(json.conflicts[0]).toMatchObject({ kind: 'invalid_record', field: 'departmentId' })
    })

    it('marks the acquired run as failed when handleTeamsSync throws -- "return handleTeamsSync(...)" without await would let the error skip the outer catch', async () => {
      const runUpdates: Record<string, unknown>[] = []
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: null, enabled_domains: ['teams'], field_mapping: { Name: 'name' } })),
        forService: () =>
          ({
            rpc: async () => ({ data: [{ result: 'acquired', run_id: RUN_ID }], error: null }),
            from: (table: string) => {
              if (table === 'organizations') return chain({ data: { timezone: 'Europe/Berlin' }, error: null })
              if (table === 'teams') return chain({ data: null, error: new Error('teams table unavailable') })
              if (table === 'integration_sync_runs') {
                return { update: (row: Record<string, unknown>) => { runUpdates.push(row); return chain({ data: { id: RUN_ID, ...row }, error: null }) } }
              }
              if (table === 'integration_sources') return { update: () => chain({ data: null, error: null }) }
              throw new Error(`unexpected table in service test fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('dry_run', 'teams', 'Name\r\nErste Mannschaft\r\n')
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(500)
      expect(runUpdates).toHaveLength(1)
      expect(runUpdates[0]).toMatchObject({ status: 'failed' })
    })
  })

  describe('fixtures sync', () => {
    it('rejects a fixtures sync on a source without a department, before reading any fixtures/teams rows', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: null, enabled_domains: ['fixtures'] })),
        // Kein 'fixtures'/'teams'-Eintrag in tables -- jeder Versuch, diese zu lesen, liesse den
        // Test an "unexpected table in service test fake" scheitern statt am erwarteten 409.
        forService: () => syncServiceClient({}),
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('dry_run', 'fixtures', 'Gegner\r\n')
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: 'source_missing_department' })
    })

    it('resolves a known teamReference to teamId/isHome and creates a fixture on apply', async () => {
      const csv = 'Mannschaft,Gegner,Heimspiel,Anstoss,Ort\r\nErste Mannschaft,SV Gegner,true,2026-08-20T18:00:00+02:00,Sportplatz Nord\r\n'
      const fieldMapping = { Mannschaft: 'teamReference', Gegner: 'opponentName', Heimspiel: 'isHome', Anstoss: 'kickoffAt', Ort: 'venueName' }
      let capturedInsertRows: Record<string, unknown>[] = []
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: DEPARTMENT_ID, enabled_domains: ['fixtures'], field_mapping: fieldMapping })),
        forService: () =>
          syncServiceClient({
            fixtures: { ...chain({ data: [], error: null }), insert: (rows: Record<string, unknown>[]) => { capturedInsertRows = rows; return chain({ data: null, error: null }) } },
            teams: chain({ data: [{ id: TEAM_ID, name: 'Erste Mannschaft' }], error: null }),
          }),
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('apply', 'fixtures', csv)
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().run).toMatchObject({ createdCount: 1 })
      expect(response.json().conflicts).toEqual([])
      expect(capturedInsertRows).toHaveLength(1)
      expect(capturedInsertRows[0]).toMatchObject({ team_id: TEAM_ID, is_home: true, opponent_name: 'SV Gegner', department_id: DEPARTMENT_ID })
    })

    it('treats a teamReference resolving to no known team as an unknown_structure conflict', async () => {
      const csv = 'Mannschaft,Gegner\r\nZweite Mannschaft,SV Gegner\r\n'
      const fieldMapping = { Mannschaft: 'teamReference', Gegner: 'opponentName' }
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: DEPARTMENT_ID, enabled_domains: ['fixtures'], field_mapping: fieldMapping })),
        forService: () =>
          syncServiceClient({
            fixtures: chain({ data: [], error: null }),
            teams: chain({ data: [{ id: TEAM_ID, name: 'Erste Mannschaft' }], error: null }),
          }),
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('dry_run', 'fixtures', csv)
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(200)
      const json = response.json()
      expect(json.run).toMatchObject({ createdCount: 0 })
      expect(json.conflicts).toHaveLength(1)
      expect(json.conflicts[0]).toMatchObject({ kind: 'unknown_structure' })
    })

    it('applies a played-match update (status + scores) once a tracked field also changed', async () => {
      // planSync vergleicht nur die in fixtureMatch.ts.fieldsOf() genannten Felder (teamId/
      // opponentName/isHome/competition/kickoffAt) -- status/homeScore/awayScore gehoeren nicht
      // dazu. Ohne eine Aenderung an einem dieser Felder gaelte die Zeile als "unchanged" und
      // wuerde uebersprungen, das Ergebnis daher nie geschrieben. competition aendert sich hier
      // zusaetzlich (wie es ein echter Export nach Spielende oft ohnehin tut) und loest die
      // Uebernahme aus; status/homeScore/awayScore werden dann im selben Patch mitgeschrieben.
      const csv = 'ExterneId,Gegner,Liga,Status,Heimtore,Auswaertstore\r\next-1,SV Gegner,Kreisliga A,played,2,1\r\n'
      const fieldMapping = { ExterneId: 'externalId', Gegner: 'opponentName', Liga: 'competition', Status: 'status', Heimtore: 'homeScore', Auswaertstore: 'awayScore' }
      const existingFixtureRow = {
        id: FIXTURE_ID, external_id: 'ext-1', source_id: SOURCE_ID, team_id: null, is_home: null, own_team_label: null,
        opponent_name: 'SV Gegner', competition: null, kickoff_at: '2026-08-01T18:00:00Z', kickoff_time_confirmed: true,
        venue_name: null, venue_address: null, status: 'scheduled', home_score: null, away_score: null, note: null,
        source_updated_at: null, updated_at: '2026-08-01T00:00:00Z',
      }
      let capturedUpdate: Record<string, unknown> | null = null
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: DEPARTMENT_ID, enabled_domains: ['fixtures'], field_mapping: fieldMapping })),
        forService: () =>
          syncServiceClient({
            fixtures: { ...chain({ data: [existingFixtureRow], error: null }), update: (patch: Record<string, unknown>) => { capturedUpdate = patch; return chain({ data: null, error: null }) } },
            teams: chain({ data: [], error: null }),
          }),
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('apply', 'fixtures', csv)
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().run).toMatchObject({ updatedCount: 1 })
      expect(capturedUpdate).toMatchObject({ competition: 'Kreisliga A', status: 'played', home_score: 2, away_score: 1 })
    })

    it('absorbs a CHECK-constraint rejection (played without both scores) as a graceful no-op, not a crash', async () => {
      // Dieselbe Grundidee wie die Elternkontakt-CHECK bei directory_people (Paket 014): ein
      // fehlgeschlagenes Update bleibt unveraendert stehen statt den Lauf abzubrechen. Anders als
      // bei Personen erzeugt handleFixturesSync dafuer aber KEINEN sichtbaren Konflikt-Eintrag --
      // appliedUpdatedCount wird nur stillschweigend zurueckgenommen (siehe apps/api/src/app.ts,
      // Kommentar bei "23514: status='played' ohne beide Torzahlen").
      const csv = 'ExterneId,Gegner,Liga,Status,Heimtore\r\next-1,SV Gegner,Kreisliga A,played,2\r\n'
      const fieldMapping = { ExterneId: 'externalId', Gegner: 'opponentName', Liga: 'competition', Status: 'status', Heimtore: 'homeScore' }
      const existingFixtureRow = {
        id: FIXTURE_ID, external_id: 'ext-1', source_id: SOURCE_ID, team_id: null, is_home: null, own_team_label: null,
        opponent_name: 'SV Gegner', competition: null, kickoff_at: '2026-08-01T18:00:00Z', kickoff_time_confirmed: true,
        venue_name: null, venue_address: null, status: 'scheduled', home_score: null, away_score: null, note: null,
        source_updated_at: null, updated_at: '2026-08-01T00:00:00Z',
      }
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: DEPARTMENT_ID, enabled_domains: ['fixtures'], field_mapping: fieldMapping })),
        forService: () =>
          syncServiceClient({
            fixtures: { ...chain({ data: [existingFixtureRow], error: null }), update: () => chain({ data: null, error: { code: '23514', message: 'check violation' } }) },
            teams: chain({ data: [], error: null }),
          }),
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('apply', 'fixtures', csv)
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().run).toMatchObject({ updatedCount: 0 })
      expect(response.json().conflicts).toEqual([])
    })
  })

  describe('events sync', () => {
    it('creates a department-scoped club event on apply', async () => {
      const csv = 'Titel,Beginn,Kategorie,Ort\r\nSommerfest,2026-09-01T16:00:00+02:00,festival,Vereinsheim\r\n'
      const fieldMapping = { Titel: 'title', Beginn: 'startsAt', Kategorie: 'category', Ort: 'locationName' }
      let capturedInsertRows: Record<string, unknown>[] = []
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: DEPARTMENT_ID, enabled_domains: ['events'], field_mapping: fieldMapping })),
        forService: () =>
          syncServiceClient({
            club_events: { ...chain({ data: [], error: null }), insert: (rows: Record<string, unknown>[]) => { capturedInsertRows = rows; return chain({ data: null, error: null }) } },
          }),
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('apply', 'events', csv)
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().run).toMatchObject({ createdCount: 1 })
      expect(capturedInsertRows).toHaveLength(1)
      expect(capturedInsertRows[0]).toMatchObject({ department_id: DEPARTMENT_ID, title: 'Sommerfest', category: 'festival' })
    })

    it('creates an organization-wide club event (department_id null) from a source without a department', async () => {
      const csv = 'Titel,Beginn,Kategorie,Ort\r\nJahreshauptversammlung,2026-10-01T18:00:00+02:00,general_meeting,Vereinsheim\r\n'
      const fieldMapping = { Titel: 'title', Beginn: 'startsAt', Kategorie: 'category', Ort: 'locationName' }
      let capturedInsertRows: Record<string, unknown>[] = []
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: null, enabled_domains: ['events'], field_mapping: fieldMapping })),
        forService: () =>
          syncServiceClient({
            club_events: { ...chain({ data: [], error: null }), insert: (rows: Record<string, unknown>[]) => { capturedInsertRows = rows; return chain({ data: null, error: null }) } },
          }),
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('apply', 'events', csv)
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().run).toMatchObject({ createdCount: 1 })
      expect(capturedInsertRows[0]).toMatchObject({ department_id: null, title: 'Jahreshauptversammlung' })
    })

    it('turns an unparseable startsAt into an invalid_record conflict instead of crashing on the starts_at NOT NULL column', async () => {
      const csv = 'Titel,Beginn\r\nJahreshauptversammlung,kaputtes-datum\r\n'
      const fieldMapping = { Titel: 'title', Beginn: 'startsAt' }
      const clients: SupabaseClientFactory = {
        forUser: () => sourceOnlyUserClient(integrationSource({ department_id: DEPARTMENT_ID, enabled_domains: ['events'], field_mapping: fieldMapping })),
        forService: () => syncServiceClient({ club_events: chain({ data: [], error: null }) }),
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const { boundary, body } = syncMultipartBody('dry_run', 'events', csv)
      const response = await app.inject({
        method: 'POST', url: `/v1/integration-sources/${SOURCE_ID}/sync`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
      })
      expect(response.statusCode).toBe(200)
      const json = response.json()
      expect(json.run).toMatchObject({ createdCount: 0 })
      expect(json.conflicts).toHaveLength(1)
      expect(json.conflicts[0]).toMatchObject({ kind: 'invalid_record', field: 'startsAt' })
    })
  })

  describe('GET fixtures/club-events lists', () => {
    // GET .../fixtures und .../club-events filtern serverseitig wirklich (departmentId/teamId/
    // from/to) -- anders als chain() oben, das jede Filterbedingung ignoriert, wendet dieser Stub
    // eq()/gte()/lte() tatsaechlich auf die uebergebenen Zeilen an, um zu belegen, dass die
    // Query-Parameter der Route tatsaechlich einschraenken, nicht nur, dass sie 200 antwortet.
    function filterableRows(rows: readonly Record<string, unknown>[]) {
      let result = [...rows]
      const builder: Record<string, unknown> = {
        eq: (column: string, value: unknown) => { result = result.filter((row) => row[column] === value); return builder },
        gte: (column: string, value: unknown) => { result = result.filter((row) => (row[column] as string) >= (value as string)); return builder },
        lte: (column: string, value: unknown) => { result = result.filter((row) => (row[column] as string) <= (value as string)); return builder },
        order: () => builder,
        then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => resolve({ data: result, error: null }),
      }
      return builder as PromiseLike<{ data: unknown; error: unknown }> & Record<string, unknown>
    }

    function fixtureRow(overrides: Record<string, unknown> = {}) {
      return {
        id: FIXTURE_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, kind: 'match', competition: null,
        is_home: true, own_team_label: null, opponent_name: 'SV Gegner', kickoff_at: '2026-08-10T18:00:00Z', kickoff_time_confirmed: true,
        venue_name: 'Sportplatz', venue_address: null, status: 'scheduled', home_score: null, away_score: null, note: null,
        announcement_dismissed_at: null, result_dismissed_at: null, source_id: null, source_updated_at: null,
        created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
        ...overrides,
      }
    }

    function clubEventRow(overrides: Record<string, unknown> = {}) {
      return {
        id: CLUB_EVENT_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, title: 'Sommerfest', description: null,
        category: 'festival', starts_at: '2026-09-01T16:00:00Z', ends_at: null, all_day: false, location_name: 'Vereinsheim', location_address: null,
        registration_url: null, status: 'scheduled', invitation_dismissed_at: null, source_id: null, source_updated_at: null,
        created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
        ...overrides,
      }
    }

    it('lists fixtures for an organization and narrows by departmentId/teamId/from/to', async () => {
      const fixtureA = fixtureRow({ id: FIXTURE_ID, department_id: DEPARTMENT_ID, team_id: TEAM_ID, kickoff_at: '2026-08-10T18:00:00Z' })
      const fixtureB = fixtureRow({ id: OTHER_FIXTURE_ID, department_id: OTHER_DEPARTMENT_ID, team_id: null, kickoff_at: '2026-09-15T18:00:00Z' })
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'fixtures') return { select: () => filterableRows([fixtureA, fixtureB]) }; throw new Error(`unexpected table in test fake: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({ from: () => { throw new Error('no service access expected for a listing route') } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)

      const all = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/fixtures`, headers: { authorization: `Bearer ${token}` } })
      expect(all.statusCode).toBe(200)
      expect((all.json() as { id: string }[]).map((row) => row.id).sort()).toEqual([FIXTURE_ID, OTHER_FIXTURE_ID].sort())

      const byDepartment = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/fixtures?departmentId=${DEPARTMENT_ID}`, headers: { authorization: `Bearer ${token}` } })
      expect((byDepartment.json() as { id: string }[]).map((row) => row.id)).toEqual([FIXTURE_ID])

      const byTeam = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/fixtures?teamId=${TEAM_ID}`, headers: { authorization: `Bearer ${token}` } })
      expect((byTeam.json() as { id: string }[]).map((row) => row.id)).toEqual([FIXTURE_ID])

      const byRange = await app.inject({
        method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/fixtures?from=2026-09-01T00:00:00Z&to=2026-09-30T00:00:00Z`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect((byRange.json() as { id: string }[]).map((row) => row.id)).toEqual([OTHER_FIXTURE_ID])
    })

    it('lists club events for an organization and narrows by departmentId/from/to', async () => {
      const eventA = clubEventRow({ id: CLUB_EVENT_ID, department_id: DEPARTMENT_ID, starts_at: '2026-09-01T16:00:00Z' })
      const otherEventId = '19000000-7000-4000-8000-000000000002'
      const eventB = clubEventRow({ id: otherEventId, department_id: OTHER_DEPARTMENT_ID, starts_at: '2026-10-15T16:00:00Z' })
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'club_events') return { select: () => filterableRows([eventA, eventB]) }; throw new Error(`unexpected table in test fake: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({ from: () => { throw new Error('no service access expected for a listing route') } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)

      const byDepartment = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/club-events?departmentId=${DEPARTMENT_ID}`, headers: { authorization: `Bearer ${token}` } })
      expect(byDepartment.statusCode).toBe(200)
      expect((byDepartment.json() as { id: string }[]).map((row) => row.id)).toEqual([CLUB_EVENT_ID])
      // Der Rundlauf durch ClubEventSchema muss camelCase liefern, nicht die rohen snake_case-Spalten.
      expect(byDepartment.json()).toMatchObject([{ startsAt: '2026-09-01T16:00:00Z', locationName: 'Vereinsheim', allDay: false }])

      const byRange = await app.inject({
        method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/club-events?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect((byRange.json() as { id: string }[]).map((row) => row.id)).toEqual([otherEventId])
    })
  })

  describe('dismiss endpoints', () => {
    it('lets a caller with post.create in the fixture department dismiss its announcement', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'fixtures') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }, error: null }); throw new Error(`unexpected table in test fake: ${table}`) } }) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'fixtures') {
                return {
                  update: () =>
                    chain({
                      data: {
                        id: FIXTURE_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, kind: 'match', competition: null,
                        is_home: null, own_team_label: null, opponent_name: 'SV Gegner', kickoff_at: '2026-08-10T18:00:00Z', kickoff_time_confirmed: true,
                        venue_name: null, venue_address: null, status: 'scheduled', home_score: null, away_score: null, note: null,
                        announcement_dismissed_at: new Date().toISOString(), result_dismissed_at: null, source_id: null, source_updated_at: null,
                        created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
                      },
                      error: null,
                    }),
                }
              }
              throw new Error(`unexpected table in service test fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/fixtures/${FIXTURE_ID}/dismiss-announcement`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.announcementDismissedAt).not.toBeNull()
      expect(Date.now() - new Date(body.announcementDismissedAt).getTime()).toBeLessThan(5000)
    })

    it('rejects dismissing an announcement without post.create in that department', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'fixtures') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }, error: null }); throw new Error(`unexpected table in test fake: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({ from: () => { throw new Error('no service access expected before the permission check') } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/fixtures/${FIXTURE_ID}/dismiss-announcement`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(403)
    })

    it('returns 404 when dismissing an announcement for a nonexistent fixture', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'fixtures') return chain({ data: null, error: null }); throw new Error(`unexpected table in test fake: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({ from: () => { throw new Error('no service access expected before the not-found check') } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/fixtures/${FIXTURE_ID}/dismiss-announcement`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(404)
    })

    it('lets a caller with post.create dismiss a fixture result', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'fixtures') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }, error: null }); throw new Error(`unexpected table in test fake: ${table}`) } }) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'fixtures') {
                return {
                  update: () =>
                    chain({
                      data: {
                        id: FIXTURE_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, kind: 'match', competition: null,
                        is_home: true, own_team_label: null, opponent_name: 'SV Gegner', kickoff_at: '2026-08-10T18:00:00Z', kickoff_time_confirmed: true,
                        venue_name: null, venue_address: null, status: 'played', home_score: 2, away_score: 1, note: null,
                        announcement_dismissed_at: null, result_dismissed_at: new Date().toISOString(), source_id: null, source_updated_at: null,
                        created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
                      },
                      error: null,
                    }),
                }
              }
              throw new Error(`unexpected table in service test fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/fixtures/${FIXTURE_ID}/dismiss-result`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.resultDismissedAt).not.toBeNull()
      expect(Date.now() - new Date(body.resultDismissedAt).getTime()).toBeLessThan(5000)
    })

    it('lets a caller with post.create dismiss an org-wide (department_id null) club event invitation', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'club_events') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: null }, error: null }); throw new Error(`unexpected table in test fake: ${table}`) } }) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'club_events') {
                return {
                  update: () =>
                    chain({
                      data: {
                        id: CLUB_EVENT_ID, organization_id: ORGANIZATION_ID, department_id: null, team_id: null, title: 'Jahreshauptversammlung', description: null,
                        category: 'general_meeting', starts_at: '2026-10-01T18:00:00Z', ends_at: null, all_day: false, location_name: null, location_address: null,
                        registration_url: null, status: 'scheduled', invitation_dismissed_at: new Date().toISOString(), source_id: null, source_updated_at: null,
                        created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
                      },
                      error: null,
                    }),
                }
              }
              throw new Error(`unexpected table in service test fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/club-events/${CLUB_EVENT_ID}/dismiss-invitation`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.invitationDismissedAt).not.toBeNull()
      expect(Date.now() - new Date(body.invitationDismissedAt).getTime()).toBeLessThan(5000)
    })
  })

  describe('GET /v1/departments/:id/content-suggestions', () => {
    // fixtures wird zweimal mit unterschiedlichen Spaltenlisten abgefragt (bevorstehend vs.
    // gespielt), submissions zweimal mit unterschiedlicher Einzelspalte -- die select()-Feldliste
    // selbst entscheidet hier, welcher Kandidatensatz zurueckkommt, statt die Aufrufreihenfolge
    // anzunehmen.
    function contentSuggestionsUserClient(input: {
      upcomingFixtures?: Record<string, unknown>[]
      playedFixtures?: Record<string, unknown>[]
      upcomingEvents?: Record<string, unknown>[]
      fixtureIdsWithSubmission?: string[]
      eventIdsWithSubmission?: string[]
    }): SupabaseClient {
      return {
        from: (table: string) => {
          if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
          if (table === 'fixtures') {
            return { select: (fields: string) => chain({ data: (fields.includes('announcement_dismissed_at') ? input.upcomingFixtures : input.playedFixtures) ?? [], error: null }) }
          }
          if (table === 'club_events') return { select: () => chain({ data: input.upcomingEvents ?? [], error: null }) }
          if (table === 'submissions') {
            return {
              select: (fields: string) =>
                chain({
                  data: fields.includes('fixture_id')
                    ? (input.fixtureIdsWithSubmission ?? []).map((id) => ({ fixture_id: id }))
                    : (input.eventIdsWithSubmission ?? []).map((id) => ({ club_event_id: id })),
                  error: null,
                }),
            }
          }
          throw new Error(`unexpected table in test fake: ${table}`)
        },
      } as unknown as SupabaseClient
    }

    const noServiceAccess = { from: () => { throw new Error('no service access expected') } } as unknown as SupabaseClient
    const departmentOnlyClient: SupabaseClientFactory = {
      forUser: () => ({ from: (table: string) => { if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null }); throw new Error(`unexpected table in test fake: ${table}`) } }) as unknown as SupabaseClient,
      forService: () => noServiceAccess,
    }

    it('produces a fixture_announcement suggestion for an upcoming fixture without a submission, and suppresses it once one exists', async () => {
      const in2Days = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
      const fixture = { id: FIXTURE_ID, opponent_name: 'SV Gegner', kickoff_at: in2Days, source_updated_at: null, announcement_dismissed_at: null }
      const token = await signAccessToken(USER_ID)

      const withoutSubmission = contentSuggestionsUserClient({ upcomingFixtures: [fixture] })
      const app1 = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: { forUser: () => withoutSubmission, forService: () => noServiceAccess } })
      const response1 = await app1.inject({ method: 'GET', url: `/v1/departments/${DEPARTMENT_ID}/content-suggestions`, headers: { authorization: `Bearer ${token}` } })
      expect(response1.statusCode).toBe(200)
      expect(response1.json().suggestions).toEqual([
        { kind: 'fixture_announcement', departmentId: DEPARTMENT_ID, fixtureId: FIXTURE_ID, occursAt: in2Days, label: 'Spielankündigung gegen SV Gegner fehlt noch' },
      ])

      const withSubmission = contentSuggestionsUserClient({ upcomingFixtures: [fixture], fixtureIdsWithSubmission: [FIXTURE_ID] })
      const app2 = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: { forUser: () => withSubmission, forService: () => noServiceAccess } })
      const response2 = await app2.inject({ method: 'GET', url: `/v1/departments/${DEPARTMENT_ID}/content-suggestions`, headers: { authorization: `Bearer ${token}` } })
      expect(response2.json().suggestions).toEqual([])
    })

    it('suppresses a dismissed fixture announcement, but the suggestion reappears once the source changes after the dismissal', async () => {
      const now = Date.now()
      const in2Days = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString()
      const dismissedAt = new Date(now - 24 * 60 * 60 * 1000).toISOString()
      const sourceUpdatedBeforeDismissal = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()
      const sourceUpdatedAfterDismissal = new Date(now).toISOString()
      const token = await signAccessToken(USER_ID)

      const stillDismissed = contentSuggestionsUserClient({
        upcomingFixtures: [{ id: FIXTURE_ID, opponent_name: 'SV Gegner', kickoff_at: in2Days, source_updated_at: sourceUpdatedBeforeDismissal, announcement_dismissed_at: dismissedAt }],
      })
      const app1 = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: { forUser: () => stillDismissed, forService: () => noServiceAccess } })
      const response1 = await app1.inject({ method: 'GET', url: `/v1/departments/${DEPARTMENT_ID}/content-suggestions`, headers: { authorization: `Bearer ${token}` } })
      expect(response1.json().suggestions).toEqual([])

      // Das Spiel wurde nach dem Wegklicken verlegt (source_updated_at liegt jetzt NACH
      // announcement_dismissed_at) -- der Vorschlag muss zurueckkommen (plans/019, Abschnitt 4).
      const reappeared = contentSuggestionsUserClient({
        upcomingFixtures: [{ id: FIXTURE_ID, opponent_name: 'SV Gegner', kickoff_at: in2Days, source_updated_at: sourceUpdatedAfterDismissal, announcement_dismissed_at: dismissedAt }],
      })
      const app2 = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: { forUser: () => reappeared, forService: () => noServiceAccess } })
      const response2 = await app2.inject({ method: 'GET', url: `/v1/departments/${DEPARTMENT_ID}/content-suggestions`, headers: { authorization: `Bearer ${token}` } })
      expect(response2.json().suggestions).toHaveLength(1)
      expect(response2.json().suggestions[0]).toMatchObject({ kind: 'fixture_announcement', fixtureId: FIXTURE_ID })
    })

    it('produces a fixture_result suggestion for a recently played fixture without a submission', async () => {
      const past24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const client = contentSuggestionsUserClient({
        playedFixtures: [{ id: FIXTURE_ID, opponent_name: 'SV Gegner', kickoff_at: past24h, home_score: 2, away_score: 1, source_updated_at: null, result_dismissed_at: null }],
      })
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: { forUser: () => client, forService: () => noServiceAccess } })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/departments/${DEPARTMENT_ID}/content-suggestions`, headers: { authorization: `Bearer ${token}` } })
      expect(response.json().suggestions).toEqual([
        { kind: 'fixture_result', departmentId: DEPARTMENT_ID, fixtureId: FIXTURE_ID, occursAt: past24h, label: 'Ergebnis gegen SV Gegner noch nicht erzählt' },
      ])
    })

    it('produces an event_invitation suggestion for an upcoming club event without a submission', async () => {
      const in10Days = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      const client = contentSuggestionsUserClient({ upcomingEvents: [{ id: CLUB_EVENT_ID, title: 'Sommerfest', starts_at: in10Days, source_updated_at: null, invitation_dismissed_at: null }] })
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: { forUser: () => client, forService: () => noServiceAccess } })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/departments/${DEPARTMENT_ID}/content-suggestions`, headers: { authorization: `Bearer ${token}` } })
      expect(response.json().suggestions).toEqual([
        { kind: 'event_invitation', departmentId: DEPARTMENT_ID, clubEventId: CLUB_EVENT_ID, occursAt: in10Days, label: 'Einladung zu „Sommerfest“ fehlt noch' },
      ])
    })

    it('rejects content suggestions for a caller without post.create in the department', async () => {
      const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: departmentOnlyClient })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/departments/${DEPARTMENT_ID}/content-suggestions`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(403)
    })
  })

  describe('POST /v1/submissions with fixtureId/clubEventId', () => {
    it('rejects a payload carrying both fixtureId and clubEventId, before it reaches the handler', async () => {
      const app = await startApp()
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST',
        url: '/v1/submissions',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetSlug: 'training_insight', communicationGoal: 'inform',
          requestedFormats: ['feed_image'], sourceMaterial: { facts: {}, observations: ['Testspiel.'], quotes: [], doNotMention: [] },
          fixtureId: FIXTURE_ID, clubEventId: CLUB_EVENT_ID,
        },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ error: 'invalid_request' })
    })

    it('creates a submission linked to a fixture in the same department, with facts/provenance/snapshot derived from the fixture', async () => {
      let capturedInsert: Record<string, unknown> | null = null
      const clients: SupabaseClientFactory = {
        forUser: () =>
          ({
            from: (table: string) => {
              if (table === 'policy_settings') return chain({ data: [], error: null })
              if (table === 'member_review_trust') return chain({ data: [], error: null })
              if (table === 'organizations') return chain({ data: { timezone: 'Europe/Berlin' }, error: null })
              if (table === 'fixtures') {
                return chain({
                  data: {
                    id: FIXTURE_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, kind: 'match', competition: null,
                    is_home: true, own_team_label: null, opponent_name: 'SV Gegner', kickoff_at: '2026-08-20T18:00:00Z', kickoff_time_confirmed: true,
                    venue_name: 'Sportplatz Nord', venue_address: null, status: 'scheduled', home_score: null, away_score: null, note: null,
                    announcement_dismissed_at: null, result_dismissed_at: null, source_id: null, source_updated_at: null,
                    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
                  },
                  error: null,
                })
              }
              if (table === 'submissions') {
                return { insert: (payload: Record<string, unknown>) => { capturedInsert = payload; return chain({ data: { id: '19000000-8000-4000-8000-000000000001', status: 'draft' }, error: null }) } }
              }
              throw new Error(`unexpected table in test fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
        forService: () => draftCreationServiceClient(),
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST',
        url: '/v1/submissions',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetSlug: 'training_insight', communicationGoal: 'inform',
          requestedFormats: ['feed_image'], sourceMaterial: { facts: {}, observations: ['Testspiel steht an.'], quotes: [], doNotMention: [] },
          fixtureId: FIXTURE_ID,
        },
      })
      expect(response.statusCode).toBe(202)
      expect(capturedInsert).toMatchObject({ fixture_id: FIXTURE_ID, club_event_id: null })
      expect(readField(capturedInsert, 'source_provenance')).not.toEqual({})
      expect(readField(capturedInsert, 'source_prefill_snapshot')).not.toBeNull()
    })

    it('rejects a fixtureId belonging to a different department than the request, with 400 fixture_not_found_in_department', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () =>
          ({
            from: (table: string) => {
              if (table === 'policy_settings') return chain({ data: [], error: null })
              if (table === 'member_review_trust') return chain({ data: [], error: null })
              if (table === 'organizations') return chain({ data: { timezone: 'Europe/Berlin' }, error: null })
              if (table === 'fixtures') {
                return chain({
                  data: {
                    id: FIXTURE_ID, organization_id: ORGANIZATION_ID, department_id: OTHER_DEPARTMENT_ID, team_id: null, kind: 'match', competition: null,
                    is_home: true, own_team_label: null, opponent_name: 'SV Gegner', kickoff_at: '2026-08-20T18:00:00Z', kickoff_time_confirmed: true,
                    venue_name: 'Sportplatz Nord', venue_address: null, status: 'scheduled', home_score: null, away_score: null, note: null,
                    announcement_dismissed_at: null, result_dismissed_at: null, source_id: null, source_updated_at: null,
                    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
                  },
                  error: null,
                })
              }
              throw new Error(`unexpected table in test fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
        forService: () => ({ from: () => { throw new Error('forService should not be used by this test') } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST',
        url: '/v1/submissions',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetSlug: 'training_insight', communicationGoal: 'inform',
          requestedFormats: ['feed_image'], sourceMaterial: { facts: {}, observations: ['Testspiel.'], quotes: [], doNotMention: [] },
          fixtureId: FIXTURE_ID,
        },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ error: 'fixture_not_found_in_department' })
    })

    it('accepts a clubEventId whose department is null (org-wide) regardless of the requested departmentId', async () => {
      let capturedInsert: Record<string, unknown> | null = null
      const clients: SupabaseClientFactory = {
        forUser: () =>
          ({
            from: (table: string) => {
              if (table === 'policy_settings') return chain({ data: [], error: null })
              if (table === 'member_review_trust') return chain({ data: [], error: null })
              if (table === 'organizations') return chain({ data: { timezone: 'Europe/Berlin' }, error: null })
              if (table === 'club_events') {
                return chain({
                  data: {
                    id: CLUB_EVENT_ID, organization_id: ORGANIZATION_ID, department_id: null, team_id: null, title: 'Sommerfest', description: null,
                    category: 'festival', starts_at: '2026-09-01T16:00:00Z', ends_at: null, all_day: false, location_name: 'Vereinsheim', location_address: null,
                    registration_url: null, status: 'scheduled', invitation_dismissed_at: null, source_id: null, source_updated_at: null,
                    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
                  },
                  error: null,
                })
              }
              if (table === 'submissions') {
                return { insert: (payload: Record<string, unknown>) => { capturedInsert = payload; return chain({ data: { id: '19000000-8000-4000-8000-000000000002', status: 'draft' }, error: null }) } }
              }
              throw new Error(`unexpected table in test fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
        forService: () => draftCreationServiceClient(),
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST',
        url: '/v1/submissions',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetSlug: 'training_insight', communicationGoal: 'invite',
          requestedFormats: ['feed_image'], sourceMaterial: { facts: {}, observations: ['Sommerfest steht an.'], quotes: [], doNotMention: [] },
          clubEventId: CLUB_EVENT_ID,
        },
      })
      expect(response.statusCode).toBe(202)
      expect(capturedInsert).toMatchObject({ club_event_id: CLUB_EVENT_ID, fixture_id: null })
    })
  })
})

describe('Paket 015: Einwilligungsverwaltung', () => {
  const CONSENT_ID = '15000000-4000-4000-8000-000000000001'
  const DIRECTORY_PERSON_ID = '15000000-3000-4000-8000-000000000001'
  const CONSENT_REQUEST_ID = '15000000-5000-4000-8000-000000000001'

  function consentRecordRow(overrides: Record<string, unknown> = {}) {
    return {
      id: CONSENT_ID, organization_id: ORGANIZATION_ID, directory_person_id: DIRECTORY_PERSON_ID,
      pseudonymous_subject_ref: DIRECTORY_PERSON_ID, scope: 'Fotos fuer Social Media', origin: 'paper',
      source_id: null, signed_at: '2026-08-01', signer_name: 'Erika Musterfrau', signer_role: 'guardian',
      guardian_confirmed: true, valid_from: '2026-08-01T00:00:00Z', valid_until: null, revoked_at: null,
      revoked_by: null, revocation_reason: null, superseded_by: null, created_at: '2026-08-01T00:00:00Z',
      scope_structured: { purposes: ['social_media'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false, departmentIds: null },
      ...overrides,
    }
  }

  function consentScopeAndFields() {
    return {
      scope: 'Fotos fuer Social Media',
      scopeStructured: JSON.stringify({ purposes: ['social_media'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false, departmentIds: null }),
      signedAt: '2026-08-01', signerName: 'Erika Musterfrau', signerRole: 'guardian', guardianConfirmed: 'true',
    }
  }

  function consentUploadBody(fields: Record<string, string>, extra: Record<string, string> = {}) {
    const boundary = '----vereinsfunkConsentBoundary'
    const parts: Buffer[] = []
    for (const [key, value] of Object.entries({ organizationId: ORGANIZATION_ID, directoryPersonId: DIRECTORY_PERSON_ID, ...fields, ...extra })) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`))
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="nachweis.pdf"\r\nContent-Type: application/pdf\r\n\r\n`))
    parts.push(Buffer.from('%PDF-1.4 fake evidence content'))
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
    return { boundary, body: Buffer.concat(parts) }
  }

  it('rejects the registratur upload without consent.manage', async () => {
    const app = await startApp({
      roleProvider: denyingRoleProvider,
      supabaseClients: {
        forUser: () =>
          ({ from: (table: string) => { if (table === 'directory_people') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }, error: null } as never); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({}) as unknown as SupabaseClient,
      },
    })
    const token = await signAccessToken(USER_ID)
    const { boundary, body } = consentUploadBody(consentScopeAndFields())
    const response = await app.inject({
      method: 'POST', url: '/v1/consents',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(response.statusCode).toBe(403)
  })

  it('rejects a registratur evidence file with a disallowed MIME type', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkConsentBadMimeBoundary'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="organizationId"\r\n\r\n${ORGANIZATION_ID}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="directoryPersonId"\r\n\r\n${DIRECTORY_PERSON_ID}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="scope"\r\n\r\nFotos\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="scopeStructured"\r\n\r\n${JSON.stringify({ purposes: ['social_media'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false, departmentIds: null })}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="signedAt"\r\n\r\n2026-08-01\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="signerName"\r\n\r\nErika Musterfrau\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="signerRole"\r\n\r\nguardian\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="guardianConfirmed"\r\n\r\ntrue\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="nachweis.mp4"\r\nContent-Type: video/mp4\r\n\r\n`),
      Buffer.from('not really a video'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST', url: '/v1/consents',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_file_type' })
  })

  it('rejects a registratur request naming both a directory person and a pseudonymous ref', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const { boundary, body } = consentUploadBody(consentScopeAndFields(), { pseudonymousSubjectRef: 'ext-subject-001' })
    const response = await app.inject({
      method: 'POST', url: '/v1/consents',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('rejects a registratur upload with signerRole=self for a minor -- consent to publish is not a minor\'s own to give', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: (table: string) => { if (table === 'directory_people') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, is_minor: true }, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const { boundary, body } = consentUploadBody({ ...consentScopeAndFields(), signerRole: 'self' })
    const response = await app.inject({
      method: 'POST', url: '/v1/consents',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'guardian_required_for_minor' })
  })

  it('rejects a digital consent request with recipientRole=self for a minor', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: (table: string) => { if (table === 'directory_people') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, is_minor: true }, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/consent-requests',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        organizationId: ORGANIZATION_ID, directoryPersonId: DIRECTORY_PERSON_ID, recipientEmail: 'kind@example.local', recipientRole: 'self',
        requestedScope: { purposes: ['social_media'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false, departmentIds: null },
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'guardian_required_for_minor' })
  })

  it('returns 404 when revoking a consent record that does not exist', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: (table: string) => { if (table === 'consent_records') return chain({ data: null, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/consents/${CONSENT_ID}/revoke`,
      headers: { authorization: `Bearer ${token}` }, payload: { revokedBy: 'organization' },
    })
    expect(response.statusCode).toBe(404)
  })

  it('rejects revoking a consent record without consent.manage in the linked department', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_records') return chain({ data: consentRecordRow(), error: null })
            if (table === 'directory_people') return chain({ data: { department_id: DEPARTMENT_ID }, error: null })
            throw new Error(`unexpected table: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/consents/${CONSENT_ID}/revoke`,
      headers: { authorization: `Bearer ${token}` }, payload: { revokedBy: 'organization' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('revokes a consent record and audits the action', async () => {
    const auditRows: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_records') return chain({ data: consentRecordRow(), error: null })
            if (table === 'directory_people') return chain({ data: { department_id: DEPARTMENT_ID }, error: null })
            throw new Error(`unexpected table: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_records') return { update: () => chain({ data: consentRecordRow({ revoked_at: '2026-08-08T00:00:00Z', revoked_by: 'organization' }), error: null }) }
            if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { auditRows.push(row); return { error: null } } }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/consents/${CONSENT_ID}/revoke`,
      headers: { authorization: `Bearer ${token}` }, payload: { revokedBy: 'organization', reason: 'Elternwunsch' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'revoked' })
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]).toMatchObject({ action: 'consent.revoked' })
  })

  it('refuses to revoke an already-revoked consent record', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_records') return chain({ data: consentRecordRow({ revoked_at: '2026-08-01T00:00:00Z' }), error: null })
            if (table === 'directory_people') return chain({ data: { department_id: DEPARTMENT_ID }, error: null })
            throw new Error(`unexpected table: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/consents/${CONSENT_ID}/revoke`,
      headers: { authorization: `Bearer ${token}` }, payload: { revokedBy: 'organization' },
    })
    expect(response.statusCode).toBe(409)
  })

  it('rejects updating the organization consent text without organization.manage', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: `/v1/organizations/${ORGANIZATION_ID}/consent-text`,
      headers: { authorization: `Bearer ${token}` }, payload: { body: 'Neuer Text' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('creating a new organization consent text never updates the previous version', async () => {
    let insertedRow: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_consent_texts') {
              return {
                insert: (row: Record<string, unknown>) => {
                  insertedRow = row
                  return chain({ data: { id: '15000000-6000-4000-8000-000000000001', body: row.body, created_at: '2026-08-08T00:00:00Z' }, error: null })
                },
              }
            }
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: `/v1/organizations/${ORGANIZATION_ID}/consent-text`,
      headers: { authorization: `Bearer ${token}` }, payload: { body: 'Neue Fassung des Einwilligungstexts' },
    })
    expect(response.statusCode).toBe(201)
    expect(insertedRow).toMatchObject({ organization_id: ORGANIZATION_ID, body: 'Neue Fassung des Einwilligungstexts' })
    expect(response.json()).toMatchObject({ isDefaultTemplate: false })
  })

  it('returns the identical, generic response for an unknown and an already-responded consent-request token (no enumerability)', async () => {
    let callCount = 0
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_requests') {
              callCount += 1
              // Erster Aufruf: kein Treffer. Zweiter Aufruf: Treffer, aber status bereits 'granted'.
              return chain({ data: callCount === 1 ? null : { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, directory_person_id: DIRECTORY_PERSON_ID, recipient_email: 'x@example.local', recipient_role: 'guardian', requested_scope: {}, text_version: 'v1', status: 'granted', expires_at: '2099-01-01T00:00:00Z', responded_at: '2026-08-01T00:00:00Z', consent_record_id: CONSENT_ID, send_count: 1, last_sent_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z', created_by: USER_ID, id: CONSENT_REQUEST_ID }, error: null })
            }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const unknownResponse = await app.inject({ method: 'GET', url: '/v1/consent-requests/by-token/unknown-token' })
    const respondedResponse = await app.inject({ method: 'GET', url: '/v1/consent-requests/by-token/already-responded-token' })
    expect(unknownResponse.statusCode).toBe(404)
    expect(respondedResponse.statusCode).toBe(404)
    expect(unknownResponse.json()).toMatchObject({ error: 'invalid_or_expired' })
    expect(respondedResponse.json()).toMatchObject({ error: 'invalid_or_expired' })
  })

  it('sets X-Robots-Tag: noindex on the public consent-request page', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ from: () => chain({ data: null, error: null }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({ method: 'GET', url: '/v1/consent-requests/by-token/some-token' })
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
  })

  it('records a decline without creating a consent record', async () => {
    let consentRecordsTouched = false
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_requests') {
              return {
                select: () => chain({
                  data: { id: CONSENT_REQUEST_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, directory_person_id: DIRECTORY_PERSON_ID, recipient_email: 'x@example.local', recipient_role: 'guardian', requested_scope: {}, text_version: 'v1', status: 'sent', expires_at: '2099-01-01T00:00:00Z', responded_at: null, consent_record_id: null, send_count: 1, last_sent_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z', created_by: USER_ID },
                  error: null,
                }),
                update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
              }
            }
            if (table === 'consent_records') { consentRecordsTouched = true; throw new Error('must not be touched on decline') }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({ method: 'POST', url: '/v1/consent-requests/by-token/some-token/respond', payload: { decision: 'declined' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'declined' })
    expect(consentRecordsTouched).toBe(false)
  })

  it('rate-limits repeated public respond attempts from the same client', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ from: () => chain({ data: null, error: null }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    let lastStatus = 0
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await app.inject({ method: 'POST', url: '/v1/consent-requests/by-token/rate-limit-token/respond', payload: { decision: 'declined' } })
      lastStatus = response.statusCode
    }
    expect(lastStatus).toBe(429)
  })
})

describe('Paket 020: Rechtliche Pflichten und Datenschutzbetrieb', () => {
  const AUDIT_EVENTS_INSERT_OK = { insert: async () => ({ error: null }) }
  const RETENTION_SETTINGS_ROW = {
    organization_id: ORGANIZATION_ID, raw_media_days: 90, derivative_days: null,
    audit_event_days: 1095, consent_evidence_years: 5, status_event_days: 730, updated_at: '2026-08-08T00:00:00Z',
  }
  const DIRECTORY_PERSON_ID = '20000000-3000-4000-8000-000000000001'

  describe('GET/PUT /v1/organizations/:id/retention-settings', () => {
    it('rejects reading retention settings without organization.manage', async () => {
      const app = await startApp({ roleProvider: denyingRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/retention-settings`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(403)
    })

    it('returns the retention settings for an organization manager', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({ from: (table: string) => { if (table === 'retention_settings') return chain({ data: RETENTION_SETTINGS_ROW, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/retention-settings`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ organizationId: ORGANIZATION_ID, rawMediaDays: 90, derivativeDays: null })
    })

    // Regression: ein Verein ohne retention_settings-Zeile (z. B. per Seed direkt angelegt, siehe
    // supabase/seed.sql) bekam bislang einen unbehandelten 500 statt Standardwerten.
    it('creates a default retention_settings row on first access when none exists yet', async () => {
      let inserted = false
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'retention_settings') {
                return {
                  select: () => chain(inserted ? { data: { ...RETENTION_SETTINGS_ROW, updated_by: USER_ID }, error: null } : { data: null, error: null }),
                  upsert: () => {
                    inserted = true
                    return chain({ data: null, error: null })
                  },
                }
              }
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/retention-settings`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      expect(inserted).toBe(true)
      expect(response.json()).toMatchObject({ rawMediaDays: 90 })
    })

    it('updates the raw media retention period and records an audit event', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'retention_settings') {
                // loadOrCreateRetentionSettings prueft die Zeile per select() zuerst (existiert
                // bereits -> kein insert), danach ruft der Handler update() separat auf.
                return {
                  select: () => chain({ data: RETENTION_SETTINGS_ROW, error: null }),
                  update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...RETENTION_SETTINGS_ROW, raw_media_days: 60 }, error: null }) }) }) }),
                }
              }
              if (table === 'audit_events') return AUDIT_EVENTS_INSERT_OK
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'PUT', url: `/v1/organizations/${ORGANIZATION_ID}/retention-settings`, headers: { authorization: `Bearer ${token}` }, payload: { rawMediaDays: 60 },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ rawMediaDays: 60 })
    })
  })

  describe('POST /v1/organizations/:id/retention/run', () => {
    it('rejects triggering a retention run without organization.manage', async () => {
      const app = await startApp({ roleProvider: denyingRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: `/v1/organizations/${ORGANIZATION_ID}/retention/run`, headers: { authorization: `Bearer ${token}` }, payload: { dryRun: true },
      })
      expect(response.statusCode).toBe(403)
    })

    it('runs a dry run that finds nothing and still logs the dry run itself', async () => {
      let retentionDeletionsLoggedAsDryRun = false
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'retention_settings') return { select: () => chain({ data: RETENTION_SETTINGS_ROW, error: null }) }
              if (['audit_events', 'post_status_events', 'invitations', 'consent_requests', 'publication_media_grants', 'idempotency_keys'].includes(table)) return chain({ data: [], error: null })
              if (table === 'retention_deletions') {
                return {
                  insert: async (rows: { dry_run: boolean }[]) => {
                    retentionDeletionsLoggedAsDryRun = rows.every((row) => row.dry_run === true)
                    return { error: null }
                  },
                }
              }
              throw new Error(`unexpected table: ${table}`)
            },
            rpc: async (fn: string) => {
              if (fn === 'select_expired_raw_media' || fn === 'select_expired_consent_evidence') return { data: [], error: null }
              throw new Error(`unexpected rpc: ${fn}`)
            },
            storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: `/v1/organizations/${ORGANIZATION_ID}/retention/run`, headers: { authorization: `Bearer ${token}` }, payload: { dryRun: true },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ dryRun: true })
      expect((response.json() as { results: { entityCount: number }[] }).results.every((result) => result.entityCount === 0)).toBe(true)
      expect(retentionDeletionsLoggedAsDryRun).toBe(true)
    })

    // Regression: Fastify ist mit requestIdHeader: 'x-correlation-id' konfiguriert -- ein
    // Aufrufer konnte request.id damit auf einen beliebigen, nicht-UUID-foermigen String setzen.
    // correlationId wird jetzt lokal per randomUUID() erzeugt, unabhaengig vom Header.
    it('ignores a non-UUID x-correlation-id header and returns a real UUID correlationId', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'retention_settings') return { select: () => chain({ data: RETENTION_SETTINGS_ROW, error: null }) }
              if (['audit_events', 'post_status_events', 'invitations', 'consent_requests', 'publication_media_grants', 'idempotency_keys'].includes(table)) return chain({ data: [], error: null })
              if (table === 'retention_deletions') return { insert: async () => ({ error: null }) }
              throw new Error(`unexpected table: ${table}`)
            },
            rpc: async (fn: string) => {
              if (fn === 'select_expired_raw_media' || fn === 'select_expired_consent_evidence') return { data: [], error: null }
              throw new Error(`unexpected rpc: ${fn}`)
            },
            storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: `/v1/organizations/${ORGANIZATION_ID}/retention/run`,
        headers: { authorization: `Bearer ${token}`, 'x-correlation-id': 'not-a-uuid' },
        payload: { dryRun: true },
      })
      expect(response.statusCode).toBe(200)
      expect((response.json() as { correlationId: string }).correlationId).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('deletes an expired raw media object from storage and marks the row deleted on a real run', async () => {
      const removedPaths: string[] = []
      let mediaAssetsUpdated = false
      let retentionDeletionsLogged = false
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'retention_settings') return { select: () => chain({ data: RETENTION_SETTINGS_ROW, error: null }) }
              if (table === 'media_assets') {
                return { update: () => ({ in: async () => { mediaAssetsUpdated = true; return { error: null } } }) }
              }
              if (table === 'audit_events') return { ...chain({ data: [], error: null }), insert: async () => ({ error: null }) }
              if (['post_status_events', 'invitations', 'consent_requests', 'publication_media_grants', 'idempotency_keys'].includes(table)) return chain({ data: [], error: null })
              if (table === 'retention_deletions') return { insert: async () => { retentionDeletionsLogged = true; return { error: null } } }
              throw new Error(`unexpected table: ${table}`)
            },
            rpc: async (fn: string) => {
              if (fn === 'select_expired_raw_media') {
                return { data: [{ media_asset_id: '20000000-4000-4000-8000-000000000001', bucket_id: 'raw-media', object_path: 'organizations/x/departments/y/submissions/z/old.jpg' }], error: null }
              }
              if (fn === 'select_expired_consent_evidence') return { data: [], error: null }
              throw new Error(`unexpected rpc: ${fn}`)
            },
            storage: {
              from: (bucket: string) => ({
                remove: async (paths: string[]) => { expect(bucket).toBe('raw-media'); removedPaths.push(...paths); return { error: null } },
                list: async () => ({ data: [], error: null }),
              }),
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: `/v1/organizations/${ORGANIZATION_ID}/retention/run`, headers: { authorization: `Bearer ${token}` }, payload: { dryRun: false },
      })
      expect(response.statusCode).toBe(200)
      expect(removedPaths).toEqual(['organizations/x/departments/y/submissions/z/old.jpg'])
      expect(mediaAssetsUpdated).toBe(true)
      expect(retentionDeletionsLogged).toBe(true)
    })
  })

  describe('data subject requests', () => {
    it('rejects listing data subject requests without organization.manage', async () => {
      const app = await startApp({ roleProvider: denyingRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/data-subject-requests`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(403)
    })

    it('creates a data subject request', async () => {
      const insertedRow = {
        id: '20000000-5000-4000-8000-000000000001', organization_id: ORGANIZATION_ID, kind: 'access', subject_kind: 'member',
        directory_person_id: null, subject_label: 'Max Mustermann', received_at: '2026-03-10', due_at: '2026-04-10',
        extended_until: null, extension_reason: null, status: 'open', resolution_note: null, handled_by: null,
        completed_at: null, created_at: '2026-03-10T00:00:00Z',
      }
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'data_subject_requests') return { insert: () => ({ select: () => ({ single: async () => ({ data: insertedRow, error: null }) }) }) }
              if (table === 'audit_events') return AUDIT_EVENTS_INSERT_OK
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: `/v1/organizations/${ORGANIZATION_ID}/data-subject-requests`, headers: { authorization: `Bearer ${token}` },
        payload: { kind: 'access', subjectKind: 'member', subjectLabel: 'Max Mustermann', receivedAt: '2026-03-10' },
      })
      expect(response.statusCode).toBe(201)
      expect(response.json()).toMatchObject({ kind: 'access', dueAt: '2026-04-10' })
    })

    it('marks a data subject request completed', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'data_subject_requests') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'data_subject_requests') {
                return {
                  update: () => ({
                    eq: () => ({
                      select: () => ({
                        single: async () => ({
                          data: {
                            id: '20000000-5000-4000-8000-000000000001', organization_id: ORGANIZATION_ID, kind: 'access', subject_kind: 'member',
                            directory_person_id: null, subject_label: 'Max Mustermann', received_at: '2026-03-10', due_at: '2026-04-10',
                            extended_until: null, extension_reason: null, status: 'completed', resolution_note: 'Auskunft erteilt',
                            handled_by: USER_ID, completed_at: '2026-03-15T00:00:00Z', created_at: '2026-03-10T00:00:00Z',
                          },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }
              }
              if (table === 'audit_events') return AUDIT_EVENTS_INSERT_OK
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'PATCH', url: '/v1/data-subject-requests/20000000-5000-4000-8000-000000000001', headers: { authorization: `Bearer ${token}` },
        payload: { status: 'completed', resolutionNote: 'Auskunft erteilt' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ status: 'completed' })
    })

    // Regression: due_at ist nur aus der Datenbank bekannt und wird jetzt vor dem Update geprueft,
    // statt den CHECK-Verstoss der Datenbank als unbehandelten 500 durchreichen zu lassen.
    it('rejects an extension that ends before the request due_at', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'data_subject_requests') return chain({ data: { organization_id: ORGANIZATION_ID, due_at: '2026-04-10' }, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({}) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'PATCH', url: '/v1/data-subject-requests/20000000-5000-4000-8000-000000000001', headers: { authorization: `Bearer ${token}` },
        payload: { extendedUntil: '2026-04-01', extensionReason: 'zu frueh' },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ error: 'extended_until_before_due_at' })
    })

    // Regression: extensionReason ohne extendedUntil in derselben Anfrage schlug bislang am
    // CHECK-Constraint der Datenbank fehl (500) statt an der Zod-Validierung (400).
    it('rejects setting extensionReason without extendedUntil in the same request', async () => {
      const app = await startApp({ roleProvider: organizationManagerRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'PATCH', url: '/v1/data-subject-requests/20000000-5000-4000-8000-000000000001', headers: { authorization: `Bearer ${token}` },
        payload: { extensionReason: 'mehr Zeit noetig' },
      })
      expect(response.statusCode).toBe(400)
    })

    // Regression: extendedUntil:null liess ein bestehendes extensionReason unangetastet und
    // verletzte damit den CHECK "Begruendung nur mit Verlaengerungsdatum" (500). Die API muss die
    // Begruendung jetzt selbst mitloeschen.
    it('clears an existing extensionReason when extendedUntil is reset to null', async () => {
      let updatedPayload: Record<string, unknown> | undefined
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'data_subject_requests') return chain({ data: { organization_id: ORGANIZATION_ID, due_at: '2026-04-10' }, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'data_subject_requests') {
                return {
                  update: (row: Record<string, unknown>) => {
                    updatedPayload = row
                    return {
                      eq: () => ({
                        select: () => ({
                          single: async () => ({
                            data: {
                              id: '20000000-5000-4000-8000-000000000001', organization_id: ORGANIZATION_ID, kind: 'access', subject_kind: 'member',
                              directory_person_id: null, subject_label: 'Max Mustermann', received_at: '2026-03-10', due_at: '2026-04-10',
                              extended_until: null, extension_reason: null, status: 'open', resolution_note: null,
                              handled_by: null, completed_at: null, created_at: '2026-03-10T00:00:00Z',
                            },
                            error: null,
                          }),
                        }),
                      }),
                    }
                  },
                }
              }
              if (table === 'audit_events') return AUDIT_EVENTS_INSERT_OK
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'PATCH', url: '/v1/data-subject-requests/20000000-5000-4000-8000-000000000001', headers: { authorization: `Bearer ${token}` },
        payload: { extendedUntil: null },
      })
      expect(response.statusCode).toBe(200)
      expect(updatedPayload).toMatchObject({ extended_until: null, extension_reason: null })
    })
  })

  describe('GET /v1/data-subjects/:personId/export and POST .../erase', () => {
    function directoryPersonUserClient(extra: Record<string, unknown> = {}) {
      return {
        from: (table: string) => {
          if (table === 'directory_people') {
            return chain({
              data: {
                organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, first_name: 'Max', last_name: 'Mustermann',
                birth_year: 2010, is_minor: true, status: 'active', joined_at: null, left_at: null, guardian_name: 'Erika Mustermann', guardian_email: 'eltern@example.local',
                ...extra,
              },
              error: null,
            })
          }
          throw new Error(`unexpected table in test fake: ${table}`)
        },
      } as unknown as SupabaseClient
    }

    it('rejects an export request without organization.manage', async () => {
      const clients: SupabaseClientFactory = { forUser: () => directoryPersonUserClient(), forService: () => ({}) as unknown as SupabaseClient }
      const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/data-subjects/${DIRECTORY_PERSON_ID}/export`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(403)
    })

    it('bundles consents, media usages and the access log into a signed export link', async () => {
      let uploadedPath: string | undefined
      const clients: SupabaseClientFactory = {
        forUser: () => directoryPersonUserClient(),
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'consent_records') return chain({ data: [{ id: '1', scope: 'Fotos', origin: 'paper', signed_at: '2026-01-01', valid_until: null, revoked_at: null, superseded_by: null }], error: null })
              if (table === 'audit_events') return { ...chain({ data: [{ action: 'directory_person.created', created_at: '2026-01-01T00:00:00Z' }], error: null }), insert: async () => ({ error: null }) }
              if (table === 'face_regions') return chain({ data: [], error: null })
              throw new Error(`unexpected table: ${table}`)
            },
            storage: {
              from: () => ({
                upload: async (path: string) => { uploadedPath = path; return { error: null } },
                createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/export.json' }, error: null }),
              }),
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/data-subjects/${DIRECTORY_PERSON_ID}/export`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ signedUrl: 'https://signed.example/export.json' })
      expect(uploadedPath).toContain(`organizations/${ORGANIZATION_ID}/exports/`)
    })

    it('erases the directory entry, anonymizes linked consent evidence, and names what is retained and why', async () => {
      let directoryPeopleDeleted = false
      let consentRecordsAnonymized: Record<string, unknown> | undefined
      const clients: SupabaseClientFactory = {
        forUser: () => directoryPersonUserClient(),
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'consent_records') {
                return {
                  select: () => chain({ data: null, error: null, count: 1 }),
                  update: (row: Record<string, unknown>) => ({ eq: async () => { consentRecordsAnonymized = row; return { error: null } } }),
                }
              }
              if (table === 'directory_people') return { delete: () => ({ eq: async () => { directoryPeopleDeleted = true; return { error: null } } }) }
              if (table === 'audit_events') return AUDIT_EVENTS_INSERT_OK
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/data-subjects/${DIRECTORY_PERSON_ID}/erase`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      expect(directoryPeopleDeleted).toBe(true)
      expect(consentRecordsAnonymized).toMatchObject({ pseudonymous_subject_ref: null, signer_name: null })
      const body = response.json() as { erased: string[]; retained: { category: string }[] }
      expect(body.erased).toContain('Verzeichniseintrag')
      expect(body.retained.map((entry) => entry.category)).toContain('Einwilligungsnachweise')
    })
  })

  describe('processing records and processor agreements', () => {
    it('rejects an unbalanced third-country transfer processing record before it reaches the database', async () => {
      const app = await startApp({ roleProvider: organizationManagerRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: `/v1/organizations/${ORGANIZATION_ID}/processing-records`, headers: { authorization: `Bearer ${token}` },
        payload: { purpose: 'Test', legalBasis: 'Test', retentionNote: 'Test', thirdCountryTransfer: true },
      })
      expect(response.statusCode).toBe(400)
    })

    // Regression: thirdCountryTransfer=true stand bereits in der Datenbank, nur transferSafeguard
    // wurde in dieser Anfrage genullt -- ein Zod-Schema ohne Datenbankzugriff sieht das nicht,
    // ohne den Nachschlag kam der CHECK-Verstoss als unbehandelter 500 durch.
    it('rejects clearing transferSafeguard while thirdCountryTransfer is already true in the database', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'processing_records') return chain({ data: { organization_id: ORGANIZATION_ID, third_country_transfer: true, transfer_safeguard: 'Standardvertragsklauseln' }, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({}) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'PATCH', url: '/v1/processing-records/20000000-7000-4000-8000-000000000001', headers: { authorization: `Bearer ${token}` },
        payload: { transferSafeguard: null },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ error: 'transfer_safeguard_required' })
    })

    it('creates a processor agreement without an uploaded document', async () => {
      const insertedRow = {
        id: '20000000-6000-4000-8000-000000000001', organization_id: ORGANIZATION_ID, processor_name: 'Supabase', purpose: 'Hosting',
        signed_at: null, valid_until: null, document_path: null, status: 'pending', created_at: '2026-03-10T00:00:00Z',
      }
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'processor_agreements') return { insert: () => ({ select: () => ({ single: async () => ({ data: insertedRow, error: null }) }) }) }
              if (table === 'audit_events') return AUDIT_EVENTS_INSERT_OK
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: `/v1/organizations/${ORGANIZATION_ID}/processor-agreements`, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { processorName: 'Supabase', purpose: 'Hosting' },
      })
      expect(response.statusCode).toBe(201)
      expect(response.json()).toMatchObject({ processorName: 'Supabase', hasDocument: false })
    })

    // Regression: validUntil vor signedAt schlug bislang am CHECK-Constraint der Datenbank fehl
    // (500) statt an der Zod-Validierung (400).
    it('rejects a processor agreement whose validUntil is before signedAt', async () => {
      const app = await startApp({ roleProvider: organizationManagerRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: `/v1/organizations/${ORGANIZATION_ID}/processor-agreements`, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { processorName: 'Supabase', purpose: 'Hosting', signedAt: '2026-05-01', validUntil: '2025-01-01' },
      })
      expect(response.statusCode).toBe(400)
    })

    // Regression: signedAt ist im Update-Schema nicht setzbar -- ohne den Nachschlag gegen den
    // bestehenden Datensatz kam ein zu frueh gesetztes validUntil als unbehandelter 500 durch.
    it('rejects updating validUntil to before the existing signedAt', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'processor_agreements') return chain({ data: { organization_id: ORGANIZATION_ID, signed_at: '2026-01-01' }, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({}) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'PATCH', url: '/v1/processor-agreements/20000000-6000-4000-8000-000000000001', headers: { authorization: `Bearer ${token}` },
        payload: { validUntil: '2025-06-01' },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ error: 'valid_until_before_signed_at' })
    })

    it('returns not_found for a signed document url when no document was uploaded', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'processor_agreements') return chain({ data: { organization_id: ORGANIZATION_ID, document_path: null }, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({}) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: '/v1/processor-agreements/20000000-6000-4000-8000-000000000001/document-url', headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: 'no_document' })
    })

    it('signs a document url and records that it was viewed', async () => {
      let auditedAction: string | undefined
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'processor_agreements') return chain({ data: { organization_id: ORGANIZATION_ID, document_path: 'organizations/x/compliance/y/vertrag' }, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => { if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { auditedAction = row.action as string; return { error: null } } }; throw new Error(`unexpected table: ${table}`) },
            storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/vertrag.pdf' }, error: null }) }) },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: '/v1/processor-agreements/20000000-6000-4000-8000-000000000001/document-url', headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ signedUrl: 'https://signed.example/vertrag.pdf' })
      expect(auditedAction).toBe('processor_agreement.document_viewed')
    })
  })

  describe('manipulationssicherer Audit-Trail: sign/verify', () => {
    it('rejects signing the audit chain without organization.manage', async () => {
      const app = await startApp({ roleProvider: denyingRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/organizations/${ORGANIZATION_ID}/audit-chain/sign`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(403)
    })

    it('signs the current head hash and stores the signature', async () => {
      let inserted: Record<string, unknown> | undefined
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'audit_events') return chain({ data: { hash: 'abc123' }, error: null, count: 5 })
              if (table === 'audit_chain_signatures') {
                return { insert: (row: Record<string, unknown>) => { inserted = row; return { select: () => ({ single: async () => ({ data: { signed_at: '2026-03-10T00:00:00Z' }, error: null }) }) } } }
              }
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/organizations/${ORGANIZATION_ID}/audit-chain/sign`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(201)
      expect(inserted).toMatchObject({ head_hash: 'abc123' })
      expect(response.json()).toMatchObject({ headHash: 'abc123' })
    })

    it('verifies the audit chain and cryptographically confirms a genuine signature', async () => {
      const signer = createChainSigner({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1')
      const signed = signer.sign('abc123')
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'audit_chain_signatures') return chain({ data: { signed_at: '2026-03-01T00:00:00Z', head_hash: 'abc123', signature: signed.signature, key_version: signed.keyVersion }, error: null })
              // Der signierte Kopf-Hash muss weiterhin als hash einer audit_events-Zeile dieses
              // Vereins vorkommen, sonst waere die Kette trotz gueltiger Signatur manipuliert.
              if (table === 'audit_events') return chain({ data: [{ id: 'still-present' }], error: null })
              throw new Error(`unexpected table: ${table}`)
            },
            rpc: async (fn: string) => {
              if (fn === 'verify_audit_chain') return { data: [{ checked_count: 10, tampered_count: 0, unlinked_count: 1 }], error: null }
              throw new Error(`unexpected rpc: ${fn}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/audit-chain/verify`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ checkedCount: 10, tamperedCount: 0, unlinkedCount: 1, lastSignedAt: '2026-03-01T00:00:00Z', signatureValid: true })
    })

    // Deckt den Kern des Funds ab (adversariale Pruefung): wer Datenbankzugriff hat, kann
    // audit_chain_signatures.head_hash unbemerkt an eine faelschlich nachgerechnete Kette anpassen
    // -- aber nicht die Signatur, die den urspruenglichen head_hash mit dem externen Schluessel
    // bestaetigt hat. Ohne die kryptografische Pruefung waere das nie aufgefallen.
    it('flags a stored signature that no longer matches the stored head_hash', async () => {
      const signer = createChainSigner({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1')
      const signed = signer.sign('original-head-hash')
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'audit_chain_signatures') return chain({ data: { signed_at: '2026-03-01T00:00:00Z', head_hash: 'tampered-head-hash', signature: signed.signature, key_version: signed.keyVersion }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
            rpc: async (fn: string) => {
              if (fn === 'verify_audit_chain') return { data: [{ checked_count: 10, tampered_count: 0, unlinked_count: 0 }], error: null }
              throw new Error(`unexpected rpc: ${fn}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/audit-chain/verify`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ signatureValid: false })
    })

    it('reports signatureValid as null when the chain has never been signed', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'audit_chain_signatures') return chain({ data: null, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
            rpc: async (fn: string) => {
              if (fn === 'verify_audit_chain') return { data: [{ checked_count: 0, tampered_count: 0, unlinked_count: 0 }], error: null }
              throw new Error(`unexpected rpc: ${fn}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/audit-chain/verify`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ signatureValid: null, lastSignedAt: null })
    })
  })

  describe('GET /v1/organizations/:id/profile', () => {
    it('rejects reading the organization profile without organization.manage', async () => {
      const app = await startApp({ roleProvider: denyingRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/profile`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(403)
    })

    it('returns the organization profile so a form can be pre-filled before editing it', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () =>
          ({
            from: (table: string) => {
              if (table === 'organization_profiles') {
                return chain({
                  data: {
                    organization_id: ORGANIZATION_ID, legal_name: 'SV Nordstadt e.V.', legal_form: 'e_v', register_court: 'AG Musterstadt',
                    register_number: 'VR 1234', street: 'Vereinsweg', house_number: '1', postal_code: '12345', city: 'Musterstadt',
                    country_code: 'DE', contact_email: 'info@example.local', contact_phone: null, website_url: null, founded_year: 1921,
                    responsible_person_profile_id: null, imprint_published: false,
                  },
                  error: null,
                })
              }
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
        forService: () => ({}) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/profile`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ organizationId: ORGANIZATION_ID, legalName: 'SV Nordstadt e.V.', registerNumber: 'VR 1234' })
    })
  })

  describe('GET /v1/organizations/:id/imprint', () => {
    it('is reachable without authentication', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'organizations') return chain({ data: { name: 'SV Nordstadt' }, error: null })
              if (table === 'organization_profiles') return chain({ data: { legal_name: 'SV Nordstadt e.V.', legal_form: 'e_v', register_court: null, register_number: null, street: null, house_number: null, postal_code: null, city: null, country_code: 'DE', contact_email: 'info@example.local', contact_phone: null, website_url: null, responsible_person_profile_id: null, imprint_published: true }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/imprint` })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ organizationName: 'SV Nordstadt', legalName: 'SV Nordstadt e.V.' })
    })

    // Regression (adversariale Pruefung): ohne ausdrueckliche Freigabe darf diese Route keine
    // Kontakt-/Adress-/Registerangaben ausliefern, auch wenn organization_profiles befuellt ist.
    it('returns not_found when the organization has not published its imprint', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'organizations') return chain({ data: { name: 'SV Nordstadt' }, error: null })
              if (table === 'organization_profiles') return chain({ data: { legal_name: 'SV Nordstadt e.V.', legal_form: 'e_v', register_court: null, register_number: null, street: null, house_number: null, postal_code: null, city: null, country_code: 'DE', contact_email: 'info@example.local', contact_phone: null, website_url: null, responsible_person_profile_id: null, imprint_published: false }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/imprint` })
      expect(response.statusCode).toBe(404)
    })

    it('returns not_found for an unknown organization', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'organizations') return chain({ data: null, error: null })
              if (table === 'organization_profiles') return chain({ data: null, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/imprint` })
      expect(response.statusCode).toBe(404)
    })
  })

  describe('presserechtliche Verantwortung auf Kanaelen (§ 18 MStV)', () => {
    it('rejects naming an editorial responsible person who is not a member of the organization', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () =>
          ({ from: (table: string) => { if (table === 'social_connections') return chain({ data: { organization_id: ORGANIZATION_ID, owner_scope: 'organization', owner_department_id: null }, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({ from: () => membershipRowsStub([]) }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'PATCH', url: '/v1/channels/20000000-8000-4000-8000-000000000099', headers: { authorization: `Bearer ${token}` },
        payload: { editorialResponsibleProfileId: '20000000-0000-4000-8000-000000000099' },
      })
      expect(response.statusCode).toBe(422)
      expect(response.json()).toMatchObject({ error: 'editorial_responsible_not_a_member' })
    })

    it('rejects removing a membership when the person is named as editorial responsible on a channel', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () =>
          ({
            from: (table: string) => {
              if (table === 'organization_memberships') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, user_id: USER_ID, role: 'editor' }, error: null })
              if (table === 'organization_profiles') return chain({ data: { responsible_person_profile_id: null }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'social_connections') return chain({ data: [{ id: 'channel-1' }], error: null })
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'DELETE', url: `/v1/memberships/${MEMBERSHIP_ID}?scope=organization`, headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: 'editorial_responsible_cannot_be_removed' })
    })

    // Regression (adversariale Pruefung): ein archivierter/getrennter Kanal darf die Entfernung
    // nicht mehr blockieren, weil DELETE /v1/channels/:id die Zeile stehen laesst statt sie zu
    // loeschen -- ohne den archived_at-Filter waere die benannte Person dauerhaft unentfernbar.
    it('allows removing a membership when the only matching channel is archived', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () =>
          ({
            from: (table: string) => {
              if (table === 'organization_memberships') {
                return {
                  select: () => chain({ data: { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, user_id: USER_ID, role: 'editor' }, error: null }),
                  delete: () => ({ eq: () => ({ select: async () => ({ data: [{ id: MEMBERSHIP_ID }], error: null }) }) }),
                }
              }
              if (table === 'organization_profiles') return chain({ data: { responsible_person_profile_id: null }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'social_connections') return chain({ data: [], error: null })
              if (table === 'audit_events') return { insert: async () => ({ error: null }) }
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'DELETE', url: `/v1/memberships/${MEMBERSHIP_ID}?scope=organization`, headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(204)
    })
  })
})

describe('Paket 016: Auswertung: interne Kennzahlen', () => {
  // 'viewer' (denyingRoleProvider) hat analytics.view -- diese Permission ist an fast jede Rolle
  // vergeben (Plan, "Metrikdefinitionen"). 'contributor' ist eine der wenigen Rollen ganz ohne sie.
  const noAnalyticsViewRoleProvider: RoleProvider = { async rolesForScope() { return ['contributor'] } }

  // Deckt jede Rohtabelle ab, die die vier Endpunkte je nach Pfad lesen -- eine Anfrage ohne jede
  // Datenzeile ist der ehrliche Leerzustand eines gerade gestarteten Vereins (Plan, "coverage").
  // submissions wird zweifach abgefragt: loadMeasurementStart schliesst mit maybeSingle() ab (leer
  // = null), jeder andere Aufruf mit fetchAllRows()/range() (leer = []) -- chain() liefert immer
  // dasselbe fixe Ergebnis, unabhaengig vom Abschluss, kann also nicht beides zugleich richtig
  // bedienen. Ein eigener Fake mit unterschiedlichen Antworten je Abschlussmethode.
  function emptySubmissions(): PromiseLike<{ data: unknown; error: unknown }> & Record<string, unknown> {
    const builder: Record<string, unknown> = {
      eq: () => builder, in: () => builder, order: () => builder, limit: () => builder, range: () => builder, select: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => resolve({ data: [], error: null }),
    }
    return builder as PromiseLike<{ data: unknown; error: unknown }> & Record<string, unknown>
  }
  function emptyAnalyticsService(timezone = 'Europe/Berlin'): SupabaseClient {
    return {
      from: (table: string) => {
        if (table === 'organizations') return chain({ data: { timezone }, error: null })
        if (table === 'submissions') return emptySubmissions()
        if (
          ['posts', 'post_status_events', 'approval_requests', 'approval_decisions', 'post_versions', 'publications', 'workflow_runs', 'channel_quotas', 'departments', 'teams', 'social_connections'].includes(
            table,
          )
        ) {
          return chain({ data: [], error: null })
        }
        throw new Error(`unexpected table: ${table}`)
      },
      rpc: async (fn: string) => {
        if (fn === 'count_publications_in_period') return { data: 0, error: null }
        throw new Error(`unexpected rpc: ${fn}`)
      },
    } as unknown as SupabaseClient
  }
  // Fuer assertAnalyticsScopeConsistency: departments_select_member laesst ein Mitglied die eigene
  // Abteilung sehen (RLS) -- der Fake bildet nur genau das ab, was fuer DEPARTMENT_ID/TEAM_ID in
  // diesen Tests gebraucht wird.
  function membershipClient(): SupabaseClient {
    return {
      from: (table: string) => {
        if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
        if (table === 'teams') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }, error: null })
        throw new Error(`unexpected table: ${table}`)
      },
    } as unknown as SupabaseClient
  }
  function analyticsClients(timezone = 'Europe/Berlin'): SupabaseClientFactory {
    return { forUser: () => membershipClient(), forService: () => emptyAnalyticsService(timezone) }
  }

  describe('GET /v1/analytics/summary', () => {
    it('rejects a request without analytics.view', async () => {
      const app = await startApp({ roleProvider: noAnalyticsViewRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET', url: `/v1/analytics/summary?organizationId=${ORGANIZATION_ID}&from=2026-07-01&to=2026-07-31`, headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(403)
    })

    it('rejects a range spanning more than 24 months', async () => {
      const app = await startApp({ roleProvider: grantingRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET', url: `/v1/analytics/summary?organizationId=${ORGANIZATION_ID}&from=2020-01-01&to=2026-07-01`, headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(400)
    })

    it('returns an honest empty state (no fabricated zero disguised as a real count) for a club with no data yet', async () => {
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: analyticsClients() })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET', url: `/v1/analytics/summary?organizationId=${ORGANIZATION_ID}&from=2026-07-01&to=2026-07-31`, headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        coverage: { measurementStartsAt: null, requestedFrom: '2026-07-01', requestedTo: '2026-07-31' },
        postsCreated: 0, postsCreatedTrend: null,
        postsPublished: 0, publicationsPublished: 0, publicationsFailed: 0,
        approvalRate: null, leadTimeSecondsMedian: null, approvalSecondsMedian: null,
        activeDepartments: 0, quotas: [],
      })
    })

    it('returns activeDepartments as null when the request is already scoped to one department', async () => {
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: analyticsClients() })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET',
        url: `/v1/analytics/summary?organizationId=${ORGANIZATION_ID}&departmentId=${DEPARTMENT_ID}&from=2026-07-01&to=2026-07-31`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ activeDepartments: null })
    })

    // Adversariale Pruefung: auth.ts' rolesForScope prueft organization_memberships und
    // department_memberships unabhaengig voneinander, ohne je zu pruefen, dass die Abteilung
    // ueberhaupt zur angegebenen organizationId gehoert. Ohne assertAnalyticsScopeConsistency
    // (apps/api/src/app.ts) haette ein Aufrufer mit einer echten Abteilungsrolle (analytics.view)
    // im eigenen Verein eine FREMDE organizationId einsetzen und ueber Endpunkte, die (anders als
    // die meisten Loader hier) nicht zusammengesetzt nach organization_id UND department_id
    // filtern -- etwa die Kontingentauslastung --, echte Daten eines fremden Vereins abrufen
    // koennen.
    it('rejects a departmentId that belongs to a different organization than the one requested', async () => {
      const foreignOrganizationId = '90000000-1000-4000-8000-000000000099'
      const clients: SupabaseClientFactory = {
        forUser: () =>
          ({
            from: (table: string) => {
              if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
        // Darf gar nicht aufgerufen werden -- die Konsistenzpruefung muss VOR jedem
        // Service-Role-Zugriff ablehnen.
        forService: (): SupabaseClient => { throw new Error('service client must not be constructed before the scope-consistency check rejects the request') },
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET',
        url: `/v1/analytics/summary?organizationId=${foreignOrganizationId}&departmentId=${DEPARTMENT_ID}&from=2026-07-01&to=2026-07-31`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(404)
    })
  })

  describe('GET /v1/analytics/timeseries', () => {
    it('rejects a teamId without a departmentId', async () => {
      const app = await startApp({ roleProvider: grantingRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET',
        url: `/v1/analytics/timeseries?organizationId=${ORGANIZATION_ID}&teamId=${TEAM_ID}&from=2026-07-01&to=2026-07-31&metric=postsCreated`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(400)
    })

    it('returns one zero-valued point per day for an empty club, defaulting granularity to day', async () => {
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: analyticsClients() })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET', url: `/v1/analytics/timeseries?organizationId=${ORGANIZATION_ID}&from=2026-07-01&to=2026-07-03&metric=postsCreated`, headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { granularity: string; points: { bucketStart: string; value: number }[] }
      expect(body.granularity).toBe('day')
      expect(body.points).toEqual([
        { bucketStart: '2026-07-01', value: 0 }, { bucketStart: '2026-07-02', value: 0 }, { bucketStart: '2026-07-03', value: 0 },
      ])
    })
  })

  describe('GET /v1/analytics/breakdown', () => {
    it('rejects a request without analytics.view', async () => {
      const app = await startApp({ roleProvider: noAnalyticsViewRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET', url: `/v1/analytics/breakdown?organizationId=${ORGANIZATION_ID}&from=2026-07-01&to=2026-07-31&dimension=preset`, headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(403)
    })

    it('counts submissions by preset within the window, sorted by count descending', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'organizations') return chain({ data: { timezone: 'Europe/Berlin' }, error: null })
              if (table === 'submissions') {
                // loadMeasurementStart schliesst mit maybeSingle() ab (nicht relevant fuer diesen
                // Test, deshalb null), die Aufschluesselung selbst mit range()/then() -- ein
                // einzelnes chain()-Ergebnis kann nicht beides zugleich richtig bedienen.
                const rows = [
                  { id: 's1', department_id: DEPARTMENT_ID, team_id: null, preset_slug: 'match_result', communication_goal: 'inform', requested_formats: ['feed_image'], created_at: '2026-07-10T10:00:00Z' },
                  { id: 's2', department_id: DEPARTMENT_ID, team_id: null, preset_slug: 'match_result', communication_goal: 'inform', requested_formats: ['feed_image'], created_at: '2026-07-11T10:00:00Z' },
                  { id: 's3', department_id: DEPARTMENT_ID, team_id: null, preset_slug: 'event', communication_goal: 'invite', requested_formats: ['story'], created_at: '2026-07-12T10:00:00Z' },
                  // ausserhalb des Zeitraums -- darf nicht mitgezaehlt werden.
                  { id: 's4', department_id: DEPARTMENT_ID, team_id: null, preset_slug: 'event', communication_goal: 'invite', requested_formats: ['story'], created_at: '2026-01-01T10:00:00Z' },
                ]
                const builder: Record<string, unknown> = {
                  eq: () => builder, in: () => builder, order: () => builder, limit: () => builder, range: () => builder, select: () => builder,
                  maybeSingle: async () => ({ data: null, error: null }),
                  then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => resolve({ data: rows, error: null }),
                }
                return builder
              }
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET', url: `/v1/analytics/breakdown?organizationId=${ORGANIZATION_ID}&from=2026-07-01&to=2026-07-31&dimension=preset`, headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(200)
      expect((response.json() as { entries: unknown[] }).entries).toEqual([
        { key: 'match_result', label: 'match_result', count: 2 },
        { key: 'event', label: 'event', count: 1 },
      ])
    })
  })

  describe('GET /v1/analytics/funnel', () => {
    it('rejects a request without analytics.view', async () => {
      const app = await startApp({ roleProvider: noAnalyticsViewRoleProvider })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET', url: `/v1/analytics/funnel?organizationId=${ORGANIZATION_ID}&from=2026-07-01&to=2026-07-31`, headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(403)
    })

    it('returns all five stages at zero for an empty club', async () => {
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: analyticsClients() })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET', url: `/v1/analytics/funnel?organizationId=${ORGANIZATION_ID}&from=2026-07-01&to=2026-07-31`, headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(200)
      expect((response.json() as { stages: unknown[] }).stages).toEqual([
        { stage: 'draft', count: 0 }, { stage: 'approval_requested', count: 0 }, { stage: 'approved', count: 0 },
        { stage: 'scheduled', count: 0 }, { stage: 'published', count: 0 },
      ])
    })

    it('computes real stage counts from posts and their status history, dropping later posts off earlier in the funnel', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'organizations') return chain({ data: { timezone: 'Europe/Berlin' }, error: null })
              if (table === 'submissions') return chain({ data: null, error: null })
              if (table === 'posts') {
                return chain({
                  data: [
                    { id: 'p1', created_at: '2026-07-10T08:00:00Z', department_id: DEPARTMENT_ID },
                    { id: 'p2', created_at: '2026-07-11T08:00:00Z', department_id: DEPARTMENT_ID },
                  ],
                  error: null,
                })
              }
              if (table === 'post_status_events') {
                return chain({
                  data: [
                    // p1 durchlaeuft die ganze Route bis zur Veroeffentlichung.
                    { post_id: 'p1', to_status: 'awaiting_approval', occurred_at: '2026-07-10T09:00:00Z' },
                    { post_id: 'p1', to_status: 'approved', occurred_at: '2026-07-10T10:00:00Z' },
                    { post_id: 'p1', to_status: 'scheduled', occurred_at: '2026-07-10T10:30:00Z' },
                    { post_id: 'p1', to_status: 'published', occurred_at: '2026-07-10T11:00:00Z' },
                    // p2 bleibt in der Freigabe stehen.
                    { post_id: 'p2', to_status: 'awaiting_approval', occurred_at: '2026-07-11T09:00:00Z' },
                  ],
                  error: null,
                })
              }
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'GET', url: `/v1/analytics/funnel?organizationId=${ORGANIZATION_ID}&from=2026-07-01&to=2026-07-31`, headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode).toBe(200)
      expect((response.json() as { stages: unknown[] }).stages).toEqual([
        { stage: 'draft', count: 2 }, { stage: 'approval_requested', count: 2 }, { stage: 'approved', count: 1 },
        { stage: 'scheduled', count: 1 }, { stage: 'published', count: 1 },
      ])
    })
  })
})
