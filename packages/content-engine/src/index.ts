import { GeneratedPostSchema, type CreateSubmission, type GeneratedPost, type PlatformVariant } from '@vereinsfunk/contracts'
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
}
