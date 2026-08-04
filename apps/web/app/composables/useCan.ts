import { hasPermission, type Permission, type Role } from '@vereinsfunk/authorization'
import type { SessionState } from './useSession.js'

export interface PermissionScope {
  organizationId: string
  departmentId?: string
  teamId?: string
}

// Blendet Aktionen aus, fuer die keine Permission vorliegt. Das ist Komfort, keine
// Sicherheit -- die Durchsetzung liegt in RLS und in der Fastify-API.
export function useCan(permission: Permission, scope: PermissionScope): boolean {
  const session = useState<SessionState | null>('vf-session', () => null)
  const organization = session.value?.scopes.find((item) => item.organizationId === scope.organizationId)
  if (!organization) return false

  const roles: Role[] = [...organization.organizationRoles]
  const department = scope.departmentId ? organization.departments.find((item) => item.id === scope.departmentId) : undefined
  if (department) roles.push(...department.roles)
  if (scope.teamId && department) {
    const team = department.teams.find((item) => item.id === scope.teamId)
    if (team) roles.push(...team.roles)
  }

  return hasPermission(roles, permission)
}
