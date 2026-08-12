import {
  ApprovalRequestSchema,
  ApprovalStageSchema,
  DecideApprovalStageRequestSchema,
  DecideApprovalStageResponseSchema,
  RequestApprovalResponseSchema,
  ReresolveApprovalRouteRequestSchema,
  ReresolveApprovalRouteResponseSchema,
  StalledApprovalRequestSchema,
  UuidSchema,
  type StalledApprovalRequest,
} from '@vereinsfunk/contracts'
import { resolveReviewRoute, type MediaGateBlocker, type resolveEffectiveConfig } from '@vereinsfunk/domain'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { buildStageDefinitions, membersWithApprovePermission } from '../services/approvalRouting.js'
import { computeMediaGateBlockersForPostVersion } from '../services/mediaGate.js'
import type { ApiRouteContext } from './context.js'
import { computeRuleEntry, fetchAllRows, fetchAllRowsForIds, fetchMemberTrust, fetchPolicyRuleRows } from './shared.js'

export function registerApprovalRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context

  app.post('/v1/post-versions/:id/request-approval', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const version = await client.from('post_versions').select('id, post_id, created_by_user_id, safety_flags').eq('id', params.id).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const post = await client.from('posts').select('id, organization_id, department_id, team_id, status').eq('id', version.data.post_id).maybeSingle()
    if (post.error) throw post.error
    if (!post.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.submit', { organizationId: post.data.organization_id, departmentId: post.data.department_id }))) return

    const departmentId = post.data.department_id as string
    const teamId = post.data.team_id as string | null
    // Alle Ebenen einmal laden -- Stufenaufbau, die Vereinszeile (allow_review_exemptions) und die
    // effektive Konfiguration lesen dieselben Zeilen.
    const ruleRows = await fetchPolicyRuleRows(client, post.data.organization_id)
    const orgRow = ruleRows.orgRow
    const config = computeRuleEntry(ruleRows, teamId ? 'team' : 'department', teamId ?? departmentId, departmentId).config
    const stages = await buildStageDefinitions(client, ruleRows, post.data.organization_id, departmentId, teamId)
    const authorId = version.data.created_by_user_id as string
    const trust = await fetchMemberTrust(client, authorId, post.data.organization_id, departmentId, teamId)
    const containsMinors = ((version.data.safety_flags as string[]) ?? []).includes('minor')
    const minorReviewerUserIds = containsMinors ? await membersWithApprovePermission(client, post.data.organization_id, 'organization', null, null) : []

    const route = resolveReviewRoute({
      stages,
      trust,
      author: { userId: authorId },
      media: { containsMinors, reviewerUserIds: minorReviewerUserIds },
      selfApprovalAllowed: config.policies.selfApprovalAllowed,
      allowReviewExemptions: orgRow?.allow_review_exemptions ?? true,
    })
    if (route.blockers.length > 0) {
      return reply.code(422).send({ error: 'unfulfillable_stage', blockers: route.blockers, correlationId: request.id })
    }

    // Paket 024: request_approval nimmt keinen "stages"-Parameter mehr entgegen -- die Funktion
    // leitet die Route seit hier selbst ab (authz.resolve_review_route), damit ein per RPC direkt
    // aufrufender Einreichender keinen selbst gewaehlten Pruefkreis mehr einschleusen kann, auch
    // nicht fuer die Minderjaehrigenstufe (siehe plans/024, "Entschiedene Fragen" Punkt 2). Der
    // obige route-Aufruf bleibt als VORSCHAU bestehen, damit ein unerfuellbarer Blocker weiterhin
    // vor dem RPC-Aufruf als 422 gemeldet wird, statt erst am Fehler der RPC selbst.
    const rpc = await client.rpc('request_approval', { target_post_version_id: params.id })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('invalid_status')) return reply.code(409).send({ error: 'invalid_status', correlationId: request.id })
      if (rpc.error.message.includes('minor_stage_required')) return reply.code(422).send({ error: 'minor_stage_required', correlationId: request.id })
      if (rpc.error.message.includes('review_required')) return reply.code(422).send({ error: 'review_required', correlationId: request.id })
      if (rpc.error.message.includes('invalid_reviewer_snapshot')) return reply.code(422).send({ error: 'invalid_reviewer_snapshot', correlationId: request.id })
      // Beide sind auf diesem Weg nicht erreichbar -- resolveReviewRoute nummeriert die Stufen selbst
      // von 1 an durch und meldet einen leeren Prueferkreis vorher als Blocker. request_approval ist
      // aber per Grant direkt per RPC erreichbar und prueft deshalb beides selbst.
      if (rpc.error.message.includes('invalid_stage_positions')) return reply.code(422).send({ error: 'invalid_stage_positions', correlationId: request.id })
      if (rpc.error.message.includes('empty_reviewer_snapshot')) return reply.code(422).send({ error: 'empty_reviewer_snapshot', correlationId: request.id })
      if (rpc.error.message.includes('only_author_as_reviewer')) return reply.code(403).send({ error: 'only_author_as_reviewer', correlationId: request.id })
      throw rpc.error
    }
    return reply.code(202).send(
      RequestApprovalResponseSchema.parse({ postId: rpc.data.postId, status: rpc.data.status, approvalRequestId: rpc.data.approvalRequestId ?? null }),
    )
  })

  app.post('/v1/approval-stages/:id/decide', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = DecideApprovalStageRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('decide_approval_stage', { target_stage_id: params.id, target_decision: input.decision, target_reason: input.reason ?? null })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('invalid_decision')) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw rpc.error
    }
    return reply.code(200).send(
      DecideApprovalStageResponseSchema.parse({
        stageId: rpc.data.stageId, stageStatus: rpc.data.stageStatus, postStatus: rpc.data.postStatus,
        ...(rpc.data.nextStageId ? { nextStageId: rpc.data.nextStageId } : {}),
      }),
    )
  })

  // Paket 024: eine laufende Freigabe bewusst neu aufloesen. Kein "stages"-Parameter -- die RPC
  // leitet die Route selbst ab (siehe reresolve_approval_route, authz.resolve_review_route). Die
  // API prueft nur Struktur/Fehlerabbildung, keine Berechtigungsvorabpruefung: reresolve_approval_route
  // prueft department.manage, Autorenausschluss und Begruendungslaenge bereits selbst.
  app.post('/v1/approval-requests/:id/reresolve', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = ReresolveApprovalRouteRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('reresolve_approval_route', { target_approval_request_id: params.id, reason: input.reason })
    if (rpc.error) {
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('author_cannot_reresolve')) return reply.code(403).send({ error: 'author_cannot_reresolve', correlationId: request.id })
      if (rpc.error.message.includes('invalid_status')) return reply.code(409).send({ error: 'invalid_status', correlationId: request.id })
      if (rpc.error.message.includes('route_has_rejected_stage')) return reply.code(409).send({ error: 'route_has_rejected_stage', correlationId: request.id })
      if (rpc.error.message.includes('ambiguous_stage_mapping')) return reply.code(409).send({ error: 'ambiguous_stage_mapping', correlationId: request.id })
      if (rpc.error.message.includes('reason_required')) return reply.code(400).send({ error: 'reason_required', correlationId: request.id })
      // Guertel und Hosentraeger (Plan, Schritt 6): resolve_review_route berechnet die Route bereits
      // konfigurationstreu, assert_valid_stage_list kann diese Fehler auf diesem Weg praktisch nicht
      // mehr erreichen -- dieselben Fehlernamen wie bei request-approval trotzdem abgebildet.
      if (rpc.error.message.includes('minor_stage_required')) return reply.code(422).send({ error: 'minor_stage_required', correlationId: request.id })
      if (rpc.error.message.includes('invalid_reviewer_snapshot')) return reply.code(422).send({ error: 'invalid_reviewer_snapshot', correlationId: request.id })
      if (rpc.error.message.includes('invalid_stage_positions')) return reply.code(422).send({ error: 'invalid_stage_positions', correlationId: request.id })
      if (rpc.error.message.includes('empty_reviewer_snapshot')) return reply.code(422).send({ error: 'empty_reviewer_snapshot', correlationId: request.id })
      if (rpc.error.message.includes('only_author_as_reviewer')) return reply.code(403).send({ error: 'only_author_as_reviewer', correlationId: request.id })
      throw rpc.error
    }
    return reply.code(200).send(
      ReresolveApprovalRouteResponseSchema.parse({
        postId: rpc.data.postId, approvalRequestId: rpc.data.approvalRequestId, status: rpc.data.status,
        firstStageId: rpc.data.firstStageId ?? null,
      }),
    )
  })

  // Paket 024, "Oberflaeche": festhaengende Freigaben der eigenen Ebene -- nicht nur "wartet auf
  // mich" (GET /v1/approval-stages/mine), sondern jede Anfrage, die eine verwaltende Person sehen
  // darf (approval_requests_select, seit diesem Paket auch department.manage) UND die tatsaechlich
  // haengt: mindestens eine offene/ueberfaellige Stufe ist ueberfaellig, ODER die Anfrage ist
  // invalidiert. Bewusst kleiner als der Plan-Entwurf: "der reviewer_snapshot ist nicht mehr
  // erfuellbar" (unresolvableReviewers) fehlt, siehe plans/024, "Umsetzung: Ergebnis und
  // Abweichungen vom Plan" -- das braucht einen Mitgliedschafts-Ablaufabgleich je Snapshot-Eintrag,
  // ein eigener, spaeter nachziehbarer Schritt.
  app.get('/v1/approval-requests/stalled', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const requestRows = await fetchAllRows<{ id: string; post_id: string; post_version_id: string; invalidated_at: string | null }>((from, to) =>
      client.from('approval_requests').select('id, post_id, post_version_id, invalidated_at').eq('organization_id', query.organizationId).order('id', { ascending: true }).range(from, to),
    )
    if (requestRows.length === 0) return reply.code(200).send([])

    const requestIds = requestRows.map((row) => row.id)
    const stageRows = await fetchAllRowsForIds<{ approval_request_id: string; deadline_at: string | null }>(requestIds, (batch, from, to) =>
      client.from('approval_stages').select('approval_request_id, deadline_at').in('approval_request_id', batch).in('status', ['open', 'stalled']).order('id', { ascending: true }).range(from, to),
    )
    const now = Date.now()
    const openRequestIds = new Set(stageRows.map((row) => row.approval_request_id))
    const overdueRequestIds = new Set(
      stageRows.filter((row) => row.deadline_at !== null && new Date(row.deadline_at).getTime() < now).map((row) => row.approval_request_id),
    )
    const stalled = requestRows.filter((row) => openRequestIds.has(row.id) && (row.invalidated_at !== null || overdueRequestIds.has(row.id)))
    if (stalled.length === 0) return reply.code(200).send([])

    const postIds = Array.from(new Set(stalled.map((row) => row.post_id)))
    const postVersionIds = Array.from(new Set(stalled.map((row) => row.post_version_id)))
    const [postRows, versionRows] = await Promise.all([
      fetchAllRowsForIds<{ id: string; department_id: string }>(postIds, (batch, from, to) => client.from('posts').select('id, department_id').in('id', batch).order('id', { ascending: true }).range(from, to)),
      fetchAllRowsForIds<{ id: string; title: string }>(postVersionIds, (batch, from, to) => client.from('post_versions').select('id, title').in('id', batch).order('id', { ascending: true }).range(from, to)),
    ])
    const departmentByPostId = new Map(postRows.map((row) => [row.id, row.department_id]))
    const titleByVersionId = new Map(versionRows.map((row) => [row.id, row.title]))

    return reply.code(200).send(
      stalled
        .map((row) => {
          const departmentId = departmentByPostId.get(row.post_id as string)
          if (!departmentId) return null
          return StalledApprovalRequestSchema.parse({
            approvalRequestId: row.id, postId: row.post_id, postVersionId: row.post_version_id, departmentId,
            postTitle: titleByVersionId.get(row.post_version_id as string) ?? '',
            isOverdue: overdueRequestIds.has(row.id as string), invalidated: row.invalidated_at !== null,
          })
        })
        .filter((row): row is StalledApprovalRequest => row !== null),
    )
  })

  app.get('/v1/post-versions/:id/approval', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const version = await client.from('post_versions').select('id, created_by_user_id').eq('id', params.id).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const approvalRequest = await client.from('approval_requests').select('id, post_id, post_version_id').eq('post_version_id', params.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (approvalRequest.error) throw approvalRequest.error
    if (!approvalRequest.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const isAuthor = version.data.created_by_user_id === request.auth!.userId
    const [stagesResult, decisionsResult, routeChangesResult] = await Promise.all([
      client.from('approval_stages').select('id, position, scope, label, mode, minimum_approvals, is_minor_stage, status, reviewer_snapshot, deadline_at, opened_at').eq('approval_request_id', approvalRequest.data.id).order('position'),
      client.from('approval_decisions').select('id, approval_stage_id, decided_by, decision, reason, created_at').eq('approval_request_id', approvalRequest.data.id),
      client.from('approval_route_changes').select('id, changed_by, reason, stages_before, created_at').eq('approval_request_id', approvalRequest.data.id).order('created_at'),
    ])
    if (stagesResult.error) throw stagesResult.error
    if (decisionsResult.error) throw decisionsResult.error
    if (routeChangesResult.error) throw routeChangesResult.error
    const now = Date.now()
    return reply.code(200).send(
      ApprovalRequestSchema.parse({
        id: approvalRequest.data.id, postId: approvalRequest.data.post_id, postVersionId: approvalRequest.data.post_version_id,
        stages: stagesResult.data.map((stage) => ({
          id: stage.id, position: stage.position, scope: stage.scope, label: stage.label, mode: stage.mode,
          minimumApprovals: stage.minimum_approvals, isMinorStage: stage.is_minor_stage, status: stage.status,
          // Der Autor sieht die Zusammensetzung einer noch nicht geoeffneten Stufe nicht (Plan 011).
          // Ueber opened_at statt einzelner Statuswerte: eine abgelehnte innere Stufe skipped alle
          // FOLGENDEN Stufen direkt aus 'pending', ohne dass sie je 'open' waren -- ein Check nur
          // auf status === 'pending' haette das nach der Ablehnung wieder offengelegt (beim
          // Geheimnisse-Review gefunden).
          reviewerUserIds: isAuthor && stage.opened_at === null ? null : (stage.reviewer_snapshot as { userId: string }[]).map((entry) => entry.userId),
          deadlineAt: stage.deadline_at,
          // 'stalled' ist der markierte Fall derselben Sache -- sonst zeigte eine vom Job markierte
          // Stufe "nicht überfällig" an, obwohl sie es gerade deswegen ist.
          isOverdue: (stage.status === 'open' || stage.status === 'stalled') && stage.deadline_at !== null && new Date(stage.deadline_at as string).getTime() < now,
          // Paket 015: dieser Detail-Endpunkt zeigt (anders als /v1/approval-stages/mine) bewusst
          // keine Medien-Gate-Blocker -- Autor und Pruefende sehen hier den Freigabestatus, die
          // Blocker-Berechnung ist an die Review-Liste gebunden. Dokumentierte Vereinfachung, kein
          // Vergessen: eine spaetere Vereinheitlichung koennte computeMediaGateBlockersForPostVersion
          // auch hier aufrufen.
          mediaGateBlockers: [],
        })),
        decisions: decisionsResult.data.map((decision) => ({
          id: decision.id, approvalStageId: decision.approval_stage_id, decidedBy: decision.decided_by,
          decision: decision.decision, reason: decision.reason, createdAt: decision.created_at,
        })),
        // Paket 024: damit der Autor liest, dass und warum seine Route geaendert wurde
        // (plans/024, "Umsetzung", Schritt 4). stages_before ist bereits die redigierte Projektion.
        routeChanges: routeChangesResult.data.map((change) => ({
          id: change.id, changedBy: change.changed_by, reason: change.reason,
          stagesBefore: change.stages_before, createdAt: change.created_at,
        })),
      }),
    )
  })

  // Fuer freigaben.vue ("wartet auf mich"): RLS liefert jede Stufe, die auth.uid() ueberhaupt sehen
  // darf (u. a. jedes Vereinsmitglied mit Organisationsrolle) -- der Filter auf den eigenen
  // reviewer_snapshot-Eintrag engt das hier auf tatsaechlich zugewiesene Stufen ein.
  // organizationId ist pflichtig: eine Person mit Pruefrollen in mehreren Vereinen saehe sonst die
  // Freigaben ALLER ihrer Vereine in der Liste eines einzelnen (beim Review dieses Pakets gefunden).
  app.get('/v1/approval-stages/mine', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // 'stalled' gehoert dazu: mark_stalled_approval_stages() markiert eine ueberfaellige Stufe, nimmt
    // ihr aber kein Recht (siehe authz.can_decide_stage). Ein Filter nur auf 'open' haette sie aus
    // genau der Liste verschwinden lassen, in der die zustaendige Person sie noch entscheiden soll.
    // fetchAllRows wie bei GET /v1/organizations/:id/members: max_rows=1000 wuerde die Stufenliste
    // einer grossen Organisation still abschneiden, und der Filter unten auf den eigenen
    // reviewer_snapshot-Eintrag liesse eine zustaendige Person ihre zugewiesene Stufe nicht mehr
    // sehen (gefunden im Code-Review dieses Pakets).
    const stageRows = await fetchAllRows<{
      id: string; position: number; scope: string; label: string; mode: string; minimum_approvals: number
      is_minor_stage: boolean; status: string; reviewer_snapshot: { userId: string }[]
      deadline_at: string | null; approval_request_id: string | null
    }>((from, to) =>
      client
        .from('approval_stages')
        .select('id, position, scope, label, mode, minimum_approvals, is_minor_stage, status, reviewer_snapshot, deadline_at, approval_request_id')
        .eq('organization_id', query.organizationId)
        .in('status', ['open', 'stalled'])
        .order('id', { ascending: true })
        .range(from, to),
    )
    const userId = request.auth!.userId
    const now = Date.now()
    const mine = stageRows.filter((row) => (row.reviewer_snapshot as { userId: string }[]).some((entry) => entry.userId === userId))

    const approvalRequestIds = Array.from(new Set(mine.map((row) => row.approval_request_id as string | undefined).filter((id): id is string => Boolean(id))))
    const approvalRequestRows = await fetchAllRowsForIds<{ id: string; post_id: string; post_version_id: string }>(approvalRequestIds, (batch, from, to) =>
      client.from('approval_requests').select('id, post_id, post_version_id').in('id', batch).order('id', { ascending: true }).range(from, to),
    )
    const postVersionByRequestId = new Map(approvalRequestRows.map((row) => [row.id, row.post_version_id]))
    const postIds = Array.from(new Set(approvalRequestRows.map((row) => row.post_id)))
    const postRows = await fetchAllRowsForIds<{ id: string; department_id: string }>(postIds, (batch, from, to) =>
      client.from('posts').select('id, department_id').in('id', batch).order('id', { ascending: true }).range(from, to),
    )
    const departmentByPostId = new Map(postRows.map((row) => [row.id, row.department_id]))
    const postIdByRequestId = new Map(approvalRequestRows.map((row) => [row.id, row.post_id]))

    // Kein unnoetiger Roundtrip auf policy_settings, wenn es (noch) keine einzige aufloesbare
    // Stufe gibt -- betrifft insbesondere den erwarteten Normalfall ohne Inhalts-Pipeline (siehe
    // plans/README.md), in dem approval_stages zwar existieren koennen, aber approval_request_id
    // ins Leere zeigt, solange kein echter Beitrag dahinter steht.
    const policyRows = postIds.length > 0 ? await fetchPolicyRuleRows(client, query.organizationId) : null
    const effectiveConfigByDepartmentId = new Map<string, ReturnType<typeof resolveEffectiveConfig>>()
    function effectivePolicyForDepartment(departmentId: string): { consentExpiresOnLeave: boolean } {
      let config = effectiveConfigByDepartmentId.get(departmentId)
      if (!config) {
        config = computeRuleEntry(policyRows!, 'department', departmentId, null).config
        effectiveConfigByDepartmentId.set(departmentId, config)
      }
      return { consentExpiresOnLeave: config.policies.consentExpiresOnLeave }
    }

    // Mehrere Stufen eines Freigabeantrags zeigen auf dieselbe post_version_id -- ohne Memoisierung
    // wuerden bis zu sieben Abfragen je Stufe unnoetig wiederholt (gefunden im Code-Review).
    //
    // Die Blocker-Abfrage laeuft ueber den Service-Client, alles davor bewusst weiter ueber den
    // Nutzer-Client: WELCHE Stufen der Aufrufer sieht, bleibt seine eigene Sichtbarkeit, aber die
    // Blocker einer Stufe, die er entscheiden soll, muessen vollstaendig sein. Ueber den Nutzer-Client
    // waren sie es fuer die typischen Freigebenden nicht (gefunden im Code-Review): post_media,
    // media_derivatives und consent_records verlangen per RLS is_organization_member, also eine
    // Organisationsrolle -- eine reine Abteilungs-'approver'-Rolle sah null Zeilen und damit die
    // leere Blockerliste, und wer eine Organisationsrolle ohne 'directory.read' hat (social_manager)
    // sah die Verzeichnisperson nicht und damit weder Minderjaehrigen- noch Austrittsfaelle. Beides
    // haette dem Freigebenden "keine Einwaende" gezeigt, wo welche bestehen. Nach aussen geht nur die
    // Liste der Blocker-Namen zu einer Stufe, fuer die der Aufrufer ohnehin als Pruefer eingetragen
    // ist (mine-Filter oben) -- keine Medien-, Einwilligungs- oder Verzeichnisdaten.
    const gateClient = supabaseClients.forService()
    const blockersByPostVersionId = new Map<string, Promise<MediaGateBlocker[]>>()
    const blockersByStage = await Promise.all(
      mine.map(async (row) => {
        const postVersionId = postVersionByRequestId.get(row.approval_request_id as string)
        const postId = postIdByRequestId.get(row.approval_request_id as string)
        const departmentId = postId ? departmentByPostId.get(postId) : undefined
        if (!postVersionId || !departmentId) return []
        let pending = blockersByPostVersionId.get(postVersionId)
        if (!pending) {
          pending = computeMediaGateBlockersForPostVersion(gateClient, postVersionId, departmentId, effectivePolicyForDepartment(departmentId))
          blockersByPostVersionId.set(postVersionId, pending)
        }
        return pending
      }),
    )

    return reply.code(200).send(
      mine.map((row, index) =>
        ApprovalStageSchema.parse({
          id: row.id, position: row.position, scope: row.scope, label: row.label, mode: row.mode,
          minimumApprovals: row.minimum_approvals, isMinorStage: row.is_minor_stage, status: row.status,
          reviewerUserIds: (row.reviewer_snapshot as { userId: string }[]).map((entry) => entry.userId),
          deadlineAt: row.deadline_at, isOverdue: row.deadline_at !== null && new Date(row.deadline_at as string).getTime() < now,
          mediaGateBlockers: blockersByStage[index] ?? [],
        }),
      ),
    )
  })
}
