import { WorkflowNameSchema, WorkflowPayloadSchema, type WorkflowPayload } from '@vereinsfunk/contracts'
import { HatchetClient, Priority } from '@hatchet-dev/typescript-sdk/v1/index.js'

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

export function createHatchetClient(env: NodeJS.ProcessEnv = process.env) {
  const token = env.HATCHET_CLIENT_TOKEN
  if (!token) throw new Error('HATCHET_CLIENT_TOKEN is required to dispatch workflows')
  return HatchetClient.init<WorkflowPayload>({
    token,
    host_port: env.HATCHET_CLIENT_HOST_PORT ?? 'localhost:7077',
    tls_config: { tls_strategy: env.HATCHET_TLS === 'true' ? 'tls' : 'none' },
  })
}

/** Real SDK adapter.  It sends only the validated payload, never a domain row or secret. */
export class HatchetOrchestrator implements Orchestrator {
  constructor(private readonly client: ReturnType<typeof createHatchetClient>) {}
  async trigger(workflow: WorkflowName, raw: WorkflowPayload, options?: { priority?: HatchetPriority }) {
    const payload = assertWorkflowPayload(raw)
    const run = await this.client.runNoWait(workflow, payload, { priority: options?.priority ?? priorityToHatchet(40) as Priority })
    return { runId: await run.runId }
  }
  async cancel(runId: string) { await this.client.runs.cancel({ ids: [runId] }) }
}

export type ClaimedOutboxEntry = { id: string; workflow: WorkflowName; payload: WorkflowPayload; priority: HatchetPriority }
export interface WorkflowOutboxRepository {
  /** Atomically claims pending rows. A claimed row is invisible to concurrent dispatchers. */
  claimPending(limit: number): Promise<ClaimedOutboxEntry[]>
  markDispatched(outboxId: string, runId: string): Promise<void>
  markRetryableFailure(outboxId: string, errorClass: string): Promise<void>
}

export class WorkflowOutboxDispatcher {
  constructor(private readonly outbox: WorkflowOutboxRepository, private readonly orchestrator: Orchestrator) {}
  async dispatchPending(limit = 20) {
    const claimed = await this.outbox.claimPending(limit)
    for (const entry of claimed) {
      try {
        const { runId } = await this.orchestrator.trigger(entry.workflow, entry.payload, { priority: entry.priority })
        await this.outbox.markDispatched(entry.id, runId)
      } catch (error) {
        await this.outbox.markRetryableFailure(entry.id, error instanceof Error ? error.name : 'unknown')
      }
    }
    return claimed.length
  }
}
