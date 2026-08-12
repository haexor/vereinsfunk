import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, ORGANIZATION_ID, TEAM_ID, USER_ID, chain, denyingRoleProvider, draftCreationServiceClient, grantingRoleProvider, organizationManagerRoleProvider, readField, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

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

