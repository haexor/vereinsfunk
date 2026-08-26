import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'
import { MEMBERSHIP_ID, ORGANIZATION_ID, USER_ID, chain, membershipRowsStub, signAccessToken, startApp } from './testSupport.js'

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
})
