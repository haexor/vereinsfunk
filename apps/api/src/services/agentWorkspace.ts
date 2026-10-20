import {
  AgentWorkspaceSchema,
  OAuthPlatformSchema,
  UuidSchema,
  type AgentScope,
  type AgentWorkspace,
} from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyBaseLogger } from 'fastify'
import { z } from 'zod'

// Eingebettete Zeilen der Workspace-Abfragen (PostgREST liefert eine n:1-Einbettung als Objekt).
// departmentId null = Beitrag auf Vereinsebene.
const EmbeddedPostScopeSchema = z.object({ department_id: UuidSchema.nullable(), team_id: UuidSchema.nullable() })

const ScopedApprovalStageRowSchema = z.object({
  id: UuidSchema,
  label: z.string(),
  deadline_at: z.string().nullable(),
  approval_requests: z.object({
    post_id: UuidSchema,
    post_version_id: UuidSchema,
    post_versions: z.object({ title: z.string() }).nullable(),
    posts: EmbeddedPostScopeSchema,
  }),
})

const ScopedPublicationRowSchema = z.object({
  id: UuidSchema,
  platform: OAuthPlatformSchema,
  status: z.string(),
  scheduled_for: z.string().nullable(),
  post_versions: z.object({ id: UuidSchema, title: z.string(), posts: EmbeddedPostScopeSchema }),
})

async function loadWorkspace(
  client: SupabaseClient,
  scope: AgentScope,
  userId: string,
  logger: FastifyBaseLogger,
): Promise<AgentWorkspace> {
  let postsQuery = client
    .from('posts')
    .select('id, department_id, status, current_version_id, scheduled_for, updated_at')
    .eq('organization_id', scope.organizationId)
    .order('updated_at', { ascending: false })
    .limit(20)
  if (scope.departmentId) postsQuery = postsQuery.eq('department_id', scope.departmentId)
  if (scope.teamId) postsQuery = postsQuery.eq('team_id', scope.teamId)

  let eventsQuery = client
    .from('club_events')
    .select('id, department_id, title, starts_at, status')
    .eq('organization_id', scope.organizationId)
    .neq('status', 'cancelled')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(20)
  if (scope.departmentId) eventsQuery = eventsQuery.or(`department_id.eq.${scope.departmentId},department_id.is.null`)
  if (scope.teamId) eventsQuery = eventsQuery.eq('team_id', scope.teamId)

  // Nur offene Stufen, denen der aktuelle Nutzer tatsächlich zugeordnet ist. Das JSON-Containment
  // ergänzt die RLS-Sichtbarkeit; eine Organisationsrolle allein darf keine fremde Aufgabe in die
  // Agentenantwort bringen. Abteilung und Mannschaft stehen erst am Beitrag: der Scope-Filter laeuft
  // ueber die eingebetteten Zeilen (beide !inner) in der Abfrage selbst und damit vor dem limit.
  let approvalsQuery = client
    .from('approval_stages')
    .select('id, label, deadline_at, approval_requests!inner(post_id, post_version_id, post_versions(title), posts!inner(department_id, team_id))')
    .eq('organization_id', scope.organizationId)
    .in('status', ['open', 'stalled'])
    .contains('reviewer_snapshot', [{ userId }])
    .order('deadline_at', { ascending: true })
    .limit(20)
  if (scope.departmentId) approvalsQuery = approvalsQuery.eq('approval_requests.posts.department_id', scope.departmentId)
  if (scope.teamId) approvalsQuery = approvalsQuery.eq('approval_requests.posts.team_id', scope.teamId)

  // Textkandidaten sind eine ergänzende Kachel und dürfen den Arbeitsplatz nie blockieren (siehe
  // Kommentar unten) -- die Abfrage läuft aber weiterhin in derselben Runde wie die drei
  // Kernübersichten, statt erst nach deren komplettem Folge-Anfragen zu starten.
  let candidateSessionsQuery = client
    .from('composition_sessions')
    .select('id, department_id, team_id')
    .eq('organization_id', scope.organizationId)
    .eq('status', 'candidate_ready')
    .order('created_at', { ascending: false })
    .limit(20)
  if (scope.departmentId) candidateSessionsQuery = candidateSessionsQuery.eq('department_id', scope.departmentId)
  if (scope.teamId) candidateSessionsQuery = candidateSessionsQuery.eq('team_id', scope.teamId)

  // publications kennt keine Abteilung: Version und Beitrag werden eingebettet (beide !inner), damit
  // der Scope-Filter vor dem limit greift. Gefiltert nach dem limit fuellten fremde Abteilungen die
  // 20 Plaetze, und eine Abteilungsunterhaltung sah ihre eigenen faelligen Veroeffentlichungen nicht.
  // Der Hinweis auf den Fremdschluessel ist noetig, weil posts.current_version_id eine zweite
  // Beziehung zwischen posts und post_versions bildet.
  const publicationColumns = 'id, platform, status, scheduled_for, post_versions!inner(id, title, posts!post_versions_organization_id_post_id_fkey!inner(department_id, team_id))'
  let publicationsQuery = client
    .from('publications')
    .select(publicationColumns)
    .eq('organization_id', scope.organizationId)
    .eq('status', 'queued')
    .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`)
    .order('scheduled_for', { ascending: true })
    .limit(20)
  let publicationActivitiesQuery = client
    .from('publications')
    .select(publicationColumns)
    .eq('organization_id', scope.organizationId)
    .in('status', ['action_required', 'failed'])
    .order('updated_at', { ascending: false })
    .limit(20)
  if (scope.departmentId) {
    publicationsQuery = publicationsQuery.eq('post_versions.posts.department_id', scope.departmentId)
    publicationActivitiesQuery = publicationActivitiesQuery.eq('post_versions.posts.department_id', scope.departmentId)
  }
  if (scope.teamId) {
    publicationsQuery = publicationsQuery.eq('post_versions.posts.team_id', scope.teamId)
    publicationActivitiesQuery = publicationActivitiesQuery.eq('post_versions.posts.team_id', scope.teamId)
  }

  const [postsResult, eventsResult, approvalStagesResult, candidateSessionsResult, publicationsResult, publicationActivitiesResult] = await Promise.all([postsQuery, eventsQuery, approvalsQuery, candidateSessionsQuery, publicationsQuery, publicationActivitiesQuery])
  if (postsResult.error) throw postsResult.error
  if (eventsResult.error) throw eventsResult.error
  if (approvalStagesResult.error) throw approvalStagesResult.error

  const posts = postsResult.data ?? []
  const currentVersionIds = posts.map((row) => row.current_version_id as string | null).filter((id): id is string => id !== null)
  const versionResult = currentVersionIds.length === 0
    ? { data: [], error: null }
    : await client.from('post_versions').select('id, title').in('id', currentVersionIds)
  if (versionResult.error) throw versionResult.error
  const titleByVersionId = new Map((versionResult.data ?? []).map((row) => [row.id as string, row.title as string]))

  const approvalStages = z.array(ScopedApprovalStageRowSchema).parse(approvalStagesResult.data ?? [])
  // Textkandidaten sind eine ergänzende Kachel. Ein unvollständiges Upgrade oder ein einzelner
  // fehlerhafter Datensatz darf nie den gesamten Chat-Arbeitsplatz blockieren (die drei
  // Kernübersichten oben bleiben dabei weiterhin strikt fehlerhaft, statt Daten zu verstecken).
  let readyTextCandidates: AgentWorkspace['readyTextCandidates'] = []
  try {
    if (candidateSessionsResult.error) throw candidateSessionsResult.error
    const candidateSessions = candidateSessionsResult.data ?? []
    const candidateSessionById = new Map(candidateSessions.map((row) => [row.id as string, row]))
    const candidatesResult = candidateSessions.length === 0
      ? { data: [], error: null }
      : await client.from('generation_candidates').select('id, composition_session_id, generated_content').in('composition_session_id', candidateSessions.map((row) => row.id as string)).eq('status', 'ready').order('created_at', { ascending: false }).limit(20)
    if (candidatesResult.error) throw candidatesResult.error
    readyTextCandidates = (candidatesResult.data ?? []).flatMap((row) => {
      const session = candidateSessionById.get(row.composition_session_id as string)
      const content = z.object({ headline: z.string() }).nullable().safeParse(row.generated_content)
      if (!session || !content.success || content.data === null) return []
      return [{ id: row.id as string, sessionId: row.composition_session_id as string, departmentId: session.department_id as string | null, teamId: session.team_id as string | null, headline: content.data.headline.slice(0, 200) }]
    })
  } catch (error) {
    logger.warn({ err: error }, 'ready text candidates unavailable, degrading to empty list')
    readyTextCandidates = []
  }
  let duePublications: AgentWorkspace['duePublications'] = []
  let publicationActivities: AgentWorkspace['publicationActivities'] = []
  try {
    if (publicationsResult.error) throw publicationsResult.error
    if (publicationActivitiesResult.error) throw publicationActivitiesResult.error
    const queuedPublications = z.array(ScopedPublicationRowSchema).parse(publicationsResult.data ?? [])
    const failedPublications = z.array(ScopedPublicationRowSchema).parse(publicationActivitiesResult.data ?? [])
    duePublications = queuedPublications.map((publication) => ({
      id: publication.id, postVersionId: publication.post_versions.id, departmentId: publication.post_versions.posts.department_id, teamId: publication.post_versions.posts.team_id,
      title: publication.post_versions.title.slice(0, 200), platform: publication.platform, scheduledFor: publication.scheduled_for,
    }))
    const failedPublicationIds = failedPublications.map((publication) => publication.id)
    const attempts = failedPublicationIds.length === 0
      ? { data: [], error: null }
      : await client.from('publication_attempts').select('publication_id, error_class').in('publication_id', failedPublicationIds).order('attempt_number', { ascending: false })
    if (attempts.error) throw attempts.error
    const errorClassByPublicationId = new Map<string, string>()
    for (const attempt of attempts.data ?? []) {
      if (!errorClassByPublicationId.has(attempt.publication_id as string) && attempt.error_class !== null) errorClassByPublicationId.set(attempt.publication_id as string, attempt.error_class as string)
    }
    publicationActivities = failedPublications.map((publication) => ({
      id: publication.id, departmentId: publication.post_versions.posts.department_id, teamId: publication.post_versions.posts.team_id,
      title: publication.post_versions.title.slice(0, 200), platform: publication.platform, status: z.enum(['action_required', 'failed']).parse(publication.status),
      errorClass: z.enum(['validation', 'non_retryable', 'retryable', 'unknown']).nullable().parse(errorClassByPublicationId.get(publication.id) ?? null),
    }))
  } catch (error) {
    logger.warn({ err: error }, 'publication workspace summaries unavailable, degrading to empty lists')
    duePublications = []
    publicationActivities = []
  }
  const now = Date.now()

  return AgentWorkspaceSchema.parse({
    ...scope,
    posts: posts.map((row) => ({
      id: row.id,
      departmentId: row.department_id,
      title: titleByVersionId.get(row.current_version_id as string) ?? '',
      status: row.status,
      scheduledFor: row.scheduled_for,
      currentVersionId: row.current_version_id,
      updatedAt: row.updated_at,
    })),
    events: (eventsResult.data ?? []).map((row) => ({
      id: row.id,
      departmentId: row.department_id,
      title: row.title,
      startsAt: row.starts_at,
      status: row.status,
    })),
    pendingApprovals: approvalStages.map((stage) => ({
      stageId: stage.id,
      postId: stage.approval_requests.post_id,
      postVersionId: stage.approval_requests.post_version_id,
      departmentId: stage.approval_requests.posts.department_id,
      title: stage.approval_requests.post_versions?.title ?? '',
      label: stage.label,
      deadlineAt: stage.deadline_at,
      isOverdue: stage.deadline_at !== null && new Date(stage.deadline_at).getTime() < now,
    })),
    readyTextCandidates,
    duePublications,
    publicationActivities,
  })
}

// Die Workspace-Kacheln sind ausschliesslich lesender Kontext für den Assistenten. Ein Fehler in
// einer einzelnen Abfrage (etwa während eines gestaffelten Datenbank-Upgrades oder bei einem
// einzelnen Altdatensatz) darf deshalb weder das Anlegen einer Unterhaltung noch das Senden einer
// Nachricht verhindern. Scope- und Mitgliedschaftsprüfung passieren vor diesem Aufruf weiterhin
// strikt; der leere Fallback kann also keine Daten eines anderen Mandanten sichtbar machen.
export async function loadWorkspaceOrEmpty(
  client: SupabaseClient,
  scope: AgentScope,
  userId: string,
  logger: FastifyBaseLogger,
): Promise<AgentWorkspace> {
  try {
    return await loadWorkspace(client, scope, userId, logger)
  } catch (error) {
    logger.error({ err: error }, 'agent workspace unavailable, returning empty workspace')
    return AgentWorkspaceSchema.parse({
      ...scope,
      posts: [],
      events: [],
      pendingApprovals: [],
      readyTextCandidates: [],
      duePublications: [],
      publicationActivities: [],
    })
  }
}
