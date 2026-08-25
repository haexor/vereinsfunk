import { describe, expect, it } from 'vitest'
import { toAgentScopeRequest } from './agentScope'

describe('toAgentScopeRequest', () => {
  it('omits departmentId for an organization-wide agent request', () => {
    expect(toAgentScopeRequest({ organizationId: 'organization-1', departmentId: null })).toEqual({
      organizationId: 'organization-1',
    })
  })

  it('keeps departmentId for a department-scoped agent request', () => {
    expect(toAgentScopeRequest({ organizationId: 'organization-1', departmentId: 'department-1' })).toEqual({
      organizationId: 'organization-1',
      departmentId: 'department-1',
    })
  })
})
