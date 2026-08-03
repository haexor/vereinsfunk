import { describe, expect, it } from 'vitest'
import { FakeOrchestrator } from './index.js'
const payload = { entityId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', departmentId: '33333333-3333-4333-8333-333333333333', correlationId: '44444444-4444-4444-8444-444444444444', sourceRevision: 1, idempotencyKey: 'render:x:1' }
describe('orchestration boundary', () => it('is idempotent and accepts IDs only', async () => { const client = new FakeOrchestrator(); expect(await client.trigger('render-content', payload)).toEqual(await client.trigger('render-content', payload)) }))
