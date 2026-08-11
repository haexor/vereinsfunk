import { createClient } from '@supabase/supabase-js'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { UuidSchema, WorkflowNameSchema, WorkflowPayloadSchema, type WorkflowPayload } from '@vereinsfunk/contracts'
import type { WorkflowOutboxRepository } from '@vereinsfunk/orchestration'
import type { WorkflowExecutionRepository, WorkflowRunAcquireResult } from './workflows.js'
import type { TextGenerationRepository } from './textGeneration.js'

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
      return data as never
    },
    async acquirePendingCandidate(sessionId, organizationId) {
      // The conditional update is the candidate-level CAS. A retry sees no pending row and exits.
      const { data, error } = await client.from('generation_candidates').update({ status: 'generating' }).eq('composition_session_id', sessionId).eq('organization_id', organizationId).eq('status', 'pending').select('id, status, revision_instruction').maybeSingle()
      if (error) throw error
      if (!data) return null
      const sessionUpdate = await client.from('composition_sessions').update({ status: 'generating' }).eq('id', sessionId).eq('organization_id', organizationId)
      if (sessionUpdate.error) throw sessionUpdate.error
      return data as never
    },
    async loadActiveTextProvider() {
      const { data, error } = await client.from('llm_provider_configurations')
        .select('id, protocol, base_url, model, temperature, max_output_tokens, structured_output_required, priority, llm_provider_secrets!inner(api_key_ciphertext, key_version)')
        .eq('task_kind', 'text_generation').eq('is_active', true).order('priority').limit(2)
      if (error) throw error
      if (data.length === 0 || (data.length > 1 && data[0]!.priority === data[1]!.priority)) throw new Error('text provider configuration is ambiguous or missing')
      const row = data[0] as Record<string, unknown>
      const secret = row.llm_provider_secrets as { api_key_ciphertext: string; key_version: string } | { api_key_ciphertext: string; key_version: string }[]
      const value = Array.isArray(secret) ? secret[0] : secret
      if (!value) throw new Error('text provider secret missing')
      return { ...row, api_key_ciphertext: value.api_key_ciphertext, key_version: value.key_version } as never
    },
    async markReady(candidateId, sessionId, generatedContent, metadata) {
      const { error } = await client.from('generation_candidates').update({ status: 'ready', generated_content: generatedContent, provider_configuration_id: metadata.providerConfigurationId, provider_model_id: metadata.providerModelId, provider_parameter_hash: metadata.providerParameterHash, prompt_template_version: metadata.promptTemplateVersion }).eq('id', candidateId).eq('status', 'generating')
      if (error) throw error
      const session = await client.from('composition_sessions').update({ status: 'candidate_ready' }).eq('id', sessionId).eq('status', 'generating')
      if (session.error) throw session.error
    },
    async markFailed(candidateId, sessionId, errorClass) {
      const candidate = await client.from('generation_candidates').update({ status: 'failed', failure_code: errorClass }).eq('id', candidateId).eq('status', 'generating')
      if (candidate.error) throw candidate.error
      const session = await client.from('composition_sessions').update({ status: 'failed' }).eq('id', sessionId).eq('status', 'generating')
      if (session.error) throw session.error
    },
  }
}
