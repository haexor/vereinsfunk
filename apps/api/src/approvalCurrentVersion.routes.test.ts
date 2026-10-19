import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, ORGANIZATION_ID, USER_ID, chain, emptyPolicyRuleColumns, grantingRoleProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

// Migration 2026101910: request_approval und schedule_publication akzeptieren nur die aktuelle
// Version, schedule_publication ausserdem keine invalidierte Freigabe. Beide Absagen sind fachlich
// (409), kein interner Fehler.
const POST_VERSION_ID = 'a1000000-3000-4000-8000-000000000001'
const POST_ID = 'a1000000-2000-4000-8000-000000000001'
const SOCIAL_CONNECTION_ID = 'a1000000-8000-4000-8000-000000000001'

function rpcFailingClients(message: string): SupabaseClientFactory {
  return {
    forUser: () => ({ rpc: async () => ({ data: null, error: { message } }) }) as unknown as SupabaseClient,
    forService: () => { throw new Error('forService should not be reached') },
  }
}

describe('POST /v1/post-versions/:id/schedule -- version checks', () => {
  for (const error of ['version_not_current', 'approval_invalidated']) {
    it(`maps ${error} to 409`, async () => {
      const app = await startApp({ supabaseClients: rpcFailingClients(error) })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: `/v1/post-versions/${POST_VERSION_ID}/schedule`, headers: { authorization: `Bearer ${token}` },
        payload: { socialConnectionId: SOCIAL_CONNECTION_ID, scheduledFor: null },
      })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error })
    })
  }
})

describe('POST /v1/post-versions/:id/request-approval -- version check', () => {
  it('maps version_not_current to 409', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'post_versions') return chain({ data: { id: POST_VERSION_ID, post_id: POST_ID, created_by_user_id: USER_ID, safety_flags: [] }, error: null })
            if (table === 'posts') return chain({ data: { id: POST_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, status: 'draft_ready' }, error: null })
            if (table === 'policy_settings') return chain({ data: [{ id: 'p1', scope: 'organization', department_id: null, team_id: null, ...emptyPolicyRuleColumns(), review_required: false }], error: null })
            if (table === 'organization_memberships' || table === 'department_memberships' || table === 'team_memberships' || table === 'member_review_trust') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async () => ({ data: null, error: { message: 'version_not_current' } }),
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'directory_people') return chain({ data: [], error: null })
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'POST', url: `/v1/post-versions/${POST_VERSION_ID}/request-approval`, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'version_not_current' })
  })
})
