import { describe, expect, it } from 'vitest'
import { AnthropicVisionAnalysisGenerator, OpenAiCompatibleVisionAnalysisGenerator, type VisionAnalysisError, type VisionAnalysisInput, type VisionAnalysisResult } from './visionAnalysis.js'

const fontPairingOptions = [
  { key: 'manrope_dm_sans', label: 'Manrope / DM Sans', styleDescription: 'klare geometrische Sans-Serif' },
  { key: 'space_grotesk_karla', label: 'Space Grotesk / Karla', styleDescription: 'markante Headline mit humanistischer Fliesstext-Schrift' },
]

const input: VisionAnalysisInput = {
  imageBase64: 'ZmFrZS1wbmc=',
  imageMediaType: 'image/png',
  detectedFontFamily: 'Roboto, sans-serif',
  fontPairingOptions,
  model: 'vision-model',
  baseUrl: 'https://provider.example/v1',
  apiKey: 'secret',
}

const validResult = { primaryColor: '#163a2c', accentColor: '#caff4a', backgroundColor: '#f6f4ec', textColor: '#122820', onPrimaryColor: '#ffffff', suggestedFontPairingKey: 'space_grotesk_karla' }

describe('OpenAiCompatibleVisionAnalysisGenerator', () => {
  it('sends the screenshot as an image_url data uri alongside the enforced json schema', async () => {
    const generator = new OpenAiCompatibleVisionAnalysisGenerator(async (url, init) => {
      expect(url).toBe('https://provider.example/v1/chat/completions')
      const body = JSON.parse(String(init.body))
      expect(body.messages[1].content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,ZmFrZS1wbmc=' } })
      expect(body.response_format.json_schema.schema.properties.suggestedFontPairingKey.enum).toEqual(['manrope_dm_sans', 'space_grotesk_karla', 'none'])
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validResult) } }] }), { status: 200 })
    })
    await expect(generator.analyzeBrand(input)).resolves.toEqual(validResult satisfies VisionAnalysisResult)
  })

  it('maps an unrecognized font pairing key to null instead of trusting the provider verbatim', async () => {
    const generator = new OpenAiCompatibleVisionAnalysisGenerator(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...validResult, suggestedFontPairingKey: 'comic_sans_pairing' }) } }] }), { status: 200 }))
    await expect(generator.analyzeBrand(input)).resolves.toMatchObject({ suggestedFontPairingKey: null })
  })

  it('maps "none" to null', async () => {
    const generator = new OpenAiCompatibleVisionAnalysisGenerator(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...validResult, suggestedFontPairingKey: 'none' }) } }] }), { status: 200 }))
    await expect(generator.analyzeBrand(input)).resolves.toMatchObject({ suggestedFontPairingKey: null })
  })

  it('rejects a non-hex color as a schema failure instead of passing it through', async () => {
    const generator = new OpenAiCompatibleVisionAnalysisGenerator(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...validResult, primaryColor: 'green' }) } }] }), { status: 200 }))
    await expect(generator.analyzeBrand(input)).rejects.toMatchObject({ errorClass: 'provider_schema', retryable: false } satisfies Partial<VisionAnalysisError>)
  })

  it('refuses a blocked base url by default, without an injected fetcher and without a real network call', async () => {
    const generator = new OpenAiCompatibleVisionAnalysisGenerator()
    await expect(generator.analyzeBrand({ ...input, baseUrl: 'https://169.254.169.254/v1' })).rejects.toMatchObject({ errorClass: 'provider_configuration', retryable: false } satisfies Partial<VisionAnalysisError>)
  })

  it('classifies a rate limit and a server error as retryable, a generic 4xx as not', async () => {
    const rateLimited = new OpenAiCompatibleVisionAnalysisGenerator(async () => new Response('', { status: 429 }))
    await expect(rateLimited.analyzeBrand(input)).rejects.toMatchObject({ errorClass: 'provider_rate_limit', retryable: true })
    const serverError = new OpenAiCompatibleVisionAnalysisGenerator(async () => new Response('', { status: 503 }))
    await expect(serverError.analyzeBrand(input)).rejects.toMatchObject({ errorClass: 'provider_server', retryable: true })
    const badRequest = new OpenAiCompatibleVisionAnalysisGenerator(async () => new Response('', { status: 400 }))
    await expect(badRequest.analyzeBrand(input)).rejects.toMatchObject({ errorClass: 'provider_schema', retryable: false })
  })
})

describe('AnthropicVisionAnalysisGenerator', () => {
  it('forces the schema through a tool call and sends the screenshot as an image content block', async () => {
    const generator = new AnthropicVisionAnalysisGenerator(async (url, init) => {
      expect(url).toBe('https://provider.example/v1/messages')
      const headers = new Headers(init.headers)
      expect(headers.get('x-api-key')).toBe('secret')
      const body = JSON.parse(String(init.body))
      expect(body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'ZmFrZS1wbmc=' } })
      expect(body.tool_choice).toEqual({ type: 'tool', name: 'brand_color_analysis' })
      return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'brand_color_analysis', input: validResult }] }), { status: 200 })
    })
    await expect(generator.analyzeBrand(input)).resolves.toEqual(validResult satisfies VisionAnalysisResult)
  })

  it('does not retry an anthropic refusal', async () => {
    const generator = new AnthropicVisionAnalysisGenerator(async () => new Response(JSON.stringify({ stop_reason: 'refusal', content: [] }), { status: 200 }))
    await expect(generator.analyzeBrand(input)).rejects.toMatchObject({ errorClass: 'provider_schema', retryable: false } satisfies Partial<VisionAnalysisError>)
  })

  it('treats an answer without the output tool as a non-retryable schema failure', async () => {
    const generator = new AnthropicVisionAnalysisGenerator(async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ich helfe gerne …' }] }), { status: 200 }))
    await expect(generator.analyzeBrand(input)).rejects.toMatchObject({ errorClass: 'provider_schema', retryable: false } satisfies Partial<VisionAnalysisError>)
  })
})
