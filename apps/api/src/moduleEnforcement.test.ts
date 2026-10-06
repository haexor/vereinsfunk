import type { SupabaseClient } from '@supabase/supabase-js'
import { parseApiEnvironment } from '@vereinsfunk/config'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClientFactory } from './app.js'
import { createAuthGuards, type PlatformAdminProvider, type RoleProvider } from './auth.js'
import { SupabaseModuleStatusProvider, type ModuleStatusProvider } from './moduleStatus.js'
import {
  DEPARTMENT_ID,
  ORGANIZATION_ID,
  TEAM_ID,
  USER_ID,
  chain,
  denyingRoleProvider,
  moduleStatusProviderWith,
  organizationManagerRoleProvider,
  signAccessToken,
  startApp,
} from './testSupport.js'

// Paket 051, PR 2: Durchsetzung der Modulauswahl in der API.

const platformAdminProvider: PlatformAdminProvider = { async statusFor() { return { isPlatformAdmin: false, isDefaultAdmin: false } } }
const adminRoles: RoleProvider = { async rolesForScope() { return ['organization_admin'] } }

function authedRequest(): FastifyRequest {
  return { id: 'test-request', headers: {}, auth: { userId: USER_ID, accessToken: 'token' } } as unknown as FastifyRequest
}

function fakeReply() {
  const reply = { code: vi.fn(() => reply), send: vi.fn(() => reply) }
  return reply as unknown as FastifyReply & { code: typeof reply.code; send: typeof reply.send }
}

function guardsWith(roleProvider: RoleProvider, moduleStatusProvider: ModuleStatusProvider) {
  return createAuthGuards(parseApiEnvironment({ SUPABASE_URL: 'https://project-ref.supabase.co' }), roleProvider, platformAdminProvider, moduleStatusProvider)
}

describe('requirePermission module check', () => {
  const scope = { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID }

  it('rejects a social_media permission with 403 module_disabled when the module is off', async () => {
    const { requirePermission } = guardsWith(adminRoles, moduleStatusProviderWith(['playerboard']))
    const reply = fakeReply()
    expect(await requirePermission(authedRequest(), reply, 'post.publish', scope)).toBe(false)
    expect(reply.code).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'module_disabled', module: 'social_media' }))
  })

  it('allows a social_media permission when the module is on', async () => {
    const { requirePermission } = guardsWith(adminRoles, moduleStatusProviderWith(['social_media']))
    expect(await requirePermission(authedRequest(), fakeReply(), 'post.publish', scope)).toBe(true)
  })

  it('never consults the module status for framework permissions', async () => {
    const modulesForScope = vi.fn(async () => ({ enabled: [], blockedBy: {} }))
    const { requirePermission } = guardsWith(adminRoles, { modulesForScope })
    expect(await requirePermission(authedRequest(), fakeReply(), 'organization.manage', scope)).toBe(true)
    expect(modulesForScope).not.toHaveBeenCalled()
  })

  it('answers 403 forbidden without revealing the module state to a caller lacking the role', async () => {
    const modulesForScope = vi.fn(async () => ({ enabled: [], blockedBy: {} }))
    const { requirePermission } = guardsWith(denyingRoleProvider, { modulesForScope })
    const reply = fakeReply()
    expect(await requirePermission(authedRequest(), reply, 'post.publish', scope)).toBe(false)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'forbidden' }))
    expect(modulesForScope).not.toHaveBeenCalled()
  })

  it('lets requirePermissionAnyOf pass when a granted framework permission is among the alternatives', async () => {
    const { requirePermissionAnyOf } = guardsWith(adminRoles, moduleStatusProviderWith([]))
    expect(await requirePermissionAnyOf(authedRequest(), fakeReply(), ['post.edit', 'consent.manage'], scope)).toBe(true)
  })

  it('rejects requirePermissionAnyOf with module_disabled when every granted alternative belongs to a disabled module', async () => {
    const { requirePermissionAnyOf } = guardsWith(adminRoles, moduleStatusProviderWith(['playerboard']))
    const reply = fakeReply()
    expect(await requirePermissionAnyOf(authedRequest(), reply, ['post.edit', 'post.publish'], scope)).toBe(false)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'module_disabled', module: 'social_media' }))
  })
})

describe('SupabaseModuleStatusProvider', () => {
  function serviceClient(tables: Record<string, unknown>, seen: string[] = []): SupabaseClient {
    return {
      from: (table: string) => {
        seen.push(table)
        if (!(table in tables)) throw new Error(`unexpected table: ${table}`)
        return chain({ data: tables[table], error: null })
      },
    } as unknown as SupabaseClient
  }

  it('intersects plan, organization, department and team and reports where a module was blocked', async () => {
    const provider = new SupabaseModuleStatusProvider(() => serviceClient({
      organization_subscriptions: { subscription_plans: { included_modules: ['social_media', 'playerboard'] } },
      policy_settings: [
        { scope: 'organization', department_id: null, team_id: null, enabled_modules: ['social_media', 'playerboard'] },
        { scope: 'department', department_id: DEPARTMENT_ID, team_id: null, enabled_modules: ['playerboard'] },
      ],
    }))
    const result = await provider.modulesForScope({ organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, teamId: TEAM_ID })
    expect(result.enabled).toEqual(['playerboard'])
    expect(result.blockedBy).toEqual({ social_media: 'department' })
  })

  it('treats a missing subscription as no plan restriction', async () => {
    const provider = new SupabaseModuleStatusProvider(() => serviceClient({ organization_subscriptions: null, policy_settings: [] }))
    expect((await provider.modulesForScope({ organizationId: ORGANIZATION_ID })).enabled).toEqual(['social_media', 'playerboard'])
  })

  it('looks up the department of a team scope that arrives without one', async () => {
    const seen: string[] = []
    const provider = new SupabaseModuleStatusProvider(() => serviceClient({
      teams: { department_id: DEPARTMENT_ID },
      organization_subscriptions: null,
      policy_settings: [{ scope: 'department', department_id: DEPARTMENT_ID, team_id: null, enabled_modules: [] }],
    }, seen))
    const result = await provider.modulesForScope({ organizationId: ORGANIZATION_ID, teamId: TEAM_ID })
    expect(seen).toContain('teams')
    expect(result.enabled).toEqual([])
    expect(result.blockedBy).toEqual({ social_media: 'department', playerboard: 'department' })
  })
})

describe('module selection routes', () => {
  function clients(options: { rpc?: { data: unknown; error: unknown }; policyRows?: unknown[]; subscription?: unknown; audit?: Record<string, unknown>[] } = {}): SupabaseClientFactory {
    // Listen fuer GET, die erste Zeile fuer .single()/.maybeSingle() (Scope- und Namensauflosung).
    const rows = (data: Record<string, unknown>[]) => {
      const first = chain({ data: data[0], error: null })
      return Object.assign(chain({ data, error: null }), { maybeSingle: first.maybeSingle, single: first.single, select: () => rows(data), eq: () => rows(data) })
    }
    const tables = (table: string) => {
      if (table === 'organizations') return chain({ data: { name: 'SV Test' }, error: null })
      if (table === 'departments') return rows([{ id: DEPARTMENT_ID, name: 'Fussball', organization_id: ORGANIZATION_ID }])
      if (table === 'teams') return rows([{ id: TEAM_ID, name: 'U13', organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID }])
      if (table === 'policy_settings') return chain({ data: options.policyRows ?? [], error: null })
      if (table === 'organization_subscriptions') return chain({ data: options.subscription ?? null, error: null })
      if (table === 'organization_memberships') return chain({ data: [{ id: 'membership' }], error: null })
      if (table === 'department_memberships' || table === 'team_memberships') return chain({ data: [], error: null })
      if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { options.audit?.push(row); return { error: null } } }
      throw new Error(`unexpected table in test fake: ${table}`)
    }
    return {
      forUser: () => ({ from: tables, rpc: async () => options.rpc ?? { data: { id: 'policy-settings-id' }, error: null } }) as unknown as SupabaseClient,
      forService: () => ({ from: tables }) as unknown as SupabaseClient,
    }
  }

  it('lists every level with its own selection, effective modules and blocking source', async () => {
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients({
        subscription: { subscription_plans: { included_modules: ['social_media'] } },
        policyRows: [{ scope: 'team', department_id: DEPARTMENT_ID, team_id: TEAM_ID, enabled_modules: [] }],
      }),
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/scope-modules`, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { scope: string; own: unknown; canEdit: boolean; modules: { module: string; enabled: boolean; blockedBy: string | null }[] }[]
    expect(body.map((entry) => entry.scope)).toEqual(['organization', 'department', 'team'])
    expect(body[0]!.modules).toEqual([
      { module: 'social_media', enabled: true, blockedBy: null },
      { module: 'playerboard', enabled: false, blockedBy: 'plan' },
    ])
    expect(body[2]!.own).toEqual([])
    expect(body[2]!.modules).toEqual([
      { module: 'social_media', enabled: false, blockedBy: 'team' },
      { module: 'playerboard', enabled: false, blockedBy: 'plan' },
    ])
    expect(body.every((entry) => entry.canEdit)).toBe(true)
  })

  it('writes a selection, records an audit event and returns the updated level', async () => {
    const audit: Record<string, unknown>[] = []
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients({ audit }) })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: '/v1/scope-modules', headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'department', scopeId: DEPARTMENT_ID, enabledModules: ['social_media'] },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ scope: 'department', scopeId: DEPARTMENT_ID, name: 'Fussball', canEdit: true })
    expect(audit).toEqual([expect.objectContaining({ action: 'scope_modules.changed', metadata: { scope: 'department', scopeId: DEPARTMENT_ID, enabledModules: ['social_media'] } })])
  })

  it('answers 409 with the blocking publications when social_media still has active publications', async () => {
    const publications = [{ publicationId: '51000000-9000-4000-8000-000000000001', postId: '51000000-2000-4000-8000-000000000001' }]
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients({ rpc: { data: null, error: { message: 'module_has_active_publications', details: JSON.stringify(publications) } } }),
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: '/v1/scope-modules', headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, enabledModules: [] },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'module_has_active_publications', publications })
  })

  it('answers 422 when the selection names a module that is not active above', async () => {
    const app = await startApp({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: clients({ rpc: { data: null, error: { message: 'module_not_available', details: '["playerboard"]' } } }),
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: '/v1/scope-modules', headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, enabledModules: ['playerboard'] },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'module_not_available', modules: ['playerboard'] })
  })

  it('rejects a caller without the manage permission of that level', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients() })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: '/v1/scope-modules', headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, enabledModules: null },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'forbidden' })
  })

  it('rejects duplicate modules in the request', async () => {
    const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients() })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: '/v1/scope-modules', headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'organization', scopeId: ORGANIZATION_ID, enabledModules: ['social_media', 'social_media'] },
    })
    expect(response.statusCode).toBe(400)
  })
})
