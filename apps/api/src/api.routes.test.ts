import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, ORGANIZATION_ID, USER_ID, chain, denyingRoleProvider, draftCreationServiceClient, grantingRoleProvider, organizationManagerRoleProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'
import { SignJWT } from 'jose'

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

  // Der JSON-Parser scheitert, bevor irgendein Handler laeuft -- der Fehler landet also im
  // generischen Fehler-Handler, der bis dahin jeden Status auf 500 zog. Eine kaputte Anfrage als
  // Serverfehler zu melden ist nicht nur fuer den Aufrufer falsch, es macht auch echte 500er in der
  // Ueberwachung unsichtbar.
  it('answers a malformed JSON body with 400, not 500', async () => {
    const app = await startApp()
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { 'content-type': 'application/json' },
      payload: '{"organizationId":',
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
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
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="organizationId"\r\n\r\n${ORGANIZATION_ID}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nlogo_primary\r\n`),
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

  it('rejects a logo upload exceeding the size limit with 413, not an unhandled 500', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const boundary = '----vereinsfunkTestBoundaryLarge'
    const oversized = Buffer.alloc(9 * 1024 * 1024, 0x41)
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="organizationId"\r\n\r\n${ORGANIZATION_ID}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nlogo_primary\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`),
      oversized,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/v1/brand/assets',
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

