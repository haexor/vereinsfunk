import { HatchetClient, type Worker } from '@hatchet-dev/typescript-sdk/v1/index.js'
import { type TaskWorkflowDeclaration } from '@hatchet-dev/typescript-sdk/v1/declaration.js'
import { ConcurrencyLimitStrategy, NonRetryableError } from '@hatchet-dev/typescript-sdk/v1/task.js'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { WorkflowNameSchema, WorkflowPayloadSchema, type WorkflowName, type WorkflowPayload } from '@vereinsfunk/contracts'

export const concurrency = {
  llm: { global: 20, organization: 4, department: 2 }, image: { global: 12, organization: 3, department: 1 },
  video: { global: 4, organization: 1, department: 1 }, publishing: { global: 20, organization: 4, department: 2 },
} as const

export type WorkflowRunAcquireResult = 'acquired' | 'already_handled' | 'not_found'
export interface WorkflowExecutionRepository {
  begin(workflow: WorkflowName, payload: WorkflowPayload): Promise<WorkflowRunAcquireResult>
  succeed(workflow: WorkflowName, payload: WorkflowPayload): Promise<void>
  fail(workflow: WorkflowName, payload: WorkflowPayload, errorClass: string, retryable: boolean): Promise<void>
}
export interface ProductWorkflowExecutor {
  execute(workflow: WorkflowName, payload: WorkflowPayload): Promise<void>
}

export class WorkflowExecutionError extends Error {
  constructor(readonly errorClass: string, readonly retryable: boolean, message = errorClass) { super(message) }
}

export function classifyWorkflowError(error: unknown): WorkflowExecutionError {
  if (error instanceof WorkflowExecutionError) return error
  if (error instanceof NonRetryableError) return new WorkflowExecutionError('validation', false)
  if (error instanceof Error && /validation|zod|authorization|permission|consent/i.test(error.name + error.message)) {
    return new WorkflowExecutionError('validation', false)
  }
  return new WorkflowExecutionError('transient', true)
}

function concurrencyFor(workflow: WorkflowName) {
  const limits = workflow === 'render-content' ? concurrency.image
    : workflow === 'publish-content' ? concurrency.publishing
      : workflow === 'anonymize-media' ? concurrency.image : concurrency.llm
  return [
    { expression: "input.organizationId + ':' + input.departmentId", maxRuns: limits.department, limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN },
    { expression: 'input.organizationId', maxRuns: limits.organization, limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN },
    { expression: "'global'", maxRuns: limits.global, limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN },
  ]
}

/**
 * Registers only ID-only workflow envelopes. Product actions are injected and therefore remain
 * independently testable; a workflow cannot acquire a run twice, including after a restart.
 */
export function createWorkflowDefinitions(
  client: HatchetClient<WorkflowPayload>,
  runs: WorkflowExecutionRepository,
  executor: ProductWorkflowExecutor,
): TaskWorkflowDeclaration<WorkflowPayload, void>[] {
  return WorkflowNameSchema.options.map((workflow) => client.task<WorkflowPayload, void>({
    name: workflow,
    inputValidator: WorkflowPayloadSchema,
    retries: 3,
    backoff: { factor: 2, maxSeconds: 60 },
    executionTimeout: '10m',
    concurrency: concurrencyFor(workflow),
    idempotency: { strategy: 'status', expression: 'input.idempotencyKey', fallbackTtlMs: 86_400_000 },
    fn: async (raw) => {
      const payload = WorkflowPayloadSchema.parse(raw)
      const acquired = await runs.begin(workflow, payload)
      if (acquired === 'already_handled') return
      // Hatchet is allowed to schedule a run before the outbox dispatcher obtains its durable
      // acknowledgement. Retrying is the only safe response: performing an untracked action is not.
      if (acquired === 'not_found') throw new WorkflowExecutionError('run_mapping_pending', true)
      try {
        await executor.execute(workflow, payload)
        await runs.succeed(workflow, payload)
      } catch (error) {
        const classified = classifyWorkflowError(error)
        await runs.fail(workflow, payload, classified.errorClass, classified.retryable)
        if (!classified.retryable) throw new NonRetryableError(classified.errorClass)
        throw classified
      }
    },
  }))
}

/** Creates a real SDK worker and registers all bounded technical workflow envelopes. */
export async function createHatchetWorker(
  config: WorkerEnvironment,
  runs: WorkflowExecutionRepository,
  executor: ProductWorkflowExecutor,
): Promise<Worker> {
  const client = HatchetClient.init<WorkflowPayload>({
    token: config.HATCHET_CLIENT_TOKEN,
    api_url: config.HATCHET_CLIENT_API_URL,
    host_port: config.HATCHET_CLIENT_HOST_PORT,
    tls_config: { tls_strategy: config.HATCHET_TLS ? 'tls' : 'none' },
  })
  const worker = await client.worker('vereinsfunk-worker', { slots: config.HATCHET_WORKER_SLOTS })
  await worker.registerWorkflows(createWorkflowDefinitions(client, runs, executor))
  return worker
}
