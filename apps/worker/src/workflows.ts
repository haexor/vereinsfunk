import { z } from 'zod'
import { HatchetClient, type Worker } from '@hatchet-dev/typescript-sdk/v1/index.js'
import { type TaskWorkflowDeclaration } from '@hatchet-dev/typescript-sdk/v1/declaration.js'
import { ConcurrencyLimitStrategy, NonRetryableError } from '@hatchet-dev/typescript-sdk/v1/task.js'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { WorkflowNameSchema, WorkflowPayloadSchema, type WorkflowName, type WorkflowPayload } from '@vereinsfunk/contracts'
import { scanAndRecoverStaleCandidates, type GenerationRecoveryRepository } from './generationRecovery.js'
import { drainPendingVisionProviderComparisons, type VisionProviderComparisonExecutor } from './visionProviderComparison.js'

export const concurrency = {
  llm: { global: 20, organization: 4, department: 2 }, image: { global: 12, organization: 3, department: 1 },
  video: { global: 4, organization: 1, department: 1 }, publishing: { global: 20, organization: 4, department: 2 },
  // Paket 048: eine Website-Analyse startet ein echtes, headless Chromium (siehe
  // websiteRenderer.ts) -- ein voellig anderes Ressourcenprofil als ein HTTP-Aufruf an einen
  // LLM-Endpunkt. Mehrere hundert MB Speicher je Lauf: gaebe man ihr die llm-Grenzen, koennten
  // allein diese Jobs alle Slots des Workers mit Browsern belegen und ihn per OOM mitsamt aller
  // laufenden Textgenerierungen beenden.
  browser: { global: 2, organization: 1, department: 1 },
} as const

export type WorkflowRunAcquireResult =
  | { state: 'acquired'; leaseToken: string }
  | { state: 'already_handled' | 'not_found' }
export interface WorkflowExecutionRepository {
  begin(workflow: WorkflowName, payload: WorkflowPayload): Promise<WorkflowRunAcquireResult>
  succeed(workflow: WorkflowName, payload: WorkflowPayload, leaseToken: string): Promise<void>
  fail(workflow: WorkflowName, payload: WorkflowPayload, leaseToken: string, errorClass: string, retryable: boolean): Promise<void>
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
      : workflow === 'anonymize-media' ? concurrency.image
        : workflow === 'analyze-website-branding' ? concurrency.browser : concurrency.llm
  return [
    // departmentConcurrencyKey, not departmentId: an organization-level job (null departmentId)
    // gets its own 'org' lane instead of silently sharing a real department's round-robin group.
    { expression: "input.organizationId + ':' + input.departmentConcurrencyKey", maxRuns: limits.department, limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN },
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
      if (acquired.state !== 'acquired') {
        if (acquired.state === 'already_handled') return
        // Hatchet is allowed to schedule a run before the outbox dispatcher obtains its durable
        // acknowledgement. Retrying is the only safe response: performing an untracked action is not.
        throw new WorkflowExecutionError('run_mapping_pending', true)
      }
      const leaseToken = acquired.leaseToken
      try {
        await executor.execute(workflow, payload)
        await runs.succeed(workflow, payload, leaseToken)
      } catch (error) {
        const classified = classifyWorkflowError(error)
        await runs.fail(workflow, payload, leaseToken, classified.errorClass, classified.retryable)
        if (!classified.retryable) throw new NonRetryableError(classified.errorClass)
        throw classified
      }
    },
  }))
}

/**
 * Registers the recovery-scan cron workflow. Deliberately outside WorkflowNameSchema's generic
 * per-entity loop above: it performs no single technical action of its own to lease -- it only
 * detects stalled rows and, through create_text_generation_session, hands each one off to the
 * ordinary generate-text-post path (workflow_outbox -> createWorkflowDefinitions). No
 * workflow_runs/workflow_outbox bookkeeping either: claim_stalled_generation_candidates' own
 * skip-locked claim already makes every tick safe against concurrent or repeated execution.
 */
export function createGenerationRecoveryScanWorkflow(client: HatchetClient<WorkflowPayload>, recovery: GenerationRecoveryRepository) {
  return client.task({
    name: 'generation-recovery-scan',
    onCrons: ['*/5 * * * *'],
    inputValidator: z.object({}),
    executionTimeout: '5m',
    fn: async () => { await scanAndRecoverStaleCandidates(recovery) },
  })
}

/**
 * Registers the vision-provider-comparison poll (Paket 050, plattform-admin/vision-vergleich).
 * Outside the generic per-entity loop for the same reason as the recovery-scan cron above: a
 * platform-admin test run has no organization/department to satisfy workflow_outbox's NOT NULL
 * columns (siehe feedback_workflow_outbox_erzwingt_department_id) and there is no real one to
 * borrow, unlike start_brand_website_analysis's placeholder-department trick. The claim RPC's own
 * skip-locked select already makes every tick safe against concurrent or overlapping execution.
 */
export function createVisionProviderComparisonScanWorkflow(client: HatchetClient<WorkflowPayload>, comparisons: VisionProviderComparisonExecutor) {
  return client.task({
    name: 'vision-provider-comparison-scan',
    onCrons: ['*/1 * * * *'],
    inputValidator: z.object({}),
    executionTimeout: '10m',
    fn: async () => { await drainPendingVisionProviderComparisons(comparisons) },
  })
}

/** Creates a real SDK worker and registers all bounded technical workflow envelopes. */
export async function createHatchetWorker(
  config: WorkerEnvironment,
  runs: WorkflowExecutionRepository,
  executor: ProductWorkflowExecutor,
  recovery: GenerationRecoveryRepository,
  visionComparisons: VisionProviderComparisonExecutor,
): Promise<Worker> {
  const client = HatchetClient.init<WorkflowPayload>({
    token: config.HATCHET_CLIENT_TOKEN,
    api_url: config.HATCHET_CLIENT_API_URL,
    host_port: config.HATCHET_CLIENT_HOST_PORT,
    tls_config: { tls_strategy: config.HATCHET_TLS ? 'tls' : 'none' },
  })
  const worker = await client.worker('vereinsfunk-worker', { slots: config.HATCHET_WORKER_SLOTS })
  await worker.registerWorkflows([
    ...createWorkflowDefinitions(client, runs, executor),
    createGenerationRecoveryScanWorkflow(client, recovery),
    createVisionProviderComparisonScanWorkflow(client, visionComparisons),
  ])
  return worker
}
