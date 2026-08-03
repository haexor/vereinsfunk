import { WorkflowNameSchema, WorkflowPayloadSchema, type WorkflowPayload } from '@vereinswerk/contracts'

export type WorkflowName = ReturnType<typeof WorkflowNameSchema.parse>
export interface Orchestrator { trigger(workflow: WorkflowName, payload: WorkflowPayload, options?: { scheduledFor?: Date }): Promise<{ runId: string }>; cancel(runId: string): Promise<void> }
export function assertWorkflowPayload(payload: unknown): WorkflowPayload { return WorkflowPayloadSchema.parse(payload) }
export class FakeOrchestrator implements Orchestrator {
  readonly runs = new Map<string, { workflow: WorkflowName; payload: WorkflowPayload; scheduledFor?: Date; cancelled: boolean }>()
  async trigger(workflow: WorkflowName, raw: WorkflowPayload, options?: { scheduledFor?: Date }) { const payload = assertWorkflowPayload(raw); const existing = [...this.runs.entries()].find(([, run]) => run.workflow === workflow && run.payload.idempotencyKey === payload.idempotencyKey); if (existing) return { runId: existing[0] }; const runId = `fake-run-${this.runs.size + 1}`; const run = { workflow: WorkflowNameSchema.parse(workflow), payload, cancelled: false }; this.runs.set(runId, options?.scheduledFor ? { ...run, scheduledFor: options.scheduledFor } : run); return { runId } }
  async cancel(runId: string) { const run = this.runs.get(runId); if (run) run.cancelled = true }
}
