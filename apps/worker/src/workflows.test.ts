import { describe, expect, it, vi } from 'vitest'
import { fairnessKey, processSubmission } from './workflows.js'

const payload = {
  submissionId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  departmentId: '33333333-3333-4333-8333-333333333333',
  correlationId: '44444444-4444-4444-8444-444444444444',
  sourceRevision: 1,
  entityId: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: 'submission:11111111-1111-4111-8111-111111111111:1',
}

describe('process submission workflow', () => {
  it('passes only IDs and technical metadata to the next task', async () => {
    const enqueueDraft = vi.fn()
    await processSubmission(payload, {
      loadSubmission: vi.fn().mockResolvedValue({ status: 'queued' }),
      updateSubmission: vi.fn(),
      enqueueDraft,
    })
    expect(enqueueDraft).toHaveBeenCalledWith({
      ...payload,
      idempotencyKey: `draft:${payload.submissionId}:1`,
    })
  })

  it('creates a tenant-aware fairness key', () => {
    expect(fairnessKey(payload)).toBe(`${payload.organizationId}:${payload.departmentId}`)
  })
})
