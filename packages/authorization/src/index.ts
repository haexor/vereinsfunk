export const permissions = [
  'organization.manage',
  'department.manage',
  'team.manage',
  'member.invite',
  'member.remove',
  'post.create',
  'post.edit',
  'post.submit',
  'post.approve',
  'post.publish',
  'social_account.manage',
  'brand.manage',
  'analytics.view',
  'billing.manage',
  'directory.read',
  'integration.manage',
  'fixture.manage',
  'event.manage',
  'consent.manage',
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
    'team.manage',
    'member.invite',
    'member.remove',
    'post.create',
    'post.edit',
    'post.submit',
    'post.approve',
    'post.publish',
    // Paket 012: ohne dies gaebe es keine Rolle, die ausschliesslich die eigene Abteilung
    // verwaltet, aber deren Kanaele bespielen darf -- social_manager ist eine Vereinsrolle,
    // department_admin die einzige abteilungsscoped Verwaltungsrolle.
    'social_account.manage',
    // Paket 013: eigenes Abteilungsbranding verwalten (Logo, Farben, Schriften).
    'brand.manage',
    'analytics.view',
    // Paket 014: Mitgliederverzeichnis der eigenen Abteilung lesen, eigene Integrationsquellen
    // verwalten (integration_sources kennt keine Team-Ebene, deshalb nur hier, nicht bei team_manager).
    'directory.read',
    'integration.manage',
    // Paket 019: Spielplaene/Veranstaltungen der eigenen Abteilung verwalten -- ebenfalls nicht
    // bei team_manager, aus demselben Grund wie team.manage/integration.manage.
    'fixture.manage',
    'event.manage',
    // Paket 015: Einwilligungen betreffen Elternkontakt und Rechtsnachweise, dieselbe
    // Sensitivitaet wie der Elternkontakt aus Paket 014 -- ebenfalls nicht bei team_manager.
    'consent.manage',
  ]),
  editor: new Set(['post.create', 'post.edit', 'post.submit', 'analytics.view']),
  approver: new Set(['post.approve', 'analytics.view']),
  contributor: new Set(['post.create', 'post.submit']),
  viewer: new Set(['analytics.view']),
  team_manager: new Set([
    'post.create',
    'post.edit',
    'post.submit',
    'analytics.view',
    'member.invite',
    'member.remove',
    // Paket 013: eigenes Mannschaftsbranding verwalten.
    'brand.manage',
    // Paket 014: Mitgliederverzeichnis der eigenen Mannschaft lesen.
    'directory.read',
  ]),
}

// Paket 051: jede Permission gehoert genau einem Modul oder dem Rahmen ('core'). requirePermission
// prueft damit zusaetzlich, ob das Modul im Ziel-Scope aktiv ist. Die Modulschluessel spiegeln
// public.app_module (Migration 2026100602_app_modules.sql) und appModules in packages/domain --
// dieses Paket haengt bewusst von keinem anderen ab, ein Test in apps/api haelt die Listen
// deckungsgleich. Record<Permission, ...> erzwingt zur Kompilierzeit, dass keine Permission fehlt.
export type PermissionModule = 'core' | 'social_media' | 'playerboard'
export const permissionModule: Readonly<Record<Permission, PermissionModule>> = {
  'organization.manage': 'core',
  'department.manage': 'core',
  'team.manage': 'core',
  'member.invite': 'core',
  'member.remove': 'core',
  'brand.manage': 'core',
  'billing.manage': 'core',
  'directory.read': 'core',
  'integration.manage': 'core',
  'fixture.manage': 'core',
  'event.manage': 'core',
  'consent.manage': 'core',
  'post.create': 'social_media',
  'post.edit': 'social_media',
  'post.submit': 'social_media',
  'post.approve': 'social_media',
  'post.publish': 'social_media',
  'social_account.manage': 'social_media',
  'analytics.view': 'social_media',
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => rolePermissions[role].has(permission))
}

// Rang je Rolle fuer den Eskalationsschutz (Paket 010): niemand darf eine Rolle vergeben,
// die maechtiger ist als die eigene. Muss zusammen mit authz.role_rank() in
// supabase/migrations/2026080601_structure_and_invitations.sql angepasst werden -- die
// Permission-Listen oben sind schon heute zwischen TS und SQL dupliziert, dies folgt
// demselben, im Projekt etablierten Muster.
const roleRank: Readonly<Record<Role, number>> = {
  organization_owner: 100,
  organization_admin: 90,
  department_admin: 50,
  team_manager: 40,
  social_manager: 30,
  billing_admin: 30,
  editor: 20,
  approver: 20,
  contributor: 10,
  organization_viewer: 5,
  viewer: 5,
}

function actorMaxRank(actorRoles: readonly Role[]): number {
  return actorRoles.reduce((max, actorRole) => Math.max(max, roleRank[actorRole]), 0)
}

// organization_owner ist nie ueber diesen Weg vergebbar, nur uebertragbar (ausserhalb dieses
// Pakets). actorRoles muss bereits auf den Zielscope beschraenkt sein (siehe rolesForScope in
// apps/api/src/auth.ts), sonst kaskadieren Rollen aus falschen Scopes in den Rang ein.
export function canAssignRole(actorRoles: readonly Role[], role: Role): boolean {
  if (role === 'organization_owner') return false
  return roleRank[role] <= actorMaxRank(actorRoles)
}

// Eskalationsschutz gilt auch beim Entfernen/Herabstufen, nicht nur beim Vergeben: sonst
// koennte z. B. ein organization_admin (Rang 90) einen organization_owner (Rang 100) entfernen
// oder degradieren, obwohl canAssignRole eine Neuzuweisung von organization_owner korrekt
// verweigert -- die Luecke war, dass DELETE/PATCH nie gegen die AKTUELLE Rolle des Ziels
// prueften. Anders als canAssignRole gibt es hier keine organization_owner-Ausnahme: ein
// organization_owner darf einen anderen organization_owner entfernen (Rang 100 <= 100).
export function canRemoveRole(actorRoles: readonly Role[], targetRole: Role): boolean {
  return roleRank[targetRole] <= actorMaxRank(actorRoles)
}
