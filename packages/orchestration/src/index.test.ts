import { describe, expect, it } from 'vitest'
import { FakeOrchestrator, WorkflowOutboxDispatcher, type WorkflowOutboxRepository } from './index.js'
const payload = { entityId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', departmentId: '33333333-3333-4333-8333-333333333333', departmentConcurrencyKey: '33333333-3333-4333-8333-333333333333', correlationId: '44444444-4444-4444-8444-444444444444', sourceRevision: 1, purpose: 'test', idempotencyKey: 'render:x:1' }
describe('orchestration boundary', () => it('is idempotent and accepts IDs only', async () => { const client = new FakeOrchestrator(); expect(await client.trigger('render-content', payload)).toEqual(await client.trigger('render-content', payload)) }))

describe('workflow outbox dispatcher', () => {
  it('marks an atomically claimed entry only after Hatchet accepts it', async () => {
    const dispatched: string[] = []
    const outbox: WorkflowOutboxRepository = {
      claimPending: async () => [{ id: 'outbox-1', claimToken: 'claim-1', workflow: 'render-content', payload, priority: 2 }],
      markDispatched: async (_id, claimToken, runId) => { expect(claimToken).toBe('claim-1'); dispatched.push(runId) },
      markRetryableFailure: async () => { throw new Error('must not fail') },
    }
    const count = await new WorkflowOutboxDispatcher(outbox, new FakeOrchestrator()).dispatchPending()
    expect(count).toBe(1)
    expect(dispatched).toEqual(['fake-run-1'])
  })

  it('keeps dispatching the rest of the batch when releasing one entry fails, then reports it', async () => {
    const dispatched: string[] = []
    const failing = { trigger: async (workflow: 'render-content', raw: typeof payload) => { if (raw.idempotencyKey === 'render:x:1') throw new Error('hatchet down'); return new FakeOrchestrator().trigger(workflow, raw) } }
    const outbox: WorkflowOutboxRepository = {
      claimPending: async () => [
        { id: 'outbox-1', claimToken: 'claim-1', workflow: 'render-content', payload, priority: 2 },
        { id: 'outbox-2', claimToken: 'claim-2', workflow: 'render-content', payload: { ...payload, idempotencyKey: 'render:x:2' }, priority: 2 },
      ],
      markDispatched: async (id) => { dispatched.push(id) },
      markRetryableFailure: async () => { throw new Error('outbox release lost') },
    }
    await expect(new WorkflowOutboxDispatcher(outbox, failing as never).dispatchPending()).rejects.toThrow('outbox release lost')
    expect(dispatched).toEqual(['outbox-2'])
  })
})
