import { describe, expect, it } from 'vitest'
import { FakeContentGenerator } from './index.js'

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
