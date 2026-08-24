import { describe, expect, it } from 'vitest'
import { AgentScopeSchema, CreateAgentMessageSchema } from './agent.js'

const organizationId = '10000000-1000-4000-8000-000000000001'
const departmentId = '10000000-1100-4000-8000-000000000001'
const teamId = '10000000-1200-4000-8000-000000000001'

describe('agent contracts', () => {
  it('requires a department whenever the workspace is narrowed to a team', () => {
    expect(AgentScopeSchema.safeParse({ organizationId, teamId }).success).toBe(false)
    expect(AgentScopeSchema.safeParse({ organizationId, departmentId, teamId }).success).toBe(true)
  })

  it('keeps user input bounded before it reaches conversation storage or a provider', () => {
    expect(CreateAgentMessageSchema.safeParse({ content: 'Welche Freigaben sind offen?' }).success).toBe(true)
    expect(CreateAgentMessageSchema.safeParse({ content: 'x'.repeat(4_001) }).success).toBe(false)
  })
})
