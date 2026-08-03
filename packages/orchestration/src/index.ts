import { WorkflowNameSchema, WorkflowPayloadSchema, type WorkflowPayload } from '@vereinsfunk/contracts'

export type WorkflowName = ReturnType<typeof WorkflowNameSchema.parse>
export type HatchetPriority = 1 | 2 | 3
export function priorityToHatchet(priority: number): HatchetPriority { return priority >= 70 ? 3 : priority >= 40 ? 2 : 1 }
export interface Orchestrator { trigger(workflow: WorkflowName, payload: WorkflowPayload, options?: { scheduledFor?: Date; priority?: HatchetPriority }): Promise<{ runId: string }>; cancel(runId: string): Promise<void> }
export function assertWorkflowPayload(payload: unknown): WorkflowPayload { return WorkflowPayloadSchema.parse(payload) }
export class FakeOrchestrator implements Orchestrator {
  readonly runs = new Map<string, { workflow: WorkflowName; payload: WorkflowPayload; scheduledFor?: Date; priority?: HatchetPriority; cancelled: boolean }>()
  async trigger(workflow: WorkflowName, raw: WorkflowPayload, options?: { scheduledFor?: Date; priority?: HatchetPriority }) { const payload = assertWorkflowPayload(raw); const existing = [...this.runs.entries()].find(([, run]) => run.workflow === workflow && run.payload.idempotencyKey === payload.idempotencyKey); if (existing) return { runId: existing[0] }; const runId = `fake-run-${this.runs.size + 1}`; const run = { workflow: WorkflowNameSchema.parse(workflow), payload, cancelled: false, ...(options?.scheduledFor ? { scheduledFor: options.scheduledFor } : {}), ...(options?.priority ? { priority: options.priority } : {}) }; this.runs.set(runId, run); return { runId } }
  async cancel(runId: string) { const run = this.runs.get(runId); if (run) run.cancelled = true }
}
