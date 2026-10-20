import {
  AGENT_CONVERSATION_MESSAGE_WINDOW,
  AgentActionProposalSchema,
  AgentConversationSchema,
  AgentMessageSchema,
  AgentProposalStatusSchema,
  AgentProposalTargetRefSchema,
  AgentProposalToolNameSchema,
  AgentScopeSchema,
  CreateAgentActionProposalSchema,
  UuidSchema,
  type AgentActionProposal,
  type AgentConversation,
  type AgentMessage,
  type AgentScope,
  type CreateAgentActionProposal,
} from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { hashAgentProposalInput } from '@vereinsfunk/domain'

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

export const MediaAssetScopeRowSchema = z.object({
  id: UuidSchema,
  organization_id: UuidSchema,
  // null = Anhang auf Vereinsebene, genau wie die Unterhaltung selbst keine Abteilung tragen muss.
  department_id: UuidSchema.nullable(),
  upload_status: z.string(),
})

export const PersistedMessagesRowSchema = z.object({
  user_message: MessageRowSchema,
  assistant_message: MessageRowSchema,
  last_activity_at: z.string(),
})

const ProposalRowSchema = z.object({
  id: UuidSchema,
  organization_id: UuidSchema,
  conversation_id: UuidSchema,
  created_by: UuidSchema,
  tool_name: AgentProposalToolNameSchema,
  scope_snapshot: z.unknown(),
  input_snapshot: z.unknown(),
  input_hash: z.string(),
  target_refs: z.array(AgentProposalTargetRefSchema),
  status: AgentProposalStatusSchema,
  expires_at: z.string(),
  confirmed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const AGENT_CONVERSATION_COLUMNS =
  'id, organization_id, department_id, team_id, created_by, title, last_activity_at, archived_at, retention_expires_at, created_at, updated_at'

export const AGENT_PROPOSAL_COLUMNS =
  'id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot, input_hash, target_refs, status, expires_at, confirmed_at, created_at, updated_at'

export function mapConversation(row: unknown): AgentConversation {
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

export function mapMessage(row: unknown, mediaAssetIds: string[] = []): AgentMessage {
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

export function mapProposal(row: unknown): AgentActionProposal {
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

export function scopeForConversation(conversation: AgentConversation): AgentScope {
  return AgentScopeSchema.parse({
    organizationId: conversation.organizationId,
    departmentId: conversation.departmentId,
    teamId: conversation.teamId,
  })
}

export async function loadConversation(client: SupabaseClient, id: string): Promise<AgentConversation | null> {
  const result = await client
    .from('agent_conversations')
    .select(AGENT_CONVERSATION_COLUMNS)
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle()
  if (result.error) throw result.error
  return result.data ? mapConversation(result.data) : null
}

// Die juengsten Nachrichten, chronologisch sortiert. Absteigend laden und danach umdrehen: mit
// aufsteigender Sortierung plus limit saehe eine lange Unterhaltung fuer immer nur ihren Anfang.
export async function loadMessages(client: SupabaseClient, conversation: AgentConversation): Promise<AgentMessage[]> {
  const result = await client
    .from('agent_messages')
    .select('id, organization_id, conversation_id, role, content, created_at')
    .eq('organization_id', conversation.organizationId)
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(AGENT_CONVERSATION_MESSAGE_WINDOW)
  if (result.error) throw result.error
  const rows = [...(result.data ?? [])].reverse()
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

export async function insertActionProposal(
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
    input_hash: await hashAgentProposalInput(serializedInput),
    risk_class: normalizedInput.toolName === 'create_invitation' || normalizedInput.toolName === 'execute_publication' ? 'external' : 'write',
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  }).select(AGENT_PROPOSAL_COLUMNS).single()
  if (created.error) throw created.error
  return mapProposal(created.data)
}
