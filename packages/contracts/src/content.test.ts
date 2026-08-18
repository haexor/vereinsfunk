import { describe, expect, it } from 'vitest'
import { CompressionProvenanceSchema, CreateCompositionSessionSchema, CreateCustomStyleProfileRequestSchema, CreateGenerationCommandSchema, CreatePlatformStylePersonaRequestSchema, CreateSubmissionSchema, CustomStyleProfileSchema, deriveTextGenerationMaxOutputTokens, GeneratedPostSchema, MaxCharactersSchema, PlatformStylePersonaSchema, SaveTextWorkshopDraftSchema, TEXT_GENERATION_TEMPERATURE_STEPS, TextGenerationPlatformAvailabilitySchema, UpdatePlatformStylePersonaRequestSchema, VideoUploadMetadataSchema, WorkflowPayloadSchema } from './index.js'
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

  // Plan 044, Step 7: die Obergrenze muss mindestens so gross bleiben wie die groesste
  // Plattform-Vorgabe, sonst weist GeneratedPostSchema einen zulaessigen Beitrag ab, bevor
  // assertCaptionLength (packages/content-engine) ueberhaupt greift.
  it('accepts a caption at MaxCharactersSchemas ceiling, rejects one character more', () => {
    const atCeiling = { verifiedFacts: [], missingFacts: [], headline: 'Titel', caption: 'a'.repeat(10_000), shortCaption: 'Text', callToAction: 'Komm vorbei', altText: 'Motiv', templateId: 'event-v1', safetyFlags: [], hashtags: [] }
    expect(MaxCharactersSchema.safeParse(10_000).success).toBe(true)
    expect(GeneratedPostSchema.safeParse(atCeiling).success).toBe(true)
    expect(GeneratedPostSchema.safeParse({ ...atCeiling, caption: 'a'.repeat(10_001) }).success).toBe(false)
  })
})

describe('text workshop contracts', () => {
  const styleRules = {
    toneTags: ['warm', 'nah'], catchphrases: ['unsere Gemeinschaft'],
    examples: [{ input: 'Sommerfest am Samstag', output: 'Am Samstag feiern wir gemeinsam.' }],
    additionalInstructions: 'Konkrete Details zuerst.',
  }

  it('accepts incomplete autosave input but keeps its scope and platform choices bounded', () => {
    const draft = {
      organizationId: org, departmentId: department,
      payload: { communicationGoal: 'inform', factsText: '', observation: 'Erste Notiz', quote: '', doNotMention: '', selectedProfile: 'klar_erklaerend', temperature: 0.6, selectedPlatforms: [], maxCharactersOverride: '' },
    }
    expect(SaveTextWorkshopDraftSchema.safeParse(draft).success).toBe(true)
    expect(SaveTextWorkshopDraftSchema.safeParse({ ...draft, payload: { ...draft.payload, selectedPlatforms: ['instagram', 'instagram'] } }).success).toBe(false)
    expect(SaveTextWorkshopDraftSchema.safeParse({ ...draft, departmentId: 'not-an-id' }).success).toBe(false)
  })

  it('accepts text/photo/video composition choices but keeps historical reels outside new commands', () => {
    const input = CreateCompositionSessionSchema.parse({
      organizationId: org, departmentId: department, communicationGoal: 'invite',
      requestedFormats: ['video_post'], sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [], doNotMention: [] },
      targetPlatforms: ['instagram'],
    })
    expect(input.requestedFormats).toEqual(['video_post'])
    expect(CreateCompositionSessionSchema.safeParse({ ...input, requestedFormats: ['reel'] }).success).toBe(false)
    // CreateSubmissionSchema (Foto-Pipeline) verlangt weiterhin presetSlug, anders als
    // CreateCompositionSessionSchema seit dem Wegfall von "Anlass" -- input allein liefert keines mehr.
    expect(CreateSubmissionSchema.safeParse({ ...input, presetSlug: 'event', requestedFormats: ['reel'] }).success).toBe(true)
    expect(CreateCompositionSessionSchema.safeParse({ ...input, requestedFormats: ['text_post', 'text_post'] }).success).toBe(false)
  })

  it('requires the supported, bounded upload-video delivery profile', () => {
    const video = { kind: 'video', mimeType: 'video/mp4', byteSize: 1_000_000, width: 1080, height: 608, durationMs: 30_000, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' }
    expect(VideoUploadMetadataSchema.safeParse(video).success).toBe(true)
    expect(VideoUploadMetadataSchema.safeParse({ ...video, videoCodec: 'vp9' }).success).toBe(false)
    expect(VideoUploadMetadataSchema.safeParse({ ...video, durationMs: 180_001 }).success).toBe(false)
  })

  it('permits custom style profiles that name a real person to imitate and bounded revision instructions', () => {
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
    expect(CreateGenerationCommandSchema.safeParse({ sessionId: org, generationIntent: 'revise', revisionInstruction: 'Bitte kürzer und mit konkretem Termin.' }).success).toBe(true)
    expect(CreateGenerationCommandSchema.safeParse({ sessionId: org, generationIntent: 'revise' }).success).toBe(false)
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

  it('allows at most one of styleProfileId, systemStyleProfileSlug, or personaSlug', () => {
    const base = {
      organizationId: org, departmentId: department, communicationGoal: 'invite',
      requestedFormats: ['text_post'] as const, sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [], doNotMention: [] },
      targetPlatforms: ['instagram'] as const,
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

  // Paket 042: temperature is the member's own choice per post, limited to the four fixed regler
  // steps -- not a free number, and not inherited from the persona/style profile.
  it('defaults temperature to the "Ausgewogen" step and rejects any value off the four fixed steps', () => {
    const base = {
      organizationId: org, departmentId: department, communicationGoal: 'invite',
      requestedFormats: ['text_post'] as const, sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [], doNotMention: [] },
      targetPlatforms: ['instagram'] as const,
    }
    expect(CreateCompositionSessionSchema.parse(base).temperature).toBe(0.6)
    for (const step of TEXT_GENERATION_TEMPERATURE_STEPS) {
      expect(CreateCompositionSessionSchema.safeParse({ ...base, temperature: step.value }).success).toBe(true)
    }
    expect(CreateCompositionSessionSchema.safeParse({ ...base, temperature: 0.5 }).success).toBe(false)
  })

  // Plan 044, PR 1 Step 1: kein Vorgabewert mehr -- auf welchen Plattformen ein Verein
  // veroeffentlicht, ist seine Sache, nicht die des Betreibers. targetPlatforms ist deshalb ein
  // Pflichtfeld geworden; ohne Angabe schlaegt die Anfrage fehl statt still ['instagram','facebook']
  // einzusetzen (das waere seit Plan 042 PR 3 fuer jeden Verein ohne beide Kanaele ein garantiertes
  // 422 gewesen). min(1) bleibt: leer ist der Zustand vor dem Absenden, keine gueltige Wahl.
  it('requires an explicit, non-empty targetPlatforms selection, rejects duplicates or an unknown platform', () => {
    const base = {
      organizationId: org, departmentId: department, communicationGoal: 'invite',
      requestedFormats: ['text_post'] as const, sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [], doNotMention: [] },
    }
    expect(CreateCompositionSessionSchema.safeParse(base).success).toBe(false)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, targetPlatforms: ['instagram'], maxCharacters: 500 }).success).toBe(true)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, targetPlatforms: ['facebook', 'instagram'] }).success).toBe(true)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, targetPlatforms: [] }).success).toBe(false)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, targetPlatforms: ['instagram', 'instagram'] }).success).toBe(false)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, targetPlatforms: ['threads'] }).success).toBe(false)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, targetPlatforms: ['instagram'], maxCharacters: 99 }).success).toBe(false)
  })

  // Plan 042, PR 3 Step 3: reason is only meaningful together with available: false, but the
  // schema itself does not enforce that pairing -- the route is the single place that decides it.
  it('accepts a platform availability entry with or without a reason', () => {
    expect(TextGenerationPlatformAvailabilitySchema.safeParse({ platform: 'instagram', available: true, maxCharacters: 2200, isDefault: true }).success).toBe(true)
    expect(TextGenerationPlatformAvailabilitySchema.safeParse({ platform: 'facebook', available: false, maxCharacters: 2200, isDefault: false, reason: 'no_channel' }).success).toBe(true)
    expect(TextGenerationPlatformAvailabilitySchema.safeParse({ platform: 'facebook', available: false, maxCharacters: 2200, isDefault: false, reason: 'restricted_by_policy' }).success).toBe(true)
    expect(TextGenerationPlatformAvailabilitySchema.safeParse({ platform: 'facebook', available: false, maxCharacters: 2200, isDefault: false, reason: 'unknown' }).success).toBe(false)
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

  // Plan 039, PR 1 Step 4: ohne diese Ableitung waere die 5000-Zeichen-Vorgabe eines Website-Kanals
  // ein leeres Versprechen -- der Provideraufruf haette weiterhin nur ein festes 1200-Token-Budget.
  it('derives a token budget that grows with max_characters and never falls below the previous fixed budget', () => {
    const instagram = deriveTextGenerationMaxOutputTokens(2200)
    const website = deriveTextGenerationMaxOutputTokens(5000)
    expect(website).toBeGreaterThan(instagram)
    // Kernzusage: die Bildunterschrift muss reinpassen. Zwei Zeichen je Token ist die konservative
    // Kante fuer deutschen Text -- bei drei kaeme ein 5000-Zeichen-Blogbeitrag abgeschnitten zurueck.
    expect(website).toBeGreaterThanOrEqual(Math.ceil(5000 / 2))
    // Keine bestehende Sitzung darf durch die Ableitung WENIGER bekommen als die alte Konstante.
    // Ohne Untergrenze faellt der kleinste erlaubte Wert (100 Zeichen) auf 550 statt 1200.
    expect(deriveTextGenerationMaxOutputTokens(100)).toBe(1200)
    expect(instagram).toBeGreaterThanOrEqual(1200)
  })

  // Der Belegteil der Antwort (verifiedFacts UND generatedClaims -- jeder Beleg erscheint zweimal)
  // waechst mit dem Quellmaterial, nicht mit der Zeichengrenze. Ein fester Zuschlag liess genau den
  // belegreichen Spielbericht verhungern, fuer den die Textwerkstatt gebaut ist.
  it('grows the budget with the claim count, not only with max_characters', () => {
    const withoutClaims = deriveTextGenerationMaxOutputTokens(2200)
    const withClaims = deriveTextGenerationMaxOutputTokens(2200, 24)
    expect(withClaims).toBeGreaterThan(withoutClaims)
    // Zwei Sitzungen mit derselben Zeichengrenze, aber unterschiedlich viel Quellmaterial, duerfen
    // nicht dasselbe Budget bekommen -- sonst ist die Belegzahl im Provenienz-Hash wertlos.
    expect(deriveTextGenerationMaxOutputTokens(2200, 9)).not.toBe(withClaims)
  })
})
