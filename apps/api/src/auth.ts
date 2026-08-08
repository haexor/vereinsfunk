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
  constructor(private readonly environment: ApiEnvironment) {}

  async rolesForScope(auth: { userId: string; accessToken: string }, scope: PermissionScope): Promise<readonly Role[]> {
    const client = createUserClient(this.environment, auth.accessToken)
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
  // jwksFetch: gleiches Injektionsmuster wie fetchImpl in outboundFetch.ts, hier fuers Ersetzen des
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
