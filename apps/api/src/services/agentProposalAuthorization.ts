import {
  CreateInvitationRequestSchema,
  type AgentProposalToolName,
  type AgentSchedulePublicationProposalInput,
  type AgentScope,
  type CreateAgentActionProposal,
  type CreateInvitationRequest,
} from '@vereinsfunk/contracts'
import { canAssignRole, hasPermission, type Permission, type PermissionModule } from '@vereinsfunk/authorization'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyRequest } from 'fastify'
import { findDisabledModule } from '../auth.js'
import type { ApiRouteContext } from '../routes/context.js'
import { toPermissionScope } from './scopeAuthorization.js'
import { resolveAvailableChannelIdsForPostVersion } from './channelAvailability.js'

// Je Tool die Berechtigung, die Vorschlagen und Bestaetigen gleichermassen verlangen.
const AGENT_TOOL_PERMISSIONS: Readonly<Record<AgentProposalToolName, Permission>> = {
  create_event: 'event.manage',
  create_invitation: 'member.invite',
  request_approval: 'post.submit',
  save_content_brief: 'post.create',
  start_text_generation: 'post.create',
  accept_text_candidate: 'post.create',
  schedule_publication: 'post.publish',
  execute_publication: 'post.publish',
}

// Tools, die auf einem bestehenden Datensatz arbeiten, mit dem Fehlercode fuer "nicht im Scope".
const AGENT_TOOL_TARGET_ERRORS: Partial<Readonly<Record<AgentProposalToolName, string>>> = {
  request_approval: 'post_version_not_in_scope',
  accept_text_candidate: 'text_candidate_not_in_scope',
  schedule_publication: 'publication_target_not_in_scope',
  execute_publication: 'publication_target_not_in_scope',
}

// departmentId null = Beitrag bzw. Sitzung auf Vereinsebene (Migration 2026082504).
type ApprovalTarget = { organizationId: string; departmentId: string | null; teamId: string | null; postId: string }

type TextCandidateTarget = { organizationId: string; departmentId: string | null; teamId: string | null; sessionId: string }

type ScheduleTarget = ApprovalTarget & { socialConnectionId: string }

type PublicationTarget = ApprovalTarget & { publicationId: string }

async function loadApprovalTarget(client: SupabaseClient, postVersionId: string): Promise<ApprovalTarget | null> {
  const version = await client.from('post_versions').select('id, post_id').eq('id', postVersionId).maybeSingle()
  if (version.error) throw version.error
  if (!version.data) return null
  const post = await client.from('posts').select('id, organization_id, department_id, team_id').eq('id', version.data.post_id as string).maybeSingle()
  if (post.error) throw post.error
  if (!post.data) return null
  return { organizationId: post.data.organization_id as string, departmentId: post.data.department_id as string | null, teamId: post.data.team_id as string | null, postId: post.data.id as string }
}

async function loadTextCandidateTarget(client: SupabaseClient, candidateId: string): Promise<TextCandidateTarget | null> {
  const candidate = await client.from('generation_candidates').select('organization_id, composition_session_id, status').eq('id', candidateId).maybeSingle()
  if (candidate.error) throw candidate.error
  if (!candidate.data || candidate.data.status !== 'ready') return null
  const session = await client.from('composition_sessions').select('organization_id, department_id, team_id').eq('id', candidate.data.composition_session_id as string).maybeSingle()
  if (session.error) throw session.error
  if (!session.data || session.data.organization_id !== candidate.data.organization_id) return null
  return { organizationId: session.data.organization_id as string, departmentId: session.data.department_id as string | null, teamId: session.data.team_id as string | null, sessionId: candidate.data.composition_session_id as string }
}

async function loadScheduleTarget(client: SupabaseClient, input: AgentSchedulePublicationProposalInput): Promise<ScheduleTarget | null> {
  const version = await client.from('post_versions').select('id, post_id, effective_config_snapshot').eq('id', input.postVersionId).maybeSingle()
  if (version.error) throw version.error
  if (!version.data) return null
  const post = await client.from('posts').select('id, organization_id, department_id, team_id, status, current_version_id').eq('id', version.data.post_id as string).maybeSingle()
  if (post.error) throw post.error
  if (!post.data || post.data.status !== 'approved' || post.data.current_version_id !== version.data.id) return null
  const target = { organizationId: post.data.organization_id as string, departmentId: post.data.department_id as string | null, teamId: post.data.team_id as string | null }
  const channelIds = await resolveAvailableChannelIdsForPostVersion(client, { ...target, effectiveConfigSnapshot: version.data.effective_config_snapshot }, input.platform)
  if (channelIds.length !== 1) return null
  return { ...target, postId: post.data.id as string, socialConnectionId: channelIds[0]! }
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
  return { publicationId: publication.data.id as string, postId: post.data.id as string, organizationId: post.data.organization_id as string, departmentId: post.data.department_id as string | null, teamId: post.data.team_id as string | null }
}

export type AgentProposalAuthorization =
  | { ok: true; textCandidateTarget: TextCandidateTarget | null; scheduleTarget: ScheduleTarget | null; invitationInput: CreateInvitationRequest | null }
  | { ok: false; reason: 'requires_department' }
  | { ok: false; reason: 'invalid_input' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'target_not_in_scope'; error: string }
  | { ok: false; reason: 'module_disabled'; module: Exclude<PermissionModule, 'core'> }

function matchesScope(scope: AgentScope, target: Pick<ApprovalTarget, 'organizationId' | 'departmentId' | 'teamId'>): boolean {
  return scope.organizationId === target.organizationId
    && (scope.departmentId ?? null) === target.departmentId
    && (scope.teamId ?? null) === target.teamId
}

// Die eine Pruefung "Tool-Eingabe -> Ziel -> Scope -> Berechtigung samt Modul -> Rollenvergabe"
// fuer einen vom Nutzer angelegten, einen vom Modell vorgeschlagenen und einen zu bestaetigenden
// Vorschlag. Getrennte Kopien waren auseinandergelaufen: der Chat pruefte das Modul nicht und
// legte Vorschlaege an, die erst beim Bestaetigen an module_disabled scheiterten. Antwortet nicht
// selbst, weil der Chat eine Ablehnung als Antworttext statt als HTTP-Fehler meldet.
export async function resolveAgentProposalAuthorization(
  deps: Pick<ApiRouteContext, 'roleProvider' | 'moduleStatusProvider'>,
  request: FastifyRequest,
  client: SupabaseClient,
  scope: AgentScope,
  proposal: CreateAgentActionProposal,
): Promise<AgentProposalAuthorization> {
  if ((proposal.toolName === 'save_content_brief' || proposal.toolName === 'start_text_generation') && !scope.departmentId) {
    return { ok: false, reason: 'requires_department' }
  }
  const approvalTarget = proposal.toolName === 'request_approval' ? await loadApprovalTarget(client, proposal.input.postVersionId) : null
  const textCandidateTarget = proposal.toolName === 'accept_text_candidate' ? await loadTextCandidateTarget(client, proposal.input.candidateId) : null
  const scheduleTarget = proposal.toolName === 'schedule_publication' ? await loadScheduleTarget(client, proposal.input) : null
  const publicationTarget = proposal.toolName === 'execute_publication' ? await loadPublicationTarget(client, proposal.input.publicationId) : null
  const target = approvalTarget ?? textCandidateTarget ?? scheduleTarget ?? publicationTarget
  const targetError = AGENT_TOOL_TARGET_ERRORS[proposal.toolName]
  if (targetError && (!target || !matchesScope(scope, target))) return { ok: false, reason: 'target_not_in_scope', error: targetError }
  // Ein Ziel liegt nach matchesScope genau im Scope der Unterhaltung; beide pruefen also denselben Scope.
  const permissionScope = toPermissionScope(scope.organizationId, scope.departmentId ?? null, scope.teamId ?? null)
  const permission = AGENT_TOOL_PERMISSIONS[proposal.toolName]
  const roles = await deps.roleProvider.rolesForScope(request.auth!, permissionScope)
  if (!hasPermission(roles, permission)) return { ok: false, reason: 'forbidden' }
  // Dieselbe Modulregel wie requirePermission (auth.ts), erst nach der Rollenpruefung.
  const module = await findDisabledModule(deps.moduleStatusProvider, [permission], permissionScope)
  if (module) return { ok: false, reason: 'module_disabled', module }
  let invitationInput: CreateInvitationRequest | null = null
  if (proposal.toolName === 'create_invitation') {
    // Das Tool-Schema bietet dem Modell jede Rolle an; welche im Scope vergeben werden darf, prueft
    // erst CreateInvitationRequestSchema. Ein Fehler ist eine Ablehnung, kein 400 nach dem Modellaufruf.
    const parsed = CreateInvitationRequestSchema.safeParse({ ...proposal.input, ...scope })
    if (!parsed.success) return { ok: false, reason: 'invalid_input' }
    if (!canAssignRole(roles, parsed.data.role)) return { ok: false, reason: 'forbidden' }
    invitationInput = parsed.data
  }
  return { ok: true, textCandidateTarget, scheduleTarget, invitationInput }
}
