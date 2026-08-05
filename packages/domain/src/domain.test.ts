import { describe, expect, it } from 'vitest'
import {
  canTransition,
  createIdempotencyKey,
  curatedFontPairings,
  mergeEffectiveConfig,
  selectProviderConfiguration,
  type LlmProviderConfiguration,
} from './index.js'

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

describe('curated font pairings', () => {
  it('matches the organization_brand_profiles column defaults', () => {
    expect(curatedFontPairings.length).toBeGreaterThan(0)
    expect(curatedFontPairings[0]).toMatchObject({ displayFontKey: 'manrope', bodyFontKey: 'dm_sans' })
  })
})

describe('selectProviderConfiguration', () => {
  const config = (overrides: Partial<LlmProviderConfiguration>): LlmProviderConfiguration => ({
    id: 'id',
    protocol: 'anthropic',
    purpose: 'default',
    priority: 100,
    isActive: true,
    ...overrides,
  })

  it('prefers an exact purpose match over the default purpose', () => {
    const configs = [config({ id: 'default', purpose: 'default', priority: 1 }), config({ id: 'caption', purpose: 'caption', priority: 50 })]
    expect(selectProviderConfiguration('caption', configs)?.id).toBe('caption')
  })

  it('falls back to the default purpose when no exact match is active', () => {
    const configs = [config({ id: 'default', purpose: 'default' })]
    expect(selectProviderConfiguration('caption', configs)?.id).toBe('default')
  })

  it('orders same-purpose candidates by priority ascending', () => {
    const configs = [config({ id: 'low-priority', priority: 200 }), config({ id: 'high-priority', priority: 10 })]
    expect(selectProviderConfiguration('default', configs)?.id).toBe('high-priority')
  })

  it('ignores inactive configurations', () => {
    const configs = [config({ id: 'inactive', isActive: false, priority: 1 }), config({ id: 'active', priority: 50 })]
    expect(selectProviderConfiguration('default', configs)?.id).toBe('active')
  })

  it('returns null when nothing matches', () => {
    expect(selectProviderConfiguration('caption', [])).toBeNull()
  })
})
