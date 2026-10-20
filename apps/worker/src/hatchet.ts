import { HatchetClient, IdempotencyCollisionError, type Priority } from '@hatchet-dev/typescript-sdk/v1/index.js'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import type { WorkflowPayload } from '@vereinsfunk/contracts'
import { assertWorkflowPayload, priorityToHatchet, type HatchetPriority, type Orchestrator, type WorkflowName } from '@vereinsfunk/orchestration'

type HatchetDispatchClient = {
  runNoWait: (workflow: WorkflowName, payload: WorkflowPayload, options: { priority: Priority }) => Promise<{ runId: string | Promise<string> }>
  scheduled: { create: (workflow: WorkflowName, input: { triggerAt: Date; input: WorkflowPayload; priority: Priority }) => Promise<{ metadata: { id: string } }> }
}

/** Creates the one worker-local Hatchet SDK client (worker registration and outbox dispatch share it). */
export function createHatchetClient(config: WorkerEnvironment): HatchetClient<WorkflowPayload> {
  return HatchetClient.init<WorkflowPayload>({
    token: config.HATCHET_CLIENT_TOKEN,
    api_url: config.HATCHET_CLIENT_API_URL,
    host_port: config.HATCHET_CLIENT_HOST_PORT,
    tls_config: { tls_strategy: config.HATCHET_TLS ? 'tls' : 'none' },
  })
}

/** Hatchet adapter kept in worker infrastructure so domain orchestration stays provider-agnostic. */
export class HatchetOrchestrator implements Orchestrator {
  constructor(private readonly client: HatchetDispatchClient) {}

  async trigger(workflow: WorkflowName, raw: WorkflowPayload, options?: { scheduledFor?: Date; priority?: HatchetPriority }): Promise<{ runId: string }> {
    const payload = assertWorkflowPayload(raw)
    const priority = (options?.priority ?? priorityToHatchet(40)) as Priority
    if (options?.scheduledFor) {
      const scheduled = await this.client.scheduled.create(workflow, { triggerAt: options.scheduledFor, input: payload, priority })
      return { runId: scheduled.metadata.id }
    }
    try {
      const run = await this.client.runNoWait(workflow, payload, { priority })
      return { runId: await run.runId }
    } catch (error) {
      if (error instanceof IdempotencyCollisionError && error.existingRunExternalId) return { runId: error.existingRunExternalId }
      throw error
    }
  }
}
