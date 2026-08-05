import { describe, expect, it } from 'vitest'
import {
  AddPlatformAdminRequestSchema,
  CreateSubmissionSchema,
  GeneratedPostSchema,
  OnboardingStateSchema,
  PlatformAdminOrganizationSummarySchema,
  PlatformAdminSchema,
  PlatformSettingKeySchema,
  PlatformSettingSchema,
  PlatformSettingValueSchemas,
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
