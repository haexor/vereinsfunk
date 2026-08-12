import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { CommunicationGoalSchema, SourceMaterialSchema, StyleProfileRulesSchema, UuidSchema, WorkflowNameSchema, WorkflowPayloadSchema, type WorkflowPayload } from '@vereinsfunk/contracts'
import type { WorkflowOutboxRepository } from '@vereinsfunk/orchestration'
import { WorkflowExecutionError, type WorkflowExecutionRepository, type WorkflowRunAcquireResult } from './workflows.js'
import type { CandidateRow, ProviderRow, SessionRow, TextGenerationRepository } from './textGeneration.js'

const SessionRowSchema: z.ZodType<SessionRow> = z.object({
  id: UuidSchema, organization_id: UuidSchema, department_id: UuidSchema, team_id: UuidSchema.nullable(), preset_slug: z.string().trim().min(1),
  communication_goal: CommunicationGoalSchema, source_material: SourceMaterialSchema,
  style_profile_snapshot: z.object({ name: z.string(), description: z.string(), styleRules: StyleProfileRulesSchema, avoidRules: z.array(z.string()) }),
})
const CandidateRowSchema: z.ZodType<CandidateRow> = z.object({ id: UuidSchema, status: z.literal('generating'), revision_instruction: z.string().nullable() })
const ProviderRowSchema: z.ZodType<ProviderRow> = z.object({
  id: UuidSchema, protocol: z.string(), base_url: z.url(), model: z.string().trim().min(1), temperature: z.coerce.number(), max_output_tokens: z.coerce.number().int().positive(),
  structured_output_required: z.boolean(), api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1),
})

/** Creates the worker-only service-role repository from validated configuration. */
export function createWorkflowOutboxRepository(config: WorkerEnvironment): WorkflowOutboxRepository {
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async claimPending(limit) {
      const { data, error } = await client.rpc('claim_workflow_outbox', { p_limit: limit })
      if (error) throw error
      return (data ?? []).map((row: { id: string; claim_token: string; workflow_name: unknown; payload: unknown; priority: 1 | 2 | 3 }) => ({ id: row.id, claimToken: row.claim_token, workflow: WorkflowNameSchema.parse(row.workflow_name), payload: WorkflowPayloadSchema.parse(row.payload), priority: row.priority }))
    },
    async markDispatched(id, claimToken, runId) { const { data, error } = await client.rpc('acknowledge_workflow_outbox', { p_outbox_id: id, p_claim_token: claimToken, p_hatchet_run_id: runId }); if (error || !data) throw error ?? new Error('outbox acknowledgement lost') },
    async markRetryableFailure(id, claimToken, errorClass) { const { data, error } = await client.rpc('release_workflow_outbox', { p_outbox_id: id, p_claim_token: claimToken, p_error_class: errorClass }); if (error || !data) throw error ?? new Error('outbox release lost') },
  }
}

/** Worker-only run-state repository. All methods carry IDs and controlled status data only. */
export function createWorkflowExecutionRepository(config: WorkerEnvironment): WorkflowExecutionRepository {
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const rpcInput = (workflow: string, payload: WorkflowPayload) => ({
    p_organization_id: payload.organizationId,
    p_workflow_name: workflow,
    p_entity_id: payload.entityId,
    p_source_revision: payload.sourceRevision,
    p_purpose: payload.purpose,
  })
  return {
    async begin(workflow, payload): Promise<WorkflowRunAcquireResult> {
      const { data, error } = await client.rpc('begin_workflow_run', { ...rpcInput(workflow, payload), p_idempotency_key: payload.idempotencyKey })
      if (error) throw error
      const result = Array.isArray(data) ? data[0] : data
      if (result?.status === 'acquired' && typeof result.lease_token === 'string') return { state: 'acquired', leaseToken: UuidSchema.parse(result.lease_token) }
      if (result?.status === 'already_handled' || result?.status === 'not_found') return { state: result.status }
      throw new Error('unexpected workflow run acquisition state')
    },
    async succeed(workflow, payload, leaseToken) {
      const { data, error } = await client.rpc('finish_workflow_run', { ...rpcInput(workflow, payload), p_lease_token: leaseToken, p_status: 'succeeded', p_error_class: null })
      if (error || !data) throw error ?? new Error('workflow run completion lost')
    },
    async fail(workflow, payload, leaseToken, errorClass, retryable) {
      const { data, error } = await client.rpc('finish_workflow_run', {
        ...rpcInput(workflow, payload), p_lease_token: leaseToken, p_status: retryable ? 'failed' : 'action_required', p_error_class: errorClass,
      })
      if (error || !data) throw error ?? new Error('workflow run failure update lost')
    },
  }
}

/** Worker-only data access for text generation. Content is loaded here, never from Hatchet input. */
export function createTextGenerationRepository(config: WorkerEnvironment): TextGenerationRepository {
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async loadSession(id, organizationId) {
      const { data, error } = await client.from('composition_sessions').select('id, organization_id, department_id, team_id, preset_slug, communication_goal, source_material, style_profile_snapshot').eq('id', id).eq('organization_id', organizationId).maybeSingle()
      if (error) throw error
      return data === null ? null : SessionRowSchema.parse(data)
    },
    async acquirePendingCandidate(candidateId, sessionId, organizationId) {
      // The candidate ID in the ID-only workflow payload makes this a single-row CAS. Candidate
      // and session move together in one transaction so a mid-way failure cannot decouple them.
      const { data, error } = await client.rpc('acquire_generation_candidate', { p_candidate_id: candidateId, p_session_id: sessionId, p_organization_id: organizationId })
      if (error) {
        // A candidate still 'generating' within the recovery window may genuinely still be in
        // flight elsewhere -- retryable, so the workflow run is honestly marked 'failed' instead
        // of the caller treating a null candidate as a safe no-op and reporting false success.
        if (error.message === 'generation_candidate_still_in_progress') throw new WorkflowExecutionError('generation_candidate_still_in_progress', true)
        throw error
      }
      return data === null ? null : CandidateRowSchema.parse(data)
    },
    async loadActiveTextProvider() {
      const { data, error } = await client.from('llm_provider_configurations')
        .select('id, protocol, base_url, model, temperature, max_output_tokens, structured_output_required, priority, llm_provider_secrets!inner(api_key_ciphertext, key_version)')
        .eq('task_kind', 'text_generation').eq('is_active', true).order('priority').limit(2)
      if (error) throw error
      if (data.length === 0 || (data.length > 1 && data[0]!.priority === data[1]!.priority)) throw new Error('text provider configuration is ambiguous or missing')
      const row = z.object({
        id: UuidSchema, protocol: z.string(), base_url: z.url(), model: z.string().trim().min(1), temperature: z.coerce.number(), max_output_tokens: z.coerce.number().int().positive(),
        structured_output_required: z.boolean(), llm_provider_secrets: z.union([z.object({ api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1) }), z.array(z.object({ api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1) })).min(1)]),
      }).parse(data[0])
      const secret = row.llm_provider_secrets
      const value = Array.isArray(secret) ? secret[0] : secret
      if (!value) throw new Error('text provider secret missing')
      return ProviderRowSchema.parse({ ...row, api_key_ciphertext: value.api_key_ciphertext, key_version: value.key_version })
    },
    async markReady(candidateId, sessionId, generatedContent, metadata) {
      const { error } = await client.rpc('mark_generation_candidate_ready', {
        p_candidate_id: candidateId, p_session_id: sessionId, p_generated_content: generatedContent,
        p_provider_configuration_id: metadata.providerConfigurationId, p_provider_model_id: metadata.providerModelId,
        p_provider_parameter_hash: metadata.providerParameterHash, p_prompt_template_version: metadata.promptTemplateVersion,
      })
      if (error) throw error
    },
    async markFailed(candidateId, sessionId, errorClass) {
      const { error } = await client.rpc('mark_generation_candidate_failed', { p_candidate_id: candidateId, p_session_id: sessionId, p_error_class: errorClass })
      if (error) throw error
    },
    async releaseCandidate(candidateId, sessionId) {
      const { error } = await client.rpc('release_generation_candidate', { p_candidate_id: candidateId, p_session_id: sessionId })
      if (error) throw error
    },
  }
}
