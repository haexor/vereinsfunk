import { HatchetClient } from '@hatchet-dev/typescript-sdk/v1/index.js'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowPayload } from '@vereinsfunk/contracts'
import { WorkflowNameSchema } from '@vereinsfunk/contracts'
import { concurrency, createWorkflowDefinitions, WorkflowExecutionError, type ProductWorkflowExecutor, type WorkflowExecutionRepository } from './workflows.js'

const payload: WorkflowPayload = {
  entityId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222',
  departmentId: '33333333-3333-4333-8333-333333333333', correlationId: '44444444-4444-4444-8444-444444444444',
  sourceRevision: 1, purpose: 'test', idempotencyKey: 'technical:test:1',
}

function declarations(begin: WorkflowExecutionRepository['begin'], execute = vi.fn<ProductWorkflowExecutor['execute']>().mockResolvedValue(undefined)) {
  const runs: WorkflowExecutionRepository = {
    begin,
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

describe('worker workflow registration', () => {
  it('registers every allow-listed workflow with ID-only validation and fairness limits', () => {
    const { definitions } = declarations(async () => 'already_handled')
    expect(definitions).toHaveLength(WorkflowNameSchema.options.length)
    expect(definitions.map((definition) => definition.name)).toEqual(WorkflowNameSchema.options)
    expect(definitions[0]?.definition._tasks[0]?.concurrency).toEqual([
      expect.objectContaining({ expression: "input.organizationId + ':' + input.departmentId", maxRuns: 2 }),
      expect.objectContaining({ expression: 'input.organizationId', maxRuns: 4 }),
      expect.objectContaining({ expression: "'global'", maxRuns: 20 }),
    ])
    expect(concurrency.llm).toEqual({ global: 20, organization: 4, department: 2 })
  })

  it('does not execute duplicate deliveries', async () => {
    const { task, execute, runs } = declarations(async () => 'already_handled')
    await expect(task(payload, {} as never)).resolves.toBeUndefined()
    expect(execute).not.toHaveBeenCalled()
    expect(runs.succeed).not.toHaveBeenCalled()
  })

  it('retries a delivery that races the durable outbox acknowledgement', async () => {
    const { task, execute } = declarations(async () => 'not_found')
    await expect(task(payload, {} as never)).rejects.toMatchObject({ errorClass: 'run_mapping_pending', retryable: true })
    expect(execute).not.toHaveBeenCalled()
  })

  it('records a non-retryable failure without permitting a partial technical action', async () => {
    const execute = vi.fn<ProductWorkflowExecutor['execute']>().mockRejectedValue(new WorkflowExecutionError('authorization', false))
    const { task, runs } = declarations(async () => 'acquired', execute)
    await expect(task(payload, {} as never)).rejects.toMatchObject({ name: 'NonRetryableError' })
    expect(runs.fail).toHaveBeenCalledWith('process-submission', payload, 'authorization', false)
    expect(runs.succeed).not.toHaveBeenCalled()
  })
})
