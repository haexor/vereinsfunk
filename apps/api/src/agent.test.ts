import { describe, expect, it, vi } from 'vitest'
import { LocalAgentResponder, OpenAiResponsesAgentResponder } from './agent.js'

const workspace = {
  organizationId: '10000000-1000-4000-8000-000000000001',
  departmentId: null,
  teamId: null,
  posts: [],
  events: [],
  pendingApprovals: [],
}

describe('agent responders', () => {
  it('never describes a local fallback response as an executed action', async () => {
    const responder = new LocalAgentResponder()
    const answer = await responder.respond({
      messages: [{ role: 'user', content: 'Veröffentliche den Beitrag sofort.' }],
      workspace,
      userId: 'hashed-user',
    })
    expect(answer.content).not.toContain('veröffentlicht')
  })

  it('uses the stateless Responses API and passes a hashed safety identifier only', async () => {
    let capturedInit: RequestInit | undefined
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({
        output: [{ content: [{ type: 'output_text', text: 'Zwei Freigaben warten auf dich.' }] }],
      }), { status: 200 })
    })
    const responder = new OpenAiResponsesAgentResponder({ apiKey: 'secret', model: 'gpt-test', fetcher })
    await expect(responder.respond({
      messages: [{ role: 'user', content: 'Was ist offen?' }],
      workspace,
      userId: 'a'.repeat(64),
    })).resolves.toEqual({ content: 'Zwei Freigaben warten auf dich.' })
    expect(capturedInit).toBeDefined()
    const body = JSON.parse(String(capturedInit!.body)) as { store: boolean; safety_identifier: string; input: unknown[] }
    expect(body.store).toBe(false)
    expect(body.safety_identifier).toBe('a'.repeat(64))
    expect(JSON.stringify(body.input)).not.toContain('secret')
  })

  it('surfaces provider status failures for the route fallback', async () => {
    const responder = new OpenAiResponsesAgentResponder({
      apiKey: 'secret', model: 'gpt-test', fetcher: async () => new Response('', { status: 429 }),
    })
    await expect(responder.respond({ messages: [], workspace, userId: 'a'.repeat(64) }))
      .rejects.toThrow('agent_provider_429')
  })

  it('rejects successful but malformed provider responses for the route fallback', async () => {
    const responder = new OpenAiResponsesAgentResponder({
      apiKey: 'secret', model: 'gpt-test', fetcher: async () => new Response(JSON.stringify({ output: [] }), { status: 200 }),
    })
    await expect(responder.respond({ messages: [], workspace, userId: 'a'.repeat(64) }))
      .rejects.toThrow('agent_provider_invalid_response')
  })

  it('accepts only a validated, single function call as an action proposal', async () => {
    const responder = new OpenAiResponsesAgentResponder({
      apiKey: 'secret', model: 'gpt-test', fetcher: async () => new Response(JSON.stringify({
        output: [{ type: 'function_call', name: 'create_invitation', arguments: JSON.stringify({ email: 'neues.mitglied@example.org', role: 'viewer' }) }],
      }), { status: 200 }),
    })
    await expect(responder.respond({ messages: [], workspace, userId: 'a'.repeat(64) })).resolves.toEqual({
      content: 'Ich habe eine Aktion zur Bestätigung vorbereitet.',
      proposal: { toolName: 'create_invitation', input: { email: 'neues.mitglied@example.org', role: 'viewer' } },
    })
  })
})
