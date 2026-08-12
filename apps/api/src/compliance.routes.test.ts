import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, MEMBERSHIP_ID, ORGANIZATION_ID, USER_ID, chain, denyingRoleProvider, membershipRowsStub, organizationManagerRoleProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'
import { createChainSigner } from '@vereinsfunk/secrets'

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

