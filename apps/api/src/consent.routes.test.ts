import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, ORGANIZATION_ID, USER_ID, chain, denyingRoleProvider, grantingRoleProvider, organizationManagerRoleProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'
import { addMonthsToIsoDate, hashPublicToken } from './services/consent.js'

describe('Paket 015: Einwilligungsverwaltung', () => {
  const CONSENT_ID = '15000000-4000-4000-8000-000000000001'
  const DIRECTORY_PERSON_ID = '15000000-3000-4000-8000-000000000001'
  const CONSENT_REQUEST_ID = '15000000-5000-4000-8000-000000000001'
  const CONSENT_RECORD_ID = '15000000-6000-4000-8000-000000000001'

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

  it('refuses to supersede a revoked consent record instead of silently undoing the revocation', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_records') return chain({ data: consentRecordRow({ revoked_at: '2026-08-01T00:00:00Z', revoked_by: 'guardian' }), error: null })
            if (table === 'directory_people') return chain({ data: { department_id: DEPARTMENT_ID }, error: null })
            throw new Error(`unexpected table: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('a revoked consent must not get a successor') },
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: `/v1/consents/${CONSENT_ID}/supersede`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: 'Fotos fuer Social Media', scopeStructured: { purposes: ['social_media'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false, departmentIds: null },
        signedAt: '2026-08-01', signerName: 'Erika Musterfrau', signerRole: 'guardian', guardianConfirmed: true,
      },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'already_revoked' })
  })

  const TWELVE_MONTH_POLICY = { data: [{ scope: 'organization', department_id: null, consent_validity_months: 12 }], error: null }

  it('registers an old paper form with its validity window anchored on the signature date', async () => {
    let insertedRow: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'directory_people') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, is_minor: false }, error: null })
            if (table === 'policy_settings') return chain(TWELVE_MONTH_POLICY)
            throw new Error(`unexpected table: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          storage: { from: () => ({ upload: async () => ({ error: null }) }) },
          from: (table: string) => {
            if (table === 'consent_records') return { insert: (row: Record<string, unknown>) => { insertedRow = row; return chain({ data: consentRecordRow({ id: row.id, signed_at: row.signed_at, valid_from: row.valid_from, valid_until: row.valid_until }), error: null }) } }
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const { boundary, body } = consentUploadBody({ ...consentScopeAndFields(), signedAt: '2020-03-15' })
    const response = await app.inject({
      method: 'POST', url: '/v1/consents',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    // Mit valid_from = now() verletzte valid_until (Unterschrift + 12 Monate) den CHECK
    // valid_until > valid_from und endete als 500.
    expect(response.statusCode).toBe(201)
    expect(insertedRow).toMatchObject({ valid_from: '2020-03-15T00:00:00.000Z', valid_until: '2021-03-15T00:00:00.000Z' })
    expect(response.json()).toMatchObject({ status: 'expired' })
  })

  it('applies the consent validity policy to a superseding version', async () => {
    let insertedRow: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_records') return chain({ data: consentRecordRow(), error: null })
            if (table === 'directory_people') return chain({ data: { department_id: DEPARTMENT_ID, is_minor: false }, error: null })
            if (table === 'policy_settings') return chain(TWELVE_MONTH_POLICY)
            throw new Error(`unexpected table: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_records') {
              return {
                select: () => chain({ data: { evidence_bucket: 'raw-media', evidence_path: `organizations/${ORGANIZATION_ID}/consents/${CONSENT_ID}/nachweis` }, error: null }),
                insert: (row: Record<string, unknown>) => { insertedRow = row; return chain({ data: consentRecordRow({ id: row.id, valid_from: row.valid_from, valid_until: row.valid_until }), error: null }) },
                update: () => chain({ data: { id: CONSENT_ID }, error: null }),
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
      method: 'POST', url: `/v1/consents/${CONSENT_ID}/supersede`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: 'Fotos fuer Social Media', scopeStructured: { purposes: ['social_media'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false, departmentIds: null },
        signedAt: '2026-08-01', signerName: 'Erika Musterfrau', signerRole: 'guardian', guardianConfirmed: true,
      },
    })
    expect(response.statusCode).toBe(201)
    expect(insertedRow).toMatchObject({ valid_from: '2026-08-01T00:00:00.000Z', valid_until: '2027-08-01T00:00:00.000Z' })
  })

  // Wie chain(), protokolliert aber jeden Aufruf samt Argumenten -- fuer Tests, die pruefen, WELCHE
  // Filter eine Route an ein Update haengt.
  function recordingChain(result: { data: unknown; error: unknown }, calls: unknown[][]) {
    const builder: Record<string, unknown> = {}
    for (const method of ['eq', 'is', 'in', 'lt', 'gte', 'order', 'limit', 'range', 'select']) {
      builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder }
    }
    builder.maybeSingle = async () => result
    builder.single = async () => result
    builder.then = (resolve: (value: unknown) => unknown) => resolve(result)
    return builder
  }
  const noopEmailSender = { send: async () => undefined }

  it('retires an expired open request before creating a new one for the same address', async () => {
    const events: string[] = []
    const expireCalls: unknown[][] = []
    let expireValues: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'directory_people') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, first_name: 'Max', last_name: 'Mustermann', is_minor: false }, error: null })
            throw new Error(`unexpected table: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_requests') {
              return {
                update: (values: Record<string, unknown>) => { events.push('expire'); expireValues = values; return recordingChain({ data: null, error: null }, expireCalls) },
                insert: () => { events.push('insert'); return chain({ data: openConsentRequestRow(), error: null }) },
              }
            }
            if (table === 'organization_consent_texts') return chain({ data: null, error: null })
            if (table === 'organizations') return chain({ data: { name: 'TSV Musterstadt' }, error: null })
            if (table === 'audit_events') return { insert: async () => ({ error: null }) }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients, emailSender: noopEmailSender })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/consent-requests', headers: { authorization: `Bearer ${token}` },
      payload: {
        organizationId: ORGANIZATION_ID, directoryPersonId: DIRECTORY_PERSON_ID, recipientEmail: 'x@example.local', recipientRole: 'guardian',
        requestedScope: { purposes: ['social_media'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false, departmentIds: null },
      },
    })
    expect(response.statusCode).toBe(201)
    expect(events).toEqual(['expire', 'insert'])
    expect(expireValues).toEqual({ status: 'expired' })
    expect(expireCalls).toEqual(expect.arrayContaining([
      ['eq', 'organization_id', ORGANIZATION_ID], ['eq', 'directory_person_id', DIRECTORY_PERSON_ID], ['eq', 'recipient_email', 'x@example.local'], ['eq', 'status', 'sent'],
    ]))
    expect(expireCalls.some(([method, column]) => method === 'lt' && column === 'expires_at')).toBe(true)
  })

  it('gives a resent request a fresh expiry and guards the update against a concurrent answer or resend', async () => {
    const updateCalls: unknown[][] = []
    let updateValues: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_requests') return chain({ data: openConsentRequestRow({ send_count: 2, expires_at: '2026-01-01T00:00:00Z' }), error: null })
            throw new Error(`unexpected table: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            // Null getroffene Zeilen: eine gleichzeitige Antwort oder ein zweiter Versand war schneller.
            if (table === 'consent_requests') return { update: (values: Record<string, unknown>) => { updateValues = values; return recordingChain({ data: null, error: null }, updateCalls) } }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients, emailSender: noopEmailSender })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'POST', url: `/v1/consent-requests/${CONSENT_REQUEST_ID}/resend`, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'request_not_open' })
    expect(updateValues).toMatchObject({ send_count: 3 })
    expect(Date.parse(updateValues?.expires_at as string)).toBeGreaterThan(Date.now() + 13 * 24 * 60 * 60 * 1000)
    expect(updateCalls).toEqual(expect.arrayContaining([['eq', 'status', 'sent'], ['eq', 'send_count', 2]]))
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

  it('records and audits a decline without creating a consent record', async () => {
    let consentRecordsTouched = false
    const auditRows: Record<string, unknown>[] = []
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
                // Der Compare-and-Set auf status='sent' liefert die getroffene Zeile zurueck --
                // daran erkennt die Route, ob sie das Rennen gegen eine gleichzeitige Antwort
                // gewonnen hat.
                update: () => chain({ data: { id: CONSENT_REQUEST_ID }, error: null }),
              }
            }
            if (table === 'consent_records') { consentRecordsTouched = true; throw new Error('must not be touched on decline') }
            if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { auditRows.push(row); return { error: null } } }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({ method: 'POST', url: '/v1/consent-requests/by-token/some-token/respond', payload: { decision: 'declined' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'declined' })
    expect(consentRecordsTouched).toBe(false)
    expect(auditRows).toEqual([expect.objectContaining({ action: 'consent_request.declined_via_public_link', actor_user_id: null, entity_type: 'consent_requests', entity_id: CONSENT_REQUEST_ID })])
  })

  // Zwei gleichzeitige Antworten auf dieselbe Einwilligungsanfrage: die Verliererin des
  // Compare-and-Set darf weder "abgelehnt" melden, obwohl eingewilligt wurde, noch eine zweite,
  // an keine Anfrage gebundene consent_records-Zeile zuruecklassen (gefunden im Code-Review).
  it('reports the uniform invalid response when a concurrent answer already decided the request', async () => {
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
                // Null Zeilen getroffen: eine parallele Anfrage war schneller.
                update: () => chain({ data: null, error: null }),
              }
            }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({ method: 'POST', url: '/v1/consent-requests/by-token/race-token/respond', payload: { decision: 'declined' } })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'invalid_or_expired' })
  })

  it('removes the freshly created consent record when a concurrent answer wins the grant', async () => {
    const deletedConsentIds: string[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_requests') {
              return {
                select: () => chain({
                  data: { id: CONSENT_REQUEST_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, directory_person_id: DIRECTORY_PERSON_ID, recipient_email: 'x@example.local', recipient_role: 'guardian', requested_scope: { purposes: ['social_media'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false, departmentIds: null }, text_version: 'v1', status: 'sent', expires_at: '2099-01-01T00:00:00Z', responded_at: null, consent_record_id: null, send_count: 1, last_sent_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z', created_by: USER_ID },
                  error: null,
                }),
                update: () => chain({ data: null, error: null }),
              }
            }
            if (table === 'directory_people') return { select: () => chain({ data: { is_minor: false }, error: null }) }
            if (table === 'policy_settings') return chain({ data: [], error: null })
            if (table === 'consent_records') {
              return {
                insert: () => chain({ data: { id: CONSENT_RECORD_ID, organization_id: ORGANIZATION_ID }, error: null }),
                delete: () => ({ eq: async (_column: string, value: string) => { deletedConsentIds.push(value); return { error: null } } }),
              }
            }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({ method: 'POST', url: '/v1/consent-requests/by-token/race-grant-token/respond', payload: { decision: 'granted' } })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'invalid_or_expired' })
    expect(deletedConsentIds).toHaveLength(1)
  })

  function openConsentRequestRow(overrides: Record<string, unknown> = {}) {
    return {
      id: CONSENT_REQUEST_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, directory_person_id: DIRECTORY_PERSON_ID, recipient_email: 'x@example.local',
      recipient_role: 'guardian', requested_scope: { purposes: ['social_media'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false, departmentIds: null },
      text_version: 'default-template', status: 'sent', expires_at: '2099-01-01T00:00:00Z', responded_at: null, consent_record_id: null, send_count: 1,
      last_sent_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z', created_by: USER_ID,
      ...overrides,
    }
  }

  function grantingServiceClient(captured: { consentRow?: Record<string, unknown>; auditRows: Record<string, unknown>[] }, options: { isMinor?: boolean; requestRow?: Record<string, unknown> } = {}) {
    return {
      from: (table: string) => {
        if (table === 'consent_requests') return { select: () => chain({ data: options.requestRow ?? openConsentRequestRow(), error: null }), update: () => chain({ data: { id: CONSENT_REQUEST_ID }, error: null }) }
        if (table === 'directory_people') return { select: () => chain({ data: { is_minor: options.isMinor ?? false }, error: null }) }
        if (table === 'policy_settings') return chain({ data: [{ scope: 'organization', department_id: null, consent_validity_months: 12 }], error: null })
        if (table === 'consent_records') {
          return { insert: (row: Record<string, unknown>) => { captured.consentRow = row; return chain({ data: { id: row.id, organization_id: ORGANIZATION_ID }, error: null }) } }
        }
        if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { captured.auditRows.push(row); return { error: null } } }
        throw new Error(`unexpected table in service fake: ${table}`)
      },
    } as unknown as SupabaseClient
  }

  it('applies the consent validity policy to a digitally granted consent', async () => {
    const captured: { consentRow?: Record<string, unknown>; auditRows: Record<string, unknown>[] } = { auditRows: [] }
    const app = await startApp({ supabaseClients: { forUser: () => ({}) as unknown as SupabaseClient, forService: () => grantingServiceClient(captured) } })
    const response = await app.inject({ method: 'POST', url: '/v1/consent-requests/by-token/grant-token/respond', payload: { decision: 'granted' } })
    expect(response.statusCode).toBe(200)
    const today = new Date().toISOString().slice(0, 10)
    expect(captured.consentRow).toMatchObject({ signed_at: today, valid_until: addMonthsToIsoDate(today, 12) })
  })

  it('refuses a self grant once the person is recorded as a minor', async () => {
    const captured: { consentRow?: Record<string, unknown>; auditRows: Record<string, unknown>[] } = { auditRows: [] }
    const service = grantingServiceClient(captured, { isMinor: true, requestRow: openConsentRequestRow({ recipient_role: 'self' }) })
    const app = await startApp({ supabaseClients: { forUser: () => ({}) as unknown as SupabaseClient, forService: () => service } })
    const response = await app.inject({ method: 'POST', url: '/v1/consent-requests/by-token/self-grant-token/respond', payload: { decision: 'granted' } })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'guardian_required_for_minor' })
    expect(captured.consentRow).toBeUndefined()
  })

  it('audits a public grant as an external action without an account', async () => {
    const captured: { consentRow?: Record<string, unknown>; auditRows: Record<string, unknown>[] } = { auditRows: [] }
    const app = await startApp({ supabaseClients: { forUser: () => ({}) as unknown as SupabaseClient, forService: () => grantingServiceClient(captured) } })
    const response = await app.inject({ method: 'POST', url: '/v1/consent-requests/by-token/grant-token/respond', payload: { decision: 'granted' } })
    expect(response.statusCode).toBe(200)
    expect(captured.auditRows).toEqual([
      expect.objectContaining({ action: 'consent.granted_via_public_link', actor_user_id: null, entity_type: 'consent_records', entity_id: captured.consentRow?.id, metadata: { consentRequestId: CONSENT_REQUEST_ID } }),
    ])
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

  // Filtert die Zeilen tatsaechlich nach eq()/is(), damit ein Test sehen kann, WELCHE Zeile eine
  // Route liest oder aendert -- chain() ignoriert jeden Filter.
  function filteringConsentRecordsTable(rows: Record<string, unknown>[], updates: { values: Record<string, unknown>; filters: Record<string, unknown> }[]) {
    function builder(onResult: (filters: Record<string, unknown>) => unknown) {
      const filters: Record<string, unknown> = {}
      const query: Record<string, unknown> = {
        eq: (column: string, value: unknown) => { filters[column] = value; return query },
        is: (column: string, value: unknown) => { filters[column] = value; return query },
        select: () => query,
        maybeSingle: async () => ({ data: onResult(filters) ?? null, error: null }),
        single: async () => ({ data: onResult(filters) ?? null, error: null }),
      }
      return query
    }
    const matches = (row: Record<string, unknown>, filters: Record<string, unknown>) => Object.entries(filters).every(([column, value]) => row[column] === value)
    return {
      select: () => builder((filters) => rows.find((row) => matches(row, filters))),
      update: (values: Record<string, unknown>) => builder((filters) => {
        const row = rows.find((candidate) => matches(candidate, filters))
        if (!row) return null
        updates.push({ values, filters })
        Object.assign(row, values)
        return { id: row.id }
      }),
    }
  }

  it('revokes the head of the supersede chain, not the superseded row the public link was issued for', async () => {
    const SUCCESSOR_ID = '15000000-4000-4000-8000-000000000002'
    const rows = [
      consentRecordRow({ origin: 'digital', signer_role: 'self', guardian_confirmed: false, superseded_by: SUCCESSOR_ID, revocation_token_hash: hashPublicToken('revocation-token') }),
      consentRecordRow({ id: SUCCESSOR_ID, origin: 'digital', signer_role: 'self', guardian_confirmed: false }),
    ]
    const updates: { values: Record<string, unknown>; filters: Record<string, unknown> }[] = []
    const auditRows: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'consent_records') return filteringConsentRecordsTable(rows, updates)
            if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { auditRows.push(row); return { error: null } } }
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({ method: 'POST', url: '/v1/consents/by-revocation-token/revocation-token' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'revoked' })
    expect(updates).toHaveLength(1)
    expect(updates[0]?.filters).toMatchObject({ id: SUCCESSOR_ID, revoked_at: null, superseded_by: null })
    // Die Anfrage ging an die volljaehrige Person selbst -- sie hat widerrufen, kein Elternteil.
    expect(updates[0]?.values).toMatchObject({ revoked_by: 'self' })
    expect(auditRows[0]).toMatchObject({ action: 'consent.revoked_via_public_link', actor_user_id: null, entity_id: SUCCESSOR_ID })
  })
})

// Plan 045, PR 0 Schritt 3: die Foto-Markier-UI braucht dieselbe Einwilligungsliste, die bisher nur
// consent.manage (Vereinsverwaltung) einsehen durfte -- wer eine Box markieren darf (post.edit),
// muss verknuepfen koennen, ohne eine Vereinsverwaltung zu bemuehen. Betreiberentscheidung, 2026-08-18.
describe('GET /v1/consents -- post.edit access (Plan 045)', () => {
  it('rejects a caller with neither consent.manage nor post.edit', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: { forUser: () => ({}) as unknown as SupabaseClient, forService: () => { throw new Error('forService should not be reached') } } as unknown as SupabaseClientFactory })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: `/v1/consents?organizationId=${ORGANIZATION_ID}`, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(403)
  })

  it('allows a plain editor (post.edit, no consent.manage) to list consents', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () => ({ from: (table: string) => { if (table === 'consent_records') return chain({ data: [], error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: `/v1/consents?organizationId=${ORGANIZATION_ID}`, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(200)
  })

  it('rejects a post.edit caller scoped to another department before reading that person\'s consents', async () => {
    const otherDepartmentId = '15000000-1100-4000-8000-000000000099'
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: (table: string) => {
        if (table === 'directory_people') return chain({ data: { organization_id: ORGANIZATION_ID, department_id: otherDepartmentId }, error: null })
        throw new Error(`unexpected user table: ${table}`)
      } }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService must not read cross-department consents') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: `/v1/consents?organizationId=${ORGANIZATION_ID}&departmentId=${DEPARTMENT_ID}&directoryPersonId=15000000-3000-4000-8000-000000000001`, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'directory_person_not_found' })
  })
})
