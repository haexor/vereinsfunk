import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, INVITATION_ID, MEMBERSHIP_ID, ORGANIZATION_ID, TEAM_ID, USER_ID, denyingRoleProvider, organizationManagerRoleProvider, serviceClientCapturingAudit, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'
import type { RoleProvider } from './auth.js'

describe('structure, memberships and invitations', () => {
  it('rejects creating a department without organization.manage', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/departments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Handball' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })

  it('rejects a department_admin from creating a department', async () => {
    const departmentAdminRoleProvider: RoleProvider = {
      async rolesForScope() {
        return ['department_admin']
      },
    }
    const app = await startApp({ roleProvider: departmentAdminRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/departments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Handball' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })

  it('creates a department via the create_department RPC', async () => {
    const departmentRow = {
      id: '10000000-1100-4000-8000-000000000099',
      organization_id: ORGANIZATION_ID,
      name: 'Handball',
      slug: 'handball',
      archived_at: null,
      created_at: '2026-08-06T10:00:00+00:00',
    }
    const auditRows: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async () => ({ data: departmentRow.id, error: null }),
          from: (table: string) => {
            if (table === 'departments') return { select: () => ({ eq: () => ({ single: async () => ({ data: departmentRow, error: null }) }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit(auditRows),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ORGANIZATION_ID}/departments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Handball' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ id: departmentRow.id, name: 'Handball', slug: 'handball' })
    // Regression: der Audit-Trail lief ueber den Nutzer-Client und scheiterte an jeder Schreibung
    // still an "permission denied for table audit_events" (im Nachfolge-Review dieses PRs
    // gefunden) -- hier wird belegt, dass wirklich ein Eintrag entsteht.
    expect(auditRows[0]).toMatchObject({ action: 'department.created', entity_type: 'departments', actor_user_id: USER_ID })
  })

  it('rejects an invitation payload whose role does not match its scope, before any DB call', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, email: 'person@example.com', role: 'department_admin' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('rejects an organization-level role for a department-scoped membership, before any DB call', async () => {
    // CreateMembershipRequestSchema validates role against scope itself (superRefine) -- an
    // organization-level role is never valid for a department-scoped membership, regardless of
    // the actor's rank. See packages/authorization's canAssignRole tests for the rank check
    // itself; every role that holds member.invite at a given level is already that level's
    // highest-ranked role, so a scope-valid rank violation cannot occur independently of an
    // invalid scope/role combination in this role model.
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memberships',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'department', scopeId: DEPARTMENT_ID, userId: '10000000-0000-4000-8000-000000000099', role: 'organization_admin' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('rejects organization_owner as a role for POST /v1/memberships, before any DB call', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memberships',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, userId: '10000000-0000-4000-8000-000000000099', role: 'organization_owner' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('maps the platform-admin separation trigger on a direct membership insert to 409', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: 'P0001', message: 'platform_admin_cannot_hold_membership' } }) }) }),
          }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memberships',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, userId: '10000000-0000-4000-8000-000000000099', role: 'organization_viewer' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'platform_admin_cannot_hold_membership' })
  })

  it('rejects an invitation for an address that is already a member', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: true, error: null }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, email: 'already-member@example.com', role: 'organization_viewer' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'already_a_member' })
  })

  it('never returns the raw invitation token in the create response', async () => {
    const invitationRow = {
      id: '30000000-0000-4000-8000-000000000001',
      organization_id: ORGANIZATION_ID,
      department_id: null,
      team_id: null,
      email: 'invitee@example.com',
      role: 'organization_viewer',
      invited_by: USER_ID,
      expires_at: '2026-08-20T00:00:00+00:00',
      accepted_at: null,
      revoked_at: null,
      last_sent_at: '2026-08-06T00:00:00+00:00',
      send_count: 1,
      created_at: '2026-08-06T00:00:00+00:00',
    }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          // email_has_membership() checks whether the invitee is already a member (false here);
          // create_invitation() is the atomic RPC that replaces the former direct insert (see
          // apps/api/src/app.ts).
          rpc: async (fn: string) => (fn === 'email_has_membership' ? { data: false, error: null } : { data: invitationRow, error: null }),
          from: (table: string) => {
            if (table === 'organizations') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit([]),
    }
    const authRedirects: string[] = []
    const auditService = serviceClientCapturingAudit([])
    clients.forService = () => ({
      auth: {
        admin: {
          inviteUserByEmail: async (email: string, options?: { redirectTo?: string }) => {
            expect(email).toBe('invitee@example.com')
            authRedirects.push(options?.redirectTo ?? '')
            return { data: { user: {} }, error: null }
          },
        },
      },
      from: auditService.from,
    }) as unknown as SupabaseClient
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, email: 'invitee@example.com', role: 'organization_viewer' },
    })
    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(Object.keys(body)).not.toContain('rawToken')
    expect(Object.keys(body)).not.toContain('token')
    expect(Object.keys(body)).not.toContain('tokenHash')
    // Der Token reist nur als verschachtelter Auth-Redirect zu Supabase, nie als API-Antwort.
    // Supabase sendet den eigentlichen Invite-Link ueber den zentral konfigurierten Mailer.
    expect(authRedirects).toHaveLength(1)
    const passwordRedirect = new URL(authRedirects[0]!).searchParams.get('redirect')
    const acceptRedirect = new URL(passwordRedirect!, 'http://localhost').searchParams.get('redirect')
    const acceptUrlMatch = acceptRedirect?.match(/token=([a-f0-9]+)/)
    expect(acceptUrlMatch).not.toBeNull()
    expect(JSON.stringify(body)).not.toContain(acceptUrlMatch![1]!)
  })

  it('sends an existing account a Supabase magic link that continues to the organization invitation', async () => {
    const invitationRow = {
      id: INVITATION_ID, organization_id: ORGANIZATION_ID, department_id: null, team_id: null,
      email: 'existing@example.com', role: 'organization_viewer', invited_by: USER_ID,
      expires_at: '2026-08-20T00:00:00+00:00', accepted_at: null, revoked_at: null,
      last_sent_at: '2026-08-06T00:00:00+00:00', send_count: 1, created_at: '2026-08-06T00:00:00+00:00',
    }
    const magicLinkOptions: { shouldCreateUser?: boolean; emailRedirectTo?: string }[] = []
    const auditService = serviceClientCapturingAudit([])
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        rpc: async (fn: string) => (fn === 'email_has_membership' ? { data: false, error: null } : { data: invitationRow, error: null }),
      }) as unknown as SupabaseClient,
      forService: () => ({
        auth: {
          admin: { inviteUserByEmail: async () => ({ data: { user: null }, error: { code: 'email_exists', message: 'already registered' } }) },
          signInWithOtp: async (_input: { email: string; options: { shouldCreateUser?: boolean; emailRedirectTo?: string } }) => {
            magicLinkOptions.push(_input.options)
            return { data: {}, error: null }
          },
        },
        from: auditService.from,
      }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST', url: '/v1/invitations', headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
      payload: { organizationId: ORGANIZATION_ID, email: 'existing@example.com', role: 'organization_viewer' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ emailDelivered: true })
    expect(magicLinkOptions).toHaveLength(1)
    expect(magicLinkOptions[0]).toMatchObject({ shouldCreateUser: false })
    expect(decodeURIComponent(magicLinkOptions[0]!.emailRedirectTo!)).toContain('/einladung?token=')
  })

  it('maps the resend send-count limit to 429 before touching the database', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, email: 'x@example.com', send_count: 10, accepted_at: null, revoked_at: null },
                  error: null,
                }),
              }),
            }),
          }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/invitations/${INVITATION_ID}/resend`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ error: 'resend_limit_reached' })
  })

  it('resends an invitation via the resend_invitation RPC', async () => {
    const existingRow = { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, email: 'invitee@example.com', send_count: 2, accepted_at: null, revoked_at: null }
    const resentRow = {
      id: INVITATION_ID,
      organization_id: ORGANIZATION_ID,
      department_id: null,
      team_id: null,
      email: 'invitee@example.com',
      role: 'organization_viewer',
      invited_by: USER_ID,
      expires_at: '2026-08-20T00:00:00+00:00',
      accepted_at: null,
      revoked_at: null,
      last_sent_at: '2026-08-06T00:00:00+00:00',
      send_count: 3,
      created_at: '2026-08-05T00:00:00+00:00',
    }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async () => ({ data: resentRow, error: null }),
          from: (table: string) => {
            if (table === 'invitations') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingRow, error: null }) }) }) }
            if (table === 'organizations') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit([]),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/invitations/${INVITATION_ID}/resend`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: INVITATION_ID, sendCount: 3 })
  })

  it('maps an email/account mismatch on accept to 403', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'invitation_email_mismatch' } }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: 'some-raw-token' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'invitation_email_mismatch' })
  })

  it('maps an expired or unknown invitation on accept to 410', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'invitation_not_found_or_expired' } }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: 'some-raw-token' },
    })
    expect(response.statusCode).toBe(410)
    expect(response.json()).toMatchObject({ error: 'invitation_not_found_or_expired' })
  })

  it('maps the platform-admin separation trigger on invitation accept to 409', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({ rpc: async () => ({ data: null, error: { message: 'platform_admin_cannot_hold_membership' } }) }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: 'some-raw-token' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'platform_admin_cannot_hold_membership' })
  })

  it('refuses to remove the organization\'s responsible person', async () => {
    const membershipRow = { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, user_id: '10000000-0000-4000-8000-000000000099', role: 'organization_viewer' }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') {
              return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: membershipRow, error: null }) }) }) }
            }
            if (table === 'organization_profiles') {
              return {
                select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { responsible_person_profile_id: membershipRow.user_id }, error: null }) }) }),
              }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/memberships/${MEMBERSHIP_ID}?scope=organization`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'responsible_person_cannot_be_removed' })
  })

  it('maps the department content-delete trigger rejection to 409', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organization_id: ORGANIZATION_ID }, error: null }) }) }),
            delete: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: 'a department with existing posts cannot be deleted, archive it instead' } }) }) }),
          }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/departments/${DEPARTMENT_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'department_delete_blocked' })
  })

  // Regression: PostgREST reports no error when an RLS policy filters the DELETE's target row
  // out -- del.error is null and exactly zero rows come back, which used to be indistinguishable
  // from "deleted successfully" (found in this package's review).
  it('maps a silently RLS-filtered department delete to 403 instead of 204', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organization_id: ORGANIZATION_ID }, error: null }) }) }),
            delete: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }),
          }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/departments/${DEPARTMENT_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })

  it('changes a membership role atomically via the change_membership_role RPC', async () => {
    const existingRow = { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, user_id: '10000000-0000-4000-8000-000000000099', role: 'organization_viewer' }
    const rpcResult = { membershipId: MEMBERSHIP_ID, userId: existingRow.user_id, role: 'social_manager', expiresAt: null, fromRole: 'organization_viewer' }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingRow, error: null }) }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async (fn: string) => {
            expect(fn).toBe('change_membership_role')
            return { data: rpcResult, error: null }
          },
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit([]),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/memberships/${MEMBERSHIP_ID}?scope=organization`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'social_manager' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ membershipId: MEMBERSHIP_ID, role: 'social_manager', scope: 'organization' })
  })

  it('maps the change_membership_role RPC last-owner rejection to 409', async () => {
    // An organization_owner demoting another organization_owner passes the client-side rank
    // check (rank 100 <= 100, canRemoveRole has no organization_owner exception, see
    // packages/authorization) -- only prevent_last_owner_removal's count of remaining owners can
    // reject this, so the actor must itself be an organization_owner for the RPC to ever run.
    const ownerRoleProvider: RoleProvider = { async rolesForScope() { return ['organization_owner'] } }
    const existingRow = { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, user_id: '10000000-0000-4000-8000-000000000099', role: 'organization_owner' }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'organization_memberships') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingRow, error: null }) }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
          rpc: async (fn: string) => {
            expect(fn).toBe('change_membership_role')
            return { data: null, error: { message: 'the last organization_owner cannot be removed' } }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: ownerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/memberships/${MEMBERSHIP_ID}?scope=organization`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'organization_admin' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'cannot_remove_last_owner' })
  })

  // Regression: revoke pruefte accepted_at/revoked_at nicht. Ein Widerruf auf einer bereits
  // angenommenen Einladung aenderte nichts an der Mitgliedschaft, setzte aber revoked_at und
  // schrieb einen irrefuehrenden Audit-Eintrag.
  it('refuses to revoke an invitation that was already accepted', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'invitations') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        organization_id: ORGANIZATION_ID,
                        department_id: null,
                        team_id: null,
                        email: 'invitee@example.com',
                        accepted_at: '2026-08-06T00:00:00+00:00',
                        revoked_at: null,
                      },
                      error: null,
                    }),
                  }),
                }),
              }
            }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/invitations/${INVITATION_ID}/revoke`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
  })

  // Regression: die Scope-Kette aus organizationId + departmentId wurde ungeprueft an
  // requirePermission gegeben -- ein department_admin einer FREMDEN Organisation kam damit durch
  // die Berechtigungspruefung fuer eine beliebige organizationId (kein Leck, weil der
  // zusammengesetzte Fremdschluessel auf invitations die Kombination auf null Zeilen filtert).
  it('rejects listing invitations for a department that does not belong to the organization', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/invitations?departmentId=${DEPARTMENT_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
  })

  // Regression: pages/mitglieder.vue sendete fuer eine Team-Einladung nur teamId, nie die
  // Eltern-Abteilung -- CreateInvitationRequestSchema verlangt beides, jede Team-Einladung aus
  // der Oberflaeche schlug deshalb mit 400 fehl (im Nachfolge-Review dieses PRs gefunden).
  it('rejects a team-scoped invitation that omits the parent department', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, teamId: TEAM_ID, email: 'person@example.com', role: 'team_manager' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('sends a team-scoped invitation through Supabase Auth and preserves the acceptance target', async () => {
    const invitationRow = {
      id: INVITATION_ID,
      organization_id: ORGANIZATION_ID,
      department_id: DEPARTMENT_ID,
      team_id: TEAM_ID,
      email: 'invitee@example.com',
      role: 'team_manager',
      invited_by: USER_ID,
      expires_at: '2026-08-20T00:00:00+00:00',
      accepted_at: null,
      revoked_at: null,
      last_sent_at: '2026-08-06T00:00:00+00:00',
      send_count: 1,
      created_at: '2026-08-06T00:00:00+00:00',
    }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async (fn: string) => (fn === 'email_has_membership' ? { data: false, error: null } : { data: invitationRow, error: null }),
          from: (table: string) => {
            if (table === 'teams') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, name: 'Erste Mannschaft' }, error: null }),
                  }),
                }),
              }
            }
            if (table === 'organizations') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'SV Test' }, error: null }) }) }) }
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit([]),
    }
    const authRedirects: string[] = []
    const auditService = serviceClientCapturingAudit([])
    clients.forService = () => ({
      auth: {
        admin: {
          inviteUserByEmail: async (email: string, options?: { redirectTo?: string }) => {
            expect(email).toBe('invitee@example.com')
            authRedirects.push(options?.redirectTo ?? '')
            return { data: { user: {} }, error: null }
          },
        },
      },
      from: auditService.from,
    }) as unknown as SupabaseClient
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients,
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, teamId: TEAM_ID, email: 'invitee@example.com', role: 'team_manager' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ id: INVITATION_ID, teamId: TEAM_ID, emailDelivered: true })
    // Das neue Konto landet erst beim Passwortsetzen und danach bei der fachlichen Einladung.
    const passwordRedirect = new URL(authRedirects[0]!).searchParams.get('redirect')
    const acceptRedirect = new URL(passwordRedirect!, 'http://localhost').searchParams.get('redirect')
    expect(passwordRedirect).toContain('/passwort-neu?redirect=')
    expect(acceptRedirect).toMatch(/^\/einladung\?token=[a-f0-9]+$/)
  })

  // Regression: die drei Mitgliedschaftstabellen werden ueber fetchAllRows() geblaettert, der
  // Profil-Nachschlag lief aber als ein einzelnes .in() ueber alle Nutzer-IDs -- betroffene
  // Mitglieder fielen jenseits der Kappungsgrenze still auf "Unbekannt" zurueck.
  it('resolves display names for a roster larger than one profiles lookup chunk', async () => {
    const memberCount = 250
    const organizationRows = Array.from({ length: memberCount }, (_, index) => ({
      id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      user_id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      role: 'organization_viewer',
      expires_at: null,
    }))
    const requestedChunkSizes: number[] = []
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'profiles') {
              return {
                select: () => ({
                  in: async (_column: string, values: string[]) => {
                    requestedChunkSizes.push(values.length)
                    return { data: values.map((id) => ({ id, display_name: `Person ${id.slice(-4)}` })), error: null }
                  },
                }),
              }
            }
            const rows = table === 'organization_memberships' ? organizationRows : []
            return { select: () => ({ eq: () => ({ order: () => ({ range: async (from: number) => ({ data: from === 0 ? rows : [], error: null }) }) }) }) }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/members`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { displayName: string }[]
    expect(body).toHaveLength(memberCount)
    expect(body.filter((member) => member.displayName === 'Unbekannt')).toHaveLength(0)
    expect(requestedChunkSizes).toEqual([100, 100, 50])
  })

  it('derives per-role capability fields from the actor\'s own rank (Paket 023)', async () => {
    const ownerUserId = '10000000-0000-4000-8000-000000000101'
    const editorUserId = '10000000-0000-4000-8000-000000000102'
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'profiles') {
              return { select: () => ({ in: async (_c: string, ids: string[]) => ({ data: ids.map((id) => ({ id, display_name: 'Person' })), error: null }) }) }
            }
            if (table === 'organization_memberships') {
              return { select: () => ({ eq: () => ({ order: () => ({ range: async (from: number) => ({ data: from === 0 ? [{ id: '10000000-3000-4000-8000-000000000101', user_id: ownerUserId, role: 'organization_owner', expires_at: null }] : [], error: null }) }) }) }) }
            }
            if (table === 'department_memberships') {
              return { select: () => ({ eq: () => ({ order: () => ({ range: async (from: number) => ({ data: from === 0 ? [{ id: '10000000-3000-4000-8000-000000000102', user_id: editorUserId, role: 'editor', expires_at: null, department_id: DEPARTMENT_ID }] : [], error: null }) }) }) }) }
            }
            return { select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) }
          },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    // organizationManagerRoleProvider returns ['organization_admin'] (rank 90) for every scope --
    // enough to manage the editor (rank 20) but not the organization_owner (rank 100).
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ORGANIZATION_ID}/members`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { userId: string; roles: { canChangeRole: boolean; canRemove: boolean; canSetExpiry: boolean }[] }[]
    const owner = body.find((member) => member.userId === ownerUserId)!.roles[0]!
    const editor = body.find((member) => member.userId === editorUserId)!.roles[0]!
    expect(owner).toMatchObject({ canChangeRole: false, canRemove: false, canSetExpiry: false })
    expect(editor).toMatchObject({ canChangeRole: true, canRemove: true, canSetExpiry: true })
  })

  it('maps an RLS rejection on a direct membership insert to a friendly invite_not_allowed error (Paket 023: invite_allowed = false)', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }) }) }),
          }),
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memberships',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, userId: '10000000-0000-4000-8000-000000000099', role: 'organization_viewer' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'invite_not_allowed' })
  })

  it('maps create_invitation\'s insufficient_permission to the same friendly invite_not_allowed error', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          rpc: async (fn: string) => (fn === 'email_has_membership' ? { data: false, error: null } : { data: null, error: { code: 'P0001', message: 'insufficient_permission' } }),
          from: (table: string) => { throw new Error(`unexpected table in test fake: ${table}`) },
        }) as unknown as SupabaseClient,
      forService: () => ({}) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { organizationId: ORGANIZATION_ID, email: 'closed-department@example.com', role: 'organization_viewer' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'invite_not_allowed' })
  })

  it('sets a membership expiry via the dedicated expiry endpoint, separately from a role change', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organization_id: ORGANIZATION_ID, department_id: null, team_id: null, user_id: USER_ID, role: 'organization_viewer' }, error: null }) }) }),
          }),
          rpc: async () => ({ data: { membershipId: MEMBERSHIP_ID, expiresAt: '2026-09-01T00:00:00+00:00' }, error: null }),
        }) as unknown as SupabaseClient,
      forService: () => serviceClientCapturingAudit([]),
    }
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/memberships/${MEMBERSHIP_ID}/expiry?scope=organization`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expiresAt: '2026-09-01T00:00:00+00:00' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ expiresAt: '2026-09-01T00:00:00+00:00' })
  })
})
