import { describe, expect, it } from 'vitest'
import { CompressionProvenanceSchema, CreateCompositionSessionSchema, CreateCustomStyleProfileRequestSchema, CreateGenerationCommandSchema, CreatePlatformStylePersonaRequestSchema, CreateSubmissionSchema, CustomStyleProfileSchema, GeneratedPostSchema, PlatformStylePersonaSchema, UpdatePlatformStylePersonaRequestSchema, VideoUploadMetadataSchema, WorkflowPayloadSchema } from './index.js'
import { department, org, team } from './testFixtures.js'

describe('contracts', () => {
  it('accepts only small ID-based workflow payloads', () => {
    const payload = { entityId: org, organizationId: org, departmentId: department, correlationId: team, sourceRevision: 1, purpose: 'render', idempotencyKey: 'render:1' }
    expect(WorkflowPayloadSchema.safeParse(payload).success).toBe(true)
    expect(WorkflowPayloadSchema.safeParse({ ...payload, caption: 'This must never reach Hatchet' }).success).toBe(false)
  })

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
    expect(CreateCompositionSessionSchema.safeParse({ ...input, requestedFormats: ['text_post', 'text_post'] }).success).toBe(false)
  })

  it('requires the supported, bounded upload-video delivery profile', () => {
    const video = { kind: 'video', mimeType: 'video/mp4', byteSize: 1_000_000, width: 1080, height: 608, durationMs: 30_000, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' }
    expect(VideoUploadMetadataSchema.safeParse(video).success).toBe(true)
    expect(VideoUploadMetadataSchema.safeParse({ ...video, videoCodec: 'vp9' }).success).toBe(false)
    expect(VideoUploadMetadataSchema.safeParse({ ...video, durationMs: 180_001 }).success).toBe(false)
  })

  it('permits custom style profiles that name a real person to imitate and bounded revision instructions', () => {
    const profile = { organizationId: org, departmentId: department, teamId: null, slug: 'unser-ton', name: 'Unser Ton', description: 'Warm und konkret', styleRules, avoidRules: ['Floskeln'] }
    expect(CreateCustomStyleProfileRequestSchema.safeParse(profile).success).toBe(true)
    // Product decision (Plan 032): style profiles may name and imitate a real person -- safety is
    // organisational (role assignment, approval routes), not a keyword filter.
    expect(CreateCustomStyleProfileRequestSchema.safeParse({ ...profile, name: 'Mark Twain', styleRules: { ...styleRules, additionalInstructions: 'Schreibe wie Mark Twain' } }).success).toBe(true)
    expect(CreateCustomStyleProfileRequestSchema.safeParse({ ...profile, description: 'Im Stil von unserem Vorstand' }).success).toBe(true)
    expect(CreateCustomStyleProfileRequestSchema.safeParse({ ...profile, slug: 'klar_erklaerend' }).success).toBe(false)
    // departmentId/teamId may be omitted entirely for an organization-wide profile, not just set to null.
    const orgWideProfile = { organizationId: org, slug: 'unser-ton', name: 'Unser Ton', description: 'Warm und konkret', styleRules, avoidRules: ['Floskeln'] }
    expect(CreateCustomStyleProfileRequestSchema.safeParse(orgWideProfile).success).toBe(true)
    // teamId without departmentId must be rejected on both the request schema and the persisted
    // record schema -- CustomStyleProfileSchema extends the checked StyleProfileScopeSchema, and
    // the scope superRefine must still apply after that extend.
    expect(CreateCustomStyleProfileRequestSchema.safeParse({ ...profile, departmentId: undefined, teamId: team }).success).toBe(false)
    expect(CreateGenerationCommandSchema.safeParse({ sessionId: org, generationIntent: 'revise', revisionInstruction: 'Bitte kürzer und mit konkretem Termin.' }).success).toBe(true)
    expect(CreateGenerationCommandSchema.safeParse({ sessionId: org, generationIntent: 'revise' }).success).toBe(false)
  })

  it('keeps the teamId-requires-departmentId scope rule after CustomStyleProfileSchema extends it', () => {
    const record = {
      id: org, organizationId: org, departmentId: department, teamId: team, slug: 'unser-ton', name: 'Unser Ton',
      kind: 'custom' as const, description: 'Warm und konkret', styleRules, avoidRules: ['Floskeln'],
      isActive: true, createdBy: org, createdAt: '2026-08-05T12:34:56.789+00:00', updatedAt: '2026-08-05T12:34:56.789+00:00',
    }
    expect(CustomStyleProfileSchema.safeParse(record).success).toBe(true)
    expect(CustomStyleProfileSchema.safeParse({ ...record, departmentId: null }).success).toBe(false)
  })

  it('allows at most one of styleProfileId, systemStyleProfileSlug, or personaSlug', () => {
    const base = {
      organizationId: org, departmentId: department, presetSlug: 'event', communicationGoal: 'invite',
      requestedFormats: ['text_post'] as const, sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [], doNotMention: [] },
    }
    expect(CreateCompositionSessionSchema.safeParse(base).success).toBe(true)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, styleProfileId: org }).success).toBe(true)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, systemStyleProfileSlug: 'klar_erklaerend' }).success).toBe(true)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, personaSlug: 'kapitaen-klar' }).success).toBe(true)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, styleProfileId: org, systemStyleProfileSlug: 'klar_erklaerend' }).success).toBe(false)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, styleProfileId: org, personaSlug: 'kapitaen-klar' }).success).toBe(false)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, systemStyleProfileSlug: 'klar_erklaerend', personaSlug: 'kapitaen-klar' }).success).toBe(false)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, styleProfileId: org, systemStyleProfileSlug: 'klar_erklaerend', personaSlug: 'kapitaen-klar' }).success).toBe(false)
  })

  it('validates the platform persona catalogue and reserves system profile slugs', () => {
    const persona = { slug: 'kapitaen-klar', name: 'Kapitän Klar', description: 'Direkt und anfeuernd.', styleRules, avoidRules: ['Ironie'] }
    expect(CreatePlatformStylePersonaRequestSchema.safeParse(persona).success).toBe(true)
    expect(CreatePlatformStylePersonaRequestSchema.safeParse({ ...persona, slug: 'klar_erklaerend' }).success).toBe(false)
    const record = { id: org, ...persona, isActive: true, createdBy: org, createdAt: '2026-08-13T12:00:00+00:00', updatedAt: '2026-08-13T12:00:00+00:00' }
    expect(PlatformStylePersonaSchema.safeParse(record).success).toBe(true)
    expect(UpdatePlatformStylePersonaRequestSchema.safeParse({ isActive: false }).success).toBe(true)
    expect(UpdatePlatformStylePersonaRequestSchema.safeParse({}).success).toBe(false)
    expect(UpdatePlatformStylePersonaRequestSchema.safeParse({ slug: 'klar_erklaerend' }).success).toBe(false)
  })

  it('requires compression output measurements only when compression succeeded', () => {
    const succeeded = {
      method: 'device' as const, profileVersion: 'v1', inputBytes: 2_000_000, outputBytes: 900_000,
      container: 'mp4' as const, videoCodec: 'h264' as const, audioCodec: 'aac' as const,
      width: 1080, height: 608, durationMs: 20_000, failureReason: null,
    }
    expect(CompressionProvenanceSchema.safeParse(succeeded).success).toBe(true)
    expect(CompressionProvenanceSchema.safeParse({ ...succeeded, outputBytes: null }).success).toBe(false)
    const failed = { ...succeeded, outputBytes: null, width: null, height: null, durationMs: null, failureReason: 'memory_guardrail' as const }
    expect(CompressionProvenanceSchema.safeParse(failed).success).toBe(true)
  })
})

