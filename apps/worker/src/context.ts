import { createClient } from '@supabase/supabase-js'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { WorkflowNameSchema, WorkflowPayloadSchema } from '@vereinsfunk/contracts'
import type { WorkflowOutboxRepository } from '@vereinsfunk/orchestration'

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
