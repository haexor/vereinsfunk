import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, ORGANIZATION_ID, USER_ID, chain, denyingRoleProvider, grantingRoleProvider, organizationManagerRoleProvider, readField, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'
import type { RoleProvider } from './auth.js'

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
    // abgerufen wird sie aus dem Netz der API (siehe @vereinsfunk/outbound-fetch). Der Wert darf gar nicht
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

