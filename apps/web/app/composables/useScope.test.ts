import { describe, expect, it } from 'vitest'
import { defaultScope, findValidScope } from './useScope'

const SCOPES = [
  { organizationId: 'verein-1', departments: [{ id: 'fussball' }] },
]

describe('useScope', () => {
  it('starts at the organization, not implicitly at its first department', () => {
    expect(defaultScope(SCOPES)).toEqual({ organizationId: 'verein-1', departmentId: null })
  })

  it('keeps both the organization context and an accessible department context valid', () => {
    expect(findValidScope(SCOPES, { organizationId: 'verein-1', departmentId: null })).toEqual({ organizationId: 'verein-1', departmentId: null })
    expect(findValidScope(SCOPES, { organizationId: 'verein-1', departmentId: 'fussball' })).toEqual({ organizationId: 'verein-1', departmentId: 'fussball' })
  })
})
