import { WorkflowNameSchema, WorkflowPayloadSchema, type WorkflowPayload } from '@vereinsfunk/contracts'

export type WorkflowName = ReturnType<typeof WorkflowNameSchema.parse>
export type HatchetPriority = 1 | 2 | 3
/** Maps the product priority range onto Hatchet's three supported priority levels. */
export function priorityToHatchet(priority: number): HatchetPriority { return priority >= 70 ? 3 : priority >= 40 ? 2 : 1 }
export interface Orchestrator { trigger(workflow: WorkflowName, payload: WorkflowPayload, options?: { scheduledFor?: Date; priority?: HatchetPriority }): Promise<{ runId: string }>; cancel(runId: string): Promise<void> }
/** Rejects non-ID payloads before they reach a workflow provider. */
export function assertWorkflowPayload(payload: unknown): WorkflowPayload { return WorkflowPayloadSchema.parse(payload) }
/** In-memory provider for deterministic domain tests. */
export class FakeOrchestrator implements Orchestrator {
  readonly runs = new Map<string, { workflow: WorkflowName; payload: WorkflowPayload; scheduledFor?: Date; priority?: HatchetPriority; cancelled: boolean }>()
  async trigger(workflow: WorkflowName, raw: WorkflowPayload, options?: { scheduledFor?: Date; priority?: HatchetPriority }) { const payload = assertWorkflowPayload(raw); const existing = [...this.runs.entries()].find(([, run]) => run.workflow === workflow && run.payload.idempotencyKey === payload.idempotencyKey); if (existing) return { runId: existing[0] }; const runId = `fake-run-${this.runs.size + 1}`; const run = { workflow: WorkflowNameSchema.parse(workflow), payload, cancelled: false, ...(options?.scheduledFor ? { scheduledFor: options.scheduledFor } : {}), ...(options?.priority ? { priority: options.priority } : {}) }; this.runs.set(runId, run); return { runId } }
  async cancel(runId: string) { const run = this.runs.get(runId); if (run) run.cancelled = true }
}

export type ClaimedOutboxEntry = { id: string; claimToken: string; workflow: WorkflowName; payload: WorkflowPayload; priority: HatchetPriority }
export interface WorkflowOutboxRepository {
  /** Atomically claims pending rows. A claimed row is invisible to concurrent dispatchers. */
  claimPending(limit: number): Promise<ClaimedOutboxEntry[]>
  markDispatched(outboxId: string, claimToken: string, runId: string): Promise<void>
  markRetryableFailure(outboxId: string, claimToken: string, errorClass: string): Promise<void>
}

/** Delivers claimed outbox entries exactly once per lease; persistence remains the source of truth. */
export class WorkflowOutboxDispatcher {
  constructor(private readonly outbox: WorkflowOutboxRepository, private readonly orchestrator: Orchestrator) {}
  async dispatchPending(limit = 20) {
    const claimed = await this.outbox.claimPending(limit)
    for (const entry of claimed) {
      try {
        const { runId } = await this.orchestrator.trigger(entry.workflow, entry.payload, { priority: entry.priority })
        await this.outbox.markDispatched(entry.id, entry.claimToken, runId)
      } catch (error) {
        await this.outbox.markRetryableFailure(entry.id, entry.claimToken, error instanceof Error ? error.name : 'unknown')
      }
    }
    return claimed.length
  }
}
