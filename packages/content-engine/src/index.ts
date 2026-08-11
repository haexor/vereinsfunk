import { GeneratedPostSchema, type CreateSubmission, type GeneratedPost, type PlatformVariant, type StyleProfileRules } from '@vereinsfunk/contracts'
import { getPreset, validateSourceMaterial } from './presets.js'

export { factsFromFixture, factsFromClubEvent } from './schedule.js'
export type { FactsFromScheduleResult } from './schedule.js'

export interface GroundedContentBrief { allowedClaims: readonly { sourceId: string; text: string }[]; approvedQuotes: readonly { sourceId: string; text: string; attribution?: string }[]; missingFacts: readonly string[]; prohibitedClaims: readonly string[]; goal: CreateSubmission['communicationGoal']; requestedFormats: CreateSubmission['requestedFormats']; presetSlug: string }
export interface ContentGenerator { generate(input: CreateSubmission): Promise<GeneratedPost> }

export function createGroundedContentBrief(input: CreateSubmission): GroundedContentBrief {
  const preset = getPreset(input.presetSlug)
  const allowedClaims = [
    ...Object.entries(input.sourceMaterial.facts).map(([key, value]) => ({ sourceId: `fact:${key}`, text: `${key}: ${value}` })),
    ...input.sourceMaterial.observations.map((text, index) => ({ sourceId: `observation:${index + 1}`, text })),
  ]
  const approvedQuotes = input.sourceMaterial.quotes.filter((quote) => quote.approved).map((quote, index) => quote.attribution ? ({ sourceId: `quote:${index + 1}`, text: quote.text, attribution: quote.attribution }) : ({ sourceId: `quote:${index + 1}`, text: quote.text }))
  return { allowedClaims, approvedQuotes, missingFacts: validateSourceMaterial(preset, input.sourceMaterial), prohibitedClaims: input.sourceMaterial.doNotMention, goal: input.communicationGoal, requestedFormats: input.requestedFormats, presetSlug: input.presetSlug }
}

/** Text-workshop equivalent which intentionally has no visual output or media input. */
export function createTextGroundedContentBrief(input: Pick<CreateSubmission, 'presetSlug' | 'communicationGoal' | 'sourceMaterial'>): GroundedContentBrief {
  const preset = getPreset(input.presetSlug)
  const allowedClaims = [
    ...Object.entries(input.sourceMaterial.facts).map(([key, value]) => ({ sourceId: `fact:${key}`, text: `${key}: ${value}` })),
    ...input.sourceMaterial.observations.map((text, index) => ({ sourceId: `observation:${index + 1}`, text })),
  ]
  const approvedQuotes = input.sourceMaterial.quotes.filter((quote) => quote.approved).map((quote, index) => quote.attribution ? ({ sourceId: `quote:${index + 1}`, text: quote.text, attribution: quote.attribution }) : ({ sourceId: `quote:${index + 1}`, text: quote.text }))
  return { allowedClaims, approvedQuotes, missingFacts: validateSourceMaterial(preset, input.sourceMaterial), prohibitedClaims: input.sourceMaterial.doNotMention, goal: input.communicationGoal, requestedFormats: [], presetSlug: input.presetSlug }
}

function layoutFor(slug: string): PlatformVariant['layoutFamily'] { if (slug.includes('training') || slug.includes('children')) return 'training'; if (slug === 'volunteering') return 'thanks'; if (slug === 'event' || slug === 'new_offer') return 'invitation'; if (slug.includes('match')) return 'result'; return 'photo_moment' }
export class FakeContentGenerator implements ContentGenerator {
  async generate(input: CreateSubmission): Promise<GeneratedPost> {
    const brief = createGroundedContentBrief(input)
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

export function assertGroundedPost(post: GeneratedPost, brief: GroundedContentBrief): void {
  const allowed = new Set([...brief.allowedClaims, ...brief.approvedQuotes].map((claim) => claim.sourceId))
  if (post.generatedClaims.some((claim) => !allowed.has(claim.sourceId)) || post.variants.some((variant) => variant.claimSourceIds.some((id) => !allowed.has(id)))) throw new Error('Generated content contains an ungrounded claim')
  const rendered = [post.headline, post.caption, post.shortCaption, post.callToAction, post.altText, ...post.hashtags, ...post.verifiedFacts].join('\n').toLocaleLowerCase('de')
  if (brief.prohibitedClaims.some((phrase) => rendered.includes(phrase.toLocaleLowerCase('de')))) {
    throw new Error('Generated content contains a prohibited phrase')
  }
}

export const TEXT_PROMPT_TEMPLATE_VERSION = 'text-workshop-v1'

export type StructuredTextGeneratorInput = {
  brief: GroundedContentBrief
  styleProfile: { name: string; description: string; styleRules: StyleProfileRules; avoidRules: readonly string[] }
  revisionInstruction?: string
  model: string
  baseUrl: string
  apiKey: string
  temperature: number
  maxOutputTokens: number
}

export interface StructuredContentGenerator {
  generateText(input: StructuredTextGeneratorInput): Promise<GeneratedPost>
}

/** Error information intentionally contains no input or output text and is safe for worker logs. */
export class ContentGenerationError extends Error {
  constructor(readonly errorClass: 'provider_network' | 'provider_rate_limit' | 'provider_server' | 'provider_schema' | 'ungrounded', readonly retryable: boolean) {
    super(errorClass)
  }
}

export function buildStructuredTextPrompt(input: Pick<StructuredTextGeneratorInput, 'brief' | 'styleProfile' | 'revisionInstruction'>) {
  const instruction = input.revisionInstruction ? input.revisionInstruction.slice(0, 500) : undefined
  // The ordering is the ADR-010 priority ordering. User-controlled material is data, never an
  // instruction with more authority than these fixed rules.
  return {
    system: [
      'Erzeuge ausschließlich einen faktengebundenen deutschsprachigen Vereinsbeitrag als JSON.',
      'Niemals Fakten, Namen, Ergebnisse, Termine oder Zitate ergänzen. Verwende nur claimSourceIds aus den bestätigten Quellen.',
      'Beachte verbotene Nennungen und Stil-No-Gos. Bei fehlenden Fakten nenne sie in missingFacts statt sie zu erfinden.',
      `Stilprofil: ${input.styleProfile.name}. ${input.styleProfile.description}`,
      `Stilregeln: ${JSON.stringify(input.styleProfile.styleRules)}. No-Gos: ${JSON.stringify(input.styleProfile.avoidRules)}`,
    ].join('\n'),
    user: JSON.stringify({
      confirmedSources: { claims: input.brief.allowedClaims, approvedQuotes: input.brief.approvedQuotes },
      missingFacts: input.brief.missingFacts,
      prohibitedClaims: input.brief.prohibitedClaims,
      goal: input.brief.goal,
      presetSlug: input.brief.presetSlug,
      revisionInstruction: instruction,
    }),
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** OpenAI-compatible, JSON-schema constrained adapter. It is deliberately worker injectable. */
export class OpenAiCompatibleStructuredContentGenerator implements StructuredContentGenerator {
  constructor(private readonly fetcher: FetchLike = fetch) {}

  async generateText(input: StructuredTextGeneratorInput): Promise<GeneratedPost> {
    const prompt = buildStructuredTextPrompt(input)
    let response: Response
    try {
      response = await this.fetcher(new URL('chat/completions', input.baseUrl.endsWith('/') ? input.baseUrl : `${input.baseUrl}/`).toString(), {
        method: 'POST',
        headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: input.model, temperature: input.temperature, max_tokens: input.maxOutputTokens,
          response_format: { type: 'json_schema', json_schema: { name: 'generated_post', strict: true, schema: generatedPostJsonSchema } },
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        }),
      })
    } catch { throw new ContentGenerationError('provider_network', true) }
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
      return post
    } catch (error) {
      if (error instanceof Error && error.message.includes('ungrounded')) throw new ContentGenerationError('ungrounded', false)
      throw new ContentGenerationError('provider_schema', false)
    }
  }
}

// JSON Schema is sent to the provider; Zod remains the authoritative second validation boundary.
const generatedPostJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['verifiedFacts', 'missingFacts', 'headline', 'caption', 'shortCaption', 'callToAction', 'hashtags', 'altText', 'templateId', 'safetyFlags', 'generatedClaims', 'variants'],
  properties: {
    verifiedFacts: { type: 'array', items: { type: 'string' } }, missingFacts: { type: 'array', items: { type: 'string' } },
    headline: { type: 'string' }, caption: { type: 'string' }, shortCaption: { type: 'string' }, callToAction: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } }, altText: { type: 'string' }, templateId: { type: 'string' },
    safetyFlags: { type: 'array', items: { type: 'string' } }, generatedClaims: { type: 'array', items: { type: 'object' } }, variants: { type: 'array', items: { type: 'object' } },
  },
} as const
