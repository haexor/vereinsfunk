import {
  CreateCompositionSessionSchema,
  hasExclusivePlatformConflict,
  RequestApprovalResponseSchema,
  TextWorkshopDraftPayloadSchema,
  UuidSchema,
  type AgentActionProposal,
  type AgentContentBriefProposalInput,
  type AgentScope,
  type AgentTextGenerationProposalInput,
} from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { createAuditRecorder } from '../routes/shared.js'
import type { AgentProposalAuthorization } from './agentProposalAuthorization.js'
import { createClubEvent } from './clubEvents.js'
import { createTextGenerationSession } from './textGenerationSessions.js'
import { saveTextWorkshopDraft } from './textWorkshopDrafts.js'

type AgentProposalExecutionStatus = 400 | 403 | 404 | 409 | 422 | 429 | 502 | 503

// Fachliche Ablehnungen der ausfuehrenden Route werden unveraendert weitergereicht; alles andere
// (auch eine abgelaufene Anmeldung mitten im Aufruf) ist aus Sicht des Agenten ein 502.
const FORWARDED_EXECUTION_STATUSES: readonly number[] = [400, 403, 404, 409, 422, 429, 503]

export class AgentProposalExecutionError extends Error {
  constructor(readonly statusCode: AgentProposalExecutionStatus, readonly errorCode: string) {
    super(errorCode)
  }
}

function toTextWorkshopDraftPayload(input: AgentContentBriefProposalInput) {
  const approvedQuotes = input.sourceMaterial.quotes
    .filter((quote) => quote.approved)
    .map((quote) => `Zitat: ${quote.text}${quote.attribution ? ` (${quote.attribution})` : ''}`)
  const factsText = Object.entries(input.sourceMaterial.facts).map(([key, value]) => `${key}: ${String(value)}`).join('\n')
  const observation = [...input.sourceMaterial.observations, ...approvedQuotes].join('\n')
  // SourceMaterialSchema erlaubt längere Ableitungen als TextWorkshopDraftPayloadSchema; kürzen
  // statt den Entwurf ungeprüft zu schreiben und erst beim Rücklesen scheitern zu lassen.
  return TextWorkshopDraftPayloadSchema.parse({
    communicationGoal: input.communicationGoal,
    factsText: factsText.slice(0, 10_000),
    observation: observation.slice(0, 5_000),
    selectedProfile: input.systemStyleProfileSlug,
    temperature: 0.6 as const,
    selectedPlatforms: input.targetPlatforms,
    maxCharactersOverride: '',
  })
}

function toInitialTextGenerationInput(scope: AgentScope, input: AgentTextGenerationProposalInput) {
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

// Bestaetigte Vorschlaege, fuer die es eine fachliche Route gibt, laufen ueber genau diese Route.
// Deren Pruefungen, Publishing-Not-Aus, Fehlerabbildung und Audit bleiben so der einzige Pfad;
// eigene Kopien im Agenten waren davon abgedriftet (kein approval.requested-/invitation.created-
// Audit, kein publishing_disabled, 500 statt 409). Dieselbe Correlation-ID verbindet beide Audits.
async function executeThroughRoute(app: FastifyInstance, request: FastifyRequest, url: string, payload?: Record<string, unknown>): Promise<unknown> {
  const response = await app.inject({
    method: 'POST',
    url,
    headers: { authorization: request.headers.authorization ?? '', 'x-correlation-id': request.id },
    ...(payload ? { payload } : {}),
  })
  let body: unknown = null
  try { body = response.json() } catch { body = null }
  if (response.statusCode >= 200 && response.statusCode < 300) return body
  const rejection = z.object({ error: z.string() }).safeParse(body)
  const statusCode = FORWARDED_EXECUTION_STATUSES.includes(response.statusCode) ? response.statusCode as AgentProposalExecutionStatus : 502
  throw new AgentProposalExecutionError(statusCode, rejection.success ? rejection.data.error : 'proposal_execution_unavailable')
}

// Fuehrt einen bestaetigten, bereits beanspruchten Vorschlag aus und liefert die ID des erzeugten
// Datensatzes. Ablehnungen der ausfuehrenden Route kommen als AgentProposalExecutionError.
export async function executeAgentProposal(
  app: FastifyInstance,
  request: FastifyRequest,
  clients: { client: SupabaseClient; service: SupabaseClient },
  proposal: AgentActionProposal,
  scope: AgentScope,
  targets: Pick<Extract<AgentProposalAuthorization, { ok: true }>, 'textCandidateTarget' | 'scheduleTarget' | 'invitationInput'>,
): Promise<{ resultId: string; emailDelivered: boolean | undefined }> {
  const { client, service } = clients
  const { textCandidateTarget, scheduleTarget, invitationInput } = targets
  // mapProposal hat die Eingabe bereits je Tool validiert.
  const eventInput = proposal.toolName === 'create_event' ? proposal.input : null
  const approvalInput = proposal.toolName === 'request_approval' ? proposal.input : null
  const contentBriefInput = proposal.toolName === 'save_content_brief' ? proposal.input : null
  const textGenerationInput = proposal.toolName === 'start_text_generation' ? proposal.input : null
  const textCandidateInput = proposal.toolName === 'accept_text_candidate' ? proposal.input : null
  const scheduleInput = proposal.toolName === 'schedule_publication' ? proposal.input : null
  const publicationExecutionInput = proposal.toolName === 'execute_publication' ? proposal.input : null
  let resultId: string
  let emailDelivered: boolean | undefined
  if (eventInput) {
    const event = await createClubEvent(service, request.auth!.userId, scope, eventInput)
    resultId = event.id
  } else if (invitationInput) {
    const invitation = z.object({ id: UuidSchema, emailDelivered: z.boolean() }).parse(await executeThroughRoute(app, request, '/v1/invitations', invitationInput))
    resultId = invitation.id
    emailDelivered = invitation.emailDelivered
  } else {
    if (approvalInput) {
      const approval = RequestApprovalResponseSchema.parse(await executeThroughRoute(app, request, `/v1/post-versions/${approvalInput.postVersionId}/request-approval`))
      resultId = approval.approvalRequestId ?? approval.postId
    } else if (contentBriefInput) {
      // Derselbe Ausschluss wie createTextGenerationSession (textGenerationSessions.ts) --
      // ohne ihn wuerde ein vom Agenten vorgeschlagener Entwurf mit z. B. ['plaintext',
      // 'instagram'] kommentarlos gespeichert und erst beim spaeteren Oeffnen in erstellen.vue
      // (resolveExclusivePlatforms) stillschweigend auf 'plaintext' reduziert -- widerspruechlich
      // zu dem, was die Bestaetigung dem Nutzer als gespeichert meldet (Review PR #181).
      if (hasExclusivePlatformConflict(contentBriefInput.targetPlatforms)) {
        throw new AgentProposalExecutionError(422, 'platform_combination_not_allowed')
      }
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
      const scheduled = await executeThroughRoute(app, request, `/v1/post-versions/${scheduleInput.postVersionId}/schedule`, {
        socialConnectionId: scheduleTarget!.socialConnectionId, scheduledFor: scheduleInput.scheduledFor,
      })
      resultId = z.object({ id: UuidSchema }).parse(scheduled).id
    } else if (publicationExecutionInput) {
      // Consent-/Medien-Gate, Compare-and-Set und Provider-Audit bleiben so der einzige
      // fachliche Veroeffentlichungspfad.
      await executeThroughRoute(app, request, `/v1/publications/${publicationExecutionInput.publicationId}/execute`)
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
  return { resultId, emailDelivered }
}

// Die fachlichen Audits je Tool (source 'agent_tool'), im Anschluss an
// agent.action_proposal_confirmed geschrieben.
export async function recordAgentToolResultAudit(
  recordAuditEvent: ReturnType<typeof createAuditRecorder>,
  request: FastifyRequest,
  proposal: AgentActionProposal,
  scope: AgentScope,
  resultId: string,
): Promise<void> {
  if (proposal.toolName === 'save_content_brief') {
    await recordAuditEvent(request, {
      organizationId: proposal.organizationId,
      action: 'text_workshop_draft.saved',
      entityType: 'text_workshop_drafts',
      entityId: resultId,
      metadata: { departmentId: scope.departmentId, teamId: scope.teamId ?? null, source: 'agent_tool' },
    })
  }
  if (proposal.toolName === 'start_text_generation') {
    await recordAuditEvent(request, {
      organizationId: proposal.organizationId,
      action: 'text_generation_session.created',
      entityType: 'composition_sessions',
      entityId: resultId,
      metadata: { departmentId: scope.departmentId, teamId: scope.teamId ?? null, source: 'agent_tool' },
    })
  }
  if (proposal.toolName === 'accept_text_candidate') {
    await recordAuditEvent(request, {
      organizationId: proposal.organizationId,
      action: 'text_generation_candidate.accepted',
      entityType: 'post_versions',
      entityId: resultId,
      metadata: { candidateId: proposal.input.candidateId, source: 'agent_tool' },
    })
  }
  if (proposal.toolName === 'schedule_publication') {
    await recordAuditEvent(request, {
      organizationId: proposal.organizationId,
      action: 'post.publication_scheduled',
      entityType: 'publications',
      entityId: resultId,
      metadata: { postVersionId: proposal.input.postVersionId, platform: proposal.input.platform, scheduledFor: proposal.input.scheduledFor, source: 'agent_tool' },
    })
  }
  if (proposal.toolName === 'execute_publication') {
    await recordAuditEvent(request, {
      organizationId: proposal.organizationId,
      action: 'post.publication_executed_by_agent',
      entityType: 'publications',
      entityId: resultId,
      metadata: { source: 'agent_tool' },
    })
  }
}
