import { describe, expect, it } from 'vitest'
import { ContentGenerationError, FakeContentGenerator, OpenAiCompatibleStructuredContentGenerator, createGroundedContentBrief } from './index.js'

describe('fake content generator', () => {
  it('marks missing facts instead of inventing them', async () => {
    const result = await new FakeContentGenerator().generate({
      organizationId: '11111111-1111-4111-8111-111111111111',
      departmentId: '22222222-2222-4222-8222-222222222222',
      presetSlug: 'match_result',
      communicationGoal: 'inform',
      requestedFormats: ['feed_image'],
      sourceMaterial: { facts: { homeTeam: 'SV Nord' }, observations: [], quotes: [], doNotMention: [] },
      sourceRevision: 1,
      priority: 40,
    })
    expect(result.missingFacts).toEqual(['awayTeam', 'homeScore', 'awayScore'])
    expect(result.safetyFlags).toContain('uncertain_fact')
  })
})

describe('structured content generator', () => {
  const source = {
    organizationId: '11111111-1111-4111-8111-111111111111', departmentId: '22222222-2222-4222-8222-222222222222',
    presetSlug: 'training', communicationGoal: 'inform' as const, requestedFormats: ['feed_image'] as ('feed_image')[],
    sourceMaterial: { facts: { topic: 'Passen' }, observations: ['Die Gruppe trainierte Passen.'], quotes: [], doNotMention: ['Sponsor X'] }, sourceRevision: 1, priority: 40,
  }
  const input = { brief: createGroundedContentBrief(source), styleProfile: { name: 'Klar', description: 'Kurz', styleRules: { sentenceLength: 'short' as const, energy: 2, humour: 'none' as const, formality: 'balanced' as const, perspective: 'we' as const, bannedPhrases: [], additionalInstructions: '' }, avoidRules: [] }, model: 'synthetic', baseUrl: 'https://provider.example/v1', apiKey: 'secret', temperature: 0.2, maxOutputTokens: 400 }
  const grounded = { verifiedFacts: ['topic: Passen'], missingFacts: [], headline: 'Passen', caption: 'Passen', shortCaption: 'Passen', callToAction: '', hashtags: [], altText: 'Passen', templateId: 'v1', safetyFlags: [], generatedClaims: [{ sourceId: 'fact:topic', text: 'topic: Passen' }], variants: [] }
  it('parses structured output and never exposes an API key in its error', async () => {
    const generator = new OpenAiCompatibleStructuredContentGenerator(async (_url, init) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret')
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(grounded) } }] }), { status: 200 })
    })
    await expect(generator.generateText(input)).resolves.toMatchObject({ caption: 'Passen' })
  })
  it('fails closed for an ungrounded or prohibited provider answer', async () => {
    const generator = new OpenAiCompatibleStructuredContentGenerator(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...grounded, caption: 'Sponsor X', generatedClaims: [{ sourceId: 'made-up', text: 'Sponsor X' }] }) } }] }), { status: 200 }))
    await expect(generator.generateText(input)).rejects.toMatchObject({ errorClass: 'ungrounded', retryable: false } satisfies Partial<ContentGenerationError>)
  })
})
