import type { ScopeLevel } from '@vereinsfunk/contracts'
import { canRemoveRole, hasPermission, type Permission, type Role } from '@vereinsfunk/authorization'
import type { SupabaseClient } from '@supabase/supabase-js'
import { permissionScopeKey, type PermissionScope, type RoleProvider } from '../auth.js'
import { notExpiredFilter } from '../supabase.js'

// Scope-Aufloesung und Berechtigungshilfen: fast jedes Route-Modul (Richtlinien/Freigaben, Kanaele,
// Mitglieder/Einladungen, Verzeichnis) loest scope+scopeId oder ein Membership-Tripel auf --
// hier zentral statt in jedem Modul dupliziert.

// Loest scope+scopeId (aus CreateMembershipRequestSchema) in einen PermissionScope auf --
// organizationId muss fuer department/team erst nachgeschlagen werden, damit requirePermission
// und canAssignRole (beide brauchen den vollen Scope-Pfad) korrekt kaskadieren koennen.
export async function resolveMembershipScope(
  client: SupabaseClient,
  scope: ScopeLevel,
  scopeId: string,
): Promise<PermissionScope | null> {
  if (scope === 'organization') return { organizationId: scopeId }
  if (scope === 'department') {
    const department = await client.from('departments').select('organization_id').eq('id', scopeId).maybeSingle()
    if (department.error) throw department.error
    return department.data ? { organizationId: department.data.organization_id as string, departmentId: scopeId } : null
  }
  const team = await client.from('teams').select('organization_id, department_id').eq('id', scopeId).maybeSingle()
  if (team.error) throw team.error
  return team.data ? { organizationId: team.data.organization_id as string, departmentId: team.data.department_id as string, teamId: scopeId } : null
}

// exactOptionalPropertyTypes verbietet departmentId/teamId: undefined -- die Schluessel muessen
// bei Abwesenheit ganz fehlen statt explizit auf undefined gesetzt zu sein.
export function toPermissionScope(organizationId: string, departmentId?: string | null, teamId?: string | null): PermissionScope {
  return { organizationId, ...(departmentId ? { departmentId } : {}), ...(teamId ? { teamId } : {}) }
}

// Loest mehrere Scopes derselben Anfrage in einem Rutsch auf -- ueber RoleProvider.rolesForScopes,
// falls der uebergebene RoleProvider sie implementiert (SupabaseRoleProvider: drei Abfragen statt
// einer je Scope, Plan 031). Faellt sonst auf Promise.all(rolesForScope) zurueck, damit bestehende
// RoleProvider-Testdoubles (nur rolesForScope) unveraendert funktionieren, nur ohne den
// Geschwindigkeitsvorteil. Der Aufrufer indiziert das Ergebnis ueber denselben permissionScopeKey.
export async function resolveRolesForScopes(
  roleProvider: RoleProvider,
  auth: { userId: string; accessToken: string },
  scopes: readonly PermissionScope[],
): Promise<ReadonlyMap<string, readonly Role[]>> {
  if (roleProvider.rolesForScopes) return roleProvider.rolesForScopes(auth, scopes)
  const entries = await Promise.all(scopes.map(async (scope) => [permissionScopeKey(scope), await roleProvider.rolesForScope(auth, scope)] as const))
  return new Map(entries)
}

// departmentId/teamId serverseitig gegen ihre echte organization_id/department_id verifizieren,
// BEVOR irgendeine Berechtigung geprueft wird -- sonst waeren sie client-seitig frei kombinierbar
// (z. B. eine fremde departmentId zu dieser Organisation). Von Verzeichnis, Integration und
// Einwilligung gebraucht; dieselbe Pruefung wie resolveInvitationScope, nur ohne den Anzeigenamen.
export async function resolveDirectoryScope(
  client: SupabaseClient,
  organizationId: string,
  departmentId: string | null,
  teamId: string | null,
): Promise<PermissionScope | null> {
  return (await resolveInvitationScope(client, { organizationId, departmentId, teamId }))?.scope ?? null
}

// Deckt dieselbe Mitgliedschaft ab wie authz.is_any_member_of_organization (RLS-Grundlage von
// policy_settings_select): Organisationsrolle ODER Abteilungs- ODER Teammitgliedschaft, nicht
// nur eine Organisationsrolle wie roleProvider.rolesForScope(..., { organizationId }) allein
// prueft. Von Richtlinien/Freigaben und mehreren noch nicht extrahierten Domaenen (Kanaele,
// Integration, Datenschutz) gebraucht -- deshalb hier statt je Modul dupliziert.
export async function isAnyMemberOfOrganization(client: SupabaseClient, userId: string, organizationId: string): Promise<boolean> {
  const notExpired = notExpiredFilter()
  const [org, department, team] = await Promise.all([
    client.from('organization_memberships').select('id').eq('organization_id', organizationId).eq('user_id', userId).or(notExpired).limit(1),
    client.from('department_memberships').select('id').eq('organization_id', organizationId).eq('user_id', userId).or(notExpired).limit(1),
    client.from('team_memberships').select('id').eq('organization_id', organizationId).eq('user_id', userId).or(notExpired).limit(1),
  ])
  if (org.error) throw org.error
  if (department.error) throw department.error
  if (team.error) throw team.error
  return org.data.length > 0 || department.data.length > 0 || team.data.length > 0
}

// Welche Berechtigung eine Ebene verwaltet -- von Richtlinien, Prueferzuweisungen und
// Kontingenten gleichermassen gebraucht.
export const POLICY_MANAGE_PERMISSION: Record<ScopeLevel, Permission> = {
  organization: 'organization.manage',
  department: 'department.manage',
  team: 'team.manage',
}

// Welche Aktionen der ANFRAGENDE auf einer Mitgliedschaftszeile ausfuehren darf. Die Antwort traegt
// die Rechte mit, statt das Frontend sie zweitens herleiten zu lassen (Paket 023) -- viermal
// wortgleich in routes/members.ts, deshalb hier einmal.
export function membershipCapabilities(actorRoles: readonly Role[], targetRole: Role) {
  const canRemoveTarget = canRemoveRole(actorRoles, targetRole)
  return {
    canChangeRole: hasPermission(actorRoles, 'member.invite') && canRemoveTarget,
    canSetExpiry: hasPermission(actorRoles, 'member.invite') && canRemoveTarget,
    canRemove: hasPermission(actorRoles, 'member.remove') && canRemoveTarget,
  }
}

// POST /v1/invitations nimmt organizationId/departmentId/teamId direkt vom Client entgegen. Zugleich
// der Kern von resolveDirectoryScope (oben). Ungeprueft wuerde requirePermission auf einer Scope-Kette pruefen, die client-seitig frei
// kombinierbar ist (z. B. eine fremde organizationId zusammen mit der eigenen departmentId) --
// beim Mandantentrennung-Review gefunden, dort nur zufaellig durch den FK-Constraint auf
// invitations abgefangen.
export async function resolveInvitationScope(
  client: SupabaseClient,
  input: { organizationId: string; departmentId?: string | null | undefined; teamId?: string | null | undefined },
): Promise<{ scope: PermissionScope; scopeName: string } | null> {
  if (input.teamId) {
    const team = await client.from('teams').select('organization_id, department_id, name').eq('id', input.teamId).maybeSingle()
    if (team.error) throw team.error
    if (!team.data || team.data.organization_id !== input.organizationId || team.data.department_id !== input.departmentId) return null
    return {
      scope: { organizationId: team.data.organization_id as string, departmentId: team.data.department_id as string, teamId: input.teamId },
      scopeName: team.data.name as string,
    }
  }
  if (input.departmentId) {
    const department = await client.from('departments').select('organization_id, name').eq('id', input.departmentId).maybeSingle()
    if (department.error) throw department.error
    if (!department.data || department.data.organization_id !== input.organizationId) return null
    return { scope: { organizationId: department.data.organization_id as string, departmentId: input.departmentId }, scopeName: department.data.name as string }
  }
  return { scope: { organizationId: input.organizationId }, scopeName: '' }
}
