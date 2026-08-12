import { z } from 'zod'
import { UuidSchema } from './content.js'
import { AssignableRoleSchema, DEPARTMENT_SCOPED_ROLES, ORGANIZATION_SCOPED_ROLES, RoleSchema, ScopeLevelSchema, TEAM_SCOPED_ROLES, rolesForScopeLevel } from './structure.js'

// Getrennt von UpdateMembershipRequestSchema (Paket 023): eine Befristung zu setzen ist kein
// Rollenwechsel und braucht keine can_assign_role-Pruefung einer neuen Rolle, siehe
// public.set_membership_expiry() in supabase/migrations.
export const UpdateMembershipExpiryRequestSchema = z.object({ expiresAt: z.iso.datetime({ offset: true }).nullable() })

// scopeName ist bewusst nicht Teil dieses Schemas: die Oberflaeche kennt Abteilungs-/Team-Namen
// bereits aus useSession()/useScope() (siehe authz.membership_scopes()) und kann sie ueber
// scope+scopeId nachschlagen, ohne dass dieser Endpunkt sie redundant mitliefern muss.
// Capability-Felder (Paket 023): die Antwort traegt mit, ob DER ANFRAGENDE diese Zeile aendern
// darf -- serverseitig aus denselben Funktionen berechnet, die PATCH/DELETE /v1/memberships auch
// selbst durchsetzen (authz.can_remove_role/can_assign_role via canRemoveRole/canAssignRole). Die
// Oberflaeche zeigt und sendet nur, was hier steht, statt useCan()/canAssignRole ein zweites Mal
// gegen die eigene Rolle herzuleiten -- genau die Doppelherleitung, die im Nachfolge-Review von
// Paket 010 zwei funktionale Fehler verursacht hat.
export const MemberRoleEntrySchema = z.object({
  membershipId: UuidSchema,
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  role: RoleSchema,
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  canChangeRole: z.boolean(),
  canRemove: z.boolean(),
  canSetExpiry: z.boolean(),
}).superRefine((value, context) => {
  // organization_owner ist nie durch AssignableRoleSchema/rolesForScopeLevel abgedeckt (nicht
  // vergebbar), taucht in einer Mitgliederliste fuer scope: 'organization' aber lesend auf --
  // hier deshalb separat erlaubt, sonst wuerde ein echter Vereinsinhaber die Antwort ungueltig
  // machen. Jede andere Rolle/Scope-Kombination ist unmoeglich (department_role/team_role in der
  // Datenbank kennen organization_owner gar nicht) und war vor diesem Check unbemerkt vom Schema
  // akzeptiert worden (beim Review dieses Pakets gefunden).
  const validRoles: readonly string[] = value.scope === 'organization' ? ['organization_owner', ...ORGANIZATION_SCOPED_ROLES] : rolesForScopeLevel(value.scope)
  if (!validRoles.includes(value.role)) {
    context.addIssue({ code: 'custom', message: `role must be one of ${validRoles.join(', ')} for scope "${value.scope}"` })
  }
})
export const MemberSchema = z.object({
  userId: UuidSchema,
  displayName: z.string().min(1),
  roles: z.array(MemberRoleEntrySchema).min(1),
})

export const InvitationSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: AssignableRoleSchema,
  invitedBy: UuidSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  acceptedAt: z.iso.datetime({ offset: true }).nullable(),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
  lastSentAt: z.iso.datetime({ offset: true }),
  sendCount: z.int().min(1).max(10),
  createdAt: z.iso.datetime({ offset: true }),
})
// Die Ebene ergibt sich aus departmentId/teamId -- dieselbe Regel wie invitations_scope_check
// und invitations_role_matches_scope in der Migration, hier vor dem ersten DB-Roundtrip geprueft.
export const CreateInvitationRequestSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable().optional(),
  teamId: UuidSchema.nullable().optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: AssignableRoleSchema,
}).superRefine((value, context) => {
  if (value.teamId && !value.departmentId) {
    context.addIssue({ code: 'custom', message: 'a team-scoped invitation requires departmentId' })
  }
  if (value.teamId && !TEAM_SCOPED_ROLES.includes(value.role)) {
    context.addIssue({ code: 'custom', message: `role must be one of ${TEAM_SCOPED_ROLES.join(', ')} for a team-scoped invitation` })
  } else if (!value.teamId && value.departmentId && !DEPARTMENT_SCOPED_ROLES.includes(value.role)) {
    context.addIssue({ code: 'custom', message: `role must be one of ${DEPARTMENT_SCOPED_ROLES.join(', ')} for a department-scoped invitation` })
  } else if (!value.departmentId && !ORGANIZATION_SCOPED_ROLES.includes(value.role)) {
    context.addIssue({ code: 'custom', message: `role must be one of ${ORGANIZATION_SCOPED_ROLES.join(', ')} for an organization-scoped invitation` })
  }
})
export const AcceptInvitationRequestSchema = z.object({ token: z.string().min(1) })
export const AcceptInvitationResponseSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
  role: AssignableRoleSchema,
})

export type UpdateMembershipExpiryRequest = z.infer<typeof UpdateMembershipExpiryRequestSchema>
export type MemberRoleEntry = z.infer<typeof MemberRoleEntrySchema>
export type Member = z.infer<typeof MemberSchema>
export type Invitation = z.infer<typeof InvitationSchema>
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponseSchema>
