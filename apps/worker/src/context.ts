import { createClient } from '@supabase/supabase-js'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { WorkflowNameSchema, WorkflowPayloadSchema, type WorkflowPayload } from '@vereinsfunk/contracts'
import type { WorkflowOutboxRepository } from '@vereinsfunk/orchestration'
import type { WorkflowExecutionRepository, WorkflowRunAcquireResult } from './workflows.js'

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
      if (data === 'acquired' || data === 'already_handled' || data === 'not_found') return data
      throw new Error('unexpected workflow run acquisition state')
    },
    async succeed(workflow, payload) {
      const { data, error } = await client.rpc('finish_workflow_run', { ...rpcInput(workflow, payload), p_status: 'succeeded', p_error_class: null })
      if (error || !data) throw error ?? new Error('workflow run completion lost')
    },
    async fail(workflow, payload, errorClass, retryable) {
      const { data, error } = await client.rpc('finish_workflow_run', {
        ...rpcInput(workflow, payload), p_status: retryable ? 'failed' : 'action_required', p_error_class: errorClass,
      })
      if (error || !data) throw error ?? new Error('workflow run failure update lost')
    },
  }
}
