import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentResponder } from './agent.js'
import type { SupabaseClientFactory } from './app.js'
import { MEMBERSHIP_ID, ORGANIZATION_ID, USER_ID, chain, membershipRowsStub, signAccessToken, startApp } from './testSupport.js'

const CONVERSATION_ID = '10000000-4000-4000-8000-000000000001'
const WORKSPACE_TABLES = ['posts', 'club_events', 'approval_stages', 'composition_sessions', 'publications']

function conversationRow(departmentId: string | null = null): Record<string, unknown> {
  return {
    id: CONVERSATION_ID, organization_id: ORGANIZATION_ID, department_id: departmentId, team_id: null, created_by: USER_ID, title: null,
    last_activity_at: '2026-08-24T10:00:00+00:00', archived_at: null, retention_expires_at: '2027-08-24T10:00:00+00:00',
    created_at: '2026-08-24T10:00:00+00:00', updated_at: '2026-08-24T10:00:00+00:00',
  }
}

function messageRow(index: number, role: 'user' | 'assistant', content: string): Record<string, unknown> {
  return {
    id: `10000000-6000-4000-8000-${String(index).padStart(12, '0')}`, organization_id: ORGANIZATION_ID, conversation_id: CONVERSATION_ID,
    role, content, created_at: new Date(Date.UTC(2026, 7, 24, 10, 0, 0, index)).toISOString(),
  }
}

// append_agent_conversation_messages() gibt genau die uebergebenen Inhalte zurueck; der Responder
// des Tests entscheidet die Antwort.
function messagesServiceClient(captured: { proposals: unknown[] } = { proposals: [] }): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'audit_events') return { insert: async () => ({ error: null }) }
      if (table === 'agent_action_proposals') return { insert: (row: unknown) => { captured.proposals.push(row); throw new Error('proposal must not be created') } }
      throw new Error(`unexpected table in agent messages service fake: ${table}`)
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'append_agent_conversation_messages') throw new Error(`unexpected rpc in agent messages test: ${name}`)
      return {
        data: [{
          user_message: messageRow(1_000, 'user', String(args.user_message_content)),
          assistant_message: messageRow(1_001, 'assistant', String(args.assistant_message_content)),
          last_activity_at: '2026-08-24T11:00:00+00:00',
        }],
        error: null,
      }
    },
  } as unknown as SupabaseClient
}

async function postMessage(options: Parameters<typeof startApp>[0], content = 'Wie geht es weiter?') {
  const app = await startApp(options)
  return app.inject({
    method: 'POST',
    url: `/v1/agent/conversations/${CONVERSATION_ID}/messages`,
    headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    payload: { content },
  })
}

describe('agent routes', () => {
  it('requires an authenticated session before exposing a workspace or conversation', async () => {
    const app = await startApp()
    const [workspace, conversation] = await Promise.all([
      app.inject({ method: 'GET', url: '/v1/agent/workspace?organizationId=10000000-1000-4000-8000-000000000001' }),
      app.inject({ method: 'POST', url: '/v1/agent/conversations', payload: { organizationId: '10000000-1000-4000-8000-000000000001' } }),
    ])
    expect(workspace.statusCode).toBe(401)
    expect(conversation.statusCode).toBe(401)
  })

  it('keeps the workspace available when the optional text-candidate query fails', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
          if (table === 'department_memberships' || table === 'team_memberships') return membershipRowsStub([])
          if (table === 'posts' || table === 'club_events' || table === 'approval_stages' || table === 'publications') return chain({ data: [], error: null })
          if (table === 'composition_sessions') return chain({ data: null, error: { message: 'relation is temporarily unavailable' } })
          throw new Error(`unexpected table in agent workspace test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => ({}) as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/agent/workspace?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ organizationId: ORGANIZATION_ID, readyTextCandidates: [], duePublications: [], publicationActivities: [] })
  })

  it('lists the organization-scope conversation history without a department set', async () => {
    // Regression fuer einen frueheren Bug: department_id/team_id wurden mit .eq(col, null) statt
    // .is(col, null) gefiltert -- PostgREST versucht dann, den literalen String "null" in den
    // uuid-Spaltentyp zu casten und liefert einen Fehler, statt IS NULL zu pruefen. Der
    // Organisations-Scope (kein departmentId, kein teamId -- der Standardfall aus toAgentScopeRequest
    // im Frontend) traf das auf jedem Aufruf.
    const conversationRow = {
      id: '10000000-4000-4000-8000-000000000001',
      organization_id: ORGANIZATION_ID,
      department_id: null,
      team_id: null,
      created_by: USER_ID,
      title: null,
      last_activity_at: new Date().toISOString(),
      archived_at: null,
      retention_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
          if (table === 'department_memberships' || table === 'team_memberships') return membershipRowsStub([])
          if (table === 'agent_conversations') return chain({ data: [conversationRow], error: null })
          throw new Error(`unexpected table in agent conversations test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => ({}) as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/agent/conversations?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject([{ id: conversationRow.id, organizationId: ORGANIZATION_ID, departmentId: null, teamId: null }])
  })

  it('keeps the chat available with an empty workspace when a core summary query fails', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
          if (table === 'department_memberships' || table === 'team_memberships') return membershipRowsStub([])
          if (table === 'posts') return chain({ data: null, error: { message: 'relation is temporarily unavailable' } })
          if (table === 'club_events' || table === 'approval_stages' || table === 'composition_sessions' || table === 'publications') return chain({ data: [], error: null })
          throw new Error(`unexpected table in agent workspace test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => ({}) as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/agent/workspace?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      organizationId: ORGANIZATION_ID,
      posts: [], events: [], pendingApprovals: [], readyTextCandidates: [], duePublications: [], publicationActivities: [],
    })
  })

  it('answers with the newest message window once a conversation outgrows it', async () => {
    // 100 gespeicherte Nachrichten plus das neue Paar: frueher lud die Route die 100 aeltesten
    // (Modell sah nie den aktuellen Stand) und die Antwort mit 102 Nachrichten scheiterte am Schema.
    const history = Array.from({ length: 100 }, (_, index) => messageRow(index, index % 2 === 0 ? 'user' : 'assistant', `Nachricht ${index}`))
    const orderCalls: unknown[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table === 'agent_conversations') return chain({ data: conversationRow(), error: null })
          if (table === 'agent_messages') {
            const builder = chain({ data: [...history].reverse(), error: null })
            builder.order = (...args: unknown[]) => { orderCalls.push(args); return builder }
            return builder
          }
          if (table === 'agent_message_media_references') return chain({ data: [], error: null })
          if (WORKSPACE_TABLES.includes(table)) return chain({ data: [], error: null })
          throw new Error(`unexpected table in agent messages test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => messagesServiceClient(),
    }
    const seen: string[][] = []
    const agentResponder: AgentResponder = {
      async respond(input) {
        seen.push(input.messages.map((message) => message.content))
        return { content: 'Antwort', providerConfigured: false }
      },
    }
    const response = await postMessage({ supabaseClients: clients, agentResponder }, 'Neue Frage')
    expect(response.statusCode).toBe(201)
    expect(orderCalls).toEqual([['created_at', { ascending: false }]])
    const messages = response.json().messages as { content: string }[]
    expect(messages).toHaveLength(100)
    expect(messages[0]!.content).toBe('Nachricht 2')
    expect(messages.slice(-3).map((message) => message.content)).toEqual(['Nachricht 99', 'Neue Frage', 'Antwort'])
    expect(seen[0]!.slice(-2)).toEqual(['Nachricht 99', 'Neue Frage'])
  })
})
