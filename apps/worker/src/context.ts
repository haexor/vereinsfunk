import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { CommunicationGoalSchema, MaxCharactersSchema, SocialPlatformSchema, SourceMaterialSchema, TextGenerationTemperatureSchema, UuidSchema, WorkflowNameSchema, WorkflowPayloadSchema, type WorkflowPayload } from '@vereinsfunk/contracts'
import type { WorkflowOutboxRepository } from '@vereinsfunk/orchestration'
import { WorkflowExecutionError, type WorkflowExecutionRepository, type WorkflowRunAcquireResult } from './workflows.js'
import type { CandidateRow, ProviderRow, SessionRow, TextGenerationRepository } from './textGeneration.js'
import type { GenerationRecoveryRepository, RecoverableSessionRow, StalledCandidateRow } from './generationRecovery.js'

// style_profile_snapshot stays unvalidated here: a pre-migration snapshot in the old dial shape
// must not fail loadSession() before acquirePendingCandidate() runs, or a stuck 'pending'
// candidate could never be reclaimed by recovery (which only reclaims 'generating' rows).
// textGeneration.ts's execute() is the single place that parses it, inside its try/catch, where
// a schema mismatch is properly classified and the candidate is marked failed.
const SessionRowSchema: z.ZodType<SessionRow> = z.object({
  id: UuidSchema, organization_id: UuidSchema, department_id: UuidSchema, team_id: UuidSchema.nullable(),
  communication_goal: CommunicationGoalSchema, source_material: SourceMaterialSchema,
  style_profile_snapshot: z.unknown(), max_characters: z.coerce.number().pipe(MaxCharactersSchema), temperature: z.coerce.number().pipe(TextGenerationTemperatureSchema),
})
const CandidateRowSchema: z.ZodType<CandidateRow> = z.object({ id: UuidSchema, status: z.literal('generating'), revision_instruction: z.string().nullable(), lease_token: UuidSchema })
const ProviderRowSchema: z.ZodType<ProviderRow> = z.object({
  id: UuidSchema, protocol: z.string(), base_url: z.url(), model: z.string().trim().min(1),
  structured_output_required: z.boolean(), api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1),
})
const StalledCandidateRowSchema: z.ZodType<StalledCandidateRow> = z.object({
  id: UuidSchema, composition_session_id: UuidSchema, organization_id: UuidSchema, generation_intent: z.enum(['initial', 'revise']), revision_instruction: z.string().nullable(),
  generation_lease_token: UuidSchema,
})
// Opaque passthrough fields (requested_formats/source_material/style_profile_snapshot/
// effective_config_snapshot) are only ever handed back to create_text_generation_session
// unchanged here, never interpreted -- unlike SessionRowSchema above, which a text generator
// actually reads, so it needs the stricter shape. Still .nonoptional(): a missing key must be
// rejected at this boundary rather than silently passed through create_text_generation_session
// as a JSON null.
const RecoverableSessionRowSchema: z.ZodType<RecoverableSessionRow> = z.object({
  organization_id: UuidSchema, department_id: UuidSchema, team_id: UuidSchema.nullable(),
  communication_goal: CommunicationGoalSchema, requested_formats: z.unknown().nonoptional(), source_material: z.unknown().nonoptional(), style_profile_id: UuidSchema.nullable(),
  style_profile_snapshot: z.unknown().nonoptional(), effective_config_snapshot: z.unknown().nonoptional(),
  target_platforms: z.array(SocialPlatformSchema), max_characters: z.coerce.number().pipe(MaxCharactersSchema), temperature: z.coerce.number().pipe(TextGenerationTemperatureSchema),
  source_revision: z.coerce.number().int().positive(),
  input_hash: z.string().regex(/^[a-f0-9]{64}$/), created_by: UuidSchema,
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
      const { data, error } = await client.from('composition_sessions').select('id, organization_id, department_id, team_id, communication_goal, source_material, style_profile_snapshot, max_characters, temperature').eq('id', id).eq('organization_id', organizationId).maybeSingle()
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
    // Seit 2026081305 vergibt eine aktive Aufgabenart jede Prioritaet nur einmal -- die vorderste
    // Zeile ist damit eindeutig. Die frueher hier noetige Gleichstandspruefung (zwei Zeilen laden,
    // bei gleicher Prioritaet abbrechen) haette den Konflikt erst hier gemeldet, wo ihn niemand
    // mehr aufloesen kann; er scheitert jetzt schon beim Speichern in der Provider-Verwaltung.
    async loadActiveTextProvider() {
      const { data, error } = await client.from('llm_provider_configurations')
        .select('id, protocol, base_url, model, structured_output_required, llm_provider_secrets!inner(api_key_ciphertext, key_version)')
        .eq('task_kind', 'text_generation').eq('is_active', true).order('priority').limit(1)
      if (error) throw error
      if (data.length === 0) throw new Error('no active text provider is configured')
      const row = z.object({
        id: UuidSchema, protocol: z.string(), base_url: z.url(), model: z.string().trim().min(1),
        structured_output_required: z.boolean(), llm_provider_secrets: z.union([z.object({ api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1) }), z.array(z.object({ api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1) })).min(1)]),
      }).parse(data[0])
      const secret = row.llm_provider_secrets
      const value = Array.isArray(secret) ? secret[0] : secret
      if (!value) throw new Error('text provider secret missing')
      return ProviderRowSchema.parse({ ...row, api_key_ciphertext: value.api_key_ciphertext, key_version: value.key_version })
    },
    async markReady(candidateId, sessionId, leaseToken, generatedContent, metadata) {
      const { error } = await client.rpc('mark_generation_candidate_ready', {
        p_candidate_id: candidateId, p_session_id: sessionId, p_lease_token: leaseToken, p_generated_content: generatedContent,
        p_provider_configuration_id: metadata.providerConfigurationId, p_provider_model_id: metadata.providerModelId,
        p_provider_parameter_hash: metadata.providerParameterHash, p_prompt_template_version: metadata.promptTemplateVersion,
      })
      if (error) throw error
    },
    async markFailed(candidateId, sessionId, leaseToken, errorClass) {
      const { error } = await client.rpc('mark_generation_candidate_failed', { p_candidate_id: candidateId, p_session_id: sessionId, p_lease_token: leaseToken, p_error_class: errorClass })
      if (error) throw error
    },
    async releaseCandidate(candidateId, sessionId, leaseToken) {
      const { error } = await client.rpc('release_generation_candidate', { p_candidate_id: candidateId, p_session_id: sessionId, p_lease_token: leaseToken })
      if (error) throw error
    },
  }
}

/** Worker-only data access for the recovery-scan cron workflow. Never called from a product workflow. */
export function createGenerationRecoveryRepository(config: WorkerEnvironment): GenerationRecoveryRepository {
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async claimStalledCandidates(limit) {
      const { data, error } = await client.rpc('claim_stalled_generation_candidates', { p_limit: limit })
      if (error) throw error
      return (data ?? []).map((row: unknown) => StalledCandidateRowSchema.parse(row))
    },
    async loadSessionForRecovery(sessionId, organizationId) {
      const { data, error } = await client.from('composition_sessions')
        .select('organization_id, department_id, team_id, communication_goal, requested_formats, source_material, style_profile_id, style_profile_snapshot, effective_config_snapshot, target_platforms, max_characters, temperature, source_revision, input_hash, created_by')
        .eq('id', sessionId).eq('organization_id', organizationId).maybeSingle()
      if (error) throw error
      return data === null ? null : RecoverableSessionRowSchema.parse(data)
    },
    async createRecoveryAttempt(session, stale, candidateInputHash, correlationId, idempotencyKey) {
      const { error } = await client.rpc('create_text_generation_session', {
        p_organization_id: session.organization_id, p_department_id: session.department_id, p_team_id: session.team_id,
        p_communication_goal: session.communication_goal, p_requested_formats: session.requested_formats,
        p_source_material: session.source_material, p_style_profile_id: session.style_profile_id,
        p_style_profile_snapshot: session.style_profile_snapshot, p_effective_config_snapshot: session.effective_config_snapshot,
        p_target_platforms: session.target_platforms, p_max_characters: session.max_characters, p_temperature: session.temperature,
        p_source_revision: session.source_revision, p_input_hash: session.input_hash, p_candidate_input_hash: candidateInputHash,
        p_generation_intent: stale.generation_intent, p_revision_instruction: stale.revision_instruction, p_created_by: session.created_by,
        p_correlation_id: correlationId, p_idempotency_key: idempotencyKey, p_triggered_by: 'automatic_recovery',
      })
      if (error) {
        if (error.message === 'composition_session_candidate_limit_reached') return 'limit_reached'
        throw error
      }
      return 'created'
    },
    async finalizeRecovery(stale, failureCode) {
      const { error } = await client.rpc('finalize_stalled_generation_recovery', {
        p_candidate_id: stale.id, p_session_id: stale.composition_session_id, p_lease_token: stale.generation_lease_token, p_failure_code: failureCode,
      })
      if (error) throw error
    },
  }
}
