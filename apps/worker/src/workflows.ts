import { ConcurrencyLimitStrategy, HatchetClient, NonRetryableError, type Worker } from '@hatchet-dev/typescript-sdk/v1/index.js'
import { WorkflowPayloadSchema, type WorkflowPayload } from '@vereinsfunk/contracts'
import { createIdempotencyKey } from '@vereinsfunk/domain'
import { priorityToHatchet } from '@vereinsfunk/orchestration'

export const concurrency = {
  llm: { global: 20, organization: 4, department: 2 }, image: { global: 12, organization: 3, department: 1 },
  video: { global: 4, organization: 1, department: 1 }, publishing: { global: 20, organization: 4, department: 2 },
} as const
export interface WorkflowContext {
  loadSubmission(payload: WorkflowPayload): Promise<{ status: string; sourceRevision?: number } | null>
  updateSubmission(payload: WorkflowPayload, status: 'generating' | 'failed'): Promise<void>
  enqueueDraft(input: WorkflowPayload): Promise<void>
}
export class NonRetryableWorkflowError extends NonRetryableError {}
export function fairnessKey(payload: Pick<WorkflowPayload, 'organizationId' | 'departmentId'>) { return `${payload.organizationId}:${payload.departmentId}` }
const DEFAULT_SUBMISSION_PRIORITY = 40 // matches CreateSubmissionSchema's priority default

export async function processSubmission(raw: unknown, context: WorkflowContext): Promise<void> {
  const payload = WorkflowPayloadSchema.parse(raw)
  const submissionId = payload.submissionId ?? payload.entityId
  const submission = await context.loadSubmission(payload)
  if (!submission) {
    throw new NonRetryableWorkflowError('submission_not_found')
  }
  if (submission.status !== 'queued' || (submission.sourceRevision !== undefined && submission.sourceRevision !== payload.sourceRevision)) return
  await context.updateSubmission(payload, 'generating')
  try {
    await context.enqueueDraft({ ...payload, submissionId, entityId: submissionId, idempotencyKey: createIdempotencyKey('draft', submissionId, payload.sourceRevision) })
  } catch (error) {
    await context.updateSubmission(payload, 'failed').catch(() => {})
    throw error
  }
}

/** Real SDK declarations; starting needs explicit credentials and a Supabase-backed context. */
export async function createHatchetWorker(context: WorkflowContext, env: NodeJS.ProcessEnv = process.env): Promise<Worker> {
  const token = env.HATCHET_CLIENT_TOKEN
  if (!token) throw new Error('HATCHET_CLIENT_TOKEN is required to start the worker')
  const client = HatchetClient.init<WorkflowPayload>({ token, host_port: env.HATCHET_CLIENT_HOST_PORT ?? 'localhost:7077', tls_config: { tls_strategy: env.HATCHET_TLS === 'true' ? 'tls' : 'none' } })
  const workflow = client.task({ name: 'process-submission', inputValidator: WorkflowPayloadSchema,
    concurrency: [{ expression: "input.organizationId + ':' + input.departmentId", maxRuns: concurrency.llm.department, limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN }, { expression: 'input.organizationId', maxRuns: concurrency.llm.organization, limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN }, { expression: "'global'", maxRuns: concurrency.llm.global, limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN }],
    defaultPriority: priorityToHatchet(DEFAULT_SUBMISSION_PRIORITY),
    idempotency: { expression: 'input.idempotencyKey', strategy: 'status', fallbackTtlMs: 86_400_000 }, retries: 3, executionTimeout: '5m', fn: async (input) => { await processSubmission(input, context); return {} } })
  const worker = await client.worker('vereinsfunk-worker', { slots: Number(env.HATCHET_WORKER_SLOTS ?? 8) })
  await worker.registerWorkflows([workflow])
  return worker
}
