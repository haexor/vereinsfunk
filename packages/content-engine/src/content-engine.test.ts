import { describe, expect, it } from 'vitest'
import { AnthropicStructuredContentGenerator, FakeContentGenerator, OpenAiCompatibleStructuredContentGenerator, createGroundedContentBrief, type ContentGenerationError } from './index.js'

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
  const input = { brief: createGroundedContentBrief(source), styleProfile: { name: 'Klar', description: 'Kurz', styleRules: { toneTags: ['klar'], catchphrases: [], exampleInput: '', exampleOutput: '', additionalInstructions: '' }, avoidRules: [], doRules: [] }, model: 'synthetic', baseUrl: 'https://provider.example/v1', apiKey: 'secret', temperature: 0.2, maxOutputTokens: 400 }
  const grounded = { verifiedFacts: ['topic: Passen'], missingFacts: [], headline: 'Passen', caption: 'Passen', shortCaption: 'Passen', callToAction: '', hashtags: [], altText: 'Passen', templateId: 'v1', safetyFlags: [], generatedClaims: [{ sourceId: 'fact:topic', text: 'topic: Passen' }], variants: [] }
  it('parses structured output and never exposes an API key in its error', async () => {
    const generator = new OpenAiCompatibleStructuredContentGenerator(async (_url, init) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret')
      const schema = JSON.parse(String(init.body)).response_format.json_schema.schema
      expect(schema.properties.generatedClaims.items).toMatchObject({ additionalProperties: false, required: ['sourceId', 'text'] })
      expect(schema.properties.variants.items.properties.slidePlan.items).toMatchObject({ additionalProperties: false, required: ['role'] })
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(grounded) } }] }), { status: 200 })
    })
    await expect(generator.generateText(input)).resolves.toMatchObject({ caption: 'Passen' })
  })
  it('fails closed for an ungrounded or prohibited provider answer', async () => {
    const generator = new OpenAiCompatibleStructuredContentGenerator(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...grounded, caption: 'Sponsor X', generatedClaims: [{ sourceId: 'made-up', text: 'Sponsor X' }] }) } }] }), { status: 200 }))
    await expect(generator.generateText(input)).rejects.toMatchObject({ errorClass: 'ungrounded', retryable: false } satisfies Partial<ContentGenerationError>)
  })
  it('keeps the query string on a base url with one instead of swallowing the last path segment', () => {
    // String-Konkatenation ("…/v1?key=abc" + "/") wuerde den "/" hinter das "?" haengen und damit
    // sowohl "v1" als auch den Query-String beim Aufloesen verschlucken.
    const generator = new OpenAiCompatibleStructuredContentGenerator(async (url) => {
      expect(url).toBe('https://provider.example/v1/chat/completions?key=abc')
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(grounded) } }] }), { status: 200 })
    })
    return expect(generator.generateText({ ...input, baseUrl: 'https://provider.example/v1?key=abc' })).resolves.toMatchObject({ caption: 'Passen' })
  })
  it('refuses a blocked base url by default, without an injected fetcher and without a real network call', async () => {
    const generator = new OpenAiCompatibleStructuredContentGenerator()
    await expect(generator.generateText({ ...input, baseUrl: 'https://169.254.169.254/v1' })).rejects.toMatchObject({ errorClass: 'provider_configuration', retryable: false } satisfies Partial<ContentGenerationError>)
  })
  it('bounds a provider request and classifies an abort as retryable network failure', async () => {
    const generator = new OpenAiCompatibleStructuredContentGenerator(async (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    await expect(generator.generateText({ ...input, requestTimeoutMs: 1 })).rejects.toMatchObject({ errorClass: 'provider_network', retryable: true } satisfies Partial<ContentGenerationError>)
  })

  // Der Anthropic-Weg erzwingt das Schema ueber einen Werkzeugaufruf statt ueber response_format.
  // Der Werkzeugname ist Teil des Vertrags mit haex-claude-proxy und darf nicht driften.
  it('forces the anthropic schema through the final_result tool and reads the tool_use answer', async () => {
    const generator = new AnthropicStructuredContentGenerator(async (url, init) => {
      expect(url).toBe('https://provider.example/v1/messages')
      const headers = new Headers(init.headers)
      expect(headers.get('x-api-key')).toBe('secret')
      expect(headers.get('anthropic-version')).toBe('2023-06-01')
      // Bearer zusaetzlich zu x-api-key wuerde api.anthropic.com mit 401 ablehnen.
      expect(headers.get('authorization')).toBeNull()
      const body = JSON.parse(String(init.body))
      expect(body.tools[0].name).toBe('final_result')
      expect(body.tool_choice).toEqual({ type: 'tool', name: 'final_result' })
      expect(body.tools[0].input_schema.properties.generatedClaims.items).toMatchObject({ additionalProperties: false, required: ['sourceId', 'text'] })
      // Aktuelle Claude-Modelle lehnen temperature mit 400 ab.
      expect(body.temperature).toBeUndefined()
      expect(body.system).toContain('JSON')
      return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'final_result', input: grounded }] }), { status: 200 })
    })
    await expect(generator.generateText(input)).resolves.toMatchObject({ caption: 'Passen' })
  })

  it('treats an anthropic answer without the output tool as a non-retryable schema failure', async () => {
    const generator = new AnthropicStructuredContentGenerator(async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hier ist dein Beitrag …' }] }), { status: 200 }))
    await expect(generator.generateText(input)).rejects.toMatchObject({ errorClass: 'provider_schema', retryable: false } satisfies Partial<ContentGenerationError>)
  })

  it('does not retry an anthropic refusal', async () => {
    // Eine Ablehnung kommt als HTTP 200; ein erneuter Versuch mit derselben Eingabe endet gleich.
    const generator = new AnthropicStructuredContentGenerator(async () => new Response(JSON.stringify({ stop_reason: 'refusal', content: [] }), { status: 200 }))
    await expect(generator.generateText(input)).rejects.toMatchObject({ errorClass: 'provider_schema', retryable: false } satisfies Partial<ContentGenerationError>)
  })

  it('fails closed for an ungrounded anthropic answer', async () => {
    const generator = new AnthropicStructuredContentGenerator(async () => new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'final_result', input: { ...grounded, caption: 'Sponsor X', generatedClaims: [{ sourceId: 'made-up', text: 'Sponsor X' }] } }] }), { status: 200 }))
    await expect(generator.generateText(input)).rejects.toMatchObject({ errorClass: 'ungrounded', retryable: false } satisfies Partial<ContentGenerationError>)
  })
})
