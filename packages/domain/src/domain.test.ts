import { describe, expect, it } from 'vitest'
import { canTransition, createIdempotencyKey, mergeEffectiveConfig } from './index.js'

describe('post state machine', () => {
  it('allows the approval happy path', () => {
    expect(canTransition('awaiting_approval', 'approved')).toBe(true)
  })

  it('prevents publishing an unapproved draft', () => {
    expect(canTransition('draft_ready', 'publishing')).toBe(false)
  })
})

describe('effective config', () => {
  it('allows policies to become stricter but not weaker', () => {
    const base = {
      tone: 'nahbar',
      policies: {
        approvalRequired: true,
        minorApprovalRequired: true,
        minimumApprovals: 1,
        forbiddenTopics: ['Politik'],
      },
    }
    const result = mergeEffectiveConfig(base, {
      tone: 'dynamisch',
      policies: {
        approvalRequired: false,
        minorApprovalRequired: false,
        minimumApprovals: 2,
        forbiddenTopics: ['Alkohol'],
      },
    })
    expect(result.tone).toBe('dynamisch')
    expect(result.policies.approvalRequired).toBe(true)
    expect(result.policies.minimumApprovals).toBe(2)
    expect(result.policies.forbiddenTopics).toEqual(['Politik', 'Alkohol'])
  })
})

describe('idempotency keys', () => {
  it('creates deterministic scoped keys', () => {
    expect(createIdempotencyKey('submission', 'abc', 2)).toBe('submission:abc:2')
  })
})
