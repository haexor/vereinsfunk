import { hasPermission, type Permission, type Role } from '@vereinsfunk/authorization'
import type { ApiEnvironment } from '@vereinsfunk/config'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { createRemoteJWKSet, customFetch, jwtVerify, type FetchImplementation, type JWTVerifyGetKey } from 'jose'
import { createUserClient } from './supabase.js'

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; accessToken: string }
    platformAdmin?: { isDefaultAdmin: boolean }
  }
}

export interface PermissionScope {
  organizationId: string
  departmentId?: string
  teamId?: string
}

export interface RoleProvider {
  rolesForScope(auth: { userId: string; accessToken: string }, scope: PermissionScope): Promise<readonly Role[]>
  // Optional: ein Aufrufer mit mehreren Scopes derselben Anfrage (z. B. GET /v1/organizations/:id/members
  // ueber alle Abteilungen/Teams) kann damit in konstant drei Abfragen statt einer je Scope aufloesen.
  // Optional, damit bestehende RoleProvider-Testdoubles, die nur rolesForScope implementieren, gueltig
  // bleiben -- siehe resolveRolesForScopes (routes/shared.ts) fuer den Fallback ohne diese Methode.
  rolesForScopes?(
    auth: { userId: string; accessToken: string },
    scopes: readonly PermissionScope[],
  ): Promise<ReadonlyMap<string, readonly Role[]>>
}

// Stabiler Schluessel je Scope, u. a. fuer rolesByScopeKey (routes/members.ts) und die Map, die
// rolesForScopes zurueckgibt -- beide muessen denselben Schluessel fuer denselben Scope bilden.
export function permissionScopeKey(scope: PermissionScope): string {
  if (scope.teamId) return `team:${scope.teamId}`
  if (scope.departmentId) return `department:${scope.departmentId}`
  return 'organization'
}

// Supabase legt seit 1. Mai 2025 neue Projekte standardmaessig mit asymmetrischen JWT Signing Keys
// an (RS256 im Dashboard-Default, der lokale CLI-Stack signiert mit ES256) und raet inzwischen
// explizit vom alten Shared-Secret ab. SUPABASE_JWT_SECRET bleibt als expliziter Override fuer
// Tests (deterministisch selbst signierte Tokens ohne Netzwerkzugriff) sowie fuer Projekte, die
// bewusst beim Legacy-HS256-Secret geblieben sind; jeder andere Fall verifiziert per JWKS gegen
// den Auth-Server, algorithmusunabhaengig. Ein frueherer reiner HS256-Pfad wies dort jeden echten
// Token mit Algorithmus-Mismatch ab -- 401 auf jeden authentifizierten Endpunkt.
function verifyAccessToken(environment: ApiEnvironment, jwks: JWTVerifyGetKey | undefined) {
  return async (accessToken: string): Promise<{ userId: string }> => {
    if (environment.SUPABASE_JWT_SECRET) {
      const { payload } = await jwtVerify(accessToken, new TextEncoder().encode(environment.SUPABASE_JWT_SECRET), {
        algorithms: ['HS256'],
      })
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Error('token has no subject')
      return { userId: payload.sub }
    }
    if (!jwks) throw new Error('neither SUPABASE_JWT_SECRET nor SUPABASE_URL is configured')
    const { payload } = await jwtVerify(accessToken, jwks)
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Error('token has no subject')
    return { userId: payload.sub }
  }
}

export class SupabaseRoleProvider implements RoleProvider {
  // clientFactory: gleiches Injektionsmuster wie jwksFetch in createAuthGuards, hier fuers
  // Ersetzen des Supabase-Clients in Tests (Zaehlen der .from()-Aufrufe fuer rolesForScopes, ohne
  // eine echte Supabase-Instanz zu brauchen).
  constructor(
    private readonly environment: ApiEnvironment,
    private readonly clientFactory: (environment: ApiEnvironment, accessToken: string) => SupabaseClient = createUserClient,
  ) {}

  async rolesForScope(auth: { userId: string; accessToken: string }, scope: PermissionScope): Promise<readonly Role[]> {
    const client = this.clientFactory(this.environment, auth.accessToken)
    const notExpired = `expires_at.is.null,expires_at.gt.${new Date().toISOString()}`
    const roles: Role[] = []

    const organizationRoles = await client
      .from('organization_memberships')
      .select('role')
      .eq('organization_id', scope.organizationId)
      .eq('user_id', auth.userId)
      .or(notExpired)
    if (organizationRoles.error) throw organizationRoles.error
    roles.push(...organizationRoles.data.map((row) => row.role as Role))

    if (scope.departmentId) {
      const departmentRoles = await client
        .from('department_memberships')
        .select('role')
        .eq('department_id', scope.departmentId)
        .eq('user_id', auth.userId)
        .or(notExpired)
      if (departmentRoles.error) throw departmentRoles.error
      roles.push(...departmentRoles.data.map((row) => row.role as Role))
    }

    if (scope.teamId) {
      const teamRoles = await client
        .from('team_memberships')
        .select('role')
        .eq('team_id', scope.teamId)
        .eq('user_id', auth.userId)
        .or(notExpired)
      if (teamRoles.error) throw teamRoles.error
      roles.push(...teamRoles.data.map((row) => row.role as Role))
    }

    return roles
  }

  // Drei Abfragen statt einer je Scope: SupabaseRoleProvider.rolesForScope fragt bei jedem Aufruf
  // organization_memberships neu ab (department_memberships/team_memberships je nach gesetztem
  // Feld dazu) -- bei vielen Scopes derselben Anfrage (GET /v1/organizations/:id/members mit N
  // Abteilungen/Teams) summiert sich das (Review zu PR #36). department_memberships/
  // team_memberships werden nur abgefragt, wenn die jeweilige Scope-Menge nicht leer ist.
  async rolesForScopes(
    auth: { userId: string; accessToken: string },
    scopes: readonly PermissionScope[],
  ): Promise<ReadonlyMap<string, readonly Role[]>> {
    const client = this.clientFactory(this.environment, auth.accessToken)
    const notExpired = `expires_at.is.null,expires_at.gt.${new Date().toISOString()}`
    const organizationIds = Array.from(new Set(scopes.map((scope) => scope.organizationId)))
    const departmentIds = Array.from(new Set(scopes.flatMap((scope) => (scope.departmentId ? [scope.departmentId] : []))))
    const teamIds = Array.from(new Set(scopes.flatMap((scope) => (scope.teamId ? [scope.teamId] : []))))

    const [organizationRows, departmentRows, teamRows] = await Promise.all([
      client.from('organization_memberships').select('organization_id, role').in('organization_id', organizationIds).eq('user_id', auth.userId).or(notExpired),
      departmentIds.length > 0
        ? client.from('department_memberships').select('department_id, role').in('department_id', departmentIds).eq('user_id', auth.userId).or(notExpired)
        : Promise.resolve({ data: [] as { department_id: string; role: string }[], error: null }),
      teamIds.length > 0
        ? client.from('team_memberships').select('team_id, role').in('team_id', teamIds).eq('user_id', auth.userId).or(notExpired)
        : Promise.resolve({ data: [] as { team_id: string; role: string }[], error: null }),
    ])
    if (organizationRows.error) throw organizationRows.error
    if (departmentRows.error) throw departmentRows.error
    if (teamRows.error) throw teamRows.error

    const rolesByOrganizationId = groupRolesBy(organizationRows.data, (row) => row.organization_id as string)
    const rolesByDepartmentId = groupRolesBy(departmentRows.data, (row) => row.department_id as string)
    const rolesByTeamId = groupRolesBy(teamRows.data, (row) => row.team_id as string)

    const result = new Map<string, readonly Role[]>()
    for (const scope of scopes) {
      result.set(permissionScopeKey(scope), [
        ...(rolesByOrganizationId.get(scope.organizationId) ?? []),
        ...(scope.departmentId ? (rolesByDepartmentId.get(scope.departmentId) ?? []) : []),
        ...(scope.teamId ? (rolesByTeamId.get(scope.teamId) ?? []) : []),
      ])
    }
    return result
  }
}

function groupRolesBy<T extends { role: unknown }>(rows: readonly T[], keyOf: (row: T) => string): Map<string, Role[]> {
  const grouped = new Map<string, Role[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const list = grouped.get(key)
    if (list) list.push(row.role as Role)
    else grouped.set(key, [row.role as Role])
  }
  return grouped
}

// Orthogonal zu RoleProvider/PermissionScope: ein Plattform-Admin ist keiner Organisation
// zugeordnet. Die Tabelle platform_admins hat keinerlei Grant/Policy fuer authenticated
// (siehe 2026080502_platform_administration.sql) -- nur der Service-Role-Client kommt heran.
export interface PlatformAdminProvider {
  statusFor(userId: string): Promise<{ isPlatformAdmin: boolean; isDefaultAdmin: boolean }>
}

export class SupabasePlatformAdminProvider implements PlatformAdminProvider {
  constructor(private readonly forService: () => SupabaseClient) {}

  async statusFor(userId: string): Promise<{ isPlatformAdmin: boolean; isDefaultAdmin: boolean }> {
    const result = await this.forService()
      .from('platform_admins')
      .select('is_default_admin')
      .eq('user_id', userId)
      .maybeSingle()
    if (result.error) throw result.error
    return { isPlatformAdmin: result.data !== null, isDefaultAdmin: result.data?.is_default_admin === true }
  }
}

export function createAuthGuards(
  environment: ApiEnvironment,
  roleProvider: RoleProvider,
  platformAdminProvider: PlatformAdminProvider,
  // jwksFetch: gleiches Injektionsmuster wie fetchImpl in @vereinsfunk/outbound-fetch, hier fuers Ersetzen des
  // JWKS-Abrufs in Tests -- keine echte Supabase-Instanz noetig, um die Verifikation zu pruefen.
  options: { jwksFetch?: FetchImplementation } = {},
) {
  // Einmal pro Server-/Test-App-Instanz gebaut, nicht pro Request: createRemoteJWKSet cached die
  // abgerufenen Schluessel intern, was nur greift, wenn dieselbe Instanz wiederverwendet wird.
  const jwks = environment.SUPABASE_URL
    ? createRemoteJWKSet(
        new URL('/auth/v1/.well-known/jwks.json', environment.SUPABASE_URL),
        options.jwksFetch ? { [customFetch]: options.jwksFetch } : undefined,
      )
    : undefined
  const verify = verifyAccessToken(environment, jwks)

  const requireAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const header = request.headers.authorization
    const accessToken = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    if (!accessToken) {
      reply.code(401).send({ error: 'unauthorized', correlationId: request.id })
      return false
    }
    try {
      const { userId } = await verify(accessToken)
      request.auth = { userId, accessToken }
      return true
    } catch {
      reply.code(401).send({ error: 'unauthorized', correlationId: request.id })
      return false
    }
  }

  const requirePermission = async (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: Permission,
    scope: PermissionScope,
  ): Promise<boolean> => {
    if (!request.auth) {
      reply.code(401).send({ error: 'unauthorized', correlationId: request.id })
      return false
    }
    const roles = await roleProvider.rolesForScope(request.auth, scope)
    if (!hasPermission(roles, permission)) {
      reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      return false
    }
    return true
  }

  const requirePlatformAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (!request.auth) {
      reply.code(401).send({ error: 'unauthorized', correlationId: request.id })
      return false
    }
    const status = await platformAdminProvider.statusFor(request.auth.userId)
    if (!status.isPlatformAdmin) {
      reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      return false
    }
    request.platformAdmin = { isDefaultAdmin: status.isDefaultAdmin }
    return true
  }

  return { requireAuth, requirePermission, requirePlatformAdmin }
}
