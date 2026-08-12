import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, ORGANIZATION_ID, USER_ID, chain, denyingRoleProvider, organizationManagerRoleProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

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
                // Der Compare-and-Set auf status='sent' liefert die getroffene Zeile zurueck --
                // daran erkennt die Route, ob sie das Rennen gegen eine gleichzeitige Antwort
                // gewonnen hat.
                update: () => chain({ data: { id: CONSENT_REQUEST_ID }, error: null }),
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
                  data: { id: CONSENT_REQUEST_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, directory_person_id: DIRECTORY_PERSON_ID, recipient_email: 'x@example.local', recipient_role: 'guardian', requested_scope: { purposes: ['social_media'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false }, text_version: 'v1', status: 'sent', expires_at: '2099-01-01T00:00:00Z', responded_at: null, consent_record_id: null, send_count: 1, last_sent_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z', created_by: USER_ID },
                  error: null,
                }),
                update: () => chain({ data: null, error: null }),
              }
            }
            if (table === 'directory_people') return { select: () => chain({ data: { is_minor: false }, error: null }) }
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

