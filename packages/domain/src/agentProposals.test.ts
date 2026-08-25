import { describe, expect, it } from 'vitest'
import { hashAgentProposalInput } from './agentProposals.js'

describe('hashAgentProposalInput', () => {
  it('binds object payloads independent of their key order', async () => {
    expect(await hashAgentProposalInput({ title: 'Sommerfest', startsAt: '2026-08-30T14:00:00+02:00' }))
      .toBe(await hashAgentProposalInput({ startsAt: '2026-08-30T14:00:00+02:00', title: 'Sommerfest' }))
  })
})
