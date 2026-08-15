import { describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { parseApiEnvironment } from '@vereinsfunk/config'
import {
  createAuthGuards,
  permissionScopeKey,
  SupabaseRoleProvider,
  type PermissionScope,
  type PlatformAdminProvider,
  type RoleProvider,
} from './auth.js'
import { resolveRolesForScopes } from './routes/shared.js'
import { fetchAllRowsForIds } from './supabase.js'

const roleProvider: RoleProvider = { async rolesForScope() { return [] } }
const platformAdminProvider: PlatformAdminProvider = {
  async statusFor() { return { isPlatformAdmin: false, isDefaultAdmin: false } },
}

function fakeRequest(accessToken?: string): FastifyRequest {
  return {
    id: 'test-request',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  } as unknown as FastifyRequest
}

function fakeReply() {
  const reply = { code: vi.fn(() => reply), send: vi.fn(() => reply) }
  return reply as unknown as FastifyReply & { code: typeof reply.code; send: typeof reply.send }
}

const SUPABASE_URL = 'https://project-ref.supabase.co'

// Regression: Supabase legt seit 1. Mai 2025 neue Projekte standardmaessig mit asymmetrischen JWT
// Signing Keys an. Ein reiner HS256-Pfad (der alte Code) wies jeden solchen Token mit einem
// Algorithmus-Mismatch ab -- diese Tests decken den JWKS-Pfad ab, der genau das behebt.
describe('createAuthGuards JWKS verification', () => {
  it('accepts a token signed by a key published in the project JWKS', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256')
    const kid = 'test-key'
    const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }] }

    const jwksFetch = vi.fn(async (url: string) => {
      expect(url).toBe(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
      return new Response(JSON.stringify(jwks), { headers: { 'content-type': 'application/json' } })
    })

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid })
      .setSubject('user-123')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    const environment = parseApiEnvironment({ SUPABASE_URL })
    const { requireAuth } = createAuthGuards(environment, roleProvider, platformAdminProvider, { jwksFetch })

    const request = fakeRequest(token)
    const reply = fakeReply()
    const authenticated = await requireAuth(request, reply)

    expect(authenticated).toBe(true)
    expect(request.auth).toEqual({ userId: 'user-123', accessToken: token })
    expect(reply.code).not.toHaveBeenCalled()
  })

  it('rejects a token signed by a key absent from the project JWKS', async () => {
    const { publicKey } = await generateKeyPair('ES256')
    const { privateKey: otherPrivateKey } = await generateKeyPair('ES256')
    const kid = 'test-key'
    const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }] }

    const jwksFetch = async () => new Response(JSON.stringify(jwks), { headers: { 'content-type': 'application/json' } })

    // Signiert mit einem Schluessel, der nicht im JWKS steht -- z.B. ein gefaelschter oder abgelaufen
    // rotierter Token.
    const forgedToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid })
      .setSubject('user-123')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(otherPrivateKey)

    const environment = parseApiEnvironment({ SUPABASE_URL })
    const { requireAuth } = createAuthGuards(environment, roleProvider, platformAdminProvider, { jwksFetch })

    const request = fakeRequest(forgedToken)
    const reply = fakeReply()
    const authenticated = await requireAuth(request, reply)

    expect(authenticated).toBe(false)
    expect(reply.code).toHaveBeenCalledWith(401)
  })
})

// Plan 031: GET /v1/organizations/:id/members loeste vor dieser Aenderung die Capability-Felder
// je eindeutiger Abteilung/Team einzeln auf (roleProvider.rolesForScope, ein Aufruf je Ebene).
// SupabaseRoleProvider.rolesForScopes buendelt diese Zugriffe pro Mitgliedschaftstabelle und
// begrenzt jede .in()-Liste auf URL-sichere Bloecke. clientFactory ist dasselbe
// Injektionsmuster wie jwksFetch oben, hier fuer einen Client-Fake ohne echte Supabase-Instanz.
describe('SupabaseRoleProvider.rolesForScopes', () => {
  it('reads an organization plus ten department and forty team scopes once per membership table', async () => {
    const organizationId = 'org-1'
    const departmentIds = Array.from({ length: 10 }, (_, index) => `dept-${index}`)
    const teamIds = Array.from({ length: 40 }, (_, index) => `team-${index}`)
    const departmentIdForTeam = new Map(teamIds.map((teamId, index) => [teamId, departmentIds[index % departmentIds.length]!]))

    const queriedTables: string[] = []
    function chain(data: readonly Record<string, unknown>[]) {
      return { in: () => ({ eq: () => ({ or: () => ({ order: () => ({ range: async (from: number, to: number) => ({ data: data.slice(from, to + 1), error: null }) }) }) }) }) }
    }
    const fakeClient = {
      from: (table: string) => {
        queriedTables.push(table)
        if (table === 'organization_memberships') return { select: () => chain([{ organization_id: organizationId, role: 'organization_admin' }]) }
        if (table === 'department_memberships') return { select: () => chain(departmentIds.map((departmentId) => ({ department_id: departmentId, role: 'department_admin' }))) }
        if (table === 'team_memberships') return { select: () => chain(teamIds.map((teamId) => ({ team_id: teamId, role: 'team_manager' }))) }
        throw new Error(`unexpected table in test fake: ${table}`)
      },
    } as unknown as SupabaseClient

    const environment = parseApiEnvironment({ SUPABASE_URL })
    const provider = new SupabaseRoleProvider(environment, () => fakeClient)
    const scopes: PermissionScope[] = [
      { organizationId },
      ...departmentIds.map((departmentId) => ({ organizationId, departmentId })),
      ...teamIds.map((teamId) => ({ organizationId, departmentId: departmentIdForTeam.get(teamId)!, teamId })),
    ]

    const rolesByScopeKey = await provider.rolesForScopes({ userId: 'user-1', accessToken: 'token' }, scopes)

    expect(queriedTables).toEqual(['organization_memberships', 'department_memberships', 'team_memberships'])
    // Wie das bestehende rolesForScope kaskadieren die Rollen: eine Team-Ebene traegt Org- UND
    // Abteilungs- UND Team-Rollen, nicht nur ihre eigene (canAssignRole/canRemoveRole brauchen die
    // volle Kette).
    expect(rolesByScopeKey.get('organization')).toEqual(['organization_admin'])
    expect(rolesByScopeKey.get(`department:${departmentIds[0]}`)).toEqual(['organization_admin', 'department_admin'])
    expect(rolesByScopeKey.get(`team:${teamIds[0]}`)).toEqual(['organization_admin', 'department_admin', 'team_manager'])
  })

  it('skips the department/team queries when no scope carries one', async () => {
    const queriedTables: string[] = []
    const fakeClient = {
      from: (table: string) => {
        queriedTables.push(table)
        return { select: () => ({ in: () => ({ eq: () => ({ or: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) }) }) }
      },
    } as unknown as SupabaseClient
    const environment = parseApiEnvironment({ SUPABASE_URL })
    const provider = new SupabaseRoleProvider(environment, () => fakeClient)

    await provider.rolesForScopes({ userId: 'user-1', accessToken: 'token' }, [{ organizationId: 'org-1' }])

    expect(queriedTables).toEqual(['organization_memberships'])
  })

  it('chunks large scope sets to URL-safe ID lists without losing the last roles', async () => {
    const organizationId = 'org-1'
    const departmentIds = Array.from({ length: 250 }, (_, index) => `dept-${index}`)
    const teamIds = Array.from({ length: 250 }, (_, index) => `team-${index}`)
    const batchesByTable = new Map<string, number[]>()
    const rowsByTable: Record<string, readonly Record<string, unknown>[]> = {
      organization_memberships: [{ organization_id: organizationId, role: 'organization_admin' }],
      department_memberships: departmentIds.map((department_id) => ({ department_id, role: 'department_admin' })),
      team_memberships: teamIds.map((team_id) => ({ team_id, role: 'team_manager' })),
    }
    const fakeClient = {
      from: (table: string) => ({
        select: () => ({
          in: (_column: string, ids: readonly string[]) => {
            batchesByTable.set(table, [...(batchesByTable.get(table) ?? []), ids.length])
            const rows = rowsByTable[table]!.filter((row) => ids.includes(String(Object.values(row)[0])))
            return { eq: () => ({ or: () => ({ order: () => ({ range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }) }) }) }) }
          },
        }),
      }),
    } as unknown as SupabaseClient
    const environment = parseApiEnvironment({ SUPABASE_URL })
    const provider = new SupabaseRoleProvider(environment, () => fakeClient)
    const scopes: PermissionScope[] = [
      { organizationId },
      ...departmentIds.map((departmentId) => ({ organizationId, departmentId })),
      ...teamIds.map((teamId, index) => ({ organizationId, departmentId: departmentIds[index]!, teamId })),
    ]

    const rolesByScopeKey = await provider.rolesForScopes({ userId: 'user-1', accessToken: 'token' }, scopes)

    expect(batchesByTable.get('organization_memberships')).toEqual([1])
    expect(batchesByTable.get('department_memberships')).toEqual([100, 100, 50])
    expect(batchesByTable.get('team_memberships')).toEqual([100, 100, 50])
    expect(rolesByScopeKey.get(`department:${departmentIds.at(-1)}`)).toEqual(['organization_admin', 'department_admin'])
    expect(rolesByScopeKey.get(`team:${teamIds.at(-1)}`)).toEqual(['organization_admin', 'department_admin', 'team_manager'])
  })
})

describe('fetchAllRowsForIds', () => {
  it('keeps reading a batch after Supabase max_rows has returned its first 1,000 rows', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => `role-${index}`)
    const requestedRanges: [number, number][] = []

    const result = await fetchAllRowsForIds(['scope-1'], (_batch, from, to) => {
      requestedRanges.push([from, to])
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
    })

    expect(result).toEqual(rows)
    expect(requestedRanges).toEqual([[0, 999], [1000, 1999]])
  })
})

describe('resolveRolesForScopes', () => {
  it('falls back to one rolesForScope call per scope when the provider has no rolesForScopes', async () => {
    const seenScopes: PermissionScope[] = []
    const provider: RoleProvider = {
      async rolesForScope(_auth, scope) {
        seenScopes.push(scope)
        return scope.teamId ? ['team_manager'] : scope.departmentId ? ['department_admin'] : ['organization_admin']
      },
    }
    const scopes: PermissionScope[] = [
      { organizationId: 'org-1' },
      { organizationId: 'org-1', departmentId: 'dept-1' },
      { organizationId: 'org-1', departmentId: 'dept-1', teamId: 'team-1' },
    ]

    const result = await resolveRolesForScopes(provider, { userId: 'user-1', accessToken: 'token' }, scopes)

    expect(seenScopes).toHaveLength(3)
    expect(result.get('organization')).toEqual(['organization_admin'])
    expect(result.get('department:dept-1')).toEqual(['department_admin'])
    expect(result.get('team:team-1')).toEqual(['team_manager'])
  })

  it('delegates to rolesForScopes in a single call when the provider implements it', async () => {
    let callCount = 0
    const provider: RoleProvider = {
      async rolesForScope() {
        throw new Error('rolesForScope should not be called when rolesForScopes is available')
      },
      async rolesForScopes(_auth, scopes) {
        callCount += 1
        return new Map(scopes.map((scope) => [permissionScopeKey(scope), ['organization_admin']]))
      },
    }
    const scopes: PermissionScope[] = [{ organizationId: 'org-1' }, { organizationId: 'org-1', departmentId: 'dept-1' }]

    const result = await resolveRolesForScopes(provider, { userId: 'user-1', accessToken: 'token' }, scopes)

    expect(callCount).toBe(1)
    expect(result.get('organization')).toEqual(['organization_admin'])
    expect(result.get('department:dept-1')).toEqual(['organization_admin'])
  })
})
