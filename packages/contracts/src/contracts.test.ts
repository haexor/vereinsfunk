import { describe, expect, it } from 'vitest'
import {
  AddPlatformAdminRequestSchema,
  CreateInvitationRequestSchema,
  CreateMembershipRequestSchema,
  CreateSubmissionSchema,
  DepartmentSchema,
  GeneratedPostSchema,
  InvitationSchema,
  MemberRoleEntrySchema,
  OnboardingStateSchema,
  OrganizationProfileUpdateSchema,
  PlatformAdminOrganizationSummarySchema,
  PlatformAdminSchema,
  PlatformSettingKeySchema,
  PlatformSettingSchema,
  PlatformSettingValueSchemas,
  TeamSchema,
  UpdateDepartmentRequestSchema,
} from './index.js'

const org = '11111111-1111-4111-8111-111111111111'
const department = '22222222-2222-4222-8222-222222222222'

describe('contracts', () => {
  it('rejects an invalid tenant boundary', () => {
    expect(() =>
      CreateSubmissionSchema.parse({
        organizationId: 'not-an-id',
        departmentId: department,
        presetSlug: 'event',
        communicationGoal: 'inform',
        requestedFormats: ['feed_image'],
        sourceMaterial: { facts: {}, observations: ['Sommerfest'], quotes: [], doNotMention: [] },
      }),
    ).toThrow()
  })

  it('applies safe submission defaults', () => {
    const result = CreateSubmissionSchema.parse({
      organizationId: org,
      departmentId: department,
      presetSlug: 'event',
      communicationGoal: 'invite',
      requestedFormats: ['feed_image'],
      sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [], doNotMention: [] },
    })
    expect(result.priority).toBe(40)
    expect(result.sourceRevision).toBe(1)
  })

  it('limits generated hashtags', () => {
    const base = {
      verifiedFacts: [],
      missingFacts: [],
      headline: 'Titel',
      caption: 'Text',
      shortCaption: 'Text',
      callToAction: 'Komm vorbei',
      altText: 'Motiv',
      templateId: 'event-v1',
      safetyFlags: [],
    }
    expect(GeneratedPostSchema.safeParse({ ...base, hashtags: Array(13).fill('#sport') }).success).toBe(
      false,
    )
  })
})

describe('platform administration contracts', () => {
  it('lowercases and validates admin emails', () => {
    expect(AddPlatformAdminRequestSchema.parse({ email: 'Admin@Example.COM' }).email).toBe('admin@example.com')
    expect(AddPlatformAdminRequestSchema.safeParse({ email: 'not-an-email' }).success).toBe(false)
  })

  it('rejects an unknown platform settings key before it reaches the database', () => {
    expect(PlatformSettingKeySchema.safeParse('unknown_key').success).toBe(false)
    expect(PlatformSettingValueSchemas.max_organizations_per_owner.safeParse(0).success).toBe(false)
    expect(PlatformSettingValueSchemas.max_organizations_per_owner.safeParse(5).success).toBe(true)
    expect(PlatformSettingValueSchemas.max_organizations_per_owner.safeParse(1000).success).toBe(true)
    expect(PlatformSettingValueSchemas.max_organizations_per_owner.safeParse(1001).success).toBe(false)
    expect(PlatformSettingValueSchemas.max_organizations_per_owner.safeParse(1.5).success).toBe(false)
  })

  // Regression: PostgREST serializes timestamptz with a numeric UTC offset (+00:00), not the
  // literal "Z" suffix z.iso.datetime() demands by default -- these three schemas are fed
  // directly by real DB rows and must accept that shape, not just client-constructed dates.
  it('accepts PostgREST-shaped timestamps with a numeric UTC offset, not just a Z suffix', () => {
    const offsetTimestamp = '2026-08-05T12:34:56.789+00:00'
    expect(PlatformAdminSchema.safeParse({ userId: org, isDefaultAdmin: true, createdAt: offsetTimestamp }).success).toBe(true)
    expect(PlatformSettingSchema.safeParse({ key: 'max_organizations_per_owner', value: 3, updatedAt: offsetTimestamp }).success).toBe(true)
    expect(
      PlatformAdminOrganizationSummarySchema.safeParse({
        organizationId: org,
        name: 'SV Nordstadt',
        slug: 'sv-nordstadt',
        memberCount: 1,
        departmentCount: 1,
        createdAt: offsetTimestamp,
      }).success,
    ).toBe(true)
  })
})

describe('onboarding contracts', () => {
  // Regression: organization_onboarding.dismissed_at is a real timestamptz column, serialized
  // by PostgREST with a numeric UTC offset -- same class of bug as the platform administration
  // schemas above, found during Paket 022's adversarial review and fixed here.
  it('accepts a PostgREST-shaped dismissedAt timestamp with a numeric UTC offset', () => {
    expect(
      OnboardingStateSchema.safeParse({
        completedSteps: ['branding'],
        dismissedAt: '2026-08-05T12:34:56.789+00:00',
      }).success,
    ).toBe(true)
  })

  it('still accepts a null dismissedAt', () => {
    expect(OnboardingStateSchema.safeParse({ completedSteps: [], dismissedAt: null }).success).toBe(true)
  })
})

describe('organization profile contracts', () => {
  it('rejects an empty profile update payload', () => {
    expect(OrganizationProfileUpdateSchema.safeParse({}).success).toBe(false)
  })

  it('accepts a profile update with at least one field', () => {
    expect(OrganizationProfileUpdateSchema.safeParse({ legalName: 'Verein e.V.' }).success).toBe(true)
  })
})

describe('structure and invitation contracts', () => {
  it('rejects an empty department update payload', () => {
    expect(UpdateDepartmentRequestSchema.safeParse({}).success).toBe(false)
  })

  it('accepts archiving alone, without a name change', () => {
    expect(UpdateDepartmentRequestSchema.safeParse({ archived: true }).success).toBe(true)
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
      TeamSchema.safeParse({ id: org, organizationId: org, departmentId: department, name: 'Team A', archivedAt: null, createdAt: offsetTimestamp }).success,
    ).toBe(true)
  })

  it('accepts a PostgREST-shaped expiresAt on MemberRoleEntrySchema', () => {
    expect(
      MemberRoleEntrySchema.safeParse({
        membershipId: org,
        scope: 'department',
        scopeId: department,
        role: 'editor',
        expiresAt: '2026-08-05T12:34:56.789+00:00',
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
