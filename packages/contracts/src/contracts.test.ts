import { describe, expect, it } from 'vitest'
import {
  AddPlatformAdminRequestSchema,
  AnalyticsBreakdownQuerySchema,
  AnalyticsFunnelQuerySchema,
  AnalyticsScopeQuerySchema,
  AnalyticsTimeseriesQuerySchema,
  BrandAssetSchema,
  ConfirmBrandAssetLicenseRequestSchema,
  ContentSuggestionSchema,
  CreateBrandAssetRequestSchema,
  CreateDirectoryPersonRequestSchema,
  CreateIntegrationSourceRequestSchema,
  CreateInvitationRequestSchema,
  CreateCompositionSessionSchema,
  CreateCustomStyleProfileRequestSchema,
  CreateGenerationCommandSchema,
  CreateMembershipRequestSchema,
  CreateSubmissionSchema,
  DepartmentSchema,
  DirectoryPersonSchema,
  GeneratedPostSchema,
  VideoUploadMetadataSchema,
  InvitationSchema,
  MemberRoleEntrySchema,
  OnboardingStateSchema,
  OrganizationBrandUpdateSchema,
  OrganizationProfileUpdateSchema,
  PlatformAdminOrganizationSummarySchema,
  PlatformAdminSchema,
  PlatformSettingKeySchema,
  PlatformSettingSchema,
  PlatformSettingValueSchemas,
  PolicySettingSchema,
  TeamSchema,
  UpdateDepartmentBrandRequestSchema,
  UpdateDepartmentRequestSchema,
  UpdateDirectoryPersonRequestSchema,
  UpdateMembershipExpiryRequestSchema,
  UpdatePolicySettingRequestSchema,
} from './index.js'

const org = '11111111-1111-4111-8111-111111111111'
const department = '22222222-2222-4222-8222-222222222222'
const team = '33333333-3333-4333-8333-333333333333'

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

describe('text workshop contracts', () => {
  const styleRules = {
    sentenceLength: 'short' as const, energy: 3, humour: 'light' as const,
    formality: 'balanced' as const, perspective: 'we' as const,
    bannedPhrases: ['Unvergesslicher Moment'], additionalInstructions: 'Konkrete Details zuerst.',
  }

  it('accepts text/photo/video composition choices but keeps historical reels outside new commands', () => {
    const input = CreateCompositionSessionSchema.parse({
      organizationId: org, departmentId: department, presetSlug: 'event', communicationGoal: 'invite',
      requestedFormats: ['video_post'], sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [], doNotMention: [] },
    })
    expect(input.requestedFormats).toEqual(['video_post'])
    expect(CreateCompositionSessionSchema.safeParse({ ...input, requestedFormats: ['reel'] }).success).toBe(false)
    expect(CreateSubmissionSchema.safeParse({ ...input, requestedFormats: ['reel'] }).success).toBe(true)
  })

  it('requires the supported, bounded upload-video delivery profile', () => {
    const video = { kind: 'video', mimeType: 'video/mp4', byteSize: 1_000_000, width: 1080, height: 608, durationMs: 30_000, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' }
    expect(VideoUploadMetadataSchema.safeParse(video).success).toBe(true)
    expect(VideoUploadMetadataSchema.safeParse({ ...video, videoCodec: 'vp9' }).success).toBe(false)
    expect(VideoUploadMetadataSchema.safeParse({ ...video, durationMs: 180_001 }).success).toBe(false)
  })

  it('only permits attribute-based custom style profiles and bounded revision instructions', () => {
    const profile = { organizationId: org, departmentId: department, teamId: null, slug: 'unser-ton', name: 'Unser Ton', description: 'Warm und konkret', styleRules, avoidRules: ['Floskeln'] }
    expect(CreateCustomStyleProfileRequestSchema.safeParse(profile).success).toBe(true)
    expect(CreateCustomStyleProfileRequestSchema.safeParse({ ...profile, styleRules: { ...styleRules, additionalInstructions: 'Schreibe wie eine bekannte Person' } }).success).toBe(false)
    expect(CreateGenerationCommandSchema.safeParse({ sessionId: org, generationIntent: 'revise', revisionInstruction: 'Bitte kürzer und mit konkretem Termin.' }).success).toBe(true)
    expect(CreateGenerationCommandSchema.safeParse({ sessionId: org, generationIntent: 'revise' }).success).toBe(false)
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

describe('brand contracts (Paket 013)', () => {
  it('requires the full set of color roles, not just the original two', () => {
    expect(
      OrganizationBrandUpdateSchema.safeParse({ primaryColor: '#163a2c', accentColor: '#caff4a', tone: 'nahbar', displayFontKey: 'manrope', bodyFontKey: 'dm_sans' })
        .success,
    ).toBe(false)
  })

  it('accepts a complete organization brand update', () => {
    expect(
      OrganizationBrandUpdateSchema.safeParse({
        primaryColor: '#163a2c',
        accentColor: '#caff4a',
        backgroundColor: '#f6f4ec',
        textColor: '#122820',
        onPrimaryColor: '#ffffff',
        tone: 'nahbar',
        displayFontKey: 'manrope',
        bodyFontKey: 'dm_sans',
      }).success,
    ).toBe(true)
  })

  it('rejects a teamId without a departmentId when creating a brand asset', () => {
    expect(CreateBrandAssetRequestSchema.safeParse({ organizationId: org, teamId: team, kind: 'wordmark' }).success).toBe(false)
  })

  it('accepts a department-scoped brand asset request', () => {
    expect(CreateBrandAssetRequestSchema.safeParse({ organizationId: org, departmentId: department, kind: 'logo_mark' }).success).toBe(true)
  })

  it('rejects an unconfirmed license', () => {
    expect(ConfirmBrandAssetLicenseRequestSchema.safeParse({ licenseHolder: 'Verein', confirmed: false }).success).toBe(false)
  })

  it('rejects a brand asset kind outside the enum', () => {
    expect(BrandAssetSchema.safeParse({
      id: org,
      organizationId: org,
      departmentId: null,
      teamId: null,
      kind: 'banner',
      objectPath: 'organizations/x/brand/y.png',
      mimeType: 'image/png',
      byteSize: 100,
      width: null,
      height: null,
      fontFamily: null,
      fontWeight: null,
      fontStyle: null,
      licenseHolder: null,
      licenseNote: null,
      licenseConfirmedAt: null,
      status: 'ready',
      rejectionReason: null,
      createdAt: '2026-08-07T00:00:00.000+00:00',
    }).success).toBe(false)
  })

  it('caps lockedFields at the number of overridable brand fields', () => {
    expect(UpdateDepartmentBrandRequestSchema.safeParse({ lockedFields: Array.from({ length: 12 }, (_, i) => `field-${i}`) }).success).toBe(false)
  })

  it('rejects a lockedFields entry that is not an overridable brand field', () => {
    // Ein Tippfehler waere sonst gespeichert worden und haette lautlos nichts gesperrt.
    expect(UpdateDepartmentBrandRequestSchema.safeParse({ lockedFields: ['primary_colour'] }).success).toBe(false)
    // displayFontKey/bodyFontKey fuehrt keine untere Ebene -- eine Sperre darauf waere wirkungslos.
    expect(UpdateDepartmentBrandRequestSchema.safeParse({ lockedFields: ['displayFontKey'] }).success).toBe(false)
  })

  it('accepts the overridable brand fields as lockedFields', () => {
    expect(
      UpdateDepartmentBrandRequestSchema.safeParse({
        lockedFields: ['primaryColor', 'accentColor', 'tone', 'logoAssetId', 'displayFontAssetId', 'bodyFontAssetId'],
      }).success,
    ).toBe(true)
  })
})

describe('integration and directory contracts (Paket 014)', () => {
  it('rejects http/webhook as a creatable transport -- no adapter in this package', () => {
    expect(
      CreateIntegrationSourceRequestSchema.safeParse({
        transport: 'http',
        providerKey: 'easyverein',
        displayName: 'easyVerein',
        enabledDomains: ['people'],
      }).success,
    ).toBe(false)
  })

  it('requires an endpointUrl for an ical source but not for a file source', () => {
    expect(
      CreateIntegrationSourceRequestSchema.safeParse({
        transport: 'ical',
        providerKey: 'ical',
        displayName: 'Spielplan-Feed',
        enabledDomains: ['fixtures'],
      }).success,
    ).toBe(false)
    expect(
      CreateIntegrationSourceRequestSchema.safeParse({
        transport: 'file',
        providerKey: 'csv',
        displayName: 'Mitgliederliste',
        enabledDomains: ['people'],
      }).success,
    ).toBe(true)
  })

  it('rejects an empty enabledDomains array', () => {
    expect(
      CreateIntegrationSourceRequestSchema.safeParse({
        transport: 'file', providerKey: 'csv', displayName: 'x', enabledDomains: [],
      }).success,
    ).toBe(false)
  })

  it('keeps guardian contact fields out of the base directory person schema -- data minimization at the contract boundary', () => {
    expect(Object.keys(DirectoryPersonSchema.shape)).not.toContain('guardianName')
    expect(Object.keys(DirectoryPersonSchema.shape)).not.toContain('guardianEmail')
  })

  it('rejects fields the plan explicitly excludes from the directory, such as an address', () => {
    const result = CreateDirectoryPersonRequestSchema.safeParse({
      firstName: 'Mia', lastName: 'Muster', address: 'Hauptstrasse 1',
    })
    expect(result.success).toBe(true)
    if (result.success) expect('address' in result.data).toBe(false)
  })

  it('rejects a teamId without a departmentId when creating a directory person', () => {
    expect(CreateDirectoryPersonRequestSchema.safeParse({ firstName: 'Mia', lastName: 'Muster', teamId: team }).success).toBe(false)
  })

  it('rejects an update request with no fields at all', () => {
    expect(UpdateDirectoryPersonRequestSchema.safeParse({}).success).toBe(false)
  })

  it('normalizes guardianEmail to lowercase like other email fields in this project', () => {
    const result = CreateDirectoryPersonRequestSchema.safeParse({
      firstName: 'Mia', lastName: 'Muster', guardianEmail: 'Eltern@Beispiel.de',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.guardianEmail).toBe('eltern@beispiel.de')
  })
})

describe('analytics contracts (Paket 016)', () => {
  it('accepts a plain organization-scoped range', () => {
    expect(AnalyticsScopeQuerySchema.safeParse({ organizationId: org, from: '2026-07-01', to: '2026-07-31' }).success).toBe(true)
  })

  it('rejects a teamId without a departmentId', () => {
    expect(AnalyticsScopeQuerySchema.safeParse({ organizationId: org, teamId: team, from: '2026-07-01', to: '2026-07-31' }).success).toBe(false)
  })

  it('rejects a range where from is after to', () => {
    expect(AnalyticsScopeQuerySchema.safeParse({ organizationId: org, from: '2026-07-31', to: '2026-07-01' }).success).toBe(false)
  })

  it('rejects a range spanning more than 24 months', () => {
    expect(AnalyticsScopeQuerySchema.safeParse({ organizationId: org, from: '2020-01-01', to: '2026-07-01' }).success).toBe(false)
  })

  it('accepts a range of exactly 24 months', () => {
    expect(AnalyticsScopeQuerySchema.safeParse({ organizationId: org, from: '2024-07-01', to: '2026-07-01' }).success).toBe(true)
  })

  it('applies the same scope validation to the timeseries, breakdown, and funnel query schemas', () => {
    expect(AnalyticsTimeseriesQuerySchema.safeParse({ organizationId: org, teamId: team, from: '2026-07-01', to: '2026-07-31', metric: 'postsCreated' }).success).toBe(false)
    expect(AnalyticsBreakdownQuerySchema.safeParse({ organizationId: org, from: '2026-07-31', to: '2026-07-01', dimension: 'department' }).success).toBe(false)
    expect(AnalyticsFunnelQuerySchema.safeParse({ organizationId: org, from: '2020-01-01', to: '2026-07-01' }).success).toBe(false)
  })

  it('defaults timeseries granularity to day', () => {
    const result = AnalyticsTimeseriesQuerySchema.safeParse({ organizationId: org, from: '2026-07-01', to: '2026-07-31', metric: 'postsCreated' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.granularity).toBe('day')
  })
})
