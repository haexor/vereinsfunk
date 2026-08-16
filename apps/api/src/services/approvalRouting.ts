import { hasPermission } from '@vereinsfunk/authorization'
import { resolveReviewers, type MembershipRecord, type ReviewerRef as DomainReviewerRef, type StageDefinition } from '@vereinsfunk/domain'
import type { ScopeLevel } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows, notExpiredFilter, ownPolicyRuleRow, type PolicyRuleRows } from '../routes/shared.js'

// Wer darf eine Freigabestufe entscheiden -- die Aufloesung von Rollen und benannten Prueferinnen
// zu konkreten userIds. Ohne Fastify-Bezug, damit routes/policies.ts und routes/approvals.ts
// dieselbe Fassung benutzen.


// "any_with_permission" ist keine feste Namensliste, sondern jede Person, die JETZT die
// Berechtigung im Scope haelt (Plan 011, "Fachliches Modell") -- einschliesslich der aeusseren
// Ebenen: authz.has_team_permission faellt auf has_department_permission zurueck, dieses auf
// has_organization_permission. Eine Abteilungsstufe darf deshalb auch die Vereinsleitung
// entscheiden, eine Teamstufe die Freigabeberechtigten der Elternabteilung. Ohne diese Kaskade
// blieb der Pruefkreis einer Abteilung ohne eigene "approver"-Rolle leer, und resolveReviewRoute
// meldete einen empty_reviewer_pool-Blocker (422) fuer eine Konfiguration, die tatsaechlich
// erfuellbar ist -- der Normalfall in einem kleinen Verein, in dem nur die Vereinsleitung
// freigibt (beim eigenen Review dieses Pakets gefunden).
export const ORG_ROLES_WITH_APPROVE = (['organization_owner', 'organization_admin', 'social_manager', 'billing_admin', 'organization_viewer'] as const).filter((role) => hasPermission([role], 'post.approve'))
export const DEPARTMENT_ROLES_WITH_APPROVE = (['department_admin', 'editor', 'approver', 'contributor', 'viewer'] as const).filter((role) => hasPermission([role], 'post.approve'))
export const TEAM_ROLES_WITH_APPROVE = (['team_manager', 'contributor', 'viewer'] as const).filter((role) => hasPermission([role], 'post.approve'))

export async function membersWithApprovePermission(
  client: SupabaseClient, organizationId: string, scope: ScopeLevel, departmentId: string | null, teamId: string | null,
): Promise<string[]> {
  const notExpired = notExpiredFilter()
  // Ueber fetchAllRows wie GET /v1/organizations/:id/members: max_rows=1000 wuerde den
  // Prueferkreis eines grossen Vereins still abschneiden und einzelne Berechtigte aus dem
  // eingefrorenen reviewer_snapshot fallen lassen.
  const pages = [
    ...(ORG_ROLES_WITH_APPROVE.length > 0
      ? [fetchAllRows<{ user_id: string }>((from, to) =>
          client.from('organization_memberships').select('user_id').eq('organization_id', organizationId).in('role', ORG_ROLES_WITH_APPROVE).or(notExpired).order('id', { ascending: true }).range(from, to),
        )]
      : []),
    ...(scope !== 'organization' && DEPARTMENT_ROLES_WITH_APPROVE.length > 0
      ? [fetchAllRows<{ user_id: string }>((from, to) =>
          client.from('department_memberships').select('user_id').eq('department_id', departmentId!).in('role', DEPARTMENT_ROLES_WITH_APPROVE).or(notExpired).order('id', { ascending: true }).range(from, to),
        )]
      : []),
    ...(scope === 'team' && TEAM_ROLES_WITH_APPROVE.length > 0
      ? [fetchAllRows<{ user_id: string }>((from, to) =>
          client.from('team_memberships').select('user_id').eq('team_id', teamId!).in('role', TEAM_ROLES_WITH_APPROVE).or(notExpired).order('id', { ascending: true }).range(from, to),
        )]
      : []),
  ]
  const userIds = new Set<string>()
  for (const rows of await Promise.all(pages)) {
    for (const row of rows) userIds.add(row.user_id)
  }
  return Array.from(userIds)
}

// Minderjaehrige-Verfasser:in-Stufe (Nutzerentscheidung 2026-08-16, feste Plattformregel): braucht
// den service-role-Client, nicht den Aufrufer-Client -- directory_people verlangt directory.read
// (siehe RLS-Policy, 2026080703), das eine einreichende Person mit blosser post.submit-Rolle
// (z. B. contributor) i.d.R. nicht haelt. Ein RLS-gefilterter leerer Treffer wuerde die
// Vorschaupruefung faelschlich "nicht minderjaehrig" lesen lassen -- die SQL-seitige
// authz.resolve_review_route ist ohnehin die massgebliche Quelle, aber die Client-Vorschau soll
// denselben Befund liefern.
export async function isAuthorMinor(client: SupabaseClient, organizationId: string, profileId: string): Promise<boolean> {
  const adults = await filterAdultUserIds(client, organizationId, [profileId])
  return adults.length === 0
}

// Schraenkt eine Liste von userIds auf Personen ein, die laut Vereinsverzeichnis NICHT selbst
// minderjaehrig sind -- "mindestens ein Erwachsener muss freigeben" waere sonst durch eine
// minderjaehrige Person mit Vereinsrolle unterlaufbar (das Rollenmodell schliesst das
// organisatorisch nicht aus).
export async function filterAdultUserIds(client: SupabaseClient, organizationId: string, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const minors = await client.from('directory_people').select('profile_id').eq('organization_id', organizationId).eq('is_minor', true).in('profile_id', userIds as string[])
  if (minors.error) throw minors.error
  const minorProfileIds = new Set(minors.data.map((row) => row.profile_id).filter((id): id is string => id !== null))
  return userIds.filter((id) => !minorProfileIds.has(id))
}

export function mapReviewerRow(row: { kind: string; user_id: string | null; role: string | null; target_department_id: string | null; target_team_id: string | null }): DomainReviewerRef {
  if (row.kind === 'user') return { kind: 'user', userId: row.user_id! }
  if (row.kind === 'organization_role') return { kind: 'organization_role', role: row.role! }
  if (row.kind === 'department_role') return { kind: 'department_role', departmentId: row.target_department_id!, role: row.role! }
  return { kind: 'team_role', departmentId: row.target_department_id!, teamId: row.target_team_id!, role: row.role! }
}

// Grundlage der Prueferauflösung fuer "named"-Stufen -- eine abgelaufene Mitgliedschaft traegt
// keine Rolle mehr und darf deshalb nicht als Pruefer in den reviewer_snapshot einfrieren.
// request_approval wuerde eine solche Route ohnehin mit invalid_reviewer_snapshot ablehnen, weil
// authz.is_user_member_of_organization dort denselben Ablauffilter anwendet.
export async function fetchAllMemberships(client: SupabaseClient, organizationId: string): Promise<MembershipRecord[]> {
  const notExpired = notExpiredFilter()
  // fetchAllRows aus demselben Grund wie in membersWithApprovePermission: eine benannte Rolle
  // duerfte in einem grossen Verein nicht daran scheitern, dass die Mitgliederseite abgeschnitten ist.
  const [orgRows, deptRows, teamRows] = await Promise.all([
    fetchAllRows<{ user_id: string; role: string }>((from, to) =>
      client.from('organization_memberships').select('user_id, role').eq('organization_id', organizationId).or(notExpired).order('id', { ascending: true }).range(from, to),
    ),
    fetchAllRows<{ user_id: string; role: string; department_id: string }>((from, to) =>
      client.from('department_memberships').select('user_id, role, department_id').eq('organization_id', organizationId).or(notExpired).order('id', { ascending: true }).range(from, to),
    ),
    fetchAllRows<{ user_id: string; role: string; team_id: string; department_id: string }>((from, to) =>
      client.from('team_memberships').select('user_id, role, team_id, department_id').eq('organization_id', organizationId).or(notExpired).order('id', { ascending: true }).range(from, to),
    ),
  ])
  return [
    ...orgRows.map((row) => ({ userId: row.user_id, scope: 'organization' as const, role: row.role })),
    ...deptRows.map((row) => ({ userId: row.user_id, scope: 'department' as const, departmentId: row.department_id, role: row.role })),
    ...teamRows.map((row) => ({ userId: row.user_id, scope: 'team' as const, departmentId: row.department_id, teamId: row.team_id, role: row.role })),
  ]
}

export const DEFAULT_STAGE_LABEL: Record<ScopeLevel, string> = { organization: 'Verein', department: 'Abteilung', team: 'Team' }

// Baut die Stufendefinitionen innen (Team) nach aussen (Verein) -- nur Ebenen, deren EIGENE
// Zeile review_required = true setzt, tragen eine Stufe bei (Plan 011: additiv, nicht vererbt).
export async function buildStageDefinitions(
  client: SupabaseClient, ruleRows: PolicyRuleRows, organizationId: string, departmentId: string, teamId: string | null,
): Promise<StageDefinition[]> {
  const levels: { scope: ScopeLevel; scopeId: string; scopeDepartmentId: string | null; scopeTeamId: string | null }[] = [
    ...(teamId ? [{ scope: 'team' as const, scopeId: teamId, scopeDepartmentId: departmentId, scopeTeamId: teamId }] : []),
    { scope: 'department' as const, scopeId: departmentId, scopeDepartmentId: departmentId, scopeTeamId: null },
    { scope: 'organization' as const, scopeId: organizationId, scopeDepartmentId: null, scopeTeamId: null },
  ]
  const memberships = await fetchAllMemberships(client, organizationId)
  const stages: StageDefinition[] = []
  for (const level of levels) {
    const row = ownPolicyRuleRow(ruleRows, level.scope, level.scopeDepartmentId, level.scopeTeamId)
    if (!row?.review_required) continue
    const mode = row.review_mode ?? 'any_with_permission'
    let reviewerUserIds: string[]
    if (mode === 'named') {
      const reviewerRows = await client.from('policy_reviewers').select('kind, user_id, role, target_department_id, target_team_id').eq('policy_settings_id', row.id)
      if (reviewerRows.error) throw reviewerRows.error
      reviewerUserIds = resolveReviewers(reviewerRows.data.map(mapReviewerRow), memberships).userIds
    } else {
      reviewerUserIds = await membersWithApprovePermission(client, organizationId, level.scope, level.scopeDepartmentId, level.scopeTeamId)
    }
    stages.push({
      scope: level.scope,
      ...(level.scopeDepartmentId ? { scopeDepartmentId: level.scopeDepartmentId } : {}),
      ...(level.scopeTeamId ? { scopeTeamId: level.scopeTeamId } : {}),
      label: row.review_stage_label ?? DEFAULT_STAGE_LABEL[level.scope],
      mode,
      minimumApprovals: row.review_minimum_approvals ?? 1,
      ...(row.review_deadline_hours ? { deadlineHours: row.review_deadline_hours } : {}),
      reviewerUserIds,
    })
  }
  return stages
}
