import {
  AgentConversationDetailSchema,
  AgentConversationSchema,
  AgentActionProposalSchema,
  AgentEventProposalInputSchema,
  AgentMessageSchema,
  AgentScopeSchema,
  AgentWorkspaceSchema,
  CreateAgentConversationSchema,
  CreateAgentActionProposalSchema,
  CreateAgentMessageSchema,
  UuidSchema,
  type AgentConversation,
  type AgentActionProposal,
  type AgentMessage,
  type AgentScope,
  type AgentWorkspace,
} from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { hashAgentProposalInput } from '@vereinsfunk/domain'
import type { AgentResponder } from '../agent.js'
import { createClubEvent } from '../services/clubEvents.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, isAnyMemberOfOrganization, resolveDirectoryScope, toPermissionScope } from './shared.js'

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
  tool_name: z.enum(['create_event', 'create_invitation']),
  scope_snapshot: z.unknown(),
  input_snapshot: z.unknown(),
  input_hash: z.string(),
  status: z.enum(['pending', 'executing', 'confirmed', 'cancelled', 'expired', 'failed']),
  expires_at: z.string(),
  confirmed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

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

function mapMessage(row: unknown): AgentMessage {
  const parsed = MessageRowSchema.parse(row)
  return AgentMessageSchema.parse({
    id: parsed.id,
    conversationId: parsed.conversation_id,
    organizationId: parsed.organization_id,
    role: parsed.role,
    content: parsed.content,
    createdAt: parsed.created_at,
  })
}

function mapProposal(row: unknown): AgentActionProposal {
  const parsed = ProposalRowSchema.parse(row)
  const scope = AgentScopeSchema.parse(parsed.scope_snapshot)
  return AgentActionProposalSchema.parse({
    id: parsed.id,
    conversationId: parsed.conversation_id,
    createdBy: parsed.created_by,
    toolName: parsed.tool_name,
    input: parsed.input_snapshot,
    inputHash: parsed.input_hash,
    status: parsed.status,
    expiresAt: parsed.expires_at,
    confirmedAt: parsed.confirmed_at,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
    ...scope,
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

  const [postsResult, eventsResult, approvalStagesResult] = await Promise.all([postsQuery, eventsQuery, approvalsQuery])
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
  })
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
  return (result.data ?? []).map(mapMessage)
}

export function registerAgentRoutes(
  app: FastifyInstance,
  context: ApiRouteContext,
  responder: AgentResponder,
): void {
  const { requireAuth, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.get('/v1/agent/workspace', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const scope = AgentScopeSchema.parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const validatedScope = await resolveDirectoryScope(client, scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null)
    if (!validatedScope || !(await isAnyMemberOfOrganization(client, request.auth!.userId, scope.organizationId))) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    return reply.code(200).send(await loadWorkspace(client, scope, request.auth!.userId))
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
      .select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, status, expires_at, confirmed_at, created_at, updated_at')
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
    const permission = input.toolName === 'create_event' ? 'event.manage' : 'member.invite'
    if (!(await context.requirePermission(request, reply, permission, toPermissionScope(scope.organizationId, scope.departmentId, scope.teamId)))) return
    const serializedInput = input.input as Record<string, unknown>
    const created = await supabaseClients.forService().from('agent_action_proposals').insert({
      organization_id: conversation.organizationId,
      conversation_id: conversation.id,
      created_by: request.auth!.userId,
      tool_name: input.toolName,
      scope_snapshot: scope,
      input_snapshot: serializedInput,
      input_hash: hashAgentProposalInput(serializedInput),
      risk_class: input.toolName === 'create_invitation' ? 'external' : 'write',
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    }).select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, status, expires_at, confirmed_at, created_at, updated_at').single()
    if (created.error) throw created.error
    const proposal = mapProposal(created.data)
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
      .select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, status, expires_at, confirmed_at, created_at, updated_at')
      .eq('id', params.id)
      .maybeSingle()
    if (proposal.error) throw proposal.error
    if (!proposal.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const existing = mapProposal(proposal.data)
    if (existing.status !== 'pending') return reply.code(409).send({ error: 'proposal_not_pending', correlationId: request.id })
    const cancelled = await supabaseClients.forService().from('agent_action_proposals')
      .update({ status: 'cancelled' })
      .eq('id', existing.id).eq('organization_id', existing.organizationId).eq('created_by', request.auth!.userId).eq('status', 'pending')
      .select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, status, expires_at, confirmed_at, created_at, updated_at')
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
      .select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, status, expires_at, confirmed_at, created_at, updated_at')
      .eq('id', params.id)
      .maybeSingle()
    if (found.error) throw found.error
    if (!found.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const proposal = mapProposal(found.data)
    if (proposal.toolName !== 'create_event') return reply.code(409).send({ error: 'proposal_tool_not_available', correlationId: request.id })
    const scope = AgentScopeSchema.parse({ organizationId: proposal.organizationId, departmentId: proposal.departmentId, teamId: proposal.teamId })
    if (!(await context.requirePermission(request, reply, 'event.manage', toPermissionScope(scope.organizationId, scope.departmentId, scope.teamId)))) return
    const eventInput = AgentEventProposalInputSchema.parse(proposal.input)
    if (proposal.inputHash !== hashAgentProposalInput(eventInput)) return reply.code(409).send({ error: 'proposal_input_changed', correlationId: request.id })
    const service = supabaseClients.forService()
    const claim = await service.rpc('claim_agent_action_proposal', {
      target_organization_id: proposal.organizationId,
      target_proposal_id: proposal.id,
      target_owner_id: request.auth!.userId,
    })
    if (claim.error) return reply.code(409).send({ error: 'proposal_not_pending', correlationId: request.id })
    const claimed = mapProposal(claim.data)
    if (claimed.status === 'expired') return reply.code(410).send({ error: 'proposal_expired', correlationId: request.id })
    try {
      const event = await createClubEvent(service, request.auth!.userId, scope, eventInput)
      const completed = await service.from('agent_action_proposals')
        .update({ status: 'confirmed', confirmed_by: request.auth!.userId, confirmed_at: new Date().toISOString() })
        .eq('id', proposal.id).eq('organization_id', proposal.organizationId).eq('status', 'executing')
        .select('id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, status, expires_at, confirmed_at, created_at, updated_at')
        .single()
      if (completed.error) throw completed.error
      await recordAuditEvent(request, {
        organizationId: proposal.organizationId,
        action: 'agent.action_proposal_confirmed',
        entityType: 'agent_action_proposals',
        entityId: proposal.id,
        metadata: { toolName: proposal.toolName, resultId: event.id },
      })
      return reply.code(200).send({ proposal: mapProposal(completed.data), event })
    } catch (error) {
      const failed = await service.from('agent_action_proposals').update({ status: 'failed' })
        .eq('id', proposal.id).eq('organization_id', proposal.organizationId).eq('status', 'executing')
      if (failed.error) request.log.error({ err: failed.error, correlationId: request.id }, 'agent proposal failure state could not be saved')
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
    const workspace = await loadWorkspace(client, scopeForConversation(conversation), request.auth!.userId)
    const safetyIdentifier = createHash('sha256').update(request.auth!.userId).digest('hex').slice(0, 64)
    let answer: string
    try {
      answer = await responder.respond({
        messages: [...existingMessages, { role: 'user', content: input.content }],
        workspace,
        userId: safetyIdentifier,
      })
    } catch (error) {
      request.log.warn({ err: error, correlationId: request.id }, 'agent responder failed')
      answer = 'Der Assistent ist gerade nicht erreichbar. Deine Nachricht wurde nicht als Aktion ausgeführt; bitte versuche es erneut.'
    }
    // Die Funktion sperrt die Unterhaltung und schreibt Nutzer- und Assistentennachricht samt
    // Aktivitätszeit in einer Transaktion. Ein Fehler hinterlässt dadurch nie nur eine Hälfte
    // einer Unterhaltung, die ein Client beim Retry doppelt an den Provider schicken könnte.
    const persisted = await service.rpc('append_agent_conversation_messages', {
      target_organization_id: conversation.organizationId,
      target_conversation_id: conversation.id,
      target_owner_id: request.auth!.userId,
      user_message_content: input.content,
      assistant_message_content: answer,
    })
    if (persisted.error) throw persisted.error
    const [persistedRow] = z.array(PersistedMessagesRowSchema).length(1).parse(persisted.data)
    if (!persistedRow) throw new Error('agent_message_persistence_invalid_response')
    await recordAuditEvent(request, {
      organizationId: conversation.organizationId,
      action: 'agent.message_completed',
      entityType: 'agent_conversations',
      entityId: conversation.id,
      metadata: { providerConfigured: context.environment.OPENAI_API_KEY !== undefined },
    })
    return reply.code(201).send(AgentConversationDetailSchema.parse({
      conversation: { ...conversation, lastActivityAt: persistedRow.last_activity_at },
      messages: [...existingMessages, mapMessage(persistedRow.user_message), mapMessage(persistedRow.assistant_message)],
    }))
  })
}
