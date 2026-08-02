import { describe, expect, it } from 'vitest'
import { hasPermission } from './index.js'

describe('authorization', () => {
  it('lets editors edit but not approve', () => {
    expect(hasPermission(['editor'], 'post.edit')).toBe(true)
    expect(hasPermission(['editor'], 'post.approve')).toBe(false)
  })

  it('combines permissions from scoped roles', () => {
    expect(hasPermission(['billing_admin', 'approver'], 'post.approve')).toBe(true)
    expect(hasPermission(['billing_admin', 'approver'], 'billing.manage')).toBe(true)
  })
})
