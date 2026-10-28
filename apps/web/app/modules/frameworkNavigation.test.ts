import type { Role } from '@vereinsfunk/authorization'
import { describe, expect, it } from 'vitest'
import { frameworkNavigation, visibleFrameworkNavigation } from './frameworkNavigation'
import { anchorScopes, canUsePermission, type MembershipScopeLike } from './registry'

const ORG = '10000000-1000-4000-8000-000000000001'
const DEPT = '10000000-1100-4000-8000-000000000001'
const TEAM = '10000000-1200-4000-8000-000000000001'

/** Sichtbare Eintraege fuer Rollen auf Verein, Abteilung oder Mannschaft im gewaehlten Arbeitsbereich. */
function labelsFor(roles: { organization?: Role[]; department?: Role[]; team?: Role[] }, options: { inDepartment?: boolean; socialMedia?: boolean } = {}) {
  const membership: MembershipScopeLike = {
    organizationId: ORG,
    organizationRoles: roles.organization ?? [],
    departments: [{ id: DEPT, roles: roles.department ?? [], teams: [{ id: TEAM, roles: roles.team ?? [] }] }],
  }
  const anchors = anchorScopes(membership, { organizationId: ORG, departmentId: options.inDepartment ? DEPT : null })
  return visibleFrameworkNavigation(frameworkNavigation, {
    inDepartment: options.inDepartment ?? false,
    canUse: (permission) => canUsePermission(null, anchors, permission),
    isModuleVisible: () => options.socialMedia ?? true,
  }).map((item) => item.label)
}

describe('framework navigation', () => {
  it('declares the required permission for every framework navigation link', () => {
    expect(frameworkNavigation.every((item) => item.permissions.length > 0)).toBe(true)
  })

  it('shows a player nothing to manage', () => {
    expect(labelsFor({ team: ['player'] })).toEqual([])
  })

  it('shows a coach the pages of the own team', () => {
    expect(labelsFor({ team: ['team_manager'] })).toEqual(['Marke', 'Verzeichnis'])
  })

  it('hides the organization-wide member page from a department admin', () => {
    expect(labelsFor({ department: ['department_admin'] })).toEqual([
      'Marke', 'Struktur', 'Verzeichnis', 'Einwilligungen', 'Integrationen', 'Module', 'Einstellungen',
    ])
  })

  it('hides the organization-wide member page from a department and team lead without an organization role', () => {
    expect(labelsFor({ department: ['department_admin'], team: ['team_manager'] })).not.toContain('Mitglieder')
  })

  it('keeps the organization-wide member page visible to an organization admin', () => {
    expect(labelsFor({ organization: ['organization_admin'] })).toContain('Mitglieder')
  })

  it('shows the owner everything in the organization working area and hides organization-only pages in a department', () => {
    expect(labelsFor({ organization: ['organization_owner'] })).toEqual(frameworkNavigation.map((item) => item.label))
    expect(labelsFor({ organization: ['organization_owner'] }, { inDepartment: true })).not.toContain('Tarif')
  })

  it('hides the post policies when social media is not visible', () => {
    expect(labelsFor({ organization: ['organization_owner'] }, { socialMedia: false })).not.toContain('Einstellungen')
  })

  it('shows a billing admin only the plan', () => {
    expect(labelsFor({ organization: ['billing_admin'] })).toEqual(['Tarif'])
  })
})
