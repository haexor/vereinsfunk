import { describe, expect, it } from 'vitest'
import { hashAgentProposalInput } from './agentProposals.js'

describe('hashAgentProposalInput', () => {
  it('binds object payloads independent of their key order', () => {
    expect(hashAgentProposalInput({ title: 'Sommerfest', startsAt: '2026-08-30T14:00:00+02:00' }))
      .toBe(hashAgentProposalInput({ startsAt: '2026-08-30T14:00:00+02:00', title: 'Sommerfest' }))
  })
})
