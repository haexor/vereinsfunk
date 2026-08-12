import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, ORGANIZATION_ID, TEAM_ID, USER_ID, chain, grantingRoleProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'
import type { RoleProvider } from './auth.js'

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
