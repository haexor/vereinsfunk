import { hasPermission, type Permission, type Role } from '@vereinsfunk/authorization'
import type { ApiEnvironment } from '@vereinsfunk/config'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { jwtVerify } from 'jose'
import { createUserClient } from './supabase.js'

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; accessToken: string }
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

// Bevorzugt lokale HS256-Verifikation gegen SUPABASE_JWT_SECRET, sonst Fallback auf auth.getUser().
// Beides hinter einer Funktion, damit ein Wechsel auf asymmetrische JWTs (JWKS) den Aufrufer nicht betrifft.
async function verifyAccessToken(environment: ApiEnvironment, accessToken: string): Promise<{ userId: string }> {
  if (environment.SUPABASE_JWT_SECRET) {
    const { payload } = await jwtVerify(accessToken, new TextEncoder().encode(environment.SUPABASE_JWT_SECRET), {
      algorithms: ['HS256'],
    })
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Error('token has no subject')
    return { userId: payload.sub }
  }
  const client = createUserClient(environment, accessToken)
  const { data, error } = await client.auth.getUser(accessToken)
  if (error || !data.user) throw new Error(error?.message ?? 'token rejected by auth server')
  return { userId: data.user.id }
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

export function createAuthGuards(environment: ApiEnvironment, roleProvider: RoleProvider) {
  const requireAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const header = request.headers.authorization
    const accessToken = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    if (!accessToken) {
      reply.code(401).send({ error: 'unauthorized', correlationId: request.id })
      return false
    }
    try {
      const { userId } = await verifyAccessToken(environment, accessToken)
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

  return { requireAuth, requirePermission }
}
