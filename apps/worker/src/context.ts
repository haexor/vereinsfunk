import { createClient } from '@supabase/supabase-js'
import type { WorkflowPayload } from '@vereinsfunk/contracts'
import type { WorkflowContext } from './workflows.js'
import { WorkflowNameSchema, WorkflowPayloadSchema } from '@vereinsfunk/contracts'
import type { WorkflowOutboxRepository } from '@vereinsfunk/orchestration'

/** Service-role access exists only inside the worker; every operation is tenant- and revision-scoped. */
export function createSupabaseWorkflowContext(env: NodeJS.ProcessEnv = process.env): WorkflowContext {
  const url = env.SUPABASE_URL
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRole) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to start the worker')
  const client = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async loadSubmission(payload: WorkflowPayload) {
      const { data, error } = await client.from('submissions').select('status, source_revision').eq('id', payload.entityId).eq('organization_id', payload.organizationId).eq('department_id', payload.departmentId).maybeSingle()
      if (error) throw error
      return data ? { status: data.status, sourceRevision: data.source_revision } : null
    },
    async updateSubmission(payload: WorkflowPayload, status: 'generating' | 'failed') {
      const { error } = await client.from('submissions').update({ status }).eq('id', payload.entityId).eq('organization_id', payload.organizationId).eq('department_id', payload.departmentId).eq('source_revision', payload.sourceRevision).eq('status', 'queued')
      if (error) throw error
    },
    // Package 004 proves transport only; package 032 binds the real text generator here.
    async enqueueDraft() {},
  }
}

export function createWorkflowOutboxRepository(env: NodeJS.ProcessEnv = process.env): WorkflowOutboxRepository {
  const url = env.SUPABASE_URL
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRole) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to dispatch the outbox')
  const client = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async claimPending(limit) {
      const { data, error } = await client.rpc('claim_workflow_outbox', { p_limit: limit })
      if (error) throw error
      return (data ?? []).map((row: { id: string; workflow_name: unknown; payload: unknown; priority: 1 | 2 | 3 }) => ({ id: row.id, workflow: WorkflowNameSchema.parse(row.workflow_name), payload: WorkflowPayloadSchema.parse(row.payload), priority: row.priority }))
    },
    async markDispatched(id, runId) { const { data, error } = await client.rpc('acknowledge_workflow_outbox', { p_outbox_id: id, p_hatchet_run_id: runId }); if (error || !data) throw error ?? new Error('outbox acknowledgement lost') },
    async markRetryableFailure(id, errorClass) { const { data, error } = await client.rpc('release_workflow_outbox', { p_outbox_id: id, p_error_class: errorClass }); if (error || !data) throw error ?? new Error('outbox release lost') },
  }
}
