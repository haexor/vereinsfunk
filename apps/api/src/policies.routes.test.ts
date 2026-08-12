import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, MEMBERSHIP_ID, ORGANIZATION_ID, TEAM_ID, USER_ID, chain, denyingRoleProvider, emptyPolicyRuleColumns, grantingRoleProvider, membershipRowsStub, organizationManagerRoleProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

describe('policy settings', () => {
  it('resolves inherited effective policy values for a department without its own override', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
            if (table === 'department_memberships') return membershipRowsStub([])
            if (table === 'team_memberships') return membershipRowsStub([])
            if (table === 'departments') return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: DEPARTMENT_ID, name: 'Fussball' }], error: null }) }) }) }
            if (table === 'teams') return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }
            if (table === 'policy_settings') {
              return {
                select: () => ({
                  eq: async () => ({
                    data: [{ scope: 'organization', department_id: null, team_id: null, invite_allowed: false, posts_visible_org_wide: null }],
                    error: null,
                  }),
                }),
              }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      // organizations wird ueber den Service-Client gelesen (Rechte-Review-Fix): eine
      // Organisationsrolle ist fuer diese Route nicht Voraussetzung.
      forService: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/policy-settings`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as {
      scope: string
      inviteAllowed: { effective: boolean; ownValue: boolean | null; lockedByAncestor: boolean }
      postsVisibleOrgWide: { effective: boolean }
    }[]
    const org = body.find((entry) => entry.scope === 'organization')!
    const department = body.find((entry) => entry.scope === 'department')!
    expect(org.inviteAllowed).toMatchObject({ effective: false, ownValue: false, lockedByAncestor: false })
    // The department never set its own row -- it inherits the organization's false, and cannot
    // loosen it back to true itself (lockedByAncestor), while the untouched second flag stays true.
    expect(department.inviteAllowed).toMatchObject({ effective: false, ownValue: null, lockedByAncestor: true })
    expect(department.postsVisibleOrgWide.effective).toBe(true)
  })

  it('rejects setting a department-level policy without department.manage', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organization_id: ORGANIZATION_ID }, error: null }) }) }) }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/policy-settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'department', scopeId: DEPARTMENT_ID, flag: 'invite_allowed', value: false },
    })
    expect(response.statusCode).toBe(403)
  })

  it('resolves the organization name for a department admin without an organization role (Rechte-Review fix)', async () => {
    // organizations_select_member requires an organization-level role -- a department_admin
    // without one would see the user client's `organizations` table as empty/forbidden under
    // real RLS. The route must use the service client for this specific, non-sensitive lookup;
    // this fake makes the user client throw if it is ever queried for organizations, so the test
    // fails loudly if that regresses.
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organizations') throw new Error('organizations must be read via the service client here')
            if (table === 'organization_memberships') return membershipRowsStub([])
            if (table === 'department_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
            if (table === 'team_memberships') return membershipRowsStub([])
            if (table === 'departments') return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }
            if (table === 'teams') return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }
            if (table === 'policy_settings') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/policy-settings`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'organization', name: 'SV Test' })]))
  })

  it('rejects GET policy-settings for a user with no membership in the target organization', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') return membershipRowsStub([])
            if (table === 'department_memberships') return membershipRowsStub([])
            if (table === 'team_memberships') return membershipRowsStub([])
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/policy-settings`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
  })

  it('reports a non-existent organization as not_found instead of throwing', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
            if (table === 'department_memberships') return membershipRowsStub([])
            if (table === 'team_memberships') return membershipRowsStub([])
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/policy-settings`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(404)
  })

  it('applies a policy-setting update and returns the recalculated PolicySetting (PUT success path)', async () => {
    const auditRows: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') {
              return {
                select: () => ({
                  eq: async () => ({
                    data: [{ scope: 'organization', department_id: null, team_id: null, invite_allowed: false, posts_visible_org_wide: null }],
                    error: null,
                  }),
                }),
              }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async (fn: string) => {
            if (fn === 'set_policy_setting') return { data: { id: MEMBERSHIP_ID }, error: null }
            throw new Error(`unexpected rpc in test fake: ${fn}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { auditRows.push(row); return { error: null } } }
            if (table === 'organizations') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }
            throw new Error(`unexpected table in service test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/policy-settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, flag: 'invite_allowed', value: false },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      scope: 'organization',
      name: 'SV Test',
      inviteAllowed: { effective: false, ownValue: false, canEdit: true },
    })
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]).toMatchObject({ action: 'policy_setting.changed', organization_id: ORGANIZATION_ID })
  })
})

describe('Paket 011: Freigaberouten, Vertrauen, Kontingente', () => {
  const STAGE_ID = '10000000-5000-4000-8000-000000000001'
  const OUTER_STAGE_ID = '10000000-5000-4000-8000-000000000009'
  const POST_VERSION_ID = '10000000-3000-4000-8000-000000000099'
  const POST_ID = '10000000-2000-4000-8000-000000000099'
  const APPROVAL_REQUEST_ID = '10000000-4000-4000-8000-000000000099'
  const OTHER_USER_ID = '10000000-0000-4000-8000-000000000002'

  it("rejects submitting a preset outside the department's allowed list with 422", async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') {
              return chain({ data: [{ id: 'p1', scope: 'department', department_id: DEPARTMENT_ID, team_id: null, ...emptyPolicyRuleColumns(), allowed_presets: ['match_result'] }], error: null })
            }
            if (table === 'member_review_trust') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetSlug: 'training_insight', communicationGoal: 'inform',
        requestedFormats: ['feed_image'], sourceMaterial: { facts: {}, observations: ['x'], quotes: [], doNotMention: [] },
      },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'preset_not_allowed' })
  })

  it("rejects submitting when the member's own trust record disallows it with 403", async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') return chain({ data: [], error: null })
            if (table === 'member_review_trust') return chain({ data: [{ scope: 'department', department_id: DEPARTMENT_ID, team_id: null, submit_allowed: false, review_requirement: 'inherit' }], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetSlug: 'training_insight', communicationGoal: 'inform',
        requestedFormats: ['feed_image'], sourceMaterial: { facts: {}, observations: ['x'], quotes: [], doNotMention: [] },
      },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'submit_not_allowed' })
  })

  it('rejects submitting with a teamId when the DEPARTMENT-level trust record disallows it, not just the team-level one', async () => {
    // Regression: fruehere Fassung pruefte bei vorhandener teamId ausschliesslich die
    // Team-Ebene und ignorierte die Abteilungsebene komplett -- eine Abteilungssperre liess sich
    // dadurch einfach durch Mitschicken einer teamId umgehen (beim Rechte-Review gefunden).
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') return chain({ data: [], error: null })
            if (table === 'member_review_trust') return chain({ data: [{ scope: 'department', department_id: DEPARTMENT_ID, team_id: null, submit_allowed: false, review_requirement: 'inherit' }], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, teamId: TEAM_ID, presetSlug: 'training_insight', communicationGoal: 'inform',
        requestedFormats: ['feed_image'], sourceMaterial: { facts: {}, observations: ['x'], quotes: [], doNotMention: [] },
      },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'submit_not_allowed' })
  })

  it('maps insufficient_permission from decide_approval_stage to 403', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'insufficient_permission' } }) }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-stages/${STAGE_ID}/decide`,
      headers: { authorization: `Bearer ${token}` },
      payload: { decision: 'approved' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('opens the next stage when decide_approval_stage reports the current one satisfied', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async () => ({ data: { stageId: STAGE_ID, stageStatus: 'satisfied', postStatus: 'awaiting_approval', nextStageId: '10000000-5000-4000-8000-000000000002' }, error: null }),
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-stages/${STAGE_ID}/decide`,
      headers: { authorization: `Bearer ${token}` },
      payload: { decision: 'approved' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ stageStatus: 'satisfied', nextStageId: '10000000-5000-4000-8000-000000000002' })
  })

  it('maps a channel outside the allowlist to 422 when scheduling a publication', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'channel_not_allowed' } }) }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/post-versions/${POST_VERSION_ID}/schedule`,
      headers: { authorization: `Bearer ${token}` },
      payload: { socialConnectionId: '10000000-8000-4000-8000-000000000001', scheduledFor: null },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'channel_not_allowed' })
  })

  it('hides the reviewer composition of a never-opened stage from the author, even after it was skipped', async () => {
    // Regression: eine abgelehnte innere Stufe setzt alle FOLGENDEN Stufen direkt aus 'pending' auf
    // 'skipped', ohne dass sie je 'open' waren. Eine Sichtbarkeitspruefung auf status === 'pending'
    // haette die Zusammensetzung der aeusseren Stufe dem Autor nach der Ablehnung offengelegt --
    // deshalb prueft die Route opened_at (beim Geheimnisse-Review gefunden).
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'post_versions') return chain({ data: { id: POST_VERSION_ID, created_by_user_id: USER_ID }, error: null })
            if (table === 'approval_requests') return chain({ data: { id: APPROVAL_REQUEST_ID, post_id: POST_ID, post_version_id: POST_VERSION_ID }, error: null })
            if (table === 'approval_stages') {
              return chain({
                data: [
                  {
                    id: STAGE_ID, position: 1, scope: 'department', label: 'Abteilung', mode: 'named', minimum_approvals: 1, is_minor_stage: false,
                    status: 'rejected', reviewer_snapshot: [{ userId: OTHER_USER_ID }], deadline_at: null, opened_at: new Date().toISOString(),
                  },
                  {
                    id: OUTER_STAGE_ID, position: 2, scope: 'organization', label: 'Verein', mode: 'named', minimum_approvals: 1, is_minor_stage: false,
                    status: 'skipped', reviewer_snapshot: [{ userId: OTHER_USER_ID }], deadline_at: null, opened_at: null,
                  },
                ],
                error: null,
              })
            }
            if (table === 'approval_decisions') return chain({ data: [], error: null })
            if (table === 'approval_route_changes') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/post-versions/${POST_VERSION_ID}/approval`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    const stages = response.json().stages as { id: string; reviewerUserIds: string[] | null }[]
    expect(stages.find((stage) => stage.id === STAGE_ID)?.reviewerUserIds).toEqual([OTHER_USER_ID])
    expect(stages.find((stage) => stage.id === OUTER_STAGE_ID)?.reviewerUserIds).toBeNull()
    expect(response.json().routeChanges).toEqual([])
  })

  it('rejects requesting approval with 422 and names the unfulfillable level', async () => {
    // Plan 011, "Verifikation": eine Route mit einer Stufe ohne auflösbaren Prueferkreis wird nicht
    // erzeugt -- sie wuerde den Beitrag lautlos fuer immer liegen lassen.
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'post_versions') return chain({ data: { id: POST_VERSION_ID, post_id: POST_ID, created_by_user_id: USER_ID, safety_flags: [] }, error: null })
            if (table === 'posts') return chain({ data: { id: POST_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, status: 'draft_ready' }, error: null })
            if (table === 'policy_settings') {
              return chain({ data: [{ id: 'p1', scope: 'department', department_id: DEPARTMENT_ID, team_id: null, ...emptyPolicyRuleColumns(), review_required: true }], error: null })
            }
            if (table === 'organization_memberships' || table === 'department_memberships' || table === 'team_memberships') return chain({ data: [], error: null })
            if (table === 'member_review_trust') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async () => { throw new Error('request_approval should not be called for an unfulfillable route') },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/post-versions/${POST_VERSION_ID}/request-approval`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'unfulfillable_stage', blockers: [{ kind: 'empty_reviewer_pool', stageLabel: 'Abteilung' }] })
  })

  it('resolves an organization-level approver into the reviewer snapshot of a DEPARTMENT stage', async () => {
    // Regression: der Prueferkreis einer "any_with_permission"-Stufe wurde nur aus den Rollen DER
    // EIGENEN Ebene gebildet. authz.has_department_permission reicht post.approve aber von der
    // Vereinsebene nach unten durch -- eine Abteilung ohne eigene "approver"-Rolle bekam deshalb
    // einen empty_reviewer_pool-Blocker, obwohl die Vereinsleitung freigeben darf.
    // Paket 024: request_approval() nimmt "stages" nicht mehr vom Aufrufer entgegen -- die
    // TS-seitige Route hier ist nur noch eine VORSCHAU fuer den 422-Blocker-Fall, nicht mehr das,
    // was an die RPC geht (die leitet ihre eigene Route selbst ab, siehe authz.resolve_review_route).
    // Beobachtbar bleibt deshalb nur noch, DASS die Vorschau keinen Blocker meldet -- welche
    // reviewerUserIds sie konkret berechnet, deckt weiterhin resolveReviewRoute()/
    // buildStageDefinitions() in packages/domain bzw. den uebrigen API-Tests dieser Datei ab.
    const rpcCalls: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'post_versions') return chain({ data: { id: POST_VERSION_ID, post_id: POST_ID, created_by_user_id: USER_ID, safety_flags: [] }, error: null })
            if (table === 'posts') return chain({ data: { id: POST_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, status: 'draft_ready' }, error: null })
            if (table === 'policy_settings') {
              return chain({ data: [{ id: 'p1', scope: 'department', department_id: DEPARTMENT_ID, team_id: null, ...emptyPolicyRuleColumns(), review_required: true }], error: null })
            }
            if (table === 'organization_memberships') return chain({ data: [{ user_id: OTHER_USER_ID, role: 'organization_admin' }], error: null })
            if (table === 'department_memberships' || table === 'team_memberships') return chain({ data: [], error: null })
            if (table === 'member_review_trust') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async (fn: string, args: Record<string, unknown>) => {
            rpcCalls.push({ fn, args })
            return { data: { postId: POST_ID, status: 'awaiting_approval', approvalRequestId: APPROVAL_REQUEST_ID }, error: null }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/post-versions/${POST_VERSION_ID}/request-approval`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(202)
    expect(rpcCalls[0]).toMatchObject({ fn: 'request_approval', args: { target_post_version_id: POST_VERSION_ID } })
  })

  it('reresolves an approval route and returns the newly opened stage', async () => {
    const rpcCalls: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async (fn: string, args: Record<string, unknown>) => {
            rpcCalls.push({ fn, args })
            return { data: { postId: POST_ID, approvalRequestId: APPROVAL_REQUEST_ID, status: 'awaiting_approval', firstStageId: STAGE_ID }, error: null }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${APPROVAL_REQUEST_ID}/reresolve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Medienverantwortliche ist ausgetreten, neue Person benannt.' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ approvalRequestId: APPROVAL_REQUEST_ID, status: 'awaiting_approval', firstStageId: STAGE_ID })
    expect(rpcCalls[0]).toMatchObject({
      fn: 'reresolve_approval_route',
      args: { target_approval_request_id: APPROVAL_REQUEST_ID, reason: 'Medienverantwortliche ist ausgetreten, neue Person benannt.' },
    })
  })

  it('rejects a reresolve reason shorter than ten characters with 400, before ever calling the RPC', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => { throw new Error('reresolve_approval_route should not be called for an invalid reason') } }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${APPROVAL_REQUEST_ID}/reresolve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'zu kurz' },
    })
    expect(response.statusCode).toBe(400)
  })

  it.each([
    ['not_found', 404],
    ['insufficient_permission', 403],
    ['author_cannot_reresolve', 403],
    ['invalid_status', 409],
    ['route_has_rejected_stage', 409],
    ['ambiguous_stage_mapping', 409],
    ['reason_required', 400],
    ['empty_reviewer_snapshot', 422],
  ] as const)('maps %s from reresolve_approval_route to %i', async (message, status) => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message } }) }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/approval-requests/${APPROVAL_REQUEST_ID}/reresolve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Eine ausreichend lange Begruendung fuer den Test.' },
    })
    expect(response.statusCode).toBe(status)
  })

  it('lists only stalled approval requests -- overdue or invalidated, not the merely open one', async () => {
    const OVERDUE_REQUEST_ID = '10000000-4000-4000-8000-000000000010'
    const INVALIDATED_REQUEST_ID = '10000000-4000-4000-8000-000000000011'
    const HEALTHY_REQUEST_ID = '10000000-4000-4000-8000-000000000012'
    const OVERDUE_POST_ID = '10000000-2000-4000-8000-000000000010'
    const INVALIDATED_POST_ID = '10000000-2000-4000-8000-000000000011'
    const HEALTHY_POST_ID = '10000000-2000-4000-8000-000000000012'
    const OVERDUE_VERSION_ID = '10000000-3000-4000-8000-000000000010'
    const INVALIDATED_VERSION_ID = '10000000-3000-4000-8000-000000000011'
    const HEALTHY_VERSION_ID = '10000000-3000-4000-8000-000000000012'
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'approval_requests') {
              return chain({
                data: [
                  { id: OVERDUE_REQUEST_ID, post_id: OVERDUE_POST_ID, post_version_id: OVERDUE_VERSION_ID, invalidated_at: null },
                  { id: INVALIDATED_REQUEST_ID, post_id: INVALIDATED_POST_ID, post_version_id: INVALIDATED_VERSION_ID, invalidated_at: new Date().toISOString() },
                  { id: HEALTHY_REQUEST_ID, post_id: HEALTHY_POST_ID, post_version_id: HEALTHY_VERSION_ID, invalidated_at: null },
                ],
                error: null,
              })
            }
            if (table === 'approval_stages') {
              return chain({
                data: [
                  { approval_request_id: OVERDUE_REQUEST_ID, deadline_at: new Date(Date.now() - 60_000).toISOString() },
                  { approval_request_id: INVALIDATED_REQUEST_ID, deadline_at: null },
                  { approval_request_id: HEALTHY_REQUEST_ID, deadline_at: new Date(Date.now() + 60_000).toISOString() },
                ],
                error: null,
              })
            }
            if (table === 'posts') {
              return chain({
                data: [
                  { id: OVERDUE_POST_ID, department_id: DEPARTMENT_ID },
                  { id: INVALIDATED_POST_ID, department_id: DEPARTMENT_ID },
                  { id: HEALTHY_POST_ID, department_id: DEPARTMENT_ID },
                ],
                error: null,
              })
            }
            if (table === 'post_versions') {
              return chain({
                data: [
                  { id: OVERDUE_VERSION_ID, title: 'Überfälliger Beitrag' },
                  { id: INVALIDATED_VERSION_ID, title: 'Invalidierter Beitrag' },
                ],
                error: null,
              })
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/approval-requests/stalled?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { approvalRequestId: string; isOverdue: boolean; invalidated: boolean }[]
    expect(body.map((row) => row.approvalRequestId).sort()).toEqual([INVALIDATED_REQUEST_ID, OVERDUE_REQUEST_ID].sort())
    expect(body.find((row) => row.approvalRequestId === OVERDUE_REQUEST_ID)).toMatchObject({ isOverdue: true, invalidated: false })
    expect(body.find((row) => row.approvalRequestId === INVALIDATED_REQUEST_ID)).toMatchObject({ isOverdue: false, invalidated: true })
  })

  it('rejects reading member review trust of an organization the caller does not belong to with 403', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships' || table === 'department_memberships' || table === 'team_memberships') return membershipRowsStub([])
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/member-review-trust`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
  })

  it('keeps stalled stages in the list waiting for the caller and flags them overdue', async () => {
    // Eine Frist darf weder zustimmen noch blockieren (Plan 011). mark_stalled_approval_stages()
    // setzt eine ueberfaellige Stufe auf 'stalled' -- ein Filter nur auf 'open' haette sie aus genau
    // der Liste entfernt, in der die zustaendige Person sie noch entscheiden soll.
    const statusFilters: unknown[][] = []
    const stageRow = {
      id: STAGE_ID, position: 1, scope: 'department', label: 'Abteilung', mode: 'named', minimum_approvals: 1, is_minor_stage: false,
      status: 'stalled', reviewer_snapshot: [{ userId: USER_ID }], deadline_at: new Date(Date.now() - 3_600_000).toISOString(),
    }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table !== 'approval_stages') throw new Error(`unexpected table in test fake: ${table}`)
            const builder: Record<string, unknown> = {
              select: () => builder,
              eq: () => builder,
              in: (column: string, values: unknown[]) => {
                if (column === 'status') statusFilters.push(values)
                return builder
              },
              order: () => builder,
              range: () => builder,
              then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => resolve({ data: [stageRow], error: null }),
            }
            return builder
          },
        }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/approval-stages/mine?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(statusFilters).toEqual([['open', 'stalled']])
    expect(response.json()).toMatchObject([{ id: STAGE_ID, status: 'stalled', isOverdue: true }])
  })

  it('reports the media gate blockers to a reviewer whose own RLS hides the media tables', async () => {
    // Regression (gefunden im Code-Review zu Paket 002): die Blocker wurden ueber den Nutzer-Client
    // geladen. post_media/media_derivatives/consent_records verlangen per RLS is_organization_member,
    // directory_people zusaetzlich 'directory.read' -- eine reine Abteilungs-'approver'-Rolle erfuellt
    // beides nicht und bekam eine leere Blockerliste, die wie "nichts zu beanstanden" aussieht. Der
    // forUser-Fake unten wirft fuer genau diese Tabellen: die Stufenliste selbst darf er bedienen, die
    // Medienauflösung nicht.
    const STAGE_POST_ID = '11000000-2000-4000-8000-000000000001'
    const STAGE_POST_VERSION_ID = '11000000-3000-4000-8000-000000000001'
    const stageRow = {
      id: STAGE_ID, position: 1, scope: 'department', label: 'Abteilung', mode: 'named', minimum_approvals: 1, is_minor_stage: false,
      status: 'open', reviewer_snapshot: [{ userId: USER_ID }], deadline_at: null, approval_request_id: '11000000-4000-4000-8000-000000000001',
    }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'approval_stages') return chain({ data: [stageRow], error: null })
            if (table === 'approval_requests') return chain({ data: [{ id: '11000000-4000-4000-8000-000000000001', post_id: STAGE_POST_ID, post_version_id: STAGE_POST_VERSION_ID }], error: null })
            if (table === 'posts') return chain({ data: [{ id: STAGE_POST_ID, department_id: DEPARTMENT_ID }], error: null })
            if (table === 'policy_settings') return chain({ data: [], error: null })
            throw new Error(`the media gate must not read ${table} through the user client`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table === 'post_versions') return chain({ data: { title: '', caption: 'Hallo Welt' }, error: null })
            if (table === 'post_media') return chain({ data: [{ media_derivative_id: '11000000-6000-4000-8000-000000000001' }], error: null })
            if (table === 'media_derivatives') return chain({ data: [{ id: '11000000-6000-4000-8000-000000000001', media_asset_id: '11000000-6100-4000-8000-000000000001', status: 'ready' }], error: null })
            if (table === 'media_assets') return chain({ data: [{ id: '11000000-6100-4000-8000-000000000001', mime_type: 'image/png', scan_status: 'pending' }], error: null })
            if (table === 'face_regions') return chain({ data: [], error: null })
            throw new Error(`unexpected table in service fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/approval-stages/mine?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject([{ id: STAGE_ID, mediaGateBlockers: ['scan_pending'] }])
  })

  it('requires an organizationId when listing the stages waiting for the caller', async () => {
    // Ohne Organisationsbezug saehe eine Person mit Pruefrollen in mehreren Vereinen die Freigaben
    // aller ihrer Vereine in der Liste eines einzelnen.
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: () => { throw new Error('the query must be rejected before any table access') } }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/approval-stages/mine', headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('maps an exceeded quota to 409 naming the blocking limit when scheduling a publication', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'quota_exceeded: organization/day' } }) }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/post-versions/${POST_VERSION_ID}/schedule`,
      headers: { authorization: `Bearer ${token}` },
      payload: { socialConnectionId: '10000000-8000-4000-8000-000000000001', scheduledFor: null },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'quota_exceeded', detail: 'quota_exceeded: organization/day' })
  })

  it('maps a blocked media gate to 409 naming the blockers when scheduling a publication', async () => {
    // Paket 002: ohne eigene Zuordnung faellt genau der neue Gate-Fehler in throw rpc.error, und
    // eine fachlich korrekte Absage kaeme als 500 ohne Angabe des blockierenden Mediums beim
    // Aufrufer an (gefunden im Code-Review).
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'media_gate_blocked: scan_pending,consent_invalid' } }) }) as unknown as SupabaseClient,
      forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/post-versions/${POST_VERSION_ID}/schedule`,
      headers: { authorization: `Bearer ${token}` },
      payload: { socialConnectionId: '10000000-8000-4000-8000-000000000001', scheduledFor: null },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'media_gate_blocked', blockers: ['scan_pending', 'consent_invalid'] })
  })
})

