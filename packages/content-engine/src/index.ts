import {
  GeneratedPostSchema,
  type CreateSubmission,
  type GeneratedPost,
} from '@vereinswerk/contracts'

export interface ContentGenerator {
  generate(input: CreateSubmission): Promise<GeneratedPost>
}

const requiredFacts: Record<CreateSubmission['contentType'], readonly string[]> = {
  match_result: ['homeTeam', 'awayTeam', 'homeScore', 'awayScore'],
  match_announcement: ['opponent', 'date', 'location'],
  member_recruitment: ['audience', 'contact'],
  event: ['title', 'date', 'location'],
}

export class FakeContentGenerator implements ContentGenerator {
  async generate(input: CreateSubmission): Promise<GeneratedPost> {
    const missingFacts = requiredFacts[input.contentType].filter(
      (key) => input.facts[key] === undefined || input.facts[key] === '',
    )
    const verifiedFacts = Object.entries(input.facts).map(([key, value]) => `${key}: ${value}`)
    const headline = this.headline(input)
    const caption = `${headline}\n\n${verifiedFacts.map((fact) => `• ${fact}`).join('\n')}\n\nGemeinsam mehr bewegen.`
    return GeneratedPostSchema.parse({
      verifiedFacts,
      missingFacts,
      headline,
      caption,
      shortCaption: caption.slice(0, 500),
      callToAction: 'Sei dabei und teile den Beitrag mit deinem Team.',
      hashtags: ['#vereinsleben', '#teamsport', '#gemeinsamstark'],
      altText: `Vereinsgrafik: ${headline}`,
      templateId: `${input.contentType}-v1`,
      safetyFlags: missingFacts.length > 0 ? ['uncertain_fact'] : [],
    })
  }

  private headline(input: CreateSubmission): string {
    const first = Object.values(input.facts)[0]
    const fallbacks: Record<CreateSubmission['contentType'], string> = {
      match_result: 'Abpfiff – das Ergebnis ist da',
      match_announcement: 'Nächstes Spiel, nächstes Ziel',
      member_recruitment: 'Dein Team wartet auf dich',
      event: 'Save the date',
    }
    return typeof first === 'string' && first.length <= 60 ? first : fallbacks[input.contentType]
  }
}
