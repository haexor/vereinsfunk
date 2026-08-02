export const permissions = [
  'organization.manage',
  'department.manage',
  'member.invite',
  'post.create',
  'post.edit',
  'post.submit',
  'post.approve',
  'post.publish',
  'social_account.manage',
  'analytics.view',
  'billing.manage',
] as const

export type Permission = (typeof permissions)[number]
export type Role =
  | 'organization_owner'
  | 'organization_admin'
  | 'social_manager'
  | 'billing_admin'
  | 'organization_viewer'
  | 'department_admin'
  | 'editor'
  | 'approver'
  | 'contributor'
  | 'viewer'
  | 'team_manager'

const allPermissions = new Set<Permission>(permissions)

export const rolePermissions: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  organization_owner: allPermissions,
  organization_admin: new Set(permissions.filter((permission) => permission !== 'billing.manage')),
  social_manager: new Set([
    'post.create',
    'post.edit',
    'post.submit',
    'post.approve',
    'post.publish',
    'social_account.manage',
    'analytics.view',
  ]),
  billing_admin: new Set(['billing.manage', 'analytics.view']),
  organization_viewer: new Set(['analytics.view']),
  department_admin: new Set([
    'department.manage',
    'member.invite',
    'post.create',
    'post.edit',
    'post.submit',
    'post.approve',
    'post.publish',
    'analytics.view',
  ]),
  editor: new Set(['post.create', 'post.edit', 'post.submit', 'analytics.view']),
  approver: new Set(['post.approve', 'analytics.view']),
  contributor: new Set(['post.create', 'post.submit']),
  viewer: new Set(['analytics.view']),
  team_manager: new Set(['post.create', 'post.edit', 'post.submit', 'analytics.view']),
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => rolePermissions[role].has(permission))
}
