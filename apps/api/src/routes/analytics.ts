import {
  AnalyticsBreakdownQuerySchema,
  AnalyticsBreakdownResponseSchema,
  AnalyticsFunnelQuerySchema,
  AnalyticsFunnelResponseSchema,
  AnalyticsScopeQuerySchema,
  AnalyticsSummarySchema,
  AnalyticsTimeseriesQuerySchema,
  AnalyticsTimeseriesResponseSchema,
} from '@vereinsfunk/contracts'
import {
  addDays,
  approvalDurationSecondsSamples,
  computeCountMetrics,
  computeCountMetricsSeries,
  computeFunnel,
  computeTrend,
  daysBetween,
  isInWindow,
  leadTimeSecondsSamples,
  median,
  rangeWindow,
  type CountMetrics,
} from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ApiRouteContext } from './context.js'
import { fetchAllRows, fetchAllRowsForIds, toPermissionScope } from './shared.js'

export function registerAnalyticsRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context

  // Paket 016: Auswertung: interne Kennzahlen -------------------------------------------------------
  // Kein metrics_daily-Cache, kein Aggregationsjob: jede Anfrage berechnet live aus den
  // Rohtabellen (post_status_events, approval_decisions, publications, workflow_runs,
  // post_versions, posts, submissions). Siehe plans/016-auswertung-interne-kennzahlen.md,
  // "Abweichungen vom Plan" Punkt 4, fuer die Begruendung.
  interface AnalyticsScope {
    organizationId: string
    departmentId?: string
    teamId?: string
  }
  function toAnalyticsScope(query: { organizationId: string; departmentId?: string | undefined; teamId?: string | undefined }): AnalyticsScope {
    return { organizationId: query.organizationId, ...(query.departmentId ? { departmentId: query.departmentId } : {}), ...(query.teamId ? { teamId: query.teamId } : {}) }
  }

  // KRITISCHER FUND (adversariale Pruefung): auth.ts' rolesForScope prueft organization_memberships,
  // department_memberships und team_memberships voellig unabhaengig voneinander -- nirgends wird
  // geprueft, dass die drei IDs ueberhaupt zusammengehoeren. Ein Aufrufer mit einer echten
  // Abteilungsrolle (analytics.view) in Verein A koennte sonst organizationId=<fremder Verein B> mit
  // seiner eigenen, echten departmentId aus A kombinieren: requirePermission wuerde ueber die reale
  // Abteilungsrolle in A durchgehen, obwohl die Anfrage inhaltlich Verein B gilt. Die meisten Loader
  // unten filtern zusammengesetzt nach organization_id UND department_id und liefern bei einem
  // solchen inkonsistenten Paar zufaellig leer -- die Kontingentauslastung in GET .../summary filtert
  // channel_quotas dagegen ausschliesslich nach organizationId und haette echte Konfigurations- und
  // Nutzungsdaten eines fremden Vereins zurueckgegeben. Statt den gemeinsam genutzten RoleProvider
  // projektweit zu aendern (groesserer, eigenstaendiger Eingriff), wird hier vor jeder Rechtepruefung
  // separat sichergestellt, dass departmentId tatsaechlich zu organizationId gehoert und teamId zu
  // departmentId -- dasselbe Muster wie resolveMembershipScope() oben, nur in die andere Richtung
  // (IDs vom Aufrufer, nicht aus scope+scopeId aufgeloest).
  //
  // Ueber den Nutzer-Client (RLS), nicht die Service Role: departments_select_member/
  // teams_select_member lassen jedes Mitglied die eigene Abteilung/das eigene Team sehen (mit
  // Fallback auf eine Vereinsrolle) -- fuer eine echte Kombination liefert das dieselbe Zeile wie
  // die Service Role, fuer eine vorgetaeuschte liefert RLS entweder eine ANDERE organization_id
  // (Mismatch erkannt) oder gar keine Zeile (ebenfalls erkannt). So bleibt der etablierte Aufbau
  // dieser Datei erhalten: kein Supabase-Zugriff, bevor requirePermission entschieden hat -- nur
  // aufgerufen, wenn tatsaechlich eine departmentId angegeben ist.
  async function verifyDepartmentAndTeamBelongToOrganization(
    client: SupabaseClient,
    query: { organizationId: string; departmentId: string; teamId?: string | undefined },
  ): Promise<boolean> {
    const department = await client.from('departments').select('organization_id').eq('id', query.departmentId).maybeSingle()
    if (department.error) throw department.error
    if (!department.data || department.data.organization_id !== query.organizationId) return false
    if (query.teamId) {
      const team = await client.from('teams').select('organization_id, department_id').eq('id', query.teamId).maybeSingle()
      if (team.error) throw team.error
      if (!team.data || team.data.organization_id !== query.organizationId || team.data.department_id !== query.departmentId) return false
    }
    return true
  }
  async function assertAnalyticsScopeConsistency(
    request: FastifyRequest,
    reply: FastifyReply,
    query: { organizationId: string; departmentId?: string | undefined; teamId?: string | undefined },
  ): Promise<boolean> {
    if (!query.departmentId) return true
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const consistent = await verifyDepartmentAndTeamBelongToOrganization(client, { organizationId: query.organizationId, departmentId: query.departmentId, teamId: query.teamId })
    if (!consistent) {
      reply.code(404).send({ error: 'not_found', correlationId: request.id })
      return false
    }
    return true
  }

  // null statt Wurf, wenn die Organisation nicht (mehr) existiert -- ein geworfener Error waere ueber
  // den generischen Fehler-Handler als 500 internal_error beantwortet worden, obwohl jede andere
  // Route dieser Datei eine fehlende Organisation mit 404 not_found beantwortet (CodeRabbit-Fund zu
  // PR #28). In der Praxis greift zuvor meist requirePermission mit 403, der Pfad bleibt aber
  // erreichbar, sobald eine Rollenzeile eine inzwischen geloeschte Organisation referenziert.
  async function loadOrganizationTimezone(service: SupabaseClient, organizationId: string): Promise<string | null> {
    const organization = await service.from('organizations').select('timezone').eq('id', organizationId).maybeSingle()
    if (organization.error) throw organization.error
    if (!organization.data) return null
    return organization.data.timezone as string
  }

  // Fruehestes submissions.created_at im Scope -- "ab wann liegen ueberhaupt Daten vor" (Plan,
  // Abschnitt "Endpunkte", "coverage"). null, solange kein einziger Beitrag eingereicht wurde. Auch
  // die Grundlage dafuer, ob eine Vorperiode fuer einen Trend ueberhaupt vollstaendig ist.
  async function loadMeasurementStart(service: SupabaseClient, scope: AnalyticsScope): Promise<string | null> {
    let query = service.from('submissions').select('created_at').eq('organization_id', scope.organizationId)
    if (scope.teamId) query = query.eq('team_id', scope.teamId)
    else if (scope.departmentId) query = query.eq('department_id', scope.departmentId)
    const result = await query.order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (result.error) throw result.error
    return result.data ? (result.data.created_at as string).slice(0, 10) : null
  }

  async function loadPostsInScope(service: SupabaseClient, scope: AnalyticsScope): Promise<{ id: string; createdAt: string; departmentId: string }[]> {
    const rows = await fetchAllRows<{ id: string; created_at: string; department_id: string }>((from, to) => {
      let query = service.from('posts').select('id, created_at, department_id').eq('organization_id', scope.organizationId)
      if (scope.teamId) query = query.eq('team_id', scope.teamId)
      else if (scope.departmentId) query = query.eq('department_id', scope.departmentId)
      return query.range(from, to)
    })
    return rows.map((row) => ({ id: row.id, createdAt: row.created_at, departmentId: row.department_id }))
  }

  // to_status IN (...) filtert serverseitig auf die fuenf fuer Kennzahlen relevanten Uebergaenge --
  // post_status_events ist laut Plan die am schnellsten wachsende Tabelle, ein unnoetig
  // uebertragener Uebergang (z. B. draft_ready -> render_queued) kostet ohne Nutzen.
  const RELEVANT_TRANSITION_STATUSES = ['awaiting_approval', 'approved', 'changes_requested', 'scheduled', 'published']
  async function loadStatusTransitionsInScope(service: SupabaseClient, scope: AnalyticsScope): Promise<{ postId: string; toStatus: string; occurredAt: string }[]> {
    const rows = await fetchAllRows<{ post_id: string; to_status: string; occurred_at: string }>((from, to) => {
      let query = service
        .from('post_status_events')
        .select('post_id, to_status, occurred_at')
        .eq('organization_id', scope.organizationId)
        .in('to_status', RELEVANT_TRANSITION_STATUSES)
      if (scope.teamId) query = query.eq('team_id', scope.teamId)
      else if (scope.departmentId) query = query.eq('department_id', scope.departmentId)
      return query.range(from, to)
    })
    return rows.map((row) => ({ postId: row.post_id, toStatus: row.to_status, occurredAt: row.occurred_at }))
  }

  async function loadApprovalDecisionsInScope(service: SupabaseClient, postIds: readonly string[]): Promise<{ decision: 'approved' | 'changes_requested' | 'rejected'; createdAt: string }[]> {
    if (postIds.length === 0) return []
    const requestIds = (
      await fetchAllRowsForIds<{ id: string }>(postIds, (batch, from, to) => service.from('approval_requests').select('id').in('post_id', batch).range(from, to))
    ).map((row) => row.id)
    if (requestIds.length === 0) return []
    const decisions = await fetchAllRowsForIds<{ decision: 'approved' | 'changes_requested' | 'rejected'; created_at: string }>(requestIds, (batch, from, to) =>
      service.from('approval_decisions').select('decision, created_at').in('approval_request_id', batch).range(from, to),
    )
    return decisions.map((row) => ({ decision: row.decision, createdAt: row.created_at }))
  }

  // publications hat kein department_id/team_id (Plan, "Risiken": "dieselbe Einschraenkung wie in
  // Paket 011") -- Scoping laeuft ueber die post_version_id-Liste der bereits geladenen Beitraege.
  // postId/socialConnectionId bleiben erhalten, damit "aktive Abteilungen" und die Kanal-
  // Aufschluesselung dieselbe Ladung wiederverwenden koennen statt ein zweites Mal zu joinen. `since`
  // ist die untere Fenstergrenze des Aufrufers (Vorperiode fuer Trends eingeschlossen) -- posts/
  // post_status_events brauchen die volle Historie (erste published-Transition, Durchlaufzeit), aber
  // publications hat dafuer keinen fachlichen Grund und wuerde sonst bei jeder Anfrage die gesamte
  // Vereinshistorie uebertragen (CodeRabbit-Nitpick zu PR #28).
  async function loadPublicationsForPosts(
    service: SupabaseClient,
    postIds: readonly string[],
    since: string,
  ): Promise<{ postId: string; socialConnectionId: string; status: string; updatedAt: string }[]> {
    if (postIds.length === 0) return []
    const versions = await fetchAllRowsForIds<{ id: string; post_id: string }>(postIds, (batch, from, to) => service.from('post_versions').select('id, post_id').in('post_id', batch).range(from, to))
    const versionToPost = new Map(versions.map((version) => [version.id, version.post_id]))
    const versionIds = versions.map((version) => version.id)
    if (versionIds.length === 0) return []
    const publications = await fetchAllRowsForIds<{ post_version_id: string; social_connection_id: string; status: string; updated_at: string }>(versionIds, (batch, from, to) =>
      service.from('publications').select('post_version_id, social_connection_id, status, updated_at').in('post_version_id', batch).gte('updated_at', since).range(from, to),
    )
    return publications.map((row) => ({
      postId: versionToPost.get(row.post_version_id) ?? '',
      socialConnectionId: row.social_connection_id,
      status: row.status,
      updatedAt: row.updated_at,
    }))
  }

  async function loadPostVersionsForPosts(service: SupabaseClient, postIds: readonly string[]): Promise<{ postId: string; versionNumber: number }[]> {
    if (postIds.length === 0) return []
    const rows = await fetchAllRowsForIds<{ post_id: string; version_number: number }>(postIds, (batch, from, to) => service.from('post_versions').select('post_id, version_number').in('post_id', batch).range(from, to))
    return rows.map((row) => ({ postId: row.post_id, versionNumber: row.version_number }))
  }

  // workflow_runs hat department_id, aber kein team_id (Schema seit der ersten Content-Pipeline-
  // Migration, ausserhalb des Scopes dieses Pakets) -- eine team-gescopte Anfrage bekommt hier
  // bestenfalls Abteilungsgranularitaet: ein team_manager ohne eigene Abteilungsrolle sieht in
  // workflowRuns/workflowFailures/workflowFailureRate die Zaehlwerte der GESAMTEN Abteilung, nicht
  // nur des eigenen Teams (adversariale Pruefung, als bewusst nicht behobene Einschraenkung
  // eingeordnet: reine technische Zaehlwerte ohne Personenbezug oder Inhalt, eine Behebung
  // bräuchte eine Schemaerweiterung ausserhalb dieses Pakets). Ehrlich unveraendert statt erfunden
  // praezisiert. `since` wie bei loadPublicationsForPosts: workflow_runs traegt keine posts.id-
  // Historienabhaengigkeit, ein Zeitfilter ab der unteren Fenstergrenze verliert keine Information.
  async function loadWorkflowRunsInScope(service: SupabaseClient, scope: AnalyticsScope, since: string): Promise<{ technicalStatus: string; updatedAt: string }[]> {
    const rows = await fetchAllRows<{ technical_status: string; updated_at: string }>((from, to) => {
      let query = service.from('workflow_runs').select('technical_status, updated_at').eq('organization_id', scope.organizationId).gte('updated_at', since)
      if (scope.departmentId) query = query.eq('department_id', scope.departmentId)
      return query.range(from, to)
    })
    return rows.map((row) => ({ technicalStatus: row.technical_status, updatedAt: row.updated_at }))
  }

  app.get('/v1/analytics/summary', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = AnalyticsScopeQuerySchema.parse(request.query)
    if (!(await assertAnalyticsScopeConsistency(request, reply, query))) return
    if (!(await requirePermission(request, reply, 'analytics.view', toPermissionScope(query.organizationId, query.departmentId, query.teamId)))) return

    const service = supabaseClients.forService()
    const scope = toAnalyticsScope(query)
    const timezone = await loadOrganizationTimezone(service, query.organizationId)
    if (timezone === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const measurementStartsAt = await loadMeasurementStart(service, scope)
    const window = rangeWindow(query.from, addDays(query.to, 1), timezone)
    // Vorab berechnet, weil publications/workflow_runs weiter unten schon ab der unteren Grenze der
    // Vorperiode geladen werden -- der Trend-Block weiter unten braucht dieselbe previousWindow.
    const spanDays = daysBetween(query.from, query.to) + 1
    const previousFrom = addDays(query.from, -spanDays)
    const previousWindow = rangeWindow(previousFrom, query.from, timezone)

    const posts = await loadPostsInScope(service, scope)
    const postIds = posts.map((post) => post.id)
    const transitions = await loadStatusTransitionsInScope(service, scope)
    const publishedTransitions = transitions.filter((transition) => transition.toStatus === 'published').map(({ postId, occurredAt }) => ({ postId, occurredAt }))
    const [approvalDecisions, publicationsWithPost, postVersions, workflowRuns] = await Promise.all([
      loadApprovalDecisionsInScope(service, postIds),
      loadPublicationsForPosts(service, postIds, previousWindow.startUtc),
      loadPostVersionsForPosts(service, postIds),
      loadWorkflowRunsInScope(service, scope, previousWindow.startUtc),
    ])
    const publications = publicationsWithPost.map(({ status, updatedAt }) => ({ status, updatedAt }))

    const current = computeCountMetrics({ window, postsCreated: posts, publishedTransitions, approvalDecisions, publications, workflowRuns, postVersions })
    const leadTimeSamples = leadTimeSecondsSamples(window, posts, publishedTransitions)
    const approvalSamples = approvalDurationSecondsSamples(window, transitions)
    const leadTimeMedian = median(leadTimeSamples)

    const decidedCount = current.approvalsGranted + current.approvalsChangesRequested + current.approvalsRejected
    const approvalRate = decidedCount > 0 ? current.approvalsGranted / decidedCount : null
    const changeRequestRate = decidedCount > 0 ? current.approvalsChangesRequested / decidedCount : null
    const workflowFailureRate = current.workflowRuns > 0 ? current.workflowFailures / current.workflowRuns : null
    const averageRevisionsPerPost = current.revisionsCount > 0 ? current.revisionsSum / current.revisionsCount : null

    // "Aktive Einheiten" ist nur auf Vereinsebene eine sinnvolle Aussage -- bei einer bereits auf
    // eine Abteilung eingeschraenkten Anfrage waere das Ergebnis immer 0 oder 1 und keine Information.
    let activeDepartments: number | null = null
    if (!query.departmentId) {
      const departmentByPost = new Map(posts.map((post) => [post.id, post.departmentId]))
      const active = new Set<string>()
      for (const publication of publicationsWithPost) {
        if (publication.status !== 'published' || !isInWindow(publication.updatedAt, window)) continue
        const departmentId = departmentByPost.get(publication.postId)
        if (departmentId) active.add(departmentId)
      }
      activeDepartments = active.size
    }

    // Trend nur bei vollstaendiger Vorperiode -- eine Vorperiode, die vor measurementStartsAt
    // beginnt, ist per Definition unvollstaendig (Plan, Abschnitt "Metrikdefinitionen"). Kein
    // Fallback auf 0 %.
    let postsCreatedTrend: number | null = null
    let postsPublishedTrend: number | null = null
    let publicationsPublishedTrend: number | null = null
    let approvalRateTrend: number | null = null
    let leadTimeSecondsMedianTrend: number | null = null
    if (measurementStartsAt !== null && previousFrom >= measurementStartsAt) {
      const previous = computeCountMetrics({ window: previousWindow, postsCreated: posts, publishedTransitions, approvalDecisions, publications, workflowRuns, postVersions })
      const previousDecided = previous.approvalsGranted + previous.approvalsChangesRequested + previous.approvalsRejected
      const previousApprovalRate = previousDecided > 0 ? previous.approvalsGranted / previousDecided : null
      const previousLeadTimeMedian = median(leadTimeSecondsSamples(previousWindow, posts, publishedTransitions))
      postsCreatedTrend = computeTrend(current.postsCreated, previous.postsCreated)
      postsPublishedTrend = computeTrend(current.postsPublished, previous.postsPublished)
      publicationsPublishedTrend = computeTrend(current.publicationsPublished, previous.publicationsPublished)
      approvalRateTrend = approvalRate !== null ? computeTrend(approvalRate, previousApprovalRate) : null
      leadTimeSecondsMedianTrend = leadTimeMedian !== null ? computeTrend(leadTimeMedian, previousLeadTimeMedian) : null
    }

    // Kontingentauslastung: aktuelle Periode (nicht der angefragte Auswertungszeitraum) -- eine
    // Quote bezieht sich immer auf "gerade jetzt", nicht auf einen frei gewaehlten Vergangenheits-
    // zeitraum (Plan, Abschnitt "Oberflaeche", eigener Punkt neben der Kennzahlenzeile).
    const quotaRows = await fetchAllRows<{
      id: string; scope: string; department_id: string | null; team_id: string | null; social_connection_id: string | null; period: 'day' | 'week' | 'month'; max_publications: number
    }>((from, to) => service.from('channel_quotas').select('id, scope, department_id, team_id, social_connection_id, period, max_publications').eq('organization_id', query.organizationId).range(from, to))
    const nowIso = new Date().toISOString()
    const quotas = await Promise.all(
      quotaRows.map(async (row) => {
        const usage = await service.rpc('count_publications_in_period', {
          target_organization: query.organizationId, target_department: row.department_id, target_team: row.team_id,
          target_connection: row.social_connection_id, quota_period: row.period, reference: nowIso,
        })
        if (usage.error) throw usage.error
        return {
          id: row.id, scope: row.scope, scopeId: row.team_id ?? row.department_id ?? query.organizationId,
          socialConnectionId: row.social_connection_id, period: row.period, maxPublications: row.max_publications, used: usage.data as number,
        }
      }),
    )

    return reply.code(200).send(
      AnalyticsSummarySchema.parse({
        coverage: { measurementStartsAt, requestedFrom: query.from, requestedTo: query.to },
        postsCreated: current.postsCreated, postsCreatedTrend,
        postsPublished: current.postsPublished, postsPublishedTrend,
        publicationsPublished: current.publicationsPublished, publicationsPublishedTrend,
        publicationsFailed: current.publicationsFailed,
        approvalRate, approvalRateTrend, changeRequestRate,
        leadTimeSecondsMedian: leadTimeMedian, leadTimeSecondsMedianTrend,
        approvalSecondsMedian: median(approvalSamples),
        averageRevisionsPerPost, workflowFailureRate, activeDepartments,
        quotas,
      }),
    )
  })

  app.get('/v1/analytics/timeseries', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = AnalyticsTimeseriesQuerySchema.parse(request.query)
    if (!(await assertAnalyticsScopeConsistency(request, reply, query))) return
    if (!(await requirePermission(request, reply, 'analytics.view', toPermissionScope(query.organizationId, query.departmentId, query.teamId)))) return

    const service = supabaseClients.forService()
    const scope = toAnalyticsScope(query)
    const timezone = await loadOrganizationTimezone(service, query.organizationId)
    if (timezone === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const measurementStartsAt = await loadMeasurementStart(service, scope)
    const requestWindowStart = rangeWindow(query.from, addDays(query.to, 1), timezone).startUtc

    const posts = await loadPostsInScope(service, scope)
    const postIds = posts.map((post) => post.id)
    const transitions = await loadStatusTransitionsInScope(service, scope)
    const publishedTransitions = transitions.filter((transition) => transition.toStatus === 'published').map(({ postId, occurredAt }) => ({ postId, occurredAt }))
    const [approvalDecisions, publicationsWithPost, postVersions, workflowRuns] = await Promise.all([
      loadApprovalDecisionsInScope(service, postIds),
      loadPublicationsForPosts(service, postIds, requestWindowStart),
      loadPostVersionsForPosts(service, postIds),
      loadWorkflowRunsInScope(service, scope, requestWindowStart),
    ])
    const publications = publicationsWithPost.map(({ status, updatedAt }) => ({ status, updatedAt }))

    // Bucket-Start ist immer ein Kalendertag (bzw. bei "month" der 1. des Monats) in der
    // Vereinszeitzone -- ein krummer erster Balken waere zwischen zwei Aufrufen mit leicht
    // verschobenem "from" nicht vergleichbar.
    function bucketStartDays(): string[] {
      const days: string[] = []
      if (query.granularity === 'month') {
        let cursor = `${query.from.slice(0, 7)}-01`
        while (cursor <= query.to) {
          days.push(cursor)
          const year = Number(cursor.slice(0, 4))
          const month = Number(cursor.slice(5, 7))
          cursor = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
        }
        return days
      }
      const step = query.granularity === 'week' ? 7 : 1
      for (let cursor = query.from; cursor <= query.to; cursor = addDays(cursor, step)) days.push(cursor)
      return days
    }
    const bucketStarts = bucketStartDays()
    const bucketWindows = bucketStarts.map((bucketStart, index) => {
      const nextBucketStart = bucketStarts[index + 1]
      const bucketEndExclusive = nextBucketStart ?? addDays(query.to, 1)
      return rangeWindow(bucketStart, bucketEndExclusive, timezone)
    })
    const bucketMetrics = computeCountMetricsSeries(bucketWindows, { postsCreated: posts, publishedTransitions, approvalDecisions, publications, workflowRuns, postVersions })
    const points = bucketStarts.map((bucketStart, index) => ({ bucketStart, value: (bucketMetrics[index] as CountMetrics)[query.metric] }))

    return reply.code(200).send(
      AnalyticsTimeseriesResponseSchema.parse({
        metric: query.metric, granularity: query.granularity,
        coverage: { measurementStartsAt, requestedFrom: query.from, requestedTo: query.to },
        points,
      }),
    )
  })

  app.get('/v1/analytics/breakdown', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = AnalyticsBreakdownQuerySchema.parse(request.query)
    if (!(await assertAnalyticsScopeConsistency(request, reply, query))) return
    if (!(await requirePermission(request, reply, 'analytics.view', toPermissionScope(query.organizationId, query.departmentId, query.teamId)))) return

    const service = supabaseClients.forService()
    const scope = toAnalyticsScope(query)
    const timezone = await loadOrganizationTimezone(service, query.organizationId)
    if (timezone === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const measurementStartsAt = await loadMeasurementStart(service, scope)
    const window = rangeWindow(query.from, addDays(query.to, 1), timezone)

    let entries: { key: string; label: string; count: number }[]
    if (query.dimension === 'channel') {
      const posts = await loadPostsInScope(service, scope)
      const publications = await loadPublicationsForPosts(service, posts.map((post) => post.id), window.startUtc)
      const counts = new Map<string, number>()
      for (const publication of publications) {
        if (!isInWindow(publication.updatedAt, window)) continue
        counts.set(publication.socialConnectionId, (counts.get(publication.socialConnectionId) ?? 0) + 1)
      }
      const connectionIds = [...counts.keys()]
      const connections = connectionIds.length > 0 ? await service.from('social_connections').select('id, display_name, platform').in('id', connectionIds) : { data: [] as Record<string, unknown>[], error: null }
      if (connections.error) throw connections.error
      const labelById = new Map(connections.data.map((row) => [row.id as string, `${row.display_name as string} (${row.platform as string})`]))
      entries = connectionIds.map((id) => ({ key: id, label: labelById.get(id) ?? id, count: counts.get(id) ?? 0 }))
    } else {
      // department/team/preset/goal/format: aus submissions, nicht aus posts -- "was machen wir
      // eigentlich am meisten" (Plan) ist eine Frage an das, was Menschen einreichen, nicht nur an
      // das, was am Ende als vollstaendiger Post entstand.
      const submissions = await fetchAllRows<{
        id: string; department_id: string; team_id: string | null; preset_slug: string; communication_goal: string; requested_formats: string[]; created_at: string
      }>((from, to) => {
        let submissionQuery = service.from('submissions').select('id, department_id, team_id, preset_slug, communication_goal, requested_formats, created_at').eq('organization_id', query.organizationId)
        if (scope.teamId) submissionQuery = submissionQuery.eq('team_id', scope.teamId)
        else if (scope.departmentId) submissionQuery = submissionQuery.eq('department_id', scope.departmentId)
        return submissionQuery.range(from, to)
      })
      const inWindow = submissions.filter((submission) => isInWindow(submission.created_at, window))
      const counts = new Map<string, number>()
      if (query.dimension === 'preset') for (const submission of inWindow) counts.set(submission.preset_slug, (counts.get(submission.preset_slug) ?? 0) + 1)
      if (query.dimension === 'goal') for (const submission of inWindow) counts.set(submission.communication_goal, (counts.get(submission.communication_goal) ?? 0) + 1)
      if (query.dimension === 'format') for (const submission of inWindow) for (const format of submission.requested_formats) counts.set(format, (counts.get(format) ?? 0) + 1)
      if (query.dimension === 'department') for (const submission of inWindow) counts.set(submission.department_id, (counts.get(submission.department_id) ?? 0) + 1)
      if (query.dimension === 'team') for (const submission of inWindow) if (submission.team_id) counts.set(submission.team_id, (counts.get(submission.team_id) ?? 0) + 1)

      let labelById = new Map<string, string>()
      if (query.dimension === 'department') {
        const ids = [...counts.keys()]
        const rows = ids.length > 0 ? await service.from('departments').select('id, name').in('id', ids) : { data: [] as Record<string, unknown>[], error: null }
        if (rows.error) throw rows.error
        labelById = new Map(rows.data.map((row) => [row.id as string, row.name as string]))
      } else if (query.dimension === 'team') {
        const ids = [...counts.keys()]
        const rows = ids.length > 0 ? await service.from('teams').select('id, name').in('id', ids) : { data: [] as Record<string, unknown>[], error: null }
        if (rows.error) throw rows.error
        labelById = new Map(rows.data.map((row) => [row.id as string, row.name as string]))
      }
      entries = [...counts.entries()].map(([key, count]) => ({ key, label: labelById.get(key) ?? key, count }))
    }

    entries.sort((a, b) => b.count - a.count)
    return reply.code(200).send(
      AnalyticsBreakdownResponseSchema.parse({
        dimension: query.dimension,
        coverage: { measurementStartsAt, requestedFrom: query.from, requestedTo: query.to },
        entries,
      }),
    )
  })

  app.get('/v1/analytics/funnel', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = AnalyticsFunnelQuerySchema.parse(request.query)
    if (!(await assertAnalyticsScopeConsistency(request, reply, query))) return
    if (!(await requirePermission(request, reply, 'analytics.view', toPermissionScope(query.organizationId, query.departmentId, query.teamId)))) return

    const service = supabaseClients.forService()
    const scope = toAnalyticsScope(query)
    const timezone = await loadOrganizationTimezone(service, query.organizationId)
    if (timezone === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const measurementStartsAt = await loadMeasurementStart(service, scope)
    const window = rangeWindow(query.from, addDays(query.to, 1), timezone)

    const posts = await loadPostsInScope(service, scope)
    const transitions = await loadStatusTransitionsInScope(service, scope)
    const stages = computeFunnel(window, posts, transitions)

    return reply.code(200).send(
      AnalyticsFunnelResponseSchema.parse({
        coverage: { measurementStartsAt, requestedFrom: query.from, requestedTo: query.to },
        stages,
      }),
    )
  })
}
