import { HatchetClient } from '@hatchet-dev/typescript-sdk/v1/index.js'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowPayload } from '@vereinsfunk/contracts'
import { WorkflowNameSchema } from '@vereinsfunk/contracts'
import { ConcurrencyLimitStrategy } from '@hatchet-dev/typescript-sdk/v1/task.js'
import type { GenerationRecoveryRepository } from './generationRecovery.js'
import type { VisionProviderComparisonExecutor } from './visionProviderComparison.js'
import { concurrency, createGenerationRecoveryScanWorkflow, createHatchetWorker, createVisionProviderComparisonScanWorkflow, createWorkflowDefinitions, keepLeaseAlive, WorkflowExecutionError, type ProductWorkflowExecutor, type WorkflowExecutionRepository } from './workflows.js'

const payload: WorkflowPayload = {
  entityId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222',
  departmentId: '33333333-3333-4333-8333-333333333333', departmentConcurrencyKey: '33333333-3333-4333-8333-333333333333',
  correlationId: '44444444-4444-4444-8444-444444444444',
  sourceRevision: 1, purpose: 'test', idempotencyKey: 'technical:test:1',
}

function declarations(begin: WorkflowExecutionRepository['begin'], execute = vi.fn<ProductWorkflowExecutor['execute']>().mockResolvedValue(undefined)) {
  const runs: WorkflowExecutionRepository = {
    begin,
    renew: vi.fn().mockResolvedValue(true),
    succeed: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  }
  const client = HatchetClient.init<WorkflowPayload>({ token: 'x.eyJzdWIiOiJ0ZXN0LXRlbmFudCJ9.x', api_url: 'http://localhost:8080', host_port: 'localhost:7077', tls_config: { tls_strategy: 'none' } })
  const definitions = createWorkflowDefinitions(client, runs, { execute })
  const options = definitions.find((definition) => definition.name === 'process-submission')?.definition._tasks[0]
  if (!options?.fn) throw new Error('process-submission handler was not registered')
  const task = options.fn
  return { definitions, task, runs, execute }
}

/** Der Ausschnitt des Hatchet-Kontexts, den die Task-Funktion liest. */
function attemptContext(retryCount: number) {
  return { retryCount: () => retryCount } as never
}

describe('worker workflow registration', () => {
  it('registers every allow-listed workflow with ID-only validation and fairness limits', async () => {
    const { definitions, task } = declarations(async () => ({ state: 'already_handled' }))
    expect(definitions).toHaveLength(WorkflowNameSchema.options.length)
    expect(definitions.map((definition) => definition.name)).toEqual(WorkflowNameSchema.options)
    expect(definitions[0]?.definition._tasks[0]?.concurrency).toEqual([
      expect.objectContaining({ expression: "input.organizationId + ':' + input.departmentConcurrencyKey", maxRuns: 2 }),
      expect.objectContaining({ expression: 'input.organizationId', maxRuns: 4 }),
      expect.objectContaining({ expression: "'global'", maxRuns: 20 }),
    ])
    expect(concurrency.llm).toEqual({ global: 20, organization: 4, department: 2 })
    // Die Browser-Analyse laeuft bewusst nicht unter den llm-Grenzen, siehe concurrency.browser.
    expect(definitions.find((definition) => definition.name === 'analyze-website-branding')?.definition._tasks[0]?.concurrency).toEqual([
      expect.objectContaining({ expression: "input.organizationId + ':' + input.departmentConcurrencyKey", maxRuns: 1 }),
      expect.objectContaining({ expression: 'input.organizationId', maxRuns: 1 }),
      expect.objectContaining({ expression: "'global'", maxRuns: 2 }),
    ])
    await expect(task({ ...payload, entityId: 'not-a-uuid' }, {} as never)).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('does not execute duplicate deliveries', async () => {
    const { task, execute, runs } = declarations(async () => ({ state: 'already_handled' }))
    await expect(task(payload, {} as never)).resolves.toBeUndefined()
    expect(execute).not.toHaveBeenCalled()
    expect(runs.succeed).not.toHaveBeenCalled()
  })

  it('retries a delivery that races the durable outbox acknowledgement', async () => {
    const { task, execute } = declarations(async () => ({ state: 'not_found' }))
    await expect(task(payload, {} as never)).rejects.toMatchObject({ errorClass: 'run_mapping_pending', retryable: true })
    expect(execute).not.toHaveBeenCalled()
  })

  it('records a non-retryable failure and does not mark the run as succeeded', async () => {
    const execute = vi.fn<ProductWorkflowExecutor['execute']>().mockRejectedValue(new WorkflowExecutionError('authorization', false))
    const { task, runs } = declarations(async () => ({ state: 'acquired', leaseToken: '55555555-5555-4555-8555-555555555555' }), execute)
    await expect(task(payload, attemptContext(0))).rejects.toMatchObject({ name: 'NonRetryableError' })
    expect(runs.fail).toHaveBeenCalledWith('process-submission', payload, '55555555-5555-4555-8555-555555555555', 'authorization', false)
    expect(runs.succeed).not.toHaveBeenCalled()
  })

  it('tells the executor whether this is the last Hatchet attempt', async () => {
    const execute = vi.fn<ProductWorkflowExecutor['execute']>().mockResolvedValue(undefined)
    const { task } = declarations(async () => ({ state: 'acquired', leaseToken: '55555555-5555-4555-8555-555555555555' }), execute)
    await task(payload, attemptContext(2))
    await task(payload, attemptContext(3))
    expect(execute.mock.calls.map((call) => call[2])).toEqual([{ final: false }, { final: true }])
  })

  // Vorher meldete die zweite Zustellung den noch laufenden Lauf als erledigt; scheiterte der
  // erste Versuch danach, gab es keinen Retry mehr.
  it('retries a delivery while another attempt still holds the lease', async () => {
    const { task, execute } = declarations(async () => ({ state: 'in_progress' }))
    await expect(task(payload, attemptContext(0))).rejects.toMatchObject({ errorClass: 'run_in_progress', retryable: true })
    expect(execute).not.toHaveBeenCalled()
  })

  it('renews the lease while a long attempt runs and stops afterwards', async () => {
    vi.useFakeTimers()
    try {
      let finish = () => {}
      const execute = vi.fn<ProductWorkflowExecutor['execute']>().mockImplementation(() => new Promise((resolve) => { finish = resolve }))
      const { task, runs } = declarations(async () => ({ state: 'acquired', leaseToken: '55555555-5555-4555-8555-555555555555' }), execute)
      const running = task(payload, attemptContext(0))
      await vi.advanceTimersByTimeAsync(130_000)
      expect(runs.renew).toHaveBeenCalledTimes(3)
      expect(runs.renew).toHaveBeenCalledWith('process-submission', payload, '55555555-5555-4555-8555-555555555555')
      finish()
      await running
      await vi.advanceTimersByTimeAsync(120_000)
      expect(runs.renew).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('records and rethrows a retryable executor failure', async () => {
    const execute = vi.fn<ProductWorkflowExecutor['execute']>().mockRejectedValue(new WorkflowExecutionError('provider_unavailable', true))
    const { task, runs } = declarations(async () => ({ state: 'acquired', leaseToken: '55555555-5555-4555-8555-555555555555' }), execute)
    await expect(task(payload, attemptContext(0))).rejects.toMatchObject({ errorClass: 'provider_unavailable', retryable: true })
    expect(runs.fail).toHaveBeenCalledWith('process-submission', payload, '55555555-5555-4555-8555-555555555555', 'provider_unavailable', true)
    expect(runs.succeed).not.toHaveBeenCalled()
  })
})

describe('keepLeaseAlive', () => {
  it('stops once the lease is lost, keeps going after a failed call and gives up after 30 minutes', async () => {
    vi.useFakeTimers()
    try {
      const lost = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
      keepLeaseAlive(lost)
      await vi.advanceTimersByTimeAsync(200_000)
      expect(lost).toHaveBeenCalledTimes(2)

      const flaky = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(true)
      const stopFlaky = keepLeaseAlive(flaky)
      await vi.advanceTimersByTimeAsync(80_000)
      expect(flaky).toHaveBeenCalledTimes(2)
      stopFlaky()

      const hanging = vi.fn().mockResolvedValue(true)
      keepLeaseAlive(hanging)
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(hanging).toHaveBeenCalledTimes(44)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('generation-recovery-scan registration', () => {
  it('is registered outside WorkflowNameSchema, scheduled by cron, and not ID-only validated', () => {
    const client = HatchetClient.init<WorkflowPayload>({ token: 'x.eyJzdWIiOiJ0ZXN0LXRlbmFudCJ9.x', api_url: 'http://localhost:8080', host_port: 'localhost:7077', tls_config: { tls_strategy: 'none' } })
    const recovery: GenerationRecoveryRepository = { claimStalledCandidates: vi.fn().mockResolvedValue([]), loadSessionForRecovery: vi.fn(), createRecoveryAttempt: vi.fn(), finalizeRecovery: vi.fn() }
    const declaration = createGenerationRecoveryScanWorkflow(client, recovery)
    expect(declaration.name).toBe('generation-recovery-scan')
    expect(WorkflowNameSchema.options).not.toContain('generation-recovery-scan')
    expect(declaration.definition.onCrons).toEqual(['*/5 * * * *'])
  })
  it('scans for stalled candidates when triggered', async () => {
    const client = HatchetClient.init<WorkflowPayload>({ token: 'x.eyJzdWIiOiJ0ZXN0LXRlbmFudCJ9.x', api_url: 'http://localhost:8080', host_port: 'localhost:7077', tls_config: { tls_strategy: 'none' } })
    const claimStalledCandidates = vi.fn().mockResolvedValue([])
    const recovery: GenerationRecoveryRepository = { claimStalledCandidates, loadSessionForRecovery: vi.fn(), createRecoveryAttempt: vi.fn(), finalizeRecovery: vi.fn() }
    const declaration = createGenerationRecoveryScanWorkflow(client, recovery)
    const task = declaration.definition._tasks[0]?.fn
    if (!task) throw new Error('generation-recovery-scan handler was not registered')
    await task({}, {} as never)
    expect(claimStalledCandidates).toHaveBeenCalled()
  })
})

describe('worker process integration', () => {
  const client = () => HatchetClient.init<WorkflowPayload>({ token: 'x.eyJzdWIiOiJ0ZXN0LXRlbmFudCJ9.x', api_url: 'http://localhost:8080', host_port: 'localhost:7077', tls_config: { tls_strategy: 'none' } })

  // Mit dem SDK-Default beendet dessen eigener SIGTERM-Handler den Prozess per process.exit(0),
  // bevor index.ts' shutdown() den Outbox-Versand abgeschlossen hat.
  it('leaves signal handling to the worker process instead of the SDK', async () => {
    const hatchet = client()
    const worker = vi.spyOn(hatchet, 'worker').mockResolvedValue({ registerWorkflows: vi.fn() } as never)
    const recovery: GenerationRecoveryRepository = { claimStalledCandidates: vi.fn(), loadSessionForRecovery: vi.fn(), createRecoveryAttempt: vi.fn(), finalizeRecovery: vi.fn() }
    const runs: WorkflowExecutionRepository = { begin: vi.fn(), renew: vi.fn(), succeed: vi.fn(), fail: vi.fn() }
    await createHatchetWorker(hatchet, { HATCHET_WORKER_SLOTS: 4 }, runs, { execute: vi.fn() }, recovery, {} as VisionProviderComparisonExecutor, { enqueueScheduled: vi.fn() })
    expect(worker).toHaveBeenCalledWith('vereinsfunk-worker', expect.objectContaining({ handleKill: false }))
  })

  it('never runs two vision-comparison ticks (two Chromium instances) at once', () => {
    const declaration = createVisionProviderComparisonScanWorkflow(client(), {} as VisionProviderComparisonExecutor)
    expect(declaration.definition._tasks[0]?.concurrency).toEqual({ expression: "'global'", maxRuns: 1, limitStrategy: ConcurrencyLimitStrategy.CANCEL_NEWEST })
  })
})
