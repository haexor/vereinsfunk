import { z } from 'zod'
import { SocialPlatformSchema } from './primitives.js'

export const UuidSchema = z.uuid()
export const ContentPresetSlugSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/).max(64)
export const CommunicationGoalSchema = z.enum([
  'inform', 'inspire', 'thank', 'invite', 'recruit', 'educate', 'strengthen_community',
])
export const OutputFormatSchema = z.enum(['feed_image', 'carousel', 'story', 'reel'])
// Historical rows can still contain the former visual formats (including `reel`).
// New text-workshop commands deliberately use this separate schema so a user-uploaded
// video is never misrepresented as an AI-generated Reel.
export const CompositionFormatSchema = z.enum(['text_post', 'photo_post', 'video_post'])
export const MediaAssetKindSchema = z.enum(['image', 'video'])
export const CompressionMethodSchema = z.enum(['device', 'server'])
export const CompressionFailureReasonSchema = z.enum([
  'unsupported_codec', 'unsupported_device', 'memory_guardrail', 'battery_guardrail',
  'network_guardrail', 'transcode_failed', 'cancelled',
])
export const CompressionProvenanceSchema = z.object({
  method: CompressionMethodSchema,
  profileVersion: z.string().trim().min(1).max(80),
  inputBytes: z.int().nonnegative(),
  outputBytes: z.int().positive().nullable(),
  container: z.literal('mp4'),
  videoCodec: z.literal('h264'),
  audioCodec: z.literal('aac').nullable(),
  width: z.int().positive().max(1080).nullable(),
  height: z.int().positive().max(1080).nullable(),
  durationMs: z.int().positive().max(180_000).nullable(),
  failureReason: CompressionFailureReasonSchema.nullable().default(null),
}).superRefine((provenance, context) => {
  // A failed/cancelled compression never produced real output bytes, dimensions or duration --
  // only a successful run must report them.
  if (provenance.failureReason === null && (provenance.outputBytes === null || provenance.width === null || provenance.height === null || provenance.durationMs === null)) {
    context.addIssue({ code: 'custom', message: 'outputBytes, width, height and durationMs are required when compression succeeded' })
  }
})
export const ImageUploadMetadataSchema = z.object({
  kind: z.literal('image'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  byteSize: z.int().positive().max(20 * 1024 * 1024),
  width: z.int().positive().max(12_000),
  height: z.int().positive().max(12_000),
})
export const VideoUploadMetadataSchema = z.object({
  kind: z.literal('video'),
  mimeType: z.literal('video/mp4'),
  byteSize: z.int().positive().max(250 * 1024 * 1024),
  width: z.int().positive().max(1080),
  height: z.int().positive().max(1080),
  durationMs: z.int().positive().max(180_000),
  container: z.literal('mp4'),
  videoCodec: z.literal('h264'),
  audioCodec: z.literal('aac').nullable(),
})
export const AttachmentUploadMetadataSchema = z.discriminatedUnion('kind', [ImageUploadMetadataSchema, VideoUploadMetadataSchema])

// Product decision (Plan 032, "Kuratierte und selbst angelegte Persona"): style profiles may
// name and imitate a real person (curated persona shipped by the platform, or custom persona an
// org creates itself). Safety is organisational -- who gets the poster/approver role, and the
// existing approval routes (Plan 011/024) -- not a keyword filter, which cannot reliably detect
// intent anyway. additionalInstructions stays bounded and low-priority in prompt assembly so it
// can never override grounding/safety/platform rules (see ADR-010), independent of this decision.
const StyleProfileInstructionSchema = z.string().trim().max(1_000)
// Plan 040: replaces the earlier dial-shaped rules (sentenceLength/energy/humour/formality/
// perspective/bannedPhrases) with a character model that is easier to fill in for a named
// persona ("im Stil von Zlatan Ibrahimović") than an abstract 1-5 energy scale. bannedPhrases is
// retired without replacement -- avoidRules (below) already covers the same "don't say this"
// concept, so the two no longer overlap.
export const StyleProfileExampleSchema = z.object({
  input: z.string().trim().max(300),
  output: z.string().trim().max(1_500),
})
// Shared by the Zod bound below and the "Beispiel hinzufügen" button's disabled state
// (StyleProfileEditorForm.vue) so the UI cap can't silently drift from what the API accepts.
export const STYLE_PROFILE_MAX_EXAMPLES = 5
export const StyleProfileRulesSchema = z.object({
  toneTags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  catchphrases: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  examples: z.array(StyleProfileExampleSchema).max(STYLE_PROFILE_MAX_EXAMPLES).default([]),
  additionalInstructions: StyleProfileInstructionSchema.default(''),
}).strict()
// Shared bound for avoidRules/doRules, both database-backed columns with the identical
// text_array_elements_within_length(value, 160)/cardinality <= 30 CHECK (see
// 2026081003_text_workshop_foundation.sql and 2026081304_style_profile_character_model.sql).
const StyleProfileRuleListSchema = z.array(z.string().trim().min(1).max(160)).max(30)
// The shape composition_sessions.style_profile_snapshot/post_generation_provenance.
// style_profile_snapshot are frozen into (apps/api/src/routes/content.ts) and read back out of
// (apps/worker/src/context.ts, apps/worker/src/textGeneration.ts) -- one shared schema instead of
// two independently maintained copies of the same shape.
export const StyleProfileSnapshotSchema = z.object({
  name: z.string(),
  description: z.string(),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
})
export const SystemStyleProfileSlugSchema = z.enum([
  'klar_erklaerend', 'warm_gemeinschaftlich', 'lebendig_sportlich', 'leicht_humorvoll', 'feierlich_wertschaetzend',
])
export const StyleProfileKindSchema = z.enum(['system', 'custom'])
export const StyleProfileScopeSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
}).superRefine((scope, context) => {
  if (scope.teamId && !scope.departmentId) context.addIssue({ code: 'custom', message: 'teamId requires departmentId' })
})
export const CustomStyleProfileSchema = StyleProfileScopeSchema.extend({
  id: UuidSchema,
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.literal('custom'),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
  isActive: z.boolean(),
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
export const CreateCustomStyleProfileRequestSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable().optional(),
  teamId: UuidSchema.nullable().optional(),
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
}).superRefine((profile, context) => {
  if (profile.teamId && !profile.departmentId) context.addIssue({ code: 'custom', message: 'teamId requires departmentId' })
  if ((SystemStyleProfileSlugSchema.options as readonly string[]).includes(profile.slug)) {
    context.addIssue({ code: 'custom', message: 'System style profile slugs are reserved' })
  }
})
// Plan 037: a platform-admin-curated, global persona catalogue -- no organization_id, no
// composite foreign key (see platform_style_personas migration). Referenced by slug only, frozen
// into composition_sessions.style_profile_snapshot exactly like the five hardcoded system modes.
export const PlatformStylePersonaSchema = z.object({
  id: UuidSchema,
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
  isActive: z.boolean(),
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
export const CreatePlatformStylePersonaRequestSchema = z.object({
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
}).superRefine((persona, context) => {
  if ((SystemStyleProfileSlugSchema.options as readonly string[]).includes(persona.slug)) {
    context.addIssue({ code: 'custom', message: 'System style profile slugs are reserved' })
  }
})
export const UpdatePlatformStylePersonaRequestSchema = z.object({
  slug: ContentPresetSlugSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  styleRules: StyleProfileRulesSchema.optional(),
  avoidRules: StyleProfileRuleListSchema.optional(),
  doRules: StyleProfileRuleListSchema.optional(),
  isActive: z.boolean().optional(),
}).superRefine((persona, context) => {
  if (persona.slug !== undefined && (SystemStyleProfileSlugSchema.options as readonly string[]).includes(persona.slug)) {
    context.addIssue({ code: 'custom', path: ['slug'], message: 'System style profile slugs are reserved' })
  }
  if (Object.values(persona).every((value) => value === undefined)) {
    context.addIssue({ code: 'custom', message: 'At least one field must be provided' })
  }
})
// Scope (organizationId/departmentId/teamId) is not part of this shape -- a profile's scope is
// immutable, PATCH /v1/content-style-profiles/:id derives it from the existing row instead.
export const UpdateCustomStyleProfileRequestSchema = z.object({
  slug: ContentPresetSlugSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  styleRules: StyleProfileRulesSchema.optional(),
  avoidRules: StyleProfileRuleListSchema.optional(),
  doRules: StyleProfileRuleListSchema.optional(),
  isActive: z.boolean().optional(),
}).superRefine((profile, context) => {
  if (profile.slug !== undefined && (SystemStyleProfileSlugSchema.options as readonly string[]).includes(profile.slug)) {
    context.addIssue({ code: 'custom', path: ['slug'], message: 'System style profile slugs are reserved' })
  }
  if (Object.values(profile).every((value) => value === undefined)) {
    context.addIssue({ code: 'custom', message: 'At least one field must be provided' })
  }
})
// Plan 040: "Persona/Stilprofil testen" calls the active text provider directly and
// synchronously -- no session/candidate row, no preset. sampleInput plays the role a preset's
// sourceMaterial normally plays (a single allowedClaim); there is no communicationGoal/preset
// here, so previewStyleProfile (apps/api/src/routes/shared.ts) fills those in with fixed values.
const StyleProfilePreviewCoreSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
  sampleInput: z.string().trim().min(1).max(300),
})
export const PreviewPlatformStylePersonaRequestSchema = StyleProfilePreviewCoreSchema
export const PreviewCustomStyleProfileRequestSchema = StyleProfilePreviewCoreSchema.extend({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable().optional(),
  teamId: UuidSchema.nullable().optional(),
}).superRefine((profile, context) => {
  if (profile.teamId && !profile.departmentId) context.addIssue({ code: 'custom', message: 'teamId requires departmentId' })
})
// "System-Prompt anzeigen": same request shape as the preview above (it needs the exact same
// draft state to build the prompt), but the response is the assembled prompt text instead of a
// generated post -- no provider call, no cost, so this is a pure, side-effect-free readback.
export const StyleProfilePromptPreviewSchema = z.object({ system: z.string(), user: z.string() })
export const GenerationIntentSchema = z.enum(['initial', 'revise'])
export const GenerationCandidateStatusSchema = z.enum(['pending', 'generating', 'ready', 'failed', 'accepted', 'abandoned', 'expired'])
export const CompositionSessionStatusSchema = z.enum(['draft', 'queued', 'generating', 'candidate_ready', 'failed', 'accepted', 'abandoned', 'expired'])

// Die Laengengrenze einer Plattform ist eine ZEICHEN-Grenze, kein Token-Budget: Instagram und X
// weisen einen zu langen Beitrag ab, und Tokens lassen sich darauf nicht verlaesslich umrechnen.
// Das Token-Budget bleibt daneben bestehen, ist aber nur die Leine fuer das Modell (global, nicht
// pro Plattform) -- die verbindliche Grenze ist max_characters.
//
// Dieselbe Spanne wie die CHECK-Constraints (composition_sessions.max_characters,
// text_generation_platform_defaults.max_characters): einmal benannt, damit die API nicht irgendwann
// einen Wert annimmt, den die Datenbank mit 23514 zurueckweist. Die Obergrenze 10000 laesst Raum
// fuer die tatsaechlichen Plattform-Maxima (X 280, Mastodon 500, LinkedIn 3000, Instagram 2200);
// wirksam gedeckelt wird ein Beitrag zusaetzlich durch GeneratedPostSchema.caption.
export const MaxCharactersSchema = z.int().min(100).max(10_000)
export const TEXT_GENERATION_DEFAULT_MAX_CHARACTERS = 2200
// Reines Modell-Budget, absichtlich nicht pro Plattform: es verhindert einen davonlaufenden
// Aufruf, waehrend die Plattform-Grenze ueber max_characters wirkt. Bleibt die feste Vorgabe fuer
// den Preview-Pfad (previewStyleProfile, routes/shared.ts), der keinen Sitzungs-max_characters
// kennt -- fuer eine echte Sitzung liefert deriveTextGenerationMaxOutputTokens unten den Wert.
export const TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS = 1200

// Plan 039, PR 1 Step 4: ohne diese Ableitung waere eine hoehere Plattform-Vorgabe (allen voran der
// Website-Kanal mit 5000 Zeichen, siehe text_generation_platform_defaults) ein leeres Versprechen --
// die Provider-Anfrage haette weiterhin nur das feste 1200-Token-Budget oben, und ein zu langer
// Beitrag kaeme mitten im Satz abgeschnitten zurueck.
//
// Drei Groessen, weil die Antwort aus drei Teilen besteht, die unabhaengig voneinander wachsen
// (Review dieses PRs -- eine einzelne "Zeichen / 3 + Pauschale"-Formel war an beiden Enden zu knapp):
//
// 1. Die Bildunterschrift selbst. ZWEI Zeichen je Token, nicht drei: die BPE-Tokenizer von Anthropic
//    und OpenAI sind auf Englisch (~4 Zeichen/Token) trainiert, deutscher Text mit Komposita und
//    Umlauten liegt bei ~2,0-2,5. Drei war die optimistische Kante -- ein 5000-Zeichen-Blogbeitrag
//    waere damit bei etwa der Haelfte abgeschnitten.
// 2. Der feste JSON-Rahmen: Headline, kurze Bildunterschrift, Call-to-Action, Alt-Text, Hashtags,
//    Schluessel und Syntax.
// 3. Der Beleg-Anteil, und der ist NICHT pauschal: assertGroundedPost verlangt, dass jeder belegte
//    Claim in der Antwort auftaucht, und GeneratedPostSchema laesst ihn gleich zweimal auftauchen
//    (verifiedFacts UND generatedClaims). Ein Spielbericht mit 24 Belegen kostet so mehr Tokens als
//    die gesamte Bildunterschrift. Mit einem festen Zuschlag verhungerte genau der Fall, fuer den
//    die Textwerkstatt gebaut ist.
//
// Keine Obergrenze mehr: MaxCharactersSchema (10000) und SourceMaterialSchema (30 Fakten +
// 20 Beobachtungen + 10 Zitate = 60 Belege) decken den Aufruf bereits auf rund 12100 Token, und ein
// Deckel darunter waere wieder das stille Abschneiden, das dieser Schritt gerade beseitigt.
// Untergrenze ist das bisherige feste Budget -- keine bestehende Sitzung darf durch diese Ableitung
// WENIGER bekommen als vorher (bei 2200 Zeichen waeren es sonst 1134 statt 1200 gewesen).
//
// Die Faktoren sind geschaetzt, nicht gemessen (offener Punkt in plans/039) -- vor dem ersten echten
// Blogbetrieb einmal gegen einen 5000-Zeichen-Beitrag mit vielen Belegen gegenpruefen.
const TEXT_GENERATION_CHARACTERS_PER_TOKEN = 2
const TEXT_GENERATION_ENVELOPE_TOKENS = 500
const TEXT_GENERATION_TOKENS_PER_CLAIM = 110
export function deriveTextGenerationMaxOutputTokens(maxCharacters: number, claimCount = 0): number {
  const derived = Math.ceil(maxCharacters / TEXT_GENERATION_CHARACTERS_PER_TOKEN)
    + TEXT_GENERATION_ENVELOPE_TOKENS
    + claimCount * TEXT_GENERATION_TOKENS_PER_CLAIM
  return Math.max(TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS, derived)
}

// Paket 042: wie stark die Persona-Stimme im jeweiligen Beitrag durchschlaegt -- nicht der Ton
// selbst (der kommt von der Persona). Single Source of Truth fuer die DB-CHECK-Constraint
// (composition_sessions.temperature), die API-Validierung und den Frontend-Regler.
//
// Achtung fuer die Regler-UI (PR 3): der Anthropic-Adapter sendet temperature bewusst nicht
// (aktuelle Claude-Modelle lehnen den Parameter mit 400 ab, siehe
// AnthropicStructuredContentGenerator in packages/content-engine/src/index.ts). Laeuft der aktive
// Text-Provider auf diesem Protokoll, bleibt die Stufenwahl ohne Wirkung -- die entfernte
// Provider-UI hatte dafuer einen eigenen Hinweis, die Beitrags-UI braucht ihn wieder.
export const TEXT_GENERATION_TEMPERATURE_STEPS = [
  { value: 0.3, label: 'Dezent', hint: 'Die Persona schimmert nur leicht durch.' },
  { value: 0.6, label: 'Ausgewogen', hint: 'Gute Mischung aus Fakten und Persona-Stil.' },
  { value: 0.8, label: 'Ausgeprägt', hint: 'Der typische Sound der Persona dominiert.' },
  { value: 1.0, label: 'Vollgas', hint: 'Maximale Übertreibung, volle Show.' },
] as const
export const TextGenerationTemperatureSchema = z.literal(TEXT_GENERATION_TEMPERATURE_STEPS.map((step) => step.value))
// Plan 042, PR 3 Step 3: eine Route statt zweier, weil das Formular beides zusammen braucht --
// was anhakbar ist UND welche Laenge daraus folgt. available: false wird ausgegraut angezeigt,
// nicht versteckt, sonst raetselt ein Mitglied, warum eine Plattform fehlt.
export const TextGenerationPlatformAvailabilitySchema = z.object({
  platform: SocialPlatformSchema,
  available: z.boolean(),
  maxCharacters: MaxCharactersSchema,
  reason: z.enum(['no_channel', 'restricted_by_policy']).optional(),
})
// Die "Ausgewogen"-Stufe als Vorgabe -- aus der Liste gelesen statt als zweites 0.6-Literal, sonst
// wuerde ein Umbau der Stufen einen Default hinterlassen, den das eigene Schema ablehnt.
export const TEXT_GENERATION_DEFAULT_TEMPERATURE = TEXT_GENERATION_TEMPERATURE_STEPS[1].value

export const CreateCompositionSessionSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  teamId: UuidSchema.nullable().optional(),
  presetSlug: ContentPresetSlugSchema,
  communicationGoal: CommunicationGoalSchema,
  requestedFormats: z.array(CompositionFormatSchema).min(1).max(3).superRefine((formats, context) => {
    if (formats.includes('video_post') && formats.length > 1) context.addIssue({ code: 'custom', message: 'video_post cannot be combined with another presentation type' })
    if (new Set(formats).size !== formats.length) context.addIssue({ code: 'custom', message: 'requestedFormats must not contain duplicates' })
  }),
  styleProfileId: UuidSchema.nullable().optional(),
  systemStyleProfileSlug: SystemStyleProfileSlugSchema.optional(),
  // Plan 037: a third, mutually exclusive choice alongside styleProfileId/systemStyleProfileSlug.
  // Validated only on form here, like ContentPresetSlugSchema elsewhere -- actual existence and
  // isActive are checked at runtime in the route, exactly like styleProfileId already is today.
  personaSlug: ContentPresetSlugSchema.optional(),
  sourceMaterial: z.lazy(() => SourceMaterialSchema),
  mediaAssetIds: z.array(UuidSchema).max(10).default([]),
  sourceRevision: z.int().positive().default(1),
  // Paket 042: Mehrfachauswahl, weil ein Verein denselben Beitrag ueblicherweise auf mehreren
  // Plattformen veroeffentlicht. Aus der Auswahl leitet die Route die verbindliche Zeichengrenze ab
  // (Sitzungs-Override > kleinste Vorgabe der gewaehlten Plattformen > Fallback, siehe
  // routes/content.ts). Welche Plattformen ein Mitglied ueberhaupt anhaken darf, ergibt sich aus den
  // eingerichteten Kanaelen seines Scopes; die Route prueft das seit Plan 042, PR 3 selbst und
  // antwortet mit 422 platform_not_available. Der Vorgabewert unten ist deshalb kein sicherer
  // Rueckfall mehr: ein Verein ohne Facebook-Kanal laeuft damit in genau dieses 422. Wer die Route
  // aufruft, sollte targetPlatforms aus GET /v1/text-generation-platforms setzen statt wegzulassen.
  //
  // Der Vorgabewert ist bewusst ausgeschrieben und NICHT aus SocialPlatformSchema.options
  // abgeleitet: sobald eine Kurzform-Plattform dazukommt, wuerde "alle vorausgewaehlt" zusammen mit
  // der min()-Regel jeden Beitrag stillschweigend auf deren Laenge zusammenstauchen. Bei deutlich
  // unterschiedlichen Grenzen gehoeren getrennte Texte je Plattform hin
  // (GeneratedPostSchema.variants, Plan 005) statt eines gemeinsam gekuerzten Textes.
  targetPlatforms: z.array(SocialPlatformSchema).min(1).max(SocialPlatformSchema.options.length).superRefine((platforms, context) => {
    if (new Set(platforms).size !== platforms.length) context.addIssue({ code: 'custom', message: 'targetPlatforms must not contain duplicates' })
  }).default(['instagram', 'facebook']),
  // Zeichen, nicht Tokens: die Plattform weist einen zu langen Beitrag ab.
  maxCharacters: MaxCharactersSchema.optional(),
  temperature: TextGenerationTemperatureSchema.default(TEXT_GENERATION_DEFAULT_TEMPERATURE),
}).superRefine((value, context) => {
  const chosen = [value.styleProfileId, value.systemStyleProfileSlug, value.personaSlug].filter((field) => field !== undefined && field !== null)
  if (chosen.length > 1) context.addIssue({ code: 'custom', message: 'Choose at most one of styleProfileId, systemStyleProfileSlug, or personaSlug' })
})
export const CreateGenerationCommandSchema = z.object({
  sessionId: UuidSchema,
  generationIntent: GenerationIntentSchema,
  revisionInstruction: z.string().trim().min(1).max(500).optional(),
}).superRefine((command, context) => {
  if (command.generationIntent === 'revise' && !command.revisionInstruction) context.addIssue({ code: 'custom', message: 'A revision instruction is required' })
  if (command.generationIntent === 'initial' && command.revisionInstruction) context.addIssue({ code: 'custom', message: 'An initial generation does not accept a revision instruction' })
})
export const SourceFactValueSchema = z.union([z.string().trim().min(1).max(500), z.number().finite(), z.boolean()])

export const SourceMaterialSchema = z.object({
  facts: z.record(z.string().trim().min(1).max(80), SourceFactValueSchema).refine((facts) => Object.keys(facts).length <= 30),
  observations: z.array(z.string().trim().min(1).max(500)).max(20),
  quotes: z.array(z.object({ text: z.string().trim().min(1).max(500), attribution: z.string().trim().min(1).max(120).optional(), approved: z.boolean() })).max(10),
  doNotMention: z.array(z.string().trim().min(1).max(200)).max(20),
}).superRefine((material, context) => {
  if (Object.keys(material.facts).length + material.observations.length + material.quotes.length === 0) {
    context.addIssue({ code: 'custom', message: 'At least one fact, observation, or quote is required' })
  }
})

export const HealthSchema = z.object({
  status: z.literal('ok'), service: z.string().min(1), version: z.string().min(1), timestamp: z.iso.datetime(),
})

const RoleNameSchema = z.string().min(1)
export const MembershipTeamScopeSchema = z.object({
  id: UuidSchema, name: z.string().min(1), roles: z.array(RoleNameSchema),
})
export const MembershipDepartmentScopeSchema = z.object({
  id: UuidSchema, name: z.string().min(1), roles: z.array(RoleNameSchema), teams: z.array(MembershipTeamScopeSchema),
})
export const MembershipScopeSchema = z.object({
  organizationId: UuidSchema, organizationName: z.string().min(1), organizationTimezone: z.string().min(1),
  organizationRoles: z.array(RoleNameSchema), departments: z.array(MembershipDepartmentScopeSchema),
})
export const MembershipScopesSchema = z.array(MembershipScopeSchema)

// Kept as an exported alias for integrations compiled against the prototype.
export const ContentTypeSchema = ContentPresetSlugSchema
export const SafetyFlagSchema = z.enum(['minor', 'missing_consent', 'uncertain_fact', 'sensitive_data'])

// Breaking: replaces the earlier contentType/facts shape; WorkflowPayloadSchema requires only IDs,
// a technical purpose and an idempotency key -- no content can cross this boundary.
export const CreateSubmissionSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  teamId: UuidSchema.nullable().optional(),
  presetSlug: ContentPresetSlugSchema,
  communicationGoal: CommunicationGoalSchema,
  requestedFormats: z.array(OutputFormatSchema).min(1).max(4),
  sourceMaterial: SourceMaterialSchema,
  sourceRevision: z.int().positive().default(1),
  priority: z.int().min(10).max(100).default(40),
  // Paket 019: aus welchem Spiel/welcher Veranstaltung entstand dieser Beitrag. Herkunft
  // (source_provenance/source_revision_at/source_prefill_snapshot) leitet die API selbst aus der
  // referenzierten Zeile ab, nie aus Client-Angaben -- vgl. plans/README.md "RPC traut Client nicht".
  fixtureId: UuidSchema.optional(),
  clubEventId: UuidSchema.optional(),
}).refine((value) => !value.fixtureId || !value.clubEventId, {
  message: 'fixtureId and clubEventId are mutually exclusive',
})

export const ClaimSchema = z.object({ sourceId: z.string().min(1).max(100), text: z.string().trim().min(1).max(500) })
export const PlatformVariantSchema = z.object({
  platform: z.enum(['instagram', 'facebook']), format: OutputFormatSchema,
  headline: z.string().trim().min(1).max(80), caption: z.string().trim().max(2200),
  callToAction: z.string().trim().max(240), hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u)).max(12),
  altText: z.string().trim().min(1).max(500), layoutFamily: z.enum(['photo_moment', 'training', 'quote', 'collage', 'invitation', 'thanks', 'result']),
  slidePlan: z.array(z.object({ role: z.string().min(1).max(40), headline: z.string().max(80).optional(), body: z.string().max(240).optional(), mediaAssetId: UuidSchema.optional() })).max(10).optional(),
  claimSourceIds: z.array(z.string().min(1).max(100)).max(40),
})

export const GeneratedPostSchema = z.object({
  verifiedFacts: z.array(z.string()).max(60), missingFacts: z.array(z.string()).max(30),
  headline: z.string().max(80), caption: z.string().max(10_000), shortCaption: z.string().max(500),
  callToAction: z.string().max(240), hashtags: z.array(z.string()).max(12), altText: z.string().max(500),
  templateId: z.string().min(1), safetyFlags: z.array(SafetyFlagSchema),
  generatedClaims: z.array(ClaimSchema).max(60).default([]), variants: z.array(PlatformVariantSchema).max(8).default([]),
})

export const ObscuringStyleSchema = z.enum(['club_mascot', 'sports_ball', 'emoji', 'confetti_badge', 'brand_shape', 'scribble', 'pixelate', 'solid_blur'])
export const FaceDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('consented'), consentRecordId: UuidSchema }),
  z.object({ kind: z.literal('obscure'), style: ObscuringStyleSchema }), z.object({ kind: z.literal('exclude') }),
])
// Paket 015 ergaenzt drei Blocker: consent_scope_mismatch (Zeile gueltig, deckt aber nicht den
// angefragten Umfang), naming_not_allowed und sensitive_text_data (beide textbasiert, siehe
// scanTextForSensitiveData in packages/domain -- wirken unabhaengig davon, ob ueberhaupt ein Foto
// existiert).
export const MediaGateBlockerSchema = z.enum([
  'scan_pending', 'face_pending', 'consent_invalid', 'derivative_stale', 'minor_review_required', 'original_selected',
  'consent_scope_mismatch', 'naming_not_allowed', 'sensitive_text_data',
])
export const MediaGateResultSchema = z.object({ publishable: z.boolean(), blockers: z.array(MediaGateBlockerSchema) })

export type Health = z.infer<typeof HealthSchema>
export type ContentPresetSlug = z.infer<typeof ContentPresetSlugSchema>
export type CommunicationGoal = z.infer<typeof CommunicationGoalSchema>
export type OutputFormat = z.infer<typeof OutputFormatSchema>
export type SourceMaterial = z.infer<typeof SourceMaterialSchema>
export type CreateSubmission = z.infer<typeof CreateSubmissionSchema>
export type GeneratedPost = z.infer<typeof GeneratedPostSchema>
export type PlatformVariant = z.infer<typeof PlatformVariantSchema>
export type FaceDecision = z.infer<typeof FaceDecisionSchema>
export type MediaGateResult = z.infer<typeof MediaGateResultSchema>
export type MembershipScope = z.infer<typeof MembershipScopeSchema>
export type MediaGateBlocker = z.infer<typeof MediaGateBlockerSchema>
export type CompositionFormat = z.infer<typeof CompositionFormatSchema>
export type AttachmentUploadMetadata = z.infer<typeof AttachmentUploadMetadataSchema>
export type CompressionProvenance = z.infer<typeof CompressionProvenanceSchema>
export type StyleProfileExample = z.infer<typeof StyleProfileExampleSchema>
export type StyleProfileRules = z.infer<typeof StyleProfileRulesSchema>
export type StyleProfilePromptPreview = z.infer<typeof StyleProfilePromptPreviewSchema>
export type StyleProfileSnapshot = z.infer<typeof StyleProfileSnapshotSchema>
export type CustomStyleProfile = z.infer<typeof CustomStyleProfileSchema>
export type CreateCustomStyleProfileRequest = z.infer<typeof CreateCustomStyleProfileRequestSchema>
export type PlatformStylePersona = z.infer<typeof PlatformStylePersonaSchema>
export type CreatePlatformStylePersonaRequest = z.infer<typeof CreatePlatformStylePersonaRequestSchema>
export type UpdatePlatformStylePersonaRequest = z.infer<typeof UpdatePlatformStylePersonaRequestSchema>
export type UpdateCustomStyleProfileRequest = z.infer<typeof UpdateCustomStyleProfileRequestSchema>
export type PreviewPlatformStylePersonaRequest = z.infer<typeof PreviewPlatformStylePersonaRequestSchema>
export type PreviewCustomStyleProfileRequest = z.infer<typeof PreviewCustomStyleProfileRequestSchema>
export type CreateCompositionSession = z.infer<typeof CreateCompositionSessionSchema>
export type CreateGenerationCommand = z.infer<typeof CreateGenerationCommandSchema>
export type TextGenerationPlatformAvailability = z.infer<typeof TextGenerationPlatformAvailabilitySchema>
