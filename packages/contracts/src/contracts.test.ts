import { describe, expect, it } from 'vitest'
import {
  AddPlatformAdminRequestSchema,
  CreateSubmissionSchema,
  GeneratedPostSchema,
  OrganizationSettingOverrideKeySchema,
  PlatformSettingKeySchema,
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

  it('requires organization setting override keys to be lower_snake_case', () => {
    expect(OrganizationSettingOverrideKeySchema.safeParse('Not Valid').success).toBe(false)
    expect(OrganizationSettingOverrideKeySchema.safeParse('max_departments').success).toBe(true)
  })
})
