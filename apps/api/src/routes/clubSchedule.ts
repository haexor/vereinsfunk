import { ContentSuggestionsResponseSchema, UuidSchema, type ContentSuggestion } from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CLUB_EVENT_COLUMNS, FIXTURE_COLUMNS, mapClubEventRow, mapFixtureRow } from '../apiMappers.js'
import type { ApiRouteContext } from './context.js'
import { fetchAllRows, toPermissionScope } from './shared.js'

export function registerClubScheduleRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context

  // --- Paket 019: Mannschaften, Spielplaene, Ergebnisse und Veranstaltungen ------------------
  //
  // Lesezugriff laeuft ueber den Nutzer-Client -- fixtures_select/club_events_select sind
  // vereinsweit (authz.is_any_member_of_organization), kein eigener requirePermission-Aufruf
  // noetig, genau wie bei GET .../directory-people unten. Schreibzugriff (dismiss) verlangt
  // post.create im betroffenen Scope, weil eine weggeklickte Vorschlagszeile nur relevant ist,
  // wenn man selbst Beitraege erstellen kann.

  app.get('/v1/organizations/:id/fixtures', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z
      .object({ departmentId: UuidSchema.optional(), teamId: UuidSchema.optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() })
      .parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    let builder = client
      .from('fixtures')
      .select(FIXTURE_COLUMNS)
      .eq('organization_id', params.id)
    if (query.departmentId) builder = builder.eq('department_id', query.departmentId)
    if (query.teamId) builder = builder.eq('team_id', query.teamId)
    if (query.from) builder = builder.gte('kickoff_at', query.from)
    if (query.to) builder = builder.lte('kickoff_at', query.to)
    const rows = await builder.order('kickoff_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map(mapFixtureRow))
  })

  app.get('/v1/organizations/:id/club-events', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z
      .object({ departmentId: UuidSchema.optional(), teamId: UuidSchema.optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() })
      .parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    let builder = client
      .from('club_events')
      .select(CLUB_EVENT_COLUMNS)
      .eq('organization_id', params.id)
    if (query.departmentId) builder = builder.eq('department_id', query.departmentId)
    if (query.teamId) builder = builder.eq('team_id', query.teamId)
    if (query.from) builder = builder.gte('starts_at', query.from)
    if (query.to) builder = builder.lte('starts_at', query.to)
    const rows = await builder.order('starts_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map(mapClubEventRow))
  })

  app.post('/v1/fixtures/:id/dismiss-announcement', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('fixtures').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string)))) return
    const update = await supabaseClients.forService().from('fixtures').update({ announcement_dismissed_at: new Date().toISOString() }).eq('id', params.id).select(FIXTURE_COLUMNS).single()
    if (update.error) throw update.error
    return reply.code(200).send(mapFixtureRow(update.data))
  })

  app.post('/v1/fixtures/:id/dismiss-result', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('fixtures').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string)))) return
    const update = await supabaseClients.forService().from('fixtures').update({ result_dismissed_at: new Date().toISOString() }).eq('id', params.id).select(FIXTURE_COLUMNS).single()
    if (update.error) throw update.error
    return reply.code(200).send(mapFixtureRow(update.data))
  })

  app.post('/v1/club-events/:id/dismiss-invitation', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('club_events').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null)))) return
    const update = await supabaseClients.forService().from('club_events').update({ invitation_dismissed_at: new Date().toISOString() }).eq('id', params.id).select(CLUB_EVENT_COLUMNS).single()
    if (update.error) throw update.error
    return reply.code(200).send(mapClubEventRow(update.data))
  })

  // Anlassvorschlaege: zustandslos aus reinen Lesevergleichen berechnet (plans/019,
  // "Entscheidungen vor der Umsetzung" -- kein taeglicher Job, keine Cron-Infrastruktur vorhanden,
  // Paket 004 weiterhin "in Arbeit"). Nur die drei ereignisgebundenen Regeln (Ankuendigung,
  // Ergebnis, Einladung) -- der vierte, allgemeine Kontingent-Anstoss aus dem Plan bleibt
  // bewusst offen (siehe Plan, "Umsetzung: Ergebnis und Abweichungen"): er braucht dieselbe
  // periodengenaue Kontingentberechnung wie public.schedule_publication, deren Duplizierung hier
  // ohne eigene Tests mehr Risiko als Nutzen waere.
  app.get('/v1/departments/:id/content-suggestions', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const department = await client.from('departments').select('organization_id').eq('id', params.id).maybeSingle()
    if (department.error) throw department.error
    if (!department.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(department.data.organization_id as string, params.id)
    if (!(await requirePermission(request, reply, 'post.create', scope))) return

    const now = new Date()
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const past48Hours = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
    const nowIso = now.toISOString()

    const [upcomingFixtures, playedFixtures, upcomingEvents, submissionsWithFixture, submissionsWithEvent] = await Promise.all([
      client.from('fixtures').select('id, opponent_name, kickoff_at, source_updated_at, announcement_dismissed_at')
        .eq('department_id', params.id).neq('status', 'cancelled').gte('kickoff_at', nowIso).lte('kickoff_at', in3Days),
      client.from('fixtures').select('id, opponent_name, kickoff_at, home_score, away_score, source_updated_at, result_dismissed_at')
        .eq('department_id', params.id).eq('status', 'played').gte('kickoff_at', past48Hours).lte('kickoff_at', nowIso),
      client.from('club_events').select('id, title, starts_at, source_updated_at, invitation_dismissed_at')
        .eq('department_id', params.id).neq('status', 'cancelled').gte('starts_at', nowIso).lte('starts_at', in14Days),
      // fetchAllRows aus demselben Grund wie bei membersWithApprovePermission: max_rows=1000
      // wuerde bei vielen bereits verknuepften Einreichungen einige stillschweigend abschneiden.
      fetchAllRows<{ fixture_id: string }>((from, to) =>
        client.from('submissions').select('fixture_id').eq('department_id', params.id).not('fixture_id', 'is', null).range(from, to),
      ),
      fetchAllRows<{ club_event_id: string }>((from, to) =>
        client.from('submissions').select('club_event_id').eq('department_id', params.id).not('club_event_id', 'is', null).range(from, to),
      ),
    ])
    if (upcomingFixtures.error) throw upcomingFixtures.error
    if (playedFixtures.error) throw playedFixtures.error
    if (upcomingEvents.error) throw upcomingEvents.error

    const fixtureIdsWithSubmission = new Set(submissionsWithFixture.map((row) => row.fixture_id))
    const eventIdsWithSubmission = new Set(submissionsWithEvent.map((row) => row.club_event_id))
    // Wiederkehr nach einer Korrektur in der Quelle: erscheint wieder, sobald source_updated_at
    // neuer ist als der Zeitstempel des Wegklickens -- ein verlegtes Spiel ist eine neue
    // Ankuendigung (plans/019, Abschnitt 4).
    const isDismissed = (dismissedAt: string | null, sourceUpdatedAt: string | null): boolean => {
      if (!dismissedAt) return false
      if (!sourceUpdatedAt) return true
      return new Date(sourceUpdatedAt) <= new Date(dismissedAt)
    }

    const suggestions: ContentSuggestion[] = []
    for (const fixture of upcomingFixtures.data) {
      if (fixtureIdsWithSubmission.has(fixture.id as string)) continue
      if (isDismissed(fixture.announcement_dismissed_at as string | null, fixture.source_updated_at as string | null)) continue
      suggestions.push({
        kind: 'fixture_announcement', departmentId: params.id, fixtureId: fixture.id as string,
        occursAt: fixture.kickoff_at as string,
        label: fixture.opponent_name ? `Spielankündigung gegen ${fixture.opponent_name as string} fehlt noch` : 'Spielankündigung fehlt noch',
      })
    }
    for (const fixture of playedFixtures.data) {
      if (fixtureIdsWithSubmission.has(fixture.id as string)) continue
      if (isDismissed(fixture.result_dismissed_at as string | null, fixture.source_updated_at as string | null)) continue
      suggestions.push({
        kind: 'fixture_result', departmentId: params.id, fixtureId: fixture.id as string,
        occursAt: fixture.kickoff_at as string,
        label: fixture.opponent_name ? `Ergebnis gegen ${fixture.opponent_name as string} noch nicht erzählt` : 'Ergebnis noch nicht erzählt',
      })
    }
    for (const event of upcomingEvents.data) {
      if (eventIdsWithSubmission.has(event.id as string)) continue
      if (isDismissed(event.invitation_dismissed_at as string | null, event.source_updated_at as string | null)) continue
      suggestions.push({ kind: 'event_invitation', departmentId: params.id, clubEventId: event.id as string, occursAt: event.starts_at as string, label: `Einladung zu „${event.title as string}“ fehlt noch` })
    }
    suggestions.sort((a, b) => (a.occursAt ?? '').localeCompare(b.occursAt ?? ''))

    return reply.code(200).send(ContentSuggestionsResponseSchema.parse({ suggestions }))
  })
}
