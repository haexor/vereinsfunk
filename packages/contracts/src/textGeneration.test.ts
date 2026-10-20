import { describe, expect, it } from 'vitest'
import { CreateSubmissionSchema } from './content.js'
import { CreateCompositionSessionSchema, CreateGenerationCommandSchema, deriveTextGenerationMaxOutputTokens, GeneratedPostSchema, MaxCharactersSchema, SaveTextWorkshopDraftSchema, TEXT_GENERATION_TEMPERATURE_STEPS, TextGenerationPlatformAvailabilitySchema } from './textGeneration.js'
import { department, org, team } from './testFixtures.js'

describe('text generation contracts', () => {
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

  it('accepts incomplete autosave input but keeps its scope and platform choices bounded', () => {
    const draft = {
      organizationId: org, departmentId: department,
      payload: { communicationGoal: 'inform', factsText: '', observation: 'Erste Notiz', selectedProfile: 'klar_erklaerend', temperature: 0.6, selectedPlatforms: [], maxCharactersOverride: '' },
    }
    expect(SaveTextWorkshopDraftSchema.safeParse(draft).success).toBe(true)
    expect(SaveTextWorkshopDraftSchema.safeParse({ ...draft, payload: { ...draft.payload, selectedPlatforms: ['instagram', 'instagram'] } }).success).toBe(false)
    expect(SaveTextWorkshopDraftSchema.safeParse({ ...draft, departmentId: 'not-an-id' }).success).toBe(false)
  })

  // Org-level posting: departmentId: null means "no specific department" and must be accepted for
  // both the composition session and the autosave draft -- but the key itself stays required
  // (.nullable() without .optional()), so an omitted departmentId is still rejected.
  it('accepts departmentId: null for an organization-level session or draft, but not the key being omitted', () => {
    const base = {
      organizationId: org, departmentId: department, communicationGoal: 'invite',
      requestedFormats: ['text_post'] as const, sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [] },
      targetPlatforms: ['instagram'] as const,
    }
    expect(CreateCompositionSessionSchema.safeParse({ ...base, departmentId: null }).success).toBe(true)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, departmentId: undefined }).success).toBe(false)

    const draft = {
      organizationId: org, departmentId: department,
      payload: { communicationGoal: 'inform', factsText: '', observation: 'Erste Notiz', selectedProfile: 'klar_erklaerend', temperature: 0.6, selectedPlatforms: [], maxCharactersOverride: '' },
    }
    expect(SaveTextWorkshopDraftSchema.safeParse({ ...draft, departmentId: null }).success).toBe(true)
    expect(SaveTextWorkshopDraftSchema.safeParse({ ...draft, departmentId: undefined }).success).toBe(false)
  })

  // Ein Team liegt immer in einer Abteilung -- composition_sessions und text_workshop_drafts
  // tragen beide check (team_id is null or department_id is not null). Ohne diese Vorpruefung
  // schluege die Kombination erst beim Schreiben als 23514 auf.
  it('rejects a teamId without a departmentId in both request schemas', () => {
    const base = {
      organizationId: org, communicationGoal: 'invite',
      requestedFormats: ['text_post'] as const, sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [] },
      targetPlatforms: ['instagram'] as const,
    }
    expect(CreateCompositionSessionSchema.safeParse({ ...base, departmentId: department, teamId: team }).success).toBe(true)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, departmentId: null, teamId: null }).success).toBe(true)
    expect(CreateCompositionSessionSchema.safeParse({ ...base, departmentId: null, teamId: team }).success).toBe(false)

    const draftBase = {
      organizationId: org,
      payload: { communicationGoal: 'inform', factsText: '', observation: 'Erste Notiz', selectedProfile: 'klar_erklaerend', temperature: 0.6, selectedPlatforms: [], maxCharactersOverride: '' },
    }
    expect(SaveTextWorkshopDraftSchema.safeParse({ ...draftBase, departmentId: department, teamId: team }).success).toBe(true)
    expect(SaveTextWorkshopDraftSchema.safeParse({ ...draftBase, departmentId: null, teamId: null }).success).toBe(true)
    expect(SaveTextWorkshopDraftSchema.safeParse({ ...draftBase, departmentId: null, teamId: team }).success).toBe(false)
  })

  it('accepts text/photo/video composition choices but keeps historical reels outside new commands', () => {
    const input = CreateCompositionSessionSchema.parse({
      organizationId: org, departmentId: department, communicationGoal: 'invite',
      requestedFormats: ['video_post'], sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [] },
      targetPlatforms: ['instagram'],
    })
    expect(input.requestedFormats).toEqual(['video_post'])
    expect(CreateCompositionSessionSchema.safeParse({ ...input, requestedFormats: ['reel'] }).success).toBe(false)
    // CreateSubmissionSchema (Foto-Pipeline) verlangt weiterhin presetSlug, anders als
    // CreateCompositionSessionSchema seit dem Wegfall von "Anlass" -- input allein liefert keines mehr.
    expect(CreateSubmissionSchema.safeParse({ ...input, presetSlug: 'event', requestedFormats: ['reel'] }).success).toBe(true)
    expect(CreateCompositionSessionSchema.safeParse({ ...input, requestedFormats: ['text_post', 'text_post'] }).success).toBe(false)
  })

  it('requires a revision instruction for a revise command', () => {
    expect(CreateGenerationCommandSchema.safeParse({ sessionId: org, generationIntent: 'revise', revisionInstruction: 'Bitte kürzer und mit konkretem Termin.' }).success).toBe(true)
    expect(CreateGenerationCommandSchema.safeParse({ sessionId: org, generationIntent: 'revise' }).success).toBe(false)
  })

  it('allows at most one of styleProfileId, systemStyleProfileSlug, or personaSlug', () => {
    const base = {
      organizationId: org, departmentId: department, communicationGoal: 'invite',
      requestedFormats: ['text_post'] as const, sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [] },
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
      requestedFormats: ['text_post'] as const, sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [] },
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
      requestedFormats: ['text_post'] as const, sourceMaterial: { facts: { title: 'Sommerfest' }, observations: [], quotes: [] },
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
