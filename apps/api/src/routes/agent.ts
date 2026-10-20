import {
  AGENT_CONVERSATION_MESSAGE_WINDOW,
  AgentConversationDetailSchema,
  AgentConversationSchema,
  AgentScopeSchema,
  CreateAgentActionProposalSchema,
  CreateAgentConversationSchema,
  CreateAgentMessageSchema,
  UuidSchema,
  type AgentProposalTargetRef,
  type AgentProposalToolName,
  type CreateAgentActionProposal,
} from '@vereinsfunk/contracts'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { hashAgentProposalInput } from '@vereinsfunk/domain'
import type { AgentResponder } from '../agent.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder } from './shared.js'
import { isAnyMemberOfOrganization, resolveDirectoryScope } from '../services/scopeAuthorization.js'
import { AGENT_CONVERSATION_COLUMNS, AGENT_PROPOSAL_COLUMNS, insertActionProposal, loadConversation, loadMessages, mapConversation, mapMessage, mapProposal, MediaAssetScopeRowSchema, PersistedMessagesRowSchema, scopeForConversation } from '../services/agentConversationStore.js'
import { loadWorkspaceOrEmpty } from '../services/agentWorkspace.js'
import { resolveAgentProposalAuthorization, type AgentProposalAuthorization } from '../services/agentProposalAuthorization.js'
import { AgentProposalExecutionError, executeAgentProposal, recordAgentToolResultAudit } from '../services/agentProposalExecutors.js'

// Je Tool die Tabelle des erzeugten Datensatzes (target_refs/result_refs).
const AGENT_TOOL_RESULT_ENTITIES: Readonly<Record<AgentProposalToolName, AgentProposalTargetRef['entityType']>> = {
  create_event: 'club_events',
  create_invitation: 'invitations',
  request_approval: 'approval_requests',
  save_content_brief: 'text_workshop_drafts',
  start_text_generation: 'composition_sessions',
  accept_text_candidate: 'post_versions',
  schedule_publication: 'publications',
  execute_publication: 'publications',
}

export function registerAgentRoutes(
  app: FastifyInstance,
  context: ApiRouteContext,
  responder: AgentResponder,
): void {
  const { requireAuth, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // Gemeinsame HTTP-Antwort auf eine Ablehnung, die nicht vom Ziel des Vorschlags abhaengt.
  function sendAuthorizationRejection(
    request: FastifyRequest,
    reply: FastifyReply,
    rejection: Extract<AgentProposalAuthorization, { reason: 'invalid_input' | 'forbidden' | 'module_disabled' }>,
  ) {
    if (rejection.reason === 'module_disabled') return reply.code(403).send({ error: 'module_disabled', module: rejection.module, correlationId: request.id })
    if (rejection.reason === 'invalid_input') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
    return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
  }

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
    }).select(AGENT_CONVERSATION_COLUMNS).single()
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

  // Konversationshistorie: die 50 zuletzt aktiven, nicht archivierten Unterhaltungen desselben
  // Scopes. RLS (agent_conversations_select) beschraenkt das Ergebnis bereits auf created_by =
  // auth.uid() -- Unterhaltungen sind privat, siehe Migration 2026082404. Bounded query statt
  // fetchAllRows: die 90-Tage-Retention haelt das Volumen von Natur aus klein.
  app.get('/v1/agent/conversations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const scope = AgentScopeSchema.parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const validatedScope = await resolveDirectoryScope(client, scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null)
    if (!validatedScope || !(await isAnyMemberOfOrganization(client, request.auth!.userId, scope.organizationId))) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    // department_id/team_id immer konkret filtern (eq bei Wert, is bei null) -- eine Unterhaltung
    // wird beim Anlegen ebenso konkret gespeichert (siehe POST oben: input.departmentId ?? null),
    // nie mit "beliebig". Ein fehlender Query-Parameter bedeutet Vereins-Scope (toAgentScopeRequest
    // im Frontend), nicht "ueber alle Abteilungen hinweg" -- sonst mischen sich fremde
    // Abteilungs-Unterhaltungen in den Verlauf, obwohl der Kommentar oben "desselben Scopes" verspricht.
    // .eq(col, null) waere hier falsch: PostgREST versucht dann, den literalen String "null" in den
    // uuid-Spaltentyp zu casten, statt IS NULL zu pruefen -- derselbe Fallstrick, den .is() bereits
    // an anderer Stelle vermeidet (siehe text-workshop/drafts weiter unten in content.ts).
    let rows = client
      .from('agent_conversations')
      .select(AGENT_CONVERSATION_COLUMNS)
      .eq('organization_id', scope.organizationId)
    rows = (scope.departmentId ? rows.eq('department_id', scope.departmentId) : rows.is('department_id', null)) as typeof rows
    rows = (scope.teamId ? rows.eq('team_id', scope.teamId) : rows.is('team_id', null)) as typeof rows
    const result = await rows.is('archived_at', null).order('last_activity_at', { ascending: false }).limit(50)
    if (result.error) throw result.error
    return reply.code(200).send((result.data ?? []).map(mapConversation))
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
      .select(AGENT_PROPOSAL_COLUMNS)
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
    const authorization = await resolveAgentProposalAuthorization(context, request, client, scopeForConversation(conversation), input)
    if (!authorization.ok) {
      if (authorization.reason === 'requires_department') return reply.code(422).send({ error: 'content_brief_requires_department', correlationId: request.id })
      if (authorization.reason === 'target_not_in_scope') return reply.code(404).send({ error: authorization.error, correlationId: request.id })
      return sendAuthorizationRejection(request, reply, authorization)
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
      .select(AGENT_PROPOSAL_COLUMNS)
      .eq('id', params.id)
      .maybeSingle()
    if (proposal.error) throw proposal.error
    if (!proposal.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const existing = mapProposal(proposal.data)
    if (existing.status !== 'pending') return reply.code(409).send({ error: 'proposal_not_pending', correlationId: request.id })
    const cancelled = await supabaseClients.forService().from('agent_action_proposals')
      .update({ status: 'cancelled' })
      .eq('id', existing.id).eq('organization_id', existing.organizationId).eq('created_by', request.auth!.userId).eq('status', 'pending')
      .select(AGENT_PROPOSAL_COLUMNS)
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
      .select(AGENT_PROPOSAL_COLUMNS)
      .eq('id', params.id)
      .maybeSingle()
    if (found.error) throw found.error
    if (!found.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const proposal = mapProposal(found.data)
    const scope = AgentScopeSchema.parse({ organizationId: proposal.organizationId, departmentId: proposal.departmentId, teamId: proposal.teamId })
    const authorization = await resolveAgentProposalAuthorization(context, request, client, scope, proposal)
    if (!authorization.ok) {
      if (authorization.reason === 'requires_department' || authorization.reason === 'target_not_in_scope') return reply.code(409).send({ error: 'proposal_target_changed', correlationId: request.id })
      return sendAuthorizationRejection(request, reply, authorization)
    }
    if (proposal.inputHash !== (await hashAgentProposalInput(proposal.input))) return reply.code(409).send({ error: 'proposal_input_changed', correlationId: request.id })
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
      const { resultId, emailDelivered } = await executeAgentProposal(app, request, { client, service }, proposal, scope, authorization)
      const completed = await service.from('agent_action_proposals')
        .update({
          status: 'confirmed',
          confirmed_by: request.auth!.userId,
          confirmed_at: new Date().toISOString(),
          target_refs: [{ entityType: AGENT_TOOL_RESULT_ENTITIES[proposal.toolName], id: resultId }],
        })
        .eq('id', proposal.id).eq('organization_id', proposal.organizationId).eq('status', 'executing')
        .select(AGENT_PROPOSAL_COLUMNS)
        .single()
      if (completed.error) throw completed.error
      if (toolRun.data) {
        const toolRunCompleted = await service.from('agent_tool_runs').update({
          status: 'completed', finished_at: new Date().toISOString(), result_refs: [{ entityType: AGENT_TOOL_RESULT_ENTITIES[proposal.toolName], id: resultId }],
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
      await recordAgentToolResultAudit(recordAuditEvent, request, proposal, scope, resultId)
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
      // Eine Unterhaltung auf Vereinsebene traegt departmentId null -- der Scope-Vergleich unten
      // deckt das mit ab, es braucht keine Abteilung fuer einen Anhang. AgentScopeSchema macht
      // departmentId nullable UND optional, deshalb wird auf null normalisiert statt direkt
      // verglichen: sonst entschiede ein `null !== undefined` den Vereinsfall danach, ob die Quelle
      // den Schluessel weglaesst oder auf null setzt.
      const assets = await service.from('media_assets').select('id, organization_id, department_id, upload_status').in('id', input.mediaAssetIds)
      if (assets.error) throw assets.error
      const assetRows = z.array(MediaAssetScopeRowSchema).parse(assets.data)
      if (assetRows.length !== input.mediaAssetIds.length || assetRows.some((asset) => asset.organization_id !== conversation.organizationId || asset.department_id !== (conversation.departmentId ?? null) || asset.upload_status !== 'ready')) {
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
    if (authorizedProposal && !(await resolveAgentProposalAuthorization(context, request, client, scopeForConversation(conversation), authorizedProposal)).ok) {
      answer = 'Dafür fehlen dir im aktuellen Bereich die nötigen Berechtigungen. Es wurde keine Aktion vorbereitet.'
      authorizedProposal = undefined
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
      messages: [...existingMessages, mapMessage(persistedRow.user_message, input.mediaAssetIds), mapMessage(persistedRow.assistant_message)].slice(-AGENT_CONVERSATION_MESSAGE_WINDOW),
    }))
  })
}
