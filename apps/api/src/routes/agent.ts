import {
  AgentConversationDetailSchema,
  AgentConversationSchema,
  AgentActionProposalSchema,
  AgentApprovalProposalInputSchema,
  AgentContentBriefProposalInputSchema,
  AgentProposalTargetRefSchema,
  AgentPublicationExecutionProposalInputSchema,
  AgentSchedulePublicationProposalInputSchema,
  AgentTextCandidateAcceptanceProposalInputSchema,
  AgentTextGenerationProposalInputSchema,
  AgentEventProposalInputSchema,
  CreateCompositionSessionSchema,
  CreateInvitationRequestSchema,
  AgentMessageSchema,
  OAuthPlatformSchema,
  AgentScopeSchema,
  AgentWorkspaceSchema,
  CreateAgentConversationSchema,
  CreateAgentActionProposalSchema,
  CreateAgentMessageSchema,
  TextWorkshopDraftPayloadSchema,
  UuidSchema,
  type AgentConversation,
  type AgentActionProposal,
  type CreateAgentActionProposal,
  type AgentMessage,
  type AgentScope,
  type AgentWorkspace,
} from '@vereinsfunk/contracts'
import { canAssignRole, hasPermission } from '@vereinsfunk/authorization'
import { resolveAvailableChannels } from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { hashAgentProposalInput } from '@vereinsfunk/domain'
import type { AgentResponder } from '../agent.js'
import { createClubEvent } from '../services/clubEvents.js'
import { createInvitation } from '../services/invitations.js'
import { saveTextWorkshopDraft } from '../services/textWorkshopDrafts.js'
import { createTextGenerationSession } from '../services/textGenerationSessions.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, isAnyMemberOfOrganization, resolveDirectoryScope, toChannelCandidates, toPermissionScope } from './shared.js'

const ConversationRowSchema = z.object({
  id: UuidSchema,
  organization_id: UuidSchema,
  department_id: UuidSchema.nullable(),
  team_id: UuidSchema.nullable(),
  created_by: UuidSchema,
  title: z.string().nullable(),
  last_activity_at: z.string(),
  archived_at: z.string().nullable(),
  retention_expires_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})
const MessageRowSchema = z.object({
  id: UuidSchema,
  organization_id: UuidSchema,
  conversation_id: UuidSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  created_at: z.string(),
})
const MessageMediaReferenceRowSchema = z.object({
  agent_message_id: UuidSchema,
  media_asset_id: UuidSchema,
  position: z.number().int().min(0).max(9),
})
const PersistedMessagesRowSchema = z.object({
  user_message: MessageRowSchema,
  assistant_message: MessageRowSchema,
  last_activity_at: z.string(),
})
const ProposalRowSchema = z.object({
  id: UuidSchema,
  organization_id: UuidSchema,
  conversation_id: UuidSchema,
  created_by: UuidSchema,
  tool_name: z.enum(['create_event', 'create_invitation', 'request_approval', 'save_content_brief', 'start_text_generation', 'accept_text_candidate', 'schedule_publication', 'execute_publication']),
  scope_snapshot: z.unknown(),
  input_snapshot: z.unknown(),
  input_hash: z.string(),
  target_refs: z.array(AgentProposalTargetRefSchema),
  status: z.enum(['pending', 'executing', 'confirmed', 'cancelled', 'expired', 'failed']),
  expires_at: z.string(),
  confirmed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

class AgentProposalExecutionError extends Error {
  constructor(readonly statusCode: 404 | 409 | 422 | 502 | 503, readonly errorCode: string) {
    super(errorCode)
  }
}

function mapConversation(row: unknown): AgentConversation {
  const parsed = ConversationRowSchema.parse(row)
  return AgentConversationSchema.parse({
    id: parsed.id,
    organizationId: parsed.organization_id,
    departmentId: parsed.department_id,
    teamId: parsed.team_id,
    createdBy: parsed.created_by,
    title: parsed.title,
    lastActivityAt: parsed.last_activity_at,
    archivedAt: parsed.archived_at,
    retentionExpiresAt: parsed.retention_expires_at,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  })
}

function mapMessage(row: unknown, mediaAssetIds: string[] = []): AgentMessage {
  const parsed = MessageRowSchema.parse(row)
  return AgentMessageSchema.parse({
    id: parsed.id,
    conversationId: parsed.conversation_id,
    organizationId: parsed.organization_id,
    role: parsed.role,
    content: parsed.content,
    mediaAssetIds,
    createdAt: parsed.created_at,
  })
}

function mapProposal(row: unknown): AgentActionProposal {
  const parsed = ProposalRowSchema.parse(row)
  const scope = AgentScopeSchema.parse(parsed.scope_snapshot)
  if (scope.organizationId !== parsed.organization_id) throw new Error('agent_proposal_scope_mismatch')
  return AgentActionProposalSchema.parse({
    id: parsed.id,
    conversationId: parsed.conversation_id,
    createdBy: parsed.created_by,
    toolName: parsed.tool_name,
    input: parsed.input_snapshot,
    inputHash: parsed.input_hash,
    targetRefs: parsed.target_refs,
    status: parsed.status,
    expiresAt: parsed.expires_at,
    confirmedAt: parsed.confirmed_at,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
    ...scope,
    organizationId: parsed.organization_id,
  })
}

function scopeForConversation(conversation: AgentConversation): AgentScope {
  return AgentScopeSchema.parse({
    organizationId: conversation.organizationId,
    departmentId: conversation.departmentId,
    teamId: conversation.teamId,
  })
}

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
  // Agentenantwort bringen.
  const approvalsQuery = client
    .from('approval_stages')
    .select('id, label, deadline_at, status, approval_request_id, reviewer_snapshot')
    .eq('organization_id', scope.organizationId)
    .in('status', ['open', 'stalled'])
    .contains('reviewer_snapshot', [{ userId }])
    .order('deadline_at', { ascending: true })
    .limit(20)

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

  const publicationsQuery = client
    .from('publications')
    .select('id, organization_id, post_version_id, platform, status, scheduled_for')
    .eq('organization_id', scope.organizationId)
    .eq('status', 'queued')
    .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`)
    .order('scheduled_for', { ascending: true })
    .limit(20)
  const publicationActivitiesQuery = client
    .from('publications')
    .select('id, organization_id, post_version_id, platform, status')
    .eq('organization_id', scope.organizationId)
    .in('status', ['action_required', 'failed'])
    .order('updated_at', { ascending: false })
    .limit(20)

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

  const approvalStages = approvalStagesResult.data ?? []
  const approvalRequestIds = approvalStages
    .map((row) => row.approval_request_id as string | null)
    .filter((id): id is string => id !== null)
  const requestsResult = approvalRequestIds.length === 0
    ? { data: [], error: null }
    : await client.from('approval_requests').select('id, post_id, post_version_id').in('id', approvalRequestIds)
  if (requestsResult.error) throw requestsResult.error
  const requestById = new Map((requestsResult.data ?? []).map((row) => [row.id as string, row]))
  const approvalPostIds = [...new Set((requestsResult.data ?? []).map((row) => row.post_id as string))]
  const approvalPostsResult = approvalPostIds.length === 0
    ? { data: [], error: null }
    : await client.from('posts').select('id, department_id, team_id').in('id', approvalPostIds)
  if (approvalPostsResult.error) throw approvalPostsResult.error
  const scopeByApprovalPostId = new Map((approvalPostsResult.data ?? []).map((row) => [row.id as string, {
    departmentId: row.department_id as string,
    teamId: row.team_id as string | null,
  }]))
  const approvalVersionIds = [...new Set((requestsResult.data ?? []).map((row) => row.post_version_id as string))]
  const approvalVersionsResult = approvalVersionIds.length === 0
    ? { data: [], error: null }
    : await client.from('post_versions').select('id, title').in('id', approvalVersionIds)
  if (approvalVersionsResult.error) throw approvalVersionsResult.error
  const approvalTitleByVersionId = new Map((approvalVersionsResult.data ?? []).map((row) => [row.id as string, row.title as string]))
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
      return [{ id: row.id as string, sessionId: row.composition_session_id as string, departmentId: session.department_id as string, teamId: session.team_id as string | null, headline: content.data.headline.slice(0, 200) }]
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
    const queuedPublications = publicationsResult.data ?? []
    const failedPublications = publicationActivitiesResult.data ?? []
    const trackedPublications = [...queuedPublications, ...failedPublications]
    const publicationVersionIds = [...new Set(trackedPublications.map((row) => row.post_version_id as string))]
    const publicationVersions = publicationVersionIds.length === 0
      ? { data: [], error: null }
      : await client.from('post_versions').select('id, post_id, title').in('id', publicationVersionIds)
    if (publicationVersions.error) throw publicationVersions.error
    const versionById = new Map((publicationVersions.data ?? []).map((row) => [row.id as string, row]))
    const publicationPostIds = [...new Set((publicationVersions.data ?? []).map((row) => row.post_id as string))]
    const publicationPosts = publicationPostIds.length === 0
      ? { data: [], error: null }
      : await client.from('posts').select('id, department_id, team_id').in('id', publicationPostIds)
    if (publicationPosts.error) throw publicationPosts.error
    const postById = new Map((publicationPosts.data ?? []).map((row) => [row.id as string, row]))
    duePublications = queuedPublications.flatMap((publication) => {
      const version = versionById.get(publication.post_version_id as string)
      const post = version ? postById.get(version.post_id as string) : undefined
      if (!version || !post || (scope.departmentId && scope.departmentId !== post.department_id) || (scope.teamId && scope.teamId !== post.team_id)) return []
      return [{ id: publication.id as string, postVersionId: version.id as string, departmentId: post.department_id as string, teamId: post.team_id as string | null, title: (version.title as string).slice(0, 200), platform: OAuthPlatformSchema.parse(publication.platform), scheduledFor: publication.scheduled_for as string | null }]
    })
    const failedPublicationIds = failedPublications.map((publication) => publication.id as string)
    const attempts = failedPublicationIds.length === 0
      ? { data: [], error: null }
      : await client.from('publication_attempts').select('publication_id, error_class').in('publication_id', failedPublicationIds).order('attempt_number', { ascending: false })
    if (attempts.error) throw attempts.error
    const errorClassByPublicationId = new Map<string, string>()
    for (const attempt of attempts.data ?? []) {
      if (!errorClassByPublicationId.has(attempt.publication_id as string) && attempt.error_class !== null) errorClassByPublicationId.set(attempt.publication_id as string, attempt.error_class as string)
    }
    publicationActivities = failedPublications.flatMap((publication) => {
      const version = versionById.get(publication.post_version_id as string)
      const post = version ? postById.get(version.post_id as string) : undefined
      if (!version || !post || (scope.departmentId && scope.departmentId !== post.department_id) || (scope.teamId && scope.teamId !== post.team_id)) return []
      return [{ id: publication.id as string, departmentId: post.department_id as string, teamId: post.team_id as string | null, title: (version.title as string).slice(0, 200), platform: OAuthPlatformSchema.parse(publication.platform), status: z.enum(['action_required', 'failed']).parse(publication.status), errorClass: z.enum(['validation', 'non_retryable', 'retryable', 'unknown']).nullable().parse(errorClassByPublicationId.get(publication.id as string) ?? null) }]
    })
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
    pendingApprovals: approvalStages.flatMap((stage) => {
      const request = requestById.get(stage.approval_request_id as string)
      if (!request) return []
      const postScope = scopeByApprovalPostId.get(request.post_id as string)
      if (!postScope) return []
      if (scope.departmentId && scope.departmentId !== postScope.departmentId) return []
      if (scope.teamId && scope.teamId !== postScope.teamId) return []
      return [{
        stageId: stage.id,
        postId: request.post_id,
        postVersionId: request.post_version_id,
        departmentId: postScope.departmentId,
        title: approvalTitleByVersionId.get(request.post_version_id as string) ?? '',
        label: stage.label,
        deadlineAt: stage.deadline_at,
        isOverdue: stage.deadline_at !== null && new Date(stage.deadline_at as string).getTime() < now,
      }]
    }),
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
async function loadWorkspaceOrEmpty(
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

async function loadConversation(client: SupabaseClient, id: string): Promise<AgentConversation | null> {
  const result = await client
    .from('agent_conversations')
    .select('id, organization_id, department_id, team_id, created_by, title, last_activity_at, archived_at, retention_expires_at, created_at, updated_at')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle()
  if (result.error) throw result.error
  return result.data ? mapConversation(result.data) : null
}

async function loadMessages(client: SupabaseClient, conversation: AgentConversation): Promise<AgentMessage[]> {
  const result = await client
    .from('agent_messages')
    .select('id, organization_id, conversation_id, role, content, created_at')
    .eq('organization_id', conversation.organizationId)
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true })
    .limit(100)
  if (result.error) throw result.error
  const rows = result.data ?? []
  if (rows.length === 0) return []
  const references = await client
    .from('agent_message_media_references')
    .select('agent_message_id, media_asset_id, position')
    .eq('organization_id', conversation.organizationId)
    .in('agent_message_id', rows.map((row) => row.id as string))
    .order('position', { ascending: true })
  if (references.error) throw references.error
  const mediaAssetIdsByMessageId = new Map<string, string[]>()
  for (const row of references.data ?? []) {
    const reference = MessageMediaReferenceRowSchema.parse(row)
    const mediaAssetIds = mediaAssetIdsByMessageId.get(reference.agent_message_id) ?? []
    mediaAssetIds.push(reference.media_asset_id)
    mediaAssetIdsByMessageId.set(reference.agent_message_id, mediaAssetIds)
  }
  return rows.map((row) => mapMessage(row, mediaAssetIdsByMessageId.get(row.id as string) ?? []))
}

type ApprovalTarget = { organizationId: string; departmentId: string; teamId: string | null; postId: string }
type TextCandidateTarget = { organizationId: string; departmentId: string; teamId: string | null; sessionId: string }
type ScheduleTarget = ApprovalTarget & { socialConnectionId: string }
type PublicationTarget = ApprovalTarget & { publicationId: string }

async function loadApprovalTarget(client: SupabaseClient, postVersionId: string): Promise<ApprovalTarget | null> {
  const version = await client.from('post_versions').select('id, post_id').eq('id', postVersionId).maybeSingle()
  if (version.error) throw version.error
  if (!version.data) return null
  const post = await client.from('posts').select('id, organization_id, department_id, team_id').eq('id', version.data.post_id as string).maybeSingle()
  if (post.error) throw post.error
  if (!post.data) return null
  return { organizationId: post.data.organization_id as string, departmentId: post.data.department_id as string, teamId: post.data.team_id as string | null, postId: post.data.id as string }
}

async function loadTextCandidateTarget(client: SupabaseClient, candidateId: string): Promise<TextCandidateTarget | null> {
  const candidate = await client.from('generation_candidates').select('organization_id, composition_session_id, status').eq('id', candidateId).maybeSingle()
  if (candidate.error) throw candidate.error
  if (!candidate.data || candidate.data.status !== 'ready') return null
  const session = await client.from('composition_sessions').select('organization_id, department_id, team_id').eq('id', candidate.data.composition_session_id as string).maybeSingle()
  if (session.error) throw session.error
  if (!session.data || session.data.organization_id !== candidate.data.organization_id) return null
  return { organizationId: session.data.organization_id as string, departmentId: session.data.department_id as string, teamId: session.data.team_id as string | null, sessionId: candidate.data.composition_session_id as string }
}

async function loadScheduleTarget(client: SupabaseClient, input: z.infer<typeof AgentSchedulePublicationProposalInputSchema>): Promise<ScheduleTarget | null> {
  const version = await client.from('post_versions').select('id, post_id, effective_config_snapshot').eq('id', input.postVersionId).maybeSingle()
  if (version.error) throw version.error
  if (!version.data) return null
  const post = await client.from('posts').select('id, organization_id, department_id, team_id, status, current_version_id').eq('id', version.data.post_id as string).maybeSingle()
  if (post.error) throw post.error
  if (!post.data || post.data.status !== 'approved' || post.data.current_version_id !== version.data.id) return null
  const [connections, scopeRows, policy] = await Promise.all([
    client.from('social_connections').select('id, platform, status, archived_at, responsible_profile_id').eq('organization_id', post.data.organization_id).eq('platform', input.platform),
    client.from('channel_scopes').select('social_connection_id, scope, department_id, team_id, can_schedule').eq('organization_id', post.data.organization_id),
    client.from('policy_settings').select('require_channel_responsible').eq('organization_id', post.data.organization_id).eq('scope', 'organization').maybeSingle(),
  ])
  if (connections.error) throw connections.error
  if (scopeRows.error) throw scopeRows.error
  if (policy.error) throw policy.error
  const snapshot = version.data.effective_config_snapshot as { config?: { allowedChannelIds?: unknown } } | null
  const allowedChannelIds = Array.isArray(snapshot?.config?.allowedChannelIds) ? snapshot!.config!.allowedChannelIds as string[] : null
  const channelIds = resolveAvailableChannels({
    scope: post.data.team_id ? 'team' : 'department', departmentId: post.data.department_id as string,
    ...(post.data.team_id ? { teamId: post.data.team_id as string } : {}), channels: toChannelCandidates(connections.data, scopeRows.data), allowedChannelIds,
    requireChannelResponsible: policy.data?.require_channel_responsible ?? false,
  })
  if (channelIds.length !== 1) return null
  return { organizationId: post.data.organization_id as string, departmentId: post.data.department_id as string, teamId: post.data.team_id as string | null, postId: post.data.id as string, socialConnectionId: channelIds[0]! }
}

async function loadPublicationTarget(client: SupabaseClient, publicationId: string): Promise<PublicationTarget | null> {
  const publication = await client.from('publications').select('id, organization_id, post_version_id, status, scheduled_for').eq('id', publicationId).maybeSingle()
  if (publication.error) throw publication.error
  if (!publication.data || publication.data.status !== 'queued') return null
  const scheduledFor = publication.data.scheduled_for as string | null
  if (scheduledFor !== null && new Date(scheduledFor).getTime() > Date.now()) return null
  const version = await client.from('post_versions').select('post_id').eq('id', publication.data.post_version_id as string).maybeSingle()
  if (version.error) throw version.error
  if (!version.data) return null
  const post = await client.from('posts').select('id, organization_id, department_id, team_id').eq('id', version.data.post_id as string).maybeSingle()
  if (post.error) throw post.error
  if (!post.data || post.data.organization_id !== publication.data.organization_id) return null
  return { publicationId: publication.data.id as string, postId: post.data.id as string, organizationId: post.data.organization_id as string, departmentId: post.data.department_id as string, teamId: post.data.team_id as string | null }
}

function matchesScope(scope: AgentScope, target: Pick<ApprovalTarget, 'organizationId' | 'departmentId' | 'teamId'>): boolean {
  return scope.organizationId === target.organizationId
    && scope.departmentId === target.departmentId
    && (scope.teamId ?? null) === target.teamId
}

function toTextWorkshopDraftPayload(input: z.infer<typeof AgentContentBriefProposalInputSchema>) {
  const approvedQuotes = input.sourceMaterial.quotes
    .filter((quote) => quote.approved)
    .map((quote) => `Zitat: ${quote.text}${quote.attribution ? ` (${quote.attribution})` : ''}`)
  const factsText = Object.entries(input.sourceMaterial.facts).map(([key, value]) => `${key}: ${String(value)}`).join('\n')
  const observation = [...input.sourceMaterial.observations, ...approvedQuotes].join('\n')
  const doNotMention = input.sourceMaterial.doNotMention.join('\n')
  // SourceMaterialSchema erlaubt längere Ableitungen als TextWorkshopDraftPayloadSchema; kürzen
  // statt den Entwurf ungeprüft zu schreiben und erst beim Rücklesen scheitern zu lassen.
  return TextWorkshopDraftPayloadSchema.parse({
    communicationGoal: input.communicationGoal,
    factsText: factsText.slice(0, 10_000),
    observation: observation.slice(0, 5_000),
    doNotMention: doNotMention.slice(0, 5_000),
    selectedProfile: input.systemStyleProfileSlug,
    temperature: 0.6 as const,
    selectedPlatforms: input.targetPlatforms,
    maxCharactersOverride: '',
  })
}

function toInitialTextGenerationInput(scope: AgentScope, input: z.infer<typeof AgentTextGenerationProposalInputSchema>) {
  return CreateCompositionSessionSchema.parse({
    organizationId: scope.organizationId,
    departmentId: scope.departmentId,
    teamId: scope.teamId,
    communicationGoal: input.communicationGoal,
    requestedFormats: ['text_post'],
    systemStyleProfileSlug: input.systemStyleProfileSlug,
    sourceMaterial: input.sourceMaterial,
    mediaAssetIds: [],
    sourceRevision: 1,
    targetPlatforms: input.targetPlatforms,
  })
}

async function insertActionProposal(
  service: SupabaseClient,
  conversation: AgentConversation,
  actorUserId: string,
  input: CreateAgentActionProposal,
): Promise<AgentActionProposal> {
  const scope = scopeForConversation(conversation)
  // Revalidierung verhindert, dass ein interner Aufrufer zur Laufzeit Scope-Schlüssel in den
  // Snapshot schmuggelt. Der Snapshot enthält ausschließlich die Tool-Payload.
  const normalizedInput = CreateAgentActionProposalSchema.parse(input)
  const serializedInput = normalizedInput.input as Record<string, unknown>
  const created = await service.from('agent_action_proposals').insert({
    organization_id: conversation.organizationId,
    conversation_id: conversation.id,
    created_by: actorUserId,
    tool_name: normalizedInput.toolName,
    scope_snapshot: scope,
    input_snapshot: serializedInput,
    input_hash: hashAgentProposalInput(serializedInput),
    risk_class: normalizedInput.toolName === 'create_invitation' || normalizedInput.toolName === 'execute_publication' ? 'external' : 'write',
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  }).select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, target_refs, status, expires_at, confirmed_at, created_at, updated_at').single()
  if (created.error) throw created.error
  return mapProposal(created.data)
}

export function registerAgentRoutes(
  app: FastifyInstance,
  context: ApiRouteContext,
  responder: AgentResponder,
): void {
  const { requireAuth, supabaseClients, roleProvider, environment } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.get('/v1/agent/workspace', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const scope = AgentScopeSchema.parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const validatedScope = await resolveDirectoryScope(client, scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null)
    if (!validatedScope || !(await isAnyMemberOfOrganization(client, request.auth!.userId, scope.organizationId))) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    return reply.code(200).send(await loadWorkspaceOrEmpty(client, scope, request.auth!.userId, request.log))
  })

  app.post('/v1/agent/conversations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateAgentConversationSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const validatedScope = await resolveDirectoryScope(client, input.organizationId, input.departmentId ?? null, input.teamId ?? null)
    if (!validatedScope || !(await isAnyMemberOfOrganization(client, request.auth!.userId, input.organizationId))) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const created = await supabaseClients.forService().from('agent_conversations').insert({
      organization_id: input.organizationId,
      department_id: input.departmentId ?? null,
      team_id: input.teamId ?? null,
      created_by: request.auth!.userId,
    }).select('id, organization_id, department_id, team_id, created_by, title, last_activity_at, archived_at, retention_expires_at, created_at, updated_at').single()
    if (created.error) throw created.error
    const conversation = mapConversation(created.data)
    await recordAuditEvent(request, {
      organizationId: conversation.organizationId,
      action: 'agent.conversation_created',
      entityType: 'agent_conversations',
      entityId: conversation.id,
    })
    return reply.code(201).send(AgentConversationSchema.parse(conversation))
  })

  app.get('/v1/agent/conversations/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const conversation = await loadConversation(client, params.id)
    if (!conversation) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return reply.code(200).send(AgentConversationDetailSchema.parse({
      conversation,
      messages: await loadMessages(client, conversation),
    }))
  })

  app.get('/v1/agent/conversations/:id/action-proposals', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const conversation = await loadConversation(client, params.id)
    if (!conversation) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const proposals = await client
      .from('agent_action_proposals')
      .select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, target_refs, status, expires_at, confirmed_at, created_at, updated_at')
      .eq('organization_id', conversation.organizationId)
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (proposals.error) throw proposals.error
    return reply.code(200).send((proposals.data ?? []).map(mapProposal))
  })

  app.post('/v1/agent/conversations/:id/action-proposals', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateAgentActionProposalSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const conversation = await loadConversation(client, params.id)
    if (!conversation) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = scopeForConversation(conversation)
    if ((input.toolName === 'save_content_brief' || input.toolName === 'start_text_generation') && !scope.departmentId) {
      return reply.code(422).send({ error: 'content_brief_requires_department', correlationId: request.id })
    }
    if (input.toolName === 'request_approval') {
      const target = await loadApprovalTarget(client, input.input.postVersionId)
      if (!target || !matchesScope(scope, target)) return reply.code(404).send({ error: 'post_version_not_in_scope', correlationId: request.id })
      if (!(await context.requirePermission(request, reply, 'post.submit', toPermissionScope(target.organizationId, target.departmentId, target.teamId)))) return
    } else if (input.toolName === 'accept_text_candidate') {
      const target = await loadTextCandidateTarget(client, input.input.candidateId)
      if (!target || !matchesScope(scope, target)) return reply.code(404).send({ error: 'text_candidate_not_in_scope', correlationId: request.id })
      if (!(await context.requirePermission(request, reply, 'post.create', toPermissionScope(target.organizationId, target.departmentId, target.teamId)))) return
    } else if (input.toolName === 'schedule_publication') {
      const target = await loadScheduleTarget(client, input.input)
      if (!target || !matchesScope(scope, target)) return reply.code(404).send({ error: 'publication_target_not_in_scope', correlationId: request.id })
      if (!(await context.requirePermission(request, reply, 'post.publish', toPermissionScope(target.organizationId, target.departmentId, target.teamId)))) return
    } else if (input.toolName === 'execute_publication') {
      const target = await loadPublicationTarget(client, input.input.publicationId)
      if (!target || !matchesScope(scope, target)) return reply.code(404).send({ error: 'publication_target_not_in_scope', correlationId: request.id })
      if (!(await context.requirePermission(request, reply, 'post.publish', toPermissionScope(target.organizationId, target.departmentId, target.teamId)))) return
    } else {
      const permission = input.toolName === 'create_event' ? 'event.manage' : input.toolName === 'create_invitation' ? 'member.invite' : 'post.create'
      if (!(await context.requirePermission(request, reply, permission, toPermissionScope(scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null)))) return
    }
    if (input.toolName === 'create_invitation') {
      const invitationInput = CreateInvitationRequestSchema.parse({ ...input.input, ...scope })
      const roles = await roleProvider.rolesForScope(request.auth!, toPermissionScope(scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null))
      if (!canAssignRole(roles, invitationInput.role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const proposal = await insertActionProposal(supabaseClients.forService(), conversation, request.auth!.userId, input)
    await recordAuditEvent(request, {
      organizationId: proposal.organizationId,
      action: 'agent.action_proposal_created',
      entityType: 'agent_action_proposals',
      entityId: proposal.id,
      metadata: { toolName: proposal.toolName, inputHash: proposal.inputHash },
    })
    return reply.code(201).send(proposal)
  })

  app.post('/v1/agent/action-proposals/:id/cancel', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const proposal = await client
      .from('agent_action_proposals')
      .select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, target_refs, status, expires_at, confirmed_at, created_at, updated_at')
      .eq('id', params.id)
      .maybeSingle()
    if (proposal.error) throw proposal.error
    if (!proposal.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const existing = mapProposal(proposal.data)
    if (existing.status !== 'pending') return reply.code(409).send({ error: 'proposal_not_pending', correlationId: request.id })
    const cancelled = await supabaseClients.forService().from('agent_action_proposals')
      .update({ status: 'cancelled' })
      .eq('id', existing.id).eq('organization_id', existing.organizationId).eq('created_by', request.auth!.userId).eq('status', 'pending')
      .select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, target_refs, status, expires_at, confirmed_at, created_at, updated_at')
      .maybeSingle()
    if (cancelled.error) throw cancelled.error
    if (!cancelled.data) return reply.code(409).send({ error: 'proposal_not_pending', correlationId: request.id })
    await recordAuditEvent(request, { organizationId: existing.organizationId, action: 'agent.action_proposal_cancelled', entityType: 'agent_action_proposals', entityId: existing.id })
    return reply.code(200).send(mapProposal(cancelled.data))
  })

  app.post('/v1/agent/action-proposals/:id/confirm', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const found = await client
      .from('agent_action_proposals')
      .select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, target_refs, status, expires_at, confirmed_at, created_at, updated_at')
      .eq('id', params.id)
      .maybeSingle()
    if (found.error) throw found.error
    if (!found.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const proposal = mapProposal(found.data)
    const scope = AgentScopeSchema.parse({ organizationId: proposal.organizationId, departmentId: proposal.departmentId, teamId: proposal.teamId })
    const approvalInput = proposal.toolName === 'request_approval' ? AgentApprovalProposalInputSchema.parse(proposal.input) : null
    const contentBriefInput = proposal.toolName === 'save_content_brief' ? AgentContentBriefProposalInputSchema.parse(proposal.input) : null
    const textGenerationInput = proposal.toolName === 'start_text_generation' ? AgentTextGenerationProposalInputSchema.parse(proposal.input) : null
    const textCandidateInput = proposal.toolName === 'accept_text_candidate' ? AgentTextCandidateAcceptanceProposalInputSchema.parse(proposal.input) : null
    const scheduleInput = proposal.toolName === 'schedule_publication' ? AgentSchedulePublicationProposalInputSchema.parse(proposal.input) : null
    const publicationExecutionInput = proposal.toolName === 'execute_publication' ? AgentPublicationExecutionProposalInputSchema.parse(proposal.input) : null
    if ((contentBriefInput || textGenerationInput) && !scope.departmentId) return reply.code(409).send({ error: 'proposal_target_changed', correlationId: request.id })
    const approvalTarget = approvalInput ? await loadApprovalTarget(client, approvalInput.postVersionId) : null
    const textCandidateTarget = textCandidateInput ? await loadTextCandidateTarget(client, textCandidateInput.candidateId) : null
    const scheduleTarget = scheduleInput ? await loadScheduleTarget(client, scheduleInput) : null
    const publicationTarget = publicationExecutionInput ? await loadPublicationTarget(client, publicationExecutionInput.publicationId) : null
    if (approvalInput && (!approvalTarget || !matchesScope(scope, approvalTarget))) return reply.code(409).send({ error: 'proposal_target_changed', correlationId: request.id })
    if (textCandidateInput && (!textCandidateTarget || !matchesScope(scope, textCandidateTarget))) return reply.code(409).send({ error: 'proposal_target_changed', correlationId: request.id })
    if (scheduleInput && (!scheduleTarget || !matchesScope(scope, scheduleTarget))) return reply.code(409).send({ error: 'proposal_target_changed', correlationId: request.id })
    if (publicationExecutionInput && (!publicationTarget || !matchesScope(scope, publicationTarget))) return reply.code(409).send({ error: 'proposal_target_changed', correlationId: request.id })
    const permission = proposal.toolName === 'create_event' ? 'event.manage' : proposal.toolName === 'create_invitation' ? 'member.invite' : proposal.toolName === 'request_approval' ? 'post.submit' : proposal.toolName === 'schedule_publication' || proposal.toolName === 'execute_publication' ? 'post.publish' : 'post.create'
    const permissionTarget = approvalTarget ?? textCandidateTarget ?? scheduleTarget ?? publicationTarget
    const permissionScope = permissionTarget
      ? toPermissionScope(permissionTarget.organizationId, permissionTarget.departmentId, permissionTarget.teamId)
      : toPermissionScope(scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null)
    if (!(await context.requirePermission(request, reply, permission, permissionScope))) return
    const eventInput = proposal.toolName === 'create_event' ? AgentEventProposalInputSchema.parse(proposal.input) : null
    const invitationInput = proposal.toolName === 'create_invitation'
      ? CreateInvitationRequestSchema.parse({ ...(proposal.input as Record<string, unknown>), ...scope })
      : null
    const parsedInput = eventInput ?? invitationInput ?? approvalInput ?? contentBriefInput ?? textGenerationInput ?? textCandidateInput ?? scheduleInput ?? publicationExecutionInput
    if (!parsedInput || proposal.inputHash !== hashAgentProposalInput(proposal.input)) return reply.code(409).send({ error: 'proposal_input_changed', correlationId: request.id })
    if (invitationInput) {
      const roles = await roleProvider.rolesForScope(request.auth!, toPermissionScope(scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null))
      if (!canAssignRole(roles, invitationInput.role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const service = supabaseClients.forService()
    const claim = await service.rpc('claim_agent_action_proposal', {
      target_organization_id: proposal.organizationId,
      target_proposal_id: proposal.id,
      target_owner_id: request.auth!.userId,
    })
    if (claim.error) {
      if (claim.error.code === 'P0002' || claim.error.message.includes('agent_proposal_not_pending')) {
        return reply.code(409).send({ error: 'proposal_not_pending', correlationId: request.id })
      }
      throw claim.error
    }
    const claimed = mapProposal(claim.data)
    if (claimed.status === 'expired') return reply.code(410).send({ error: 'proposal_expired', correlationId: request.id })
    const toolRun = await service.from('agent_tool_runs').insert({
      organization_id: proposal.organizationId,
      conversation_id: proposal.conversationId,
      proposal_id: proposal.id,
      tool_name: proposal.toolName,
      correlation_id: request.id,
      status: 'started',
    }).select('id').maybeSingle()
    if (toolRun.error) request.log.error({ err: toolRun.error, correlationId: request.id }, 'agent tool run could not be started')
    try {
      let resultId: string
      let emailDelivered: boolean | undefined
      let emailError: unknown
      if (eventInput) {
        const event = await createClubEvent(service, request.auth!.userId, scope, eventInput)
        resultId = event.id
      } else if (invitationInput) {
        const invitation = await createInvitation(client, service, invitationInput!, environment.WEB_BASE_URL ?? 'http://localhost:4200')
        resultId = invitation.invitation.id
        emailDelivered = invitation.emailDelivered
        emailError = invitation.emailError
      } else {
        if (approvalInput) {
          const approval = await client.rpc('request_approval', { target_post_version_id: approvalInput.postVersionId })
          if (approval.error) {
            if (approval.error.message.includes('invalid_status')) throw new AgentProposalExecutionError(409, 'invalid_status')
            if (approval.error.message.includes('review_required') || approval.error.message.includes('minor_stage_required') || approval.error.message.includes('invalid_reviewer_snapshot') || approval.error.message.includes('empty_reviewer_snapshot')) {
              throw new AgentProposalExecutionError(422, 'approval_route_unavailable')
            }
            throw approval.error
          }
          resultId = z.object({ approvalRequestId: UuidSchema.nullable().optional(), postId: UuidSchema }).parse(approval.data).approvalRequestId ?? approvalTarget!.postId
        } else if (contentBriefInput) {
          const draft = await saveTextWorkshopDraft(service, {
            id: randomUUID(), organizationId: scope.organizationId, departmentId: scope.departmentId!, teamId: scope.teamId ?? null,
            actorUserId: request.auth!.userId, payload: toTextWorkshopDraftPayload(contentBriefInput!),
          })
          resultId = draft.id
        } else if (textGenerationInput) {
          const generated = await createTextGenerationSession(client, () => service, toInitialTextGenerationInput(scope, textGenerationInput!), request.auth!.userId, request.id)
          if (!generated.ok) throw new AgentProposalExecutionError(generated.statusCode, generated.error)
          resultId = generated.sessionId
        } else if (scheduleInput) {
          const scheduled = await client.rpc('schedule_publication', { target_post_version_id: scheduleInput.postVersionId, target_social_connection_id: scheduleTarget!.socialConnectionId, target_scheduled_for: scheduleInput.scheduledFor })
          if (scheduled.error) throw new AgentProposalExecutionError(422, 'publication_schedule_unavailable')
          resultId = z.object({ id: UuidSchema }).parse(scheduled.data).id
        } else if (publicationExecutionInput) {
          // Der Agent ruft bewusst den bestehenden Ausführungsendpunkt auf. Damit bleiben dessen
          // erneute Berechtigungsprüfung, Consent-/Medien-Gate, Compare-and-Set und Provider-Audit
          // der einzige fachliche Veröffentlichungspfad.
          const executed = await app.inject({
            method: 'POST',
            url: `/v1/publications/${publicationExecutionInput.publicationId}/execute`,
            headers: { authorization: request.headers.authorization ?? '' },
          })
          if (executed.statusCode !== 200) {
            const executionError = z.object({ error: z.string() }).safeParse(executed.json())
            const statusCode = executed.statusCode === 404 || executed.statusCode === 409 || executed.statusCode === 422 || executed.statusCode === 502 || executed.statusCode === 503
              ? executed.statusCode
              : 502
            throw new AgentProposalExecutionError(statusCode, executionError.success ? executionError.data.error : 'publication_execution_unavailable')
          }
          resultId = publicationExecutionInput.publicationId
        } else {
          const attachments = await service.from('composition_session_post_media').select('media_asset_id').eq('organization_id', textCandidateTarget!.organizationId).eq('composition_session_id', textCandidateTarget!.sessionId).limit(1)
          if (attachments.error) throw attachments.error
          if ((attachments.data ?? []).length > 0) throw new AgentProposalExecutionError(422, 'text_candidate_with_media_requires_text_workshop')
          const accepted = await service.rpc('accept_text_generation_candidate', { p_candidate_id: textCandidateInput!.candidateId, p_actor_user_id: request.auth!.userId, p_media_derivative_ids: null })
          if (accepted.error) throw accepted.error
          resultId = z.object({ postVersionId: UuidSchema }).parse(accepted.data).postVersionId
        }
      }
      const completed = await service.from('agent_action_proposals')
        .update({
          status: 'confirmed',
          confirmed_by: request.auth!.userId,
          confirmed_at: new Date().toISOString(),
          target_refs: [{ entityType: eventInput ? 'club_events' : invitationInput ? 'invitations' : approvalInput ? 'approval_requests' : contentBriefInput ? 'text_workshop_drafts' : textGenerationInput ? 'composition_sessions' : textCandidateInput ? 'post_versions' : 'publications', id: resultId }],
        })
        .eq('id', proposal.id).eq('organization_id', proposal.organizationId).eq('status', 'executing')
        .select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, target_refs, status, expires_at, confirmed_at, created_at, updated_at')
        .single()
      if (completed.error) throw completed.error
      if (toolRun.data) {
        const toolRunCompleted = await service.from('agent_tool_runs').update({
          status: 'completed', finished_at: new Date().toISOString(), result_refs: [{ entityType: eventInput ? 'club_events' : invitationInput ? 'invitations' : approvalInput ? 'approval_requests' : contentBriefInput ? 'text_workshop_drafts' : textGenerationInput ? 'composition_sessions' : textCandidateInput ? 'post_versions' : 'publications', id: resultId }],
        }).eq('id', toolRun.data.id).eq('organization_id', proposal.organizationId).eq('status', 'started')
        if (toolRunCompleted.error) request.log.error({ err: toolRunCompleted.error, correlationId: request.id }, 'agent tool run could not be completed')
      }
      await recordAuditEvent(request, {
        organizationId: proposal.organizationId,
        action: 'agent.action_proposal_confirmed',
        entityType: 'agent_action_proposals',
        entityId: proposal.id,
        metadata: { toolName: proposal.toolName, resultId, emailDelivered },
      })
      if (contentBriefInput) {
        await recordAuditEvent(request, {
          organizationId: proposal.organizationId,
          action: 'text_workshop_draft.saved',
          entityType: 'text_workshop_drafts',
          entityId: resultId,
          metadata: { departmentId: scope.departmentId, teamId: scope.teamId ?? null, source: 'agent_tool' },
        })
      }
      if (textGenerationInput) {
        await recordAuditEvent(request, {
          organizationId: proposal.organizationId,
          action: 'text_generation_session.created',
          entityType: 'composition_sessions',
          entityId: resultId,
          metadata: { departmentId: scope.departmentId, teamId: scope.teamId ?? null, source: 'agent_tool' },
        })
      }
      if (textCandidateInput) {
        await recordAuditEvent(request, {
          organizationId: proposal.organizationId,
          action: 'text_generation_candidate.accepted',
          entityType: 'post_versions',
          entityId: resultId,
          metadata: { candidateId: textCandidateInput.candidateId, source: 'agent_tool' },
        })
      }
      if (scheduleInput) {
        await recordAuditEvent(request, {
          organizationId: proposal.organizationId,
          action: 'post.publication_scheduled',
          entityType: 'publications',
          entityId: resultId,
          metadata: { postVersionId: scheduleInput.postVersionId, platform: scheduleInput.platform, scheduledFor: scheduleInput.scheduledFor, source: 'agent_tool' },
        })
      }
      if (publicationExecutionInput) {
        await recordAuditEvent(request, {
          organizationId: proposal.organizationId,
          action: 'post.publication_executed_by_agent',
          entityType: 'publications',
          entityId: resultId,
          metadata: { source: 'agent_tool' },
        })
      }
      if (emailDelivered === false) request.log.error({ err: emailError, correlationId: request.id }, 'Supabase invitation email delivery failed')
      return reply.code(200).send(mapProposal(completed.data))
    } catch (error) {
      if (toolRun.data) {
        const toolRunFailed = await service.from('agent_tool_runs').update({
          status: 'failed', finished_at: new Date().toISOString(), error_code: 'execution_failed',
        }).eq('id', toolRun.data.id).eq('organization_id', proposal.organizationId).eq('status', 'started')
        if (toolRunFailed.error) request.log.error({ err: toolRunFailed.error, correlationId: request.id }, 'agent tool run could not be failed')
      }
      const failed = await service.from('agent_action_proposals').update({ status: 'failed' })
        .eq('id', proposal.id).eq('organization_id', proposal.organizationId).eq('status', 'executing')
      if (failed.error) request.log.error({ err: failed.error, correlationId: request.id }, 'agent proposal failure state could not be saved')
      if (error instanceof AgentProposalExecutionError) return reply.code(error.statusCode).send({ error: error.errorCode, correlationId: request.id })
      throw error
    }
  })

  app.post('/v1/agent/conversations/:id/messages', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateAgentMessageSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const conversation = await loadConversation(client, params.id)
    if (!conversation) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const existingMessages = await loadMessages(client, conversation)
    const service = supabaseClients.forService()
    if (input.mediaAssetIds.length > 0) {
      // The responder below only gets textual messages. Attachments are private references for
      // the user interface, never multimodal context for the model.
      if (!conversation.departmentId) return reply.code(422).send({ error: 'agent_media_requires_department', correlationId: request.id })
      const assets = await service.from('media_assets').select('id, organization_id, department_id, upload_status').in('id', input.mediaAssetIds)
      if (assets.error) throw assets.error
      if (assets.data.length !== input.mediaAssetIds.length || assets.data.some((asset) => asset.organization_id !== conversation.organizationId || asset.department_id !== conversation.departmentId || asset.upload_status !== 'ready')) {
        return reply.code(422).send({ error: 'agent_media_not_ready_or_out_of_scope', correlationId: request.id })
      }
    }
    const workspace = await loadWorkspaceOrEmpty(client, scopeForConversation(conversation), request.auth!.userId, request.log)
    const safetyIdentifier = createHash('sha256').update(request.auth!.userId).digest('hex').slice(0, 64)
    let answer: string
    let authorizedProposal: CreateAgentActionProposal | undefined
    let providerConfigured = false
    try {
      const response = await responder.respond({
        messages: [...existingMessages, { role: 'user', content: input.content }],
        workspace,
        userId: safetyIdentifier,
      })
      answer = response.content
      authorizedProposal = response.proposal
      providerConfigured = response.providerConfigured
    } catch (error) {
      request.log.warn({ err: error, correlationId: request.id }, 'agent responder failed')
      answer = 'Der Assistent ist gerade nicht erreichbar. Deine Nachricht wurde nicht als Aktion ausgeführt; bitte versuche es erneut.'
    }
    if (authorizedProposal) {
      const proposalScope = scopeForConversation(conversation)
      const approvalInput = authorizedProposal.toolName === 'request_approval' ? AgentApprovalProposalInputSchema.parse(authorizedProposal.input) : null
      const contentBriefInput = authorizedProposal.toolName === 'save_content_brief' ? AgentContentBriefProposalInputSchema.parse(authorizedProposal.input) : null
      const textGenerationInput = authorizedProposal.toolName === 'start_text_generation' ? AgentTextGenerationProposalInputSchema.parse(authorizedProposal.input) : null
      const textCandidateInput = authorizedProposal.toolName === 'accept_text_candidate' ? AgentTextCandidateAcceptanceProposalInputSchema.parse(authorizedProposal.input) : null
      const scheduleInput = authorizedProposal.toolName === 'schedule_publication' ? AgentSchedulePublicationProposalInputSchema.parse(authorizedProposal.input) : null
      const publicationExecutionInput = authorizedProposal.toolName === 'execute_publication' ? AgentPublicationExecutionProposalInputSchema.parse(authorizedProposal.input) : null
      const approvalTarget = approvalInput ? await loadApprovalTarget(client, approvalInput.postVersionId) : null
      const textCandidateTarget = textCandidateInput ? await loadTextCandidateTarget(client, textCandidateInput.candidateId) : null
      const scheduleTarget = scheduleInput ? await loadScheduleTarget(client, scheduleInput) : null
      const publicationTarget = publicationExecutionInput ? await loadPublicationTarget(client, publicationExecutionInput.publicationId) : null
      const permission = authorizedProposal.toolName === 'create_event' ? 'event.manage' : authorizedProposal.toolName === 'create_invitation' ? 'member.invite' : authorizedProposal.toolName === 'request_approval' ? 'post.submit' : authorizedProposal.toolName === 'schedule_publication' || authorizedProposal.toolName === 'execute_publication' ? 'post.publish' : 'post.create'
      const permissionTarget = approvalTarget ?? textCandidateTarget ?? scheduleTarget ?? publicationTarget
      const permissionScope = permissionTarget
        ? toPermissionScope(permissionTarget.organizationId, permissionTarget.departmentId, permissionTarget.teamId)
        : toPermissionScope(proposalScope.organizationId, proposalScope.departmentId ?? null, proposalScope.teamId ?? null)
      const roles = await roleProvider.rolesForScope(request.auth!, permissionScope)
      const invitationInput = authorizedProposal.toolName === 'create_invitation'
        ? CreateInvitationRequestSchema.parse({ ...authorizedProposal.input, ...proposalScope })
        : null
      if (((contentBriefInput !== null || textGenerationInput !== null) && !proposalScope.departmentId) || (approvalInput !== null && (!approvalTarget || !matchesScope(proposalScope, approvalTarget))) || (textCandidateInput !== null && (!textCandidateTarget || !matchesScope(proposalScope, textCandidateTarget))) || (scheduleInput !== null && (!scheduleTarget || !matchesScope(proposalScope, scheduleTarget))) || (publicationExecutionInput !== null && (!publicationTarget || !matchesScope(proposalScope, publicationTarget))) || !hasPermission(roles, permission) || (invitationInput !== null && !canAssignRole(roles, invitationInput.role))) {
        answer = 'Dafür fehlen dir im aktuellen Bereich die nötigen Berechtigungen. Es wurde keine Aktion vorbereitet.'
        authorizedProposal = undefined
      }
    }
    // Die Funktion sperrt die Unterhaltung und schreibt Nutzer- und Assistentennachricht samt
    // Aktivitätszeit in einer Transaktion. Ein Fehler hinterlässt dadurch nie nur eine Hälfte
    // einer Unterhaltung, die ein Client beim Retry doppelt an den Provider schicken könnte.
    const persisted = await service.rpc('append_agent_conversation_messages', {
      target_organization_id: conversation.organizationId,
      target_conversation_id: conversation.id,
      target_owner_id: request.auth!.userId,
      user_message_content: input.content,
      user_message_media_asset_ids: input.mediaAssetIds,
      assistant_message_content: answer,
    })
    if (persisted.error) throw persisted.error
    const [persistedRow] = z.array(PersistedMessagesRowSchema).length(1).parse(persisted.data)
    if (!persistedRow) throw new Error('agent_message_persistence_invalid_response')
    if (authorizedProposal) {
      const proposal = await insertActionProposal(service, conversation, request.auth!.userId, authorizedProposal)
      await recordAuditEvent(request, {
        organizationId: proposal.organizationId,
        action: 'agent.action_proposal_created',
        entityType: 'agent_action_proposals',
        entityId: proposal.id,
        metadata: { toolName: proposal.toolName, inputHash: proposal.inputHash, source: 'agent_tool' },
      })
    }
    await recordAuditEvent(request, {
      organizationId: conversation.organizationId,
      action: 'agent.message_completed',
      entityType: 'agent_conversations',
      entityId: conversation.id,
      metadata: { providerConfigured },
    })
    return reply.code(201).send(AgentConversationDetailSchema.parse({
      conversation: { ...conversation, lastActivityAt: persistedRow.last_activity_at },
      messages: [...existingMessages, mapMessage(persistedRow.user_message, input.mediaAssetIds), mapMessage(persistedRow.assistant_message)],
    }))
  })
}
