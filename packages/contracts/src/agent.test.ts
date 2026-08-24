import { describe, expect, it } from 'vitest'
import { AgentActionProposalSchema, AgentScopeSchema, CreateAgentMessageSchema } from './agent.js'

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
    expect(CreateAgentMessageSchema.safeParse({ content: 'x'.repeat(4_000) }).success).toBe(true)
    expect(CreateAgentMessageSchema.safeParse({ content: 'x'.repeat(4_001) }).success).toBe(false)
  })

  it('accepts only the payload that matches the proposed tool', () => {
    const base = {
      id: '10000000-2000-4000-8000-000000000001', conversationId: '10000000-3000-4000-8000-000000000001', createdBy: '10000000-4000-4000-8000-000000000001',
      organizationId, inputHash: 'a'.repeat(64), status: 'pending', expiresAt: '2026-08-24T18:00:00.000Z', confirmedAt: null, createdAt: '2026-08-24T17:00:00.000Z', updatedAt: '2026-08-24T17:00:00.000Z',
    }
    expect(AgentActionProposalSchema.safeParse({ ...base, toolName: 'create_invitation', input: { email: 'mitglied@example.org', role: 'organization_viewer' } }).success).toBe(true)
    expect(AgentActionProposalSchema.safeParse({ ...base, toolName: 'request_approval', input: { postVersionId: '10000000-5000-4000-8000-000000000001' } }).success).toBe(true)
    expect(AgentActionProposalSchema.safeParse({ ...base, toolName: 'save_content_brief', input: { communicationGoal: 'inform', sourceMaterial: { facts: { Termin: 'Samstag' }, observations: [], quotes: [], doNotMention: [] }, systemStyleProfileSlug: 'klar_erklaerend', targetPlatforms: ['instagram'] } }).success).toBe(true)
    expect(AgentActionProposalSchema.safeParse({ ...base, toolName: 'create_event', input: { email: 'mitglied@example.org', role: 'organization_viewer' } }).success).toBe(false)
    expect(AgentActionProposalSchema.safeParse({ ...base, toolName: 'create_invitation', input: { email: 'mitglied@example.org', role: 'organization_viewer', organizationId: '10000000-9000-4000-8000-000000000001' } }).success).toBe(false)
  })
})
