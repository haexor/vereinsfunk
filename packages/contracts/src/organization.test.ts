import { describe, expect, it } from 'vitest'
import { OrganizationProfileUpdateSchema } from './index.js'

describe('organization profile contracts', () => {
  it('rejects an empty profile update payload', () => {
    expect(OrganizationProfileUpdateSchema.safeParse({}).success).toBe(false)
  })

  it('accepts a profile update with at least one field', () => {
    expect(OrganizationProfileUpdateSchema.safeParse({ legalName: 'Verein e.V.' }).success).toBe(true)
  })
})

