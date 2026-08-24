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
          if (table === 'posts' || table === 'club_events' || table === 'approval_stages') return chain({ data: [], error: null })
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
    expect(response.json()).toMatchObject({ organizationId: ORGANIZATION_ID, readyTextCandidates: [] })
  })
})
