import { z } from 'zod'
import { CommunicationGoalSchema, CompositionFormatSchema, ContentPresetSlugSchema, OutputFormatSchema, SourceMaterialSchema } from './content.js'
import { requireDepartmentForTeam, SocialPlatformSchema, UuidSchema } from './primitives.js'
import { SystemStyleProfileSlugSchema } from './styleProfiles.js'

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
// einen Wert annimmt, den die Datenbank mit 23514 zurueckweist. Die Obergrenze laesst Raum fuer die
// tatsaechlichen Plattform-Maxima (X 280, Mastodon 500, LinkedIn 3000, Instagram 2200).
//
// GeneratedPostSchema.caption unten teilt sich denselben Wert (Plan 044, Step 7): die Obergrenze muss
// mindestens so gross bleiben wie die groesste Plattform-Vorgabe, sonst weist das eigene Schema einen
// zulaessigen Blogbeitrag ab, bevor assertCaptionLength (packages/content-engine) ueberhaupt greift.
// Sichtbar aneinandergekoppelt statt zufaellig uebereinstimmend.
const MAX_CHARACTERS_CEILING = 10_000
export const MaxCharactersSchema = z.int().min(100).max(MAX_CHARACTERS_CEILING)
export const TEXT_GENERATION_DEFAULT_MAX_CHARACTERS = 2200
// Reines Modell-Budget, absichtlich nicht pro Plattform: es verhindert einen davonlaufenden
// Aufruf, waehrend die Plattform-Grenze ueber max_characters wirkt. Bleibt die feste Vorgabe fuer
// den Preview-Pfad (previewStyleProfile, services/styleProfilePreview.ts), der keinen Sitzungs-max_characters
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
// (composition_sessions.temperature) und die API-Validierung.
//
// Die Beitrags-UI (erstellen.vue) bietet keine eigene Stufenwahl mehr an -- CreateCompositionSessionSchema
// laesst den Wert auf TEXT_GENERATION_DEFAULT_TEMPERATURE fallen. Die Stufen bleiben als Vertrag fuer
// die DB-CHECK-Constraint und moegliche kuenftige Verwendung bestehen. Der Anthropic-Adapter sendet
// temperature ohnehin bewusst nicht (aktuelle Claude-Modelle lehnen den Parameter mit 400 ab, siehe
// AnthropicStructuredContentGenerator in packages/content-engine/src/index.ts).
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
  // Plan 044, PR 1 Step 3: aus der effektiven default_target_platforms-Vorgabe des angefragten
  // Scopes aufgeloest, MIT der Verfuegbarkeit geschnitten -- eine Plattform in der Vorgabe ohne
  // (mehr) eingerichteten Kanal ist nicht isDefault, sonst liefe das Formular vorausgewaehlt in ein
  // 422. erstellen.vue hakt genau die Plattformen an, fuer die dies true ist; ist keine Vorgabe
  // gesetzt, ist isDefault fuer jede Plattform false und die Auswahl startet leer.
  isDefault: z.boolean(),
})
// Die "Ausgewogen"-Stufe als Vorgabe -- aus der Liste gelesen statt als zweites 0.6-Literal, sonst
// wuerde ein Umbau der Stufen einen Default hinterlassen, den das eigene Schema ablehnt.
export const TEXT_GENERATION_DEFAULT_TEMPERATURE = TEXT_GENERATION_TEMPERATURE_STEPS[1].value

export const CreateCompositionSessionSchema = z.object({
  organizationId: UuidSchema,
  // null = organization-level (no specific department). CreateSubmissionSchema (content.ts) stays
  // department-required on purpose: it always originates from a fixture/club_event, which are
  // inherently department/team-scoped -- only the manual text-workshop path here is org-optional.
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable().optional(),
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
  sourceMaterial: SourceMaterialSchema,
  mediaAssetIds: z.array(UuidSchema).max(10).default([]),
  sourceRevision: z.int().positive().default(1),
  // Paket 042: Mehrfachauswahl, weil ein Verein denselben Beitrag ueblicherweise auf mehreren
  // Plattformen veroeffentlicht. Aus der Auswahl leitet die Route die verbindliche Zeichengrenze ab
  // (Sitzungs-Override > kleinste Vorgabe der gewaehlten Plattformen > Fallback, siehe
  // routes/textWorkshop.ts). Welche Plattformen ein Mitglied ueberhaupt anhaken darf, ergibt sich aus den
  // eingerichteten Kanaelen seines Scopes; die Route prueft das seit Plan 042, PR 3 selbst und
  // antwortet mit 422 platform_not_available.
  //
  // Plan 044, PR 1 Step 1: kein Vorgabewert mehr -- es gibt keinen, der fuer jeden Verein
  // funktioniert. `['instagram','facebook']` scheiterte bei jedem Verein ohne beide Kanaele an
  // genau diesem 422, und jede aus SocialPlatformSchema.options abgeleitete Variante wuerde mit der
  // ersten Kurzform-Plattform zusammen mit der min()-Regel jeden Beitrag stillschweigend auf deren
  // Laenge zusammenstauchen. Auf welchen Plattformen ein Verein veroeffentlicht, ist seine Sache --
  // GET /v1/text-generation-platforms liefert die eigene Vorgabe des Vereins/der Abteilung
  // (isDefault), erstellen.vue hakt genau die an, sonst startet die Auswahl leer.
  targetPlatforms: z.array(SocialPlatformSchema).min(1).max(SocialPlatformSchema.options.length).superRefine((platforms, context) => {
    if (new Set(platforms).size !== platforms.length) context.addIssue({ code: 'custom', message: 'targetPlatforms must not contain duplicates' })
  }),
  // Zeichen, nicht Tokens: die Plattform weist einen zu langen Beitrag ab.
  maxCharacters: MaxCharactersSchema.optional(),
  temperature: TextGenerationTemperatureSchema.default(TEXT_GENERATION_DEFAULT_TEMPERATURE),
}).superRefine((value, context) => {
  const chosen = [value.styleProfileId, value.systemStyleProfileSlug, value.personaSlug].filter((field) => field !== undefined && field !== null)
  if (chosen.length > 1) context.addIssue({ code: 'custom', message: 'Choose at most one of styleProfileId, systemStyleProfileSlug, or personaSlug' })
  requireDepartmentForTeam(value, context)
})

// Ein Werkstatt-Entwurf ist bewusst noch keine composition_session: Er darf unvollständig sein
// und löst weder eine Generation noch Kosten aus. Die eigentliche Fachversion entsteht weiterhin
// erst beim ausdrücklichen Übernehmen eines Kandidaten.
export const TextWorkshopDraftPayloadSchema = z.object({
  communicationGoal: CommunicationGoalSchema,
  factsText: z.string().max(10_000),
  observation: z.string().max(5_000),
  selectedProfile: z.string().trim().min(1).max(80),
  temperature: TextGenerationTemperatureSchema,
  selectedPlatforms: z.array(SocialPlatformSchema).max(SocialPlatformSchema.options.length).superRefine((platforms, context) => {
    if (new Set(platforms).size !== platforms.length) context.addIssue({ code: 'custom', message: 'selectedPlatforms must not contain duplicates' })
  }),
  maxCharactersOverride: z.string().max(5),
})
export const SaveTextWorkshopDraftSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable().optional(),
  payload: TextWorkshopDraftPayloadSchema,
}).superRefine(requireDepartmentForTeam)
export const TextWorkshopDraftRowSchema = z.object({
  id: UuidSchema, organization_id: UuidSchema, department_id: UuidSchema.nullable(), team_id: UuidSchema.nullable(),
  post_id: UuidSchema.nullable(), payload: TextWorkshopDraftPayloadSchema, created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }),
})
export const CreateGenerationCommandSchema = z.object({
  sessionId: UuidSchema,
  generationIntent: GenerationIntentSchema,
  revisionInstruction: z.string().trim().min(1).max(500).optional(),
}).superRefine((command, context) => {
  if (command.generationIntent === 'revise' && !command.revisionInstruction) context.addIssue({ code: 'custom', message: 'A revision instruction is required' })
  if (command.generationIntent === 'initial' && command.revisionInstruction) context.addIssue({ code: 'custom', message: 'An initial generation does not accept a revision instruction' })
})

export const SafetyFlagSchema = z.enum(['minor', 'missing_consent', 'uncertain_fact', 'sensitive_data'])
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
  headline: z.string().max(80), caption: z.string().max(MAX_CHARACTERS_CEILING), shortCaption: z.string().max(500),
  callToAction: z.string().max(240), hashtags: z.array(z.string()).max(12), altText: z.string().max(500),
  templateId: z.string().min(1), safetyFlags: z.array(SafetyFlagSchema),
  generatedClaims: z.array(ClaimSchema).max(60).default([]), variants: z.array(PlatformVariantSchema).max(8).default([]),
})


export type GeneratedPost = z.infer<typeof GeneratedPostSchema>
export type PlatformVariant = z.infer<typeof PlatformVariantSchema>
export type CreateCompositionSession = z.infer<typeof CreateCompositionSessionSchema>
export type CreateGenerationCommand = z.infer<typeof CreateGenerationCommandSchema>
export type TextGenerationPlatformAvailability = z.infer<typeof TextGenerationPlatformAvailabilitySchema>
export type TextWorkshopDraftPayload = z.infer<typeof TextWorkshopDraftPayloadSchema>
