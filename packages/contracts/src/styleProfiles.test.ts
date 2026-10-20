import { describe, expect, it } from 'vitest'
import { CreateCustomStyleProfileRequestSchema, CreatePlatformStylePersonaRequestSchema, CustomStyleProfileSchema, PlatformStylePersonaSchema, UpdatePlatformStylePersonaRequestSchema } from './styleProfiles.js'
import { department, org, team } from './testFixtures.js'

describe('style profile contracts', () => {
  const styleRules = {
    toneTags: ['warm', 'nah'], catchphrases: ['unsere Gemeinschaft'],
    examples: [{ input: 'Sommerfest am Samstag', output: 'Am Samstag feiern wir gemeinsam.' }],
    additionalInstructions: 'Konkrete Details zuerst.',
  }

  it('permits custom style profiles that name a real person to imitate', () => {
    const profile = { organizationId: org, departmentId: department, teamId: null, slug: 'unser-ton', name: 'Unser Ton', description: 'Warm und konkret', styleRules, avoidRules: ['Floskeln'], doRules: ['Fans erwähnen'] }
    expect(CreateCustomStyleProfileRequestSchema.safeParse(profile).success).toBe(true)
    // Product decision (Plan 032): style profiles may name and imitate a real person -- safety is
    // organisational (role assignment, approval routes), not a keyword filter.
    expect(CreateCustomStyleProfileRequestSchema.safeParse({ ...profile, name: 'Mark Twain', styleRules: { ...styleRules, additionalInstructions: 'Schreibe wie Mark Twain' } }).success).toBe(true)
    expect(CreateCustomStyleProfileRequestSchema.safeParse({ ...profile, description: 'Im Stil von unserem Vorstand' }).success).toBe(true)
    expect(CreateCustomStyleProfileRequestSchema.safeParse({ ...profile, slug: 'klar_erklaerend' }).success).toBe(false)
    // departmentId/teamId may be omitted entirely for an organization-wide profile, not just set to null.
    const orgWideProfile = { organizationId: org, slug: 'unser-ton', name: 'Unser Ton', description: 'Warm und konkret', styleRules, avoidRules: ['Floskeln'], doRules: ['Fans erwähnen'] }
    expect(CreateCustomStyleProfileRequestSchema.safeParse(orgWideProfile).success).toBe(true)
    // teamId without departmentId must be rejected on both the request schema and the persisted
    // record schema -- CustomStyleProfileSchema extends the checked StyleProfileScopeSchema, and
    // the scope superRefine must still apply after that extend.
    expect(CreateCustomStyleProfileRequestSchema.safeParse({ ...profile, departmentId: undefined, teamId: team }).success).toBe(false)
  })

  it('keeps the teamId-requires-departmentId scope rule after CustomStyleProfileSchema extends it', () => {
    const record = {
      id: org, organizationId: org, departmentId: department, teamId: team, slug: 'unser-ton', name: 'Unser Ton',
      kind: 'custom' as const, description: 'Warm und konkret', styleRules, avoidRules: ['Floskeln'], doRules: ['Fans erwähnen'],
      isActive: true, createdBy: org, createdAt: '2026-08-05T12:34:56.789+00:00', updatedAt: '2026-08-05T12:34:56.789+00:00',
    }
    expect(CustomStyleProfileSchema.safeParse(record).success).toBe(true)
    expect(CustomStyleProfileSchema.safeParse({ ...record, departmentId: null }).success).toBe(false)
  })

  it('validates the platform persona catalogue and reserves system profile slugs', () => {
    const persona = { slug: 'kapitaen-klar', name: 'Kapitän Klar', description: 'Direkt und anfeuernd.', styleRules, avoidRules: ['Ironie'], doRules: ['Fans erwähnen'] }
    expect(CreatePlatformStylePersonaRequestSchema.safeParse(persona).success).toBe(true)
    expect(CreatePlatformStylePersonaRequestSchema.safeParse({ ...persona, slug: 'klar_erklaerend' }).success).toBe(false)
    const record = { id: org, ...persona, isActive: true, createdBy: org, createdAt: '2026-08-13T12:00:00+00:00', updatedAt: '2026-08-13T12:00:00+00:00' }
    expect(PlatformStylePersonaSchema.safeParse(record).success).toBe(true)
    expect(UpdatePlatformStylePersonaRequestSchema.safeParse({ isActive: false }).success).toBe(true)
    expect(UpdatePlatformStylePersonaRequestSchema.safeParse({}).success).toBe(false)
    expect(UpdatePlatformStylePersonaRequestSchema.safeParse({ slug: 'klar_erklaerend' }).success).toBe(false)
  })
})
