import { describe, expect, it } from 'vitest'
import { selectProviderConfiguration, type LlmProviderConfiguration } from './index.js'

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
    const configs = [
      config({ id: 'inactive-caption', purpose: 'caption', isActive: false }),
      config({ id: 'default', purpose: 'default' }),
    ]
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

