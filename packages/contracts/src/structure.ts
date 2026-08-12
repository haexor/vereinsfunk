import { z } from 'zod'
import { UuidSchema } from './content.js'

// Abteilungen, Teams, Mitgliedschaften und Einladungen (Paket 010).
export const ScopeLevelSchema = z.enum(['organization', 'department', 'team'])
// Jede Rolle, die in organization_memberships/department_memberships/team_memberships
// tatsaechlich vorkommen kann -- inklusive organization_owner, das nur lesend auftaucht.
export const RoleSchema = z.enum([
  'organization_owner', 'organization_admin', 'social_manager', 'billing_admin', 'organization_viewer',
  'department_admin', 'editor', 'approver', 'contributor', 'viewer', 'team_manager',
])
// organization_owner ist nie ueber diese Schemas vergebbar -- nur einladbar/zuweisbar sind
// die uebrigen Rollen (siehe invitations_role_matches_scope und authz.can_assign_role in
// 2026080601_structure_and_invitations.sql, sowie canAssignRole in packages/authorization).
export const AssignableRoleSchema = z.enum([
  'organization_admin', 'social_manager', 'billing_admin', 'organization_viewer',
  'department_admin', 'editor', 'approver', 'contributor', 'viewer', 'team_manager',
])

export const DepartmentSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})
export const CreateDepartmentRequestSchema = z.object({ name: z.string().trim().min(1).max(120) })
export const UpdateDepartmentRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.archived !== undefined, { message: 'at least one field must be provided' })

export const TeamSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  name: z.string().min(1),
  // Paket 019: Herkunft und Merkmale, die fuer Inhalte zaehlen. Nur der Sync-Codepfad (Service
  // Role) schreibt sie -- keine Oberflaeche in diesem Paket setzt sie manuell, siehe Migration
  // 2026080704_fixtures_and_events.sql.
  ageGroup: z.string().nullable().optional(),
  competition: z.string().nullable().optional(),
  sourceId: UuidSchema.nullable().optional(),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})
export const CreateTeamRequestSchema = z.object({ name: z.string().trim().min(1).max(120) })
export const UpdateTeamRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.archived !== undefined, { message: 'at least one field must be provided' })

// Einzige Quelle fuer "welche Rolle passt zu welcher Scope-Ebene" -- von
// CreateMembershipRequestSchema, CreateInvitationRequestSchema (unten) und apps/api (fuer
// UpdateMembershipRequestSchema, das scope nicht im Body traegt) gemeinsam genutzt, damit diese
// Zuordnung nicht an drei Stellen unabhaengig voneinander gepflegt wird (siehe invitations_role_matches_scope
// in 2026080601_structure_and_invitations.sql fuer das SQL-Gegenstueck).
export const ORGANIZATION_SCOPED_ROLES: readonly AssignableRole[] = ['organization_admin', 'social_manager', 'billing_admin', 'organization_viewer']
export const DEPARTMENT_SCOPED_ROLES: readonly AssignableRole[] = ['department_admin', 'editor', 'approver', 'contributor', 'viewer']
export const TEAM_SCOPED_ROLES: readonly AssignableRole[] = ['team_manager', 'contributor', 'viewer']
export function rolesForScopeLevel(scope: ScopeLevel): readonly AssignableRole[] {
  return scope === 'organization' ? ORGANIZATION_SCOPED_ROLES : scope === 'department' ? DEPARTMENT_SCOPED_ROLES : TEAM_SCOPED_ROLES
}

export type ScopeLevel = z.infer<typeof ScopeLevelSchema>
export type AssignableRole = z.infer<typeof AssignableRoleSchema>
export type Department = z.infer<typeof DepartmentSchema>
export type CreateDepartmentRequest = z.infer<typeof CreateDepartmentRequestSchema>
export type UpdateDepartmentRequest = z.infer<typeof UpdateDepartmentRequestSchema>
export type Team = z.infer<typeof TeamSchema>
export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>
export type UpdateTeamRequest = z.infer<typeof UpdateTeamRequestSchema>
