import { GeneratedPostSchema, PlatformVariantSchema, SafetyFlagSchema, type CreateSubmission, type GeneratedPost, type PlatformVariant, type StyleProfileSnapshot } from '@vereinsfunk/contracts'
import { createGuardedFetch, OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import { getPreset, validateSourceMaterial } from './presets.js'

export { factsFromFixture, factsFromClubEvent } from './schedule.js'
export type { FactsFromScheduleResult } from './schedule.js'
export { AnthropicVisionAnalysisGenerator, OpenAiCompatibleVisionAnalysisGenerator, VisionAnalysisError } from './visionAnalysis.js'
export type { FontPairingOption, VisionAnalysisGenerator, VisionAnalysisInput, VisionAnalysisResult } from './visionAnalysis.js'

export interface GroundedContentBrief { allowedClaims: readonly { sourceId: string; text: string }[]; approvedQuotes: readonly { sourceId: string; text: string; attribution?: string }[]; missingFacts: readonly string[]; prohibitedClaims: readonly string[]; goal: CreateSubmission['communicationGoal']; requestedFormats: CreateSubmission['requestedFormats']; presetSlug: string }
// Text-workshop-Sitzungen kennen keinen Anlass (presetSlug) mehr und damit auch keine daran
// haengende Pflichtfakten-Pruefung (missingFacts) oder Formatvarianten (requestedFormats) -- ein
// Omit statt einer zweiten, von Hand parallel gepflegten Feldliste.
export type TextGroundedContentBrief = Omit<GroundedContentBrief, 'missingFacts' | 'requestedFormats' | 'presetSlug'>
export interface ContentGenerator { generate(input: CreateSubmission, forbiddenTopics: readonly string[]): Promise<GeneratedPost> }

/** Claims/Zitate sind fuer Foto- und Text-Briefs identisch aus dem Quellmaterial abgeleitet. */
function claimsFromSourceMaterial(sourceMaterial: CreateSubmission['sourceMaterial']) {
  const allowedClaims = [
    ...Object.entries(sourceMaterial.facts).map(([key, value]) => ({ sourceId: `fact:${key}`, text: `${key}: ${value}` })),
    ...sourceMaterial.observations.map((text, index) => ({ sourceId: `observation:${index + 1}`, text })),
  ]
  const approvedQuotes = sourceMaterial.quotes.filter((quote) => quote.approved).map((quote, index) => quote.attribution ? ({ sourceId: `quote:${index + 1}`, text: quote.text, attribution: quote.attribution }) : ({ sourceId: `quote:${index + 1}`, text: quote.text }))
  return { allowedClaims, approvedQuotes }
}

export function createGroundedContentBrief(input: CreateSubmission, forbiddenTopics: readonly string[]): GroundedContentBrief {
  const preset = getPreset(input.presetSlug)
  const { allowedClaims, approvedQuotes } = claimsFromSourceMaterial(input.sourceMaterial)
  return { allowedClaims, approvedQuotes, missingFacts: validateSourceMaterial(preset, input.sourceMaterial), prohibitedClaims: forbiddenTopics, goal: input.communicationGoal, requestedFormats: input.requestedFormats, presetSlug: input.presetSlug }
}

/**
 * Text-workshop equivalent which intentionally has no visual output or media input, and -- anders
 * als createGroundedContentBrief -- keinen Anlass (presetSlug): die daran haengende Pflichtfakten-
 * Pruefung je Anlasstyp war nur ein weiches Signal im Prompt, nie eine Sperre. Die harte Grundlage
 * bleibt unveraendert die source_material-CHECK (mindestens ein Fakt/eine Beobachtung/ein Zitat)
 * und assertGroundedPost() gegen die bestaetigten Quellen.
 */
export function createTextGroundedContentBrief(input: Pick<CreateSubmission, 'communicationGoal' | 'sourceMaterial'>, forbiddenTopics: readonly string[]): TextGroundedContentBrief {
  const { allowedClaims, approvedQuotes } = claimsFromSourceMaterial(input.sourceMaterial)
  return { allowedClaims, approvedQuotes, prohibitedClaims: forbiddenTopics, goal: input.communicationGoal }
}

function layoutFor(slug: string): PlatformVariant['layoutFamily'] { if (slug.includes('training') || slug.includes('children')) return 'training'; if (slug === 'volunteering') return 'thanks'; if (slug === 'event' || slug === 'new_offer') return 'invitation'; if (slug.includes('match')) return 'result'; return 'photo_moment' }
export class FakeContentGenerator implements ContentGenerator {
  async generate(input: CreateSubmission, forbiddenTopics: readonly string[]): Promise<GeneratedPost> {
    const brief = createGroundedContentBrief(input, forbiddenTopics)
    const claims = [...brief.allowedClaims, ...brief.approvedQuotes]
    const first = claims[0]?.text ?? 'Deine Geschichte braucht noch einen bestätigten Moment.'
    const headline = first.length <= 80 ? first : first.slice(0, 77) + '…'
    const caption = [headline, ...claims.map((claim) => `• ${claim.text}`)].join('\n\n')
    const buildVariant = (limit: number) => {
      let text = headline
      const included: typeof claims = []
      for (const claim of claims) {
        const next = `${text}\n\n• ${claim.text}`
        if (next.length > limit) break
        text = next
        included.push(claim)
      }
      return { caption: text, claimSourceIds: included.map((claim) => claim.sourceId) }
    }
    const variants = input.requestedFormats.flatMap((format) => (['instagram', 'facebook'] as const).map((platform) => {
      const built = buildVariant(platform === 'instagram' ? 2200 : 1800)
      return { platform, format, headline, caption: built.caption, callToAction: 'Teile diesen echten Vereinsmoment mit deinem Team.', hashtags: ['#vereinsleben', '#gemeinsamstark'], altText: `Vereinsmotiv: ${headline}`, layoutFamily: layoutFor(input.presetSlug), claimSourceIds: built.claimSourceIds }
    }))
    return GeneratedPostSchema.parse({ verifiedFacts: claims.map((claim) => claim.text), missingFacts: brief.missingFacts, headline, caption: caption.slice(0, 1800), shortCaption: caption.slice(0, 500), callToAction: 'Teile diesen echten Vereinsmoment mit deinem Team.', hashtags: ['#vereinsleben', '#gemeinsamstark'], altText: `Vereinsmotiv: ${headline}`, templateId: `${input.presetSlug}-v1`, safetyFlags: brief.missingFacts.length ? ['uncertain_fact'] : [], generatedClaims: claims, variants })
  }
}

/** Error information intentionally contains no input or output text and is safe for worker logs. */
export class ContentGenerationError extends Error {
  constructor(
    readonly errorClass: 'provider_network' | 'provider_rate_limit' | 'provider_server' | 'provider_schema' | 'provider_configuration' | 'ungrounded' | 'caption_too_long',
    readonly retryable: boolean,
    /** Nur bei `caption_too_long` gesetzt: wie viele Zeichen die Antwort ueber die Grenze ging. */
    readonly overBy?: number,
  ) {
    super(errorClass)
  }
}

export function assertGroundedPost(post: GeneratedPost, brief: Pick<GroundedContentBrief, 'allowedClaims' | 'approvedQuotes' | 'prohibitedClaims'>): void {
  const allowed = new Set([...brief.allowedClaims, ...brief.approvedQuotes].map((claim) => claim.sourceId))
  if (post.generatedClaims.some((claim) => !allowed.has(claim.sourceId)) || post.variants.some((variant) => variant.claimSourceIds.some((id) => !allowed.has(id)))) throw new ContentGenerationError('ungrounded', false)
  const rendered = [post.headline, post.caption, post.shortCaption, post.callToAction, post.altText, ...post.hashtags, ...post.verifiedFacts].join('\n').toLocaleLowerCase('de')
  if (brief.prohibitedClaims.some((phrase) => rendered.includes(phrase.toLocaleLowerCase('de')))) {
    throw new ContentGenerationError('ungrounded', false)
  }
}

// UTF-16-Code-Units, dieselbe Einheit, die MaxCharactersSchema und der System-Prompt (`Der
// Beitragstext (caption) darf hoechstens N Zeichen lang sein`) bereits stillschweigend voraussetzen.
// Instagram/Facebook/Website (Plan 039) zaehlen alle so. Eigene, benannte Funktion statt eines
// verstreuten `.length`-Aufrufs: eine kuenftige Plattform mit abweichender Zaehlweise (X gewichtet
// Zeichenbereiche unterschiedlich und rechnet jede URL pauschal als 23 Zeichen) ersetzt sie lokal,
// ohne die Aufrufstelle unten zu aendern (Plan 044, offener Punkt 1).
export function countCharactersForPlatform(text: string): number {
  return text.length
}

// Die Plattform weist einen zu langen Beitrag ab -- ein Zeichen zu viel und der Beitrag wird
// abgelehnt (Betreiberentscheidung, Plan 044). Neben assertGroundedPost, damit sie fuer jeden
// Aufrufer greift, nicht nur den Worker. Geprueft wird ausschliesslich `caption`: headline (80),
// shortCaption (500) und altText (500) haben eigene, unabhaengige Grenzen. `maxCharacters` fehlt im
// Preview-Pfad (kein Sitzungskontext) -- dort greift keine Pruefung.
export function assertCaptionLength(post: GeneratedPost, maxCharacters: number | undefined): void {
  if (maxCharacters === undefined) return
  const length = countCharactersForPlatform(post.caption)
  if (length > maxCharacters) throw new ContentGenerationError('caption_too_long', false, length - maxCharacters)
}

// The output contract below is part of the prompt. Bump this whenever its wording or shape
// changes so accepted post versions retain accurate generation provenance.
// v3: missingFacts/presetSlug dropped from the user JSON alongside the Anlass removal -- the
// shape sent to the model changed even though the output contract below did not.
export const TEXT_PROMPT_TEMPLATE_VERSION = 'text-workshop-v3'

export type StructuredTextGeneratorInput = {
  brief: TextGroundedContentBrief
  styleProfile: StyleProfileSnapshot
  revisionInstruction?: string
  model: string
  baseUrl: string
  apiKey: string
  temperature: number
  maxOutputTokens: number
  /** Verbindliche Zeichengrenze der knappsten Ziel-Plattform. Fehlt im Preview-Pfad, der keine hat. */
  maxCharacters?: number
  requestTimeoutMs?: number
}

export interface StructuredContentGenerator {
  generateText(input: StructuredTextGeneratorInput): Promise<GeneratedPost>
}

export function buildStructuredTextPrompt(input: Pick<StructuredTextGeneratorInput, 'brief' | 'styleProfile' | 'revisionInstruction' | 'maxCharacters'>) {
  const instruction = input.revisionInstruction ? input.revisionInstruction.slice(0, 500) : undefined
  // The ordering is the ADR-010 priority ordering. User-controlled material is data, never an
  // instruction with more authority than these fixed rules.
  return {
    system: [
      'Erzeuge ausschließlich einen faktengebundenen deutschsprachigen Vereinsbeitrag als JSON.',
      'Niemals Fakten, Namen, Ergebnisse, Termine oder Zitate ergänzen. Verwende nur claimSourceIds aus den bestätigten Quellen.',
      'Beachte verbotene Nennungen und Stil-No-Gos. Bei fehlenden Fakten nenne sie in missingFacts statt sie zu erfinden.',
      `Stilprofil: ${input.styleProfile.name}. ${input.styleProfile.description}`,
      `Stilregeln: ${JSON.stringify(input.styleProfile.styleRules)}. Dos: ${JSON.stringify(input.styleProfile.doRules)}. No-Gos: ${JSON.stringify(input.styleProfile.avoidRules)}`,
      'Die Beispiele in styleRules.examples sind ausschließlich Stilbeispiele: Ihr Feld output enthält unformatierten Beispieltext, keinen vollständigen Modell-Output. Übernimm daraus nur Stilmerkmale, keine Fakten oder Antwortstruktur.',
      `Gib ausschließlich ein JSON-Objekt ohne Markdown oder Begleittext zurück. Die folgenden Schlüssel und Typen sind verbindlich; jede Antwort muss diesem JSON-Schema entsprechen:\n${JSON.stringify(generatedPostJsonSchema)}`,
      // Die Zielplattform weist einen zu langen Beitrag ab. Die Angabe steht hier, weil das
      // Token-Budget des Aufrufs sie nicht ersetzen kann -- Tokens sind keine Zeichen.
      ...(input.maxCharacters ? [`Der Beitragstext (caption) darf hoechstens ${input.maxCharacters} Zeichen lang sein.`] : []),
    ].join('\n'),
    user: JSON.stringify({
      confirmedSources: { claims: input.brief.allowedClaims, approvedQuotes: input.brief.approvedQuotes },
      prohibitedClaims: input.brief.prohibitedClaims,
      goal: input.brief.goal,
      revisionInstruction: instruction,
    }),
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/**
 * Haengt `path` ueber `URL.pathname` an, nicht per String-Konkatenation: eine Basis-URL mit
 * Query-String wuerde sonst den Schlussteil des Pfads verschlucken, weil ein angehaengter "/"
 * hinter dem "?" landet statt davor.
 */
function joinUrlPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`
  return url.toString()
}

/** OpenAI-compatible, JSON-schema constrained adapter. It is deliberately worker injectable. */
export class OpenAiCompatibleStructuredContentGenerator implements StructuredContentGenerator {
  constructor(private readonly fetcher: FetchLike = createGuardedFetch()) {}

  async generateText(input: StructuredTextGeneratorInput): Promise<GeneratedPost> {
    const prompt = buildStructuredTextPrompt(input)
    let response: Response
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.requestTimeoutMs ?? 60_000)
    try {
      response = await this.fetcher(joinUrlPath(input.baseUrl, 'chat/completions'), {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: input.model, temperature: input.temperature, max_tokens: input.maxOutputTokens,
          response_format: { type: 'json_schema', json_schema: { name: 'generated_post', strict: true, schema: generatedPostJsonSchema } },
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        }),
      })
    } catch (error) {
      // Eine blockierte oder umgeleitete Zieladresse ist eine dauerhafte Fehlkonfiguration, kein
      // transienter Netzwerkfehler -- drei automatische Hatchet-Wiederholungen waeren verschwendet.
      if (error instanceof OutboundFetchError) throw new ContentGenerationError('provider_configuration', false)
      throw new ContentGenerationError('provider_network', true)
    } finally { clearTimeout(timeout) }
    if (response.status === 429) throw new ContentGenerationError('provider_rate_limit', true)
    if (response.status >= 500) throw new ContentGenerationError('provider_server', true)
    if (!response.ok) throw new ContentGenerationError('provider_schema', false)
    let content: unknown
    try {
      const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
      const raw = body.choices?.[0]?.message?.content
      content = typeof raw === 'string' ? JSON.parse(raw) : raw
      const post = GeneratedPostSchema.parse(content)
      assertGroundedPost(post, input.brief)
      assertCaptionLength(post, input.maxCharacters)
      return post
    } catch (error) {
      if (error instanceof ContentGenerationError) throw error
      throw new ContentGenerationError('provider_schema', false)
    }
  }
}

/**
 * Name des Werkzeugs, das die schemakonforme Antwort erzwingt. Der Wert ist nicht frei waehlbar:
 * haex-claude-proxy erkennt genau diesen Namen und uebergibt dessen `input_schema` als
 * `--json-schema` an die Claude-CLI (src/cli-format.js, OUTPUT_TOOL_NAME) -- ein anderer Name
 * landet dort im Ausgabe-Werkzeug-Filter und die Antwort kaeme als Prosa zurueck. Fuer
 * api.anthropic.com ist es ein gewoehnlicher Werkzeugname ohne Sonderbedeutung, derselbe Aufruf
 * funktioniert also gegen beide Gegenstellen.
 */
const ANTHROPIC_OUTPUT_TOOL_NAME = 'final_result'

/**
 * Anthropic-Messages-Adapter. Strukturierte Ausgabe laeuft ueber erzwungenen Werkzeugaufruf statt
 * ueber `output_config.format`: nur diesen Weg unterstuetzt haex-claude-proxy im Abo-Modus, in dem
 * die Claude-CLI als Unterprozess laeuft und `output_config` nie zu sehen bekaeme.
 *
 * `temperature` wird bewusst nicht gesendet. Die aktuellen Claude-Modelle lehnen den Parameter mit
 * 400 ab, und im Abo-Modus des Proxys gaebe es ohnehin keinen Regler dafuer -- der konfigurierte
 * Wert bleibt fuer OpenAI-kompatible Provider gueltig und wird hier stillschweigend nicht benutzt.
 */
export class AnthropicStructuredContentGenerator implements StructuredContentGenerator {
  constructor(private readonly fetcher: FetchLike = createGuardedFetch()) {}

  async generateText(input: StructuredTextGeneratorInput): Promise<GeneratedPost> {
    const prompt = buildStructuredTextPrompt(input)
    let response: Response
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.requestTimeoutMs ?? 60_000)
    try {
      response = await this.fetcher(joinUrlPath(input.baseUrl, 'messages'), {
        method: 'POST',
        signal: controller.signal,
        // x-api-key statt Bearer: die echte Anthropic-API verlangt es so, und die Resolver des
        // Proxys lesen denselben Kopf. Beide Koepfe gleichzeitig lehnt api.anthropic.com ab.
        headers: { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: input.model, max_tokens: input.maxOutputTokens,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          tools: [{ name: ANTHROPIC_OUTPUT_TOOL_NAME, description: 'Gibt den fertigen Vereinsbeitrag zurueck.', input_schema: generatedPostJsonSchema }],
          tool_choice: { type: 'tool', name: ANTHROPIC_OUTPUT_TOOL_NAME },
        }),
      })
    } catch (error) {
      // Eine blockierte oder umgeleitete Zieladresse ist eine dauerhafte Fehlkonfiguration, kein
      // transienter Netzwerkfehler -- drei automatische Hatchet-Wiederholungen waeren verschwendet.
      if (error instanceof OutboundFetchError) throw new ContentGenerationError('provider_configuration', false)
      throw new ContentGenerationError('provider_network', true)
    } finally { clearTimeout(timeout) }
    if (response.status === 429) throw new ContentGenerationError('provider_rate_limit', true)
    if (response.status >= 500) throw new ContentGenerationError('provider_server', true)
    if (!response.ok) throw new ContentGenerationError('provider_schema', false)
    try {
      const body = await response.json() as { stop_reason?: unknown; content?: Array<{ type?: unknown; name?: unknown; input?: unknown }> }
      // Eine Ablehnung durch die Sicherheitsklassifikatoren kommt als HTTP 200 ohne Werkzeugaufruf
      // zurueck; ein erneuter Versuch mit derselben Eingabe wuerde genauso enden.
      if (body.stop_reason === 'refusal') throw new ContentGenerationError('provider_schema', false)
      const block = body.content?.find((entry) => entry.type === 'tool_use' && entry.name === ANTHROPIC_OUTPUT_TOOL_NAME)
      const post = GeneratedPostSchema.parse(block?.input)
      assertGroundedPost(post, input.brief)
      assertCaptionLength(post, input.maxCharacters)
      return post
    } catch (error) {
      if (error instanceof ContentGenerationError) throw error
      throw new ContentGenerationError('provider_schema', false)
    }
  }
}

// JSON Schema is sent to the provider; Zod remains the authoritative second validation boundary.
// platform/format/layoutFamily/safetyFlags are enums on the Zod side (PlatformVariantSchema,
// SafetyFlagSchema) -- read here via .options instead of re-typed as bare `string` so the two
// never drift apart again. A prior drift meant the provider could return a plausible-but-invalid
// value (e.g. format "post") that passed its own (looser) schema and only failed Zod afterwards,
// surfacing as an opaque provider_schema error with no indication of which field was wrong.
const platformEnum = PlatformVariantSchema.shape.platform.options
const formatEnum = PlatformVariantSchema.shape.format.options
const layoutFamilyEnum = PlatformVariantSchema.shape.layoutFamily.options
const safetyFlagEnum = SafetyFlagSchema.options
const generatedPostJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['verifiedFacts', 'missingFacts', 'headline', 'caption', 'shortCaption', 'callToAction', 'hashtags', 'altText', 'templateId', 'safetyFlags', 'generatedClaims', 'variants'],
  properties: {
    verifiedFacts: { type: 'array', items: { type: 'string' } }, missingFacts: { type: 'array', items: { type: 'string' } },
    headline: { type: 'string' }, caption: { type: 'string' }, shortCaption: { type: 'string' }, callToAction: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } }, altText: { type: 'string' }, templateId: { type: 'string' },
    safetyFlags: { type: 'array', items: { type: 'string', enum: safetyFlagEnum } },
    generatedClaims: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sourceId', 'text'], properties: { sourceId: { type: 'string' }, text: { type: 'string' } } } },
    // Strict Structured Outputs requires every declared object property to be required.
    // `slidePlan` is optional in the persisted/Zod contract, so an empty array preserves that
    // meaning for providers while keeping the provider-facing schema valid (notably OpenRouter).
    variants: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['platform', 'format', 'headline', 'caption', 'callToAction', 'hashtags', 'altText', 'layoutFamily', 'claimSourceIds', 'slidePlan'], properties: { platform: { type: 'string', enum: platformEnum }, format: { type: 'string', enum: formatEnum }, headline: { type: 'string' }, caption: { type: 'string' }, callToAction: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, altText: { type: 'string' }, layoutFamily: { type: 'string', enum: layoutFamilyEnum }, claimSourceIds: { type: 'array', items: { type: 'string' } }, slidePlan: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['role'], properties: { role: { type: 'string' } } } } } } },
  },
} as const
