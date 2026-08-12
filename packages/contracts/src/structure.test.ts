import { describe, expect, it } from 'vitest'
import { ContentSuggestionSchema, CreateInvitationRequestSchema, CreateMembershipRequestSchema, DepartmentSchema, InvitationSchema, MemberRoleEntrySchema, PolicySettingSchema, TeamSchema, UpdateDepartmentRequestSchema, UpdateMembershipExpiryRequestSchema, UpdatePolicySettingRequestSchema } from './index.js'
import { department, org, team } from './testFixtures.js'

describe('structure and invitation contracts', () => {
  it('rejects an empty department update payload', () => {
    expect(UpdateDepartmentRequestSchema.safeParse({}).success).toBe(false)
  })

  it('accepts archiving alone, without a name change', () => {
    expect(UpdateDepartmentRequestSchema.safeParse({ archived: true }).success).toBe(true)
  })

  // Gegenstueck zum Fall darunter: das ist die Payload-Form, die pages/mitglieder.vue senden
  // muss -- teamId allein liess jede Team-Einladung aus der Oberflaeche an dieser Regel scheitern.
  it('accepts a team-scoped invitation that carries both departmentId and teamId', () => {
    expect(
      CreateInvitationRequestSchema.safeParse({
        organizationId: org,
        departmentId: department,
        teamId: team,
        email: 'person@example.com',
        role: 'team_manager',
      }).success,
    ).toBe(true)
  })

  it('rejects a team-scoped invitation without a departmentId', () => {
    expect(
      CreateInvitationRequestSchema.safeParse({
        organizationId: org,
        teamId: department,
        email: 'person@example.com',
        role: 'team_manager',
      }).success,
    ).toBe(false)
  })

  it('rejects a role that does not match the invitation scope', () => {
    expect(
      CreateInvitationRequestSchema.safeParse({
        organizationId: org,
        email: 'person@example.com',
        role: 'department_admin',
      }).success,
    ).toBe(false)
    expect(
      CreateInvitationRequestSchema.safeParse({
        organizationId: org,
        departmentId: department,
        email: 'person@example.com',
        role: 'organization_admin',
      }).success,
    ).toBe(false)
  })

  it('accepts a scope-consistent invitation', () => {
    expect(
      CreateInvitationRequestSchema.safeParse({
        organizationId: org,
        departmentId: department,
        email: 'Person@Example.com',
        role: 'editor',
      }).success,
    ).toBe(true)
  })

  it('never validates organization_owner as an assignable role', () => {
    expect(
      CreateInvitationRequestSchema.safeParse({
        organizationId: org,
        email: 'person@example.com',
        role: 'organization_owner',
      }).success,
    ).toBe(false)
  })

  // Regression: same class of bug as the platform administration schemas -- invitations carry
  // four independent timestamptz columns, all fed directly by PostgREST.
  it('accepts PostgREST-shaped timestamps on every invitation datetime field', () => {
    const offsetTimestamp = '2026-08-05T12:34:56.789+00:00'
    expect(
      InvitationSchema.safeParse({
        id: org,
        organizationId: org,
        departmentId: department,
        teamId: null,
        email: 'person@example.com',
        role: 'editor',
        invitedBy: org,
        expiresAt: offsetTimestamp,
        acceptedAt: offsetTimestamp,
        revokedAt: null,
        lastSentAt: offsetTimestamp,
        sendCount: 1,
        createdAt: offsetTimestamp,
      }).success,
    ).toBe(true)
  })

  it('still accepts a false archived flag, not just true', () => {
    expect(UpdateDepartmentRequestSchema.safeParse({ archived: false }).success).toBe(true)
  })

  // Regression: same offset:true class of bug as InvitationSchema above, for the other two
  // Paket 010 schemas fed directly by real timestamptz columns.
  it('accepts PostgREST-shaped timestamps on DepartmentSchema and TeamSchema', () => {
    const offsetTimestamp = '2026-08-05T12:34:56.789+00:00'
    expect(
      DepartmentSchema.safeParse({ id: org, organizationId: org, name: 'Fussball', slug: 'fussball', archivedAt: offsetTimestamp, createdAt: offsetTimestamp })
        .success,
    ).toBe(true)
    expect(
      TeamSchema.safeParse({
        id: org, organizationId: org, departmentId: department, name: 'Team A',
        ageGroup: null, competition: null, sourceId: null, archivedAt: null, createdAt: offsetTimestamp,
      }).success,
    ).toBe(true)
  })

  // Paket 019 fuegte ageGroup/competition/sourceId hinzu -- ein Payload aus der Zeit davor
  // (bzw. ein anderer Aufrufer, der diese Schluessel nicht mitgibt) muss weiterhin parsen.
  it('accepts a TeamSchema payload without the Paket-019 ageGroup/competition/sourceId keys', () => {
    expect(
      TeamSchema.safeParse({
        id: org, organizationId: org, departmentId: department, name: 'Team A', archivedAt: null, createdAt: '2026-08-05T12:34:56Z',
      }).success,
    ).toBe(true)
  })

  it('requires a fixtureId on a fixture-kind content suggestion and rejects a mismatched clubEventId', () => {
    expect(ContentSuggestionSchema.safeParse({ kind: 'fixture_announcement', label: 'x', departmentId: department, fixtureId: team }).success).toBe(true)
    expect(ContentSuggestionSchema.safeParse({ kind: 'fixture_result', label: 'x', departmentId: department }).success).toBe(false)
    expect(ContentSuggestionSchema.safeParse({ kind: 'fixture_announcement', label: 'x', departmentId: department, clubEventId: team }).success).toBe(false)
  })

  it('requires a clubEventId on an event_invitation suggestion and permits neither on a quota_reminder', () => {
    expect(ContentSuggestionSchema.safeParse({ kind: 'event_invitation', label: 'x', departmentId: department, clubEventId: team }).success).toBe(true)
    expect(ContentSuggestionSchema.safeParse({ kind: 'event_invitation', label: 'x', departmentId: department }).success).toBe(false)
    expect(ContentSuggestionSchema.safeParse({ kind: 'quota_reminder', label: 'x', departmentId: department }).success).toBe(true)
    expect(ContentSuggestionSchema.safeParse({ kind: 'quota_reminder', label: 'x', departmentId: department, fixtureId: team }).success).toBe(false)
  })

  it('accepts a PostgREST-shaped expiresAt on MemberRoleEntrySchema', () => {
    expect(
      MemberRoleEntrySchema.safeParse({
        membershipId: org,
        scope: 'department',
        scopeId: department,
        role: 'editor',
        expiresAt: '2026-08-05T12:34:56.789+00:00',
        canChangeRole: true,
        canRemove: true,
        canSetExpiry: true,
      }).success,
    ).toBe(true)
  })

  // Regression: organization_owner is a valid MemberRoleEntrySchema role only for
  // scope: 'organization' -- department_memberships/team_memberships cannot hold it at the
  // database level at all, so a department-scoped entry with this role can never be real data.
  it('rejects organization_owner for a department-scoped member role entry', () => {
    expect(
      MemberRoleEntrySchema.safeParse({
        membershipId: org,
        scope: 'department',
        scopeId: department,
        role: 'organization_owner',
        expiresAt: null,
        canChangeRole: false,
        canRemove: false,
        canSetExpiry: false,
      }).success,
    ).toBe(false)
  })

  it('accepts organization_owner for an organization-scoped member role entry', () => {
    expect(
      MemberRoleEntrySchema.safeParse({
        membershipId: org,
        scope: 'organization',
        scopeId: org,
        role: 'organization_owner',
        expiresAt: null,
        canChangeRole: false,
        canRemove: false,
        canSetExpiry: false,
      }).success,
    ).toBe(true)
  })

  it('rejects an organization-level role for a department-scoped membership', () => {
    expect(CreateMembershipRequestSchema.safeParse({ scope: 'department', scopeId: department, userId: org, role: 'organization_admin' }).success).toBe(
      false,
    )
  })

  it('accepts a scope-consistent membership request', () => {
    expect(CreateMembershipRequestSchema.safeParse({ scope: 'department', scopeId: department, userId: org, role: 'editor' }).success).toBe(true)
  })
})

describe('policy settings contracts (Paket 023)', () => {
  it('accepts a policy setting with a locked, inherited flag and an editable, overridden one', () => {
    expect(
      PolicySettingSchema.safeParse({
        scope: 'department',
        scopeId: department,
        name: 'Fussball',
        inviteAllowed: { effective: false, ownValue: null, lockedByAncestor: true, canEdit: false },
        postsVisibleOrgWide: { effective: false, ownValue: false, lockedByAncestor: false, canEdit: true },
      }).success,
    ).toBe(true)
  })

  it('rejects an unknown policy flag before it reaches the database', () => {
    expect(
      UpdatePolicySettingRequestSchema.safeParse({ scope: 'department', scopeId: department, flag: 'analytics_visible', value: false }).success,
    ).toBe(false)
  })

  it('accepts a null value to clear an override back to "erben"', () => {
    expect(
      UpdatePolicySettingRequestSchema.safeParse({ scope: 'team', scopeId: team, flag: 'invite_allowed', value: null }).success,
    ).toBe(true)
  })
})

describe('membership expiry contract (Paket 023)', () => {
  it('accepts a PostgREST-shaped expiresAt', () => {
    expect(UpdateMembershipExpiryRequestSchema.safeParse({ expiresAt: '2026-08-05T12:34:56.789+00:00' }).success).toBe(true)
  })

  it('accepts null to clear an expiry', () => {
    expect(UpdateMembershipExpiryRequestSchema.safeParse({ expiresAt: null }).success).toBe(true)
  })

  it('rejects a plain date without a time component', () => {
    expect(UpdateMembershipExpiryRequestSchema.safeParse({ expiresAt: '2026-08-05' }).success).toBe(false)
  })
})

