import { IdempotencyCollisionError, type Priority } from '@hatchet-dev/typescript-sdk/v1/index.js'
import { describe, expect, it, vi } from 'vitest'
import { HatchetOrchestrator } from './hatchet.js'

const payload = { entityId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', departmentId: '33333333-3333-4333-8333-333333333333', correlationId: '44444444-4444-4444-8444-444444444444', sourceRevision: 1, purpose: 'test', idempotencyKey: 'render:x:1' }

function client() {
  return {
    runNoWait: vi.fn().mockResolvedValue({ runId: 'run-1' }),
    scheduled: { create: vi.fn().mockResolvedValue({ metadata: { id: 'scheduled-1' } }) },
    runs: { cancel: vi.fn() },
  }
}

describe('HatchetOrchestrator', () => {
  it('triggers immediate runs with the mapped priority', async () => {
    const sdk = client()
    await expect(new HatchetOrchestrator(sdk).trigger('render-content', payload, { priority: 3 })).resolves.toEqual({ runId: 'run-1' })
    expect(sdk.runNoWait).toHaveBeenCalledWith('render-content', payload, { priority: 3 as Priority })
  })

  it('creates scheduled runs through Hatchet scheduling', async () => {
    const sdk = client()
    const scheduledFor = new Date('2026-08-12T10:00:00.000Z')
    await expect(new HatchetOrchestrator(sdk).trigger('render-content', payload, { scheduledFor, priority: 2 })).resolves.toEqual({ runId: 'scheduled-1' })
    expect(sdk.scheduled.create).toHaveBeenCalledWith('render-content', { triggerAt: scheduledFor, input: payload, priority: 2 as Priority })
    expect(sdk.runNoWait).not.toHaveBeenCalled()
  })

  it('acknowledges an existing idempotent run without scheduling a retry', async () => {
    const sdk = client()
    sdk.runNoWait.mockRejectedValue(new IdempotencyCollisionError('existing-run'))
    await expect(new HatchetOrchestrator(sdk).trigger('render-content', payload)).resolves.toEqual({ runId: 'existing-run' })
  })
})
