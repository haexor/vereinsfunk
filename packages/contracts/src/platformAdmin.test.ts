import { describe, expect, it } from 'vitest'
import { AddPlatformAdminRequestSchema, OnboardingStateSchema, PlatformAdminOrganizationDetailSchema, PlatformAdminOrganizationSummarySchema, PlatformAdminSchema, PlatformSettingKeySchema, PlatformSettingSchema, PlatformSettingValueSchemas, TextGenerationCapabilitiesSchema, TextGenerationPlatformDefaultSchema, UpdateTextGenerationPlatformDefaultRequestSchema } from './index.js'
import { org } from './testFixtures.js'

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
    expect(PlatformSettingKeySchema.safeParse('publishing_enabled').success).toBe(true)
    expect(PlatformSettingValueSchemas.publishing_enabled.safeParse(true).success).toBe(true)
    expect(PlatformSettingValueSchemas.publishing_enabled.safeParse('true').success).toBe(false)
  })

  // Paket 050: die Ensemble-Groesse ist kein separater platform_settings-Schluessel mehr -- alle
  // aktiven text_generation-Provider zaehlen (siehe LlmProviderConfigurationSchema/isActive).
  it('rejects the retired text generation ensemble size key', () => {
    expect(PlatformSettingKeySchema.safeParse('text_generation_ensemble_size').success).toBe(false)
  })

  // Regression: PostgREST serializes timestamptz with a numeric UTC offset (+00:00), not the
  // literal "Z" suffix z.iso.datetime() demands by default -- these three schemas are fed
  // directly by real DB rows and must accept that shape, not just client-constructed dates.
  it('accepts PostgREST-shaped timestamps with a numeric UTC offset, not just a Z suffix', () => {
    const offsetTimestamp = '2026-08-05T12:34:56.789+00:00'
    expect(PlatformAdminSchema.safeParse({ userId: org, isDefaultAdmin: true, createdAt: offsetTimestamp }).success).toBe(true)
    expect(PlatformSettingSchema.safeParse({ key: 'max_organizations_per_owner', value: 3, updatedAt: offsetTimestamp }).success).toBe(true)
    expect(PlatformSettingSchema.safeParse({ key: 'publishing_enabled', value: false, updatedAt: offsetTimestamp }).success).toBe(true)
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

  it('keeps owner-account email distinct from the club contact email', () => {
    expect(
      PlatformAdminOrganizationDetailSchema.safeParse({
        organizationId: org,
        name: 'SV Nordstadt',
        slug: 'sv-nordstadt',
        timezone: 'Europe/Berlin',
        createdAt: '2026-08-05T12:34:56.789+00:00',
        memberCount: 1,
        departmentCount: 1,
        contact: {
          responsiblePersonName: null,
          ownerAccountEmail: 'owner@sv-nordstadt.example',
          email: null,
          phone: null,
          legalName: null,
          street: null,
          houseNumber: null,
          postalCode: null,
          city: null,
          countryCode: 'DE',
          websiteUrl: null,
        },
        storage: { rawMediaBytes: 0, renderedMediaBytes: 0, totalMediaBytes: 0 },
        activity: {
          day: { posts: 0, reels: 0, videoAssets: 0 },
          week: { posts: 0, reels: 0, videoAssets: 0 },
          month: { posts: 0, reels: 0, videoAssets: 0 },
          year: { posts: 0, reels: 0, videoAssets: 0 },
        },
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

describe('text generation platform defaults contracts', () => {
  it('accepts a PostgREST-shaped updatedAt timestamp with a numeric UTC offset', () => {
    expect(
      TextGenerationPlatformDefaultSchema.safeParse({ platform: 'instagram', maxCharacters: 2200, updatedAt: '2026-08-05T12:34:56.789+00:00' }).success,
    ).toBe(true)
  })

  it('rejects a platform the text workshop has no default row for', () => {
    expect(
      TextGenerationPlatformDefaultSchema.safeParse({ platform: 'threads', maxCharacters: 2200, updatedAt: '2026-08-05T12:34:56.789+00:00' }).success,
    ).toBe(false)
  })

  it('keeps maxCharacters within the same 100-10000 bounds as the DB CHECK constraint', () => {
    expect(UpdateTextGenerationPlatformDefaultRequestSchema.safeParse({ maxCharacters: 99 }).success).toBe(false)
    expect(UpdateTextGenerationPlatformDefaultRequestSchema.safeParse({ maxCharacters: 100 }).success).toBe(true)
    expect(UpdateTextGenerationPlatformDefaultRequestSchema.safeParse({ maxCharacters: 10000 }).success).toBe(true)
    expect(UpdateTextGenerationPlatformDefaultRequestSchema.safeParse({ maxCharacters: 10001 }).success).toBe(false)
  })
})

describe('text generation capabilities contract', () => {
  it('is a bare boolean, revealing neither provider nor model', () => {
    const parsed = TextGenerationCapabilitiesSchema.parse({ temperatureSupported: true })
    expect(Object.keys(parsed)).toEqual(['temperatureSupported'])
  })
})
