import { createGuardedFetch, OutboundFetchError } from '@vereinsfunk/outbound-fetch'

/**
 * Paket 048: Vision-Analyse eines Website-Screenshots fuer die KI-Markenerkennung. Bewusst ein
 * eigenes, schmales Interface statt einer Erweiterung von StructuredContentGenerator -- die
 * Eingabe (Bild statt Brief/Stilprofil) und die Ausgabe (Farben/Font-Wahl statt ein
 * GeneratedPost) haben keine sinnvolle gemeinsame Form.
 *
 * Font-Erkennung ist bewusst NICHT Teil der KI-Aufgabe: welche Schrift tatsaechlich im DOM
 * gesetzt ist, liest der Worker deterministisch per getComputedStyle aus (exakt, kein Raten).
 * Die KI bekommt diesen erkannten Namen nur als Hinweis und waehlt ausschliesslich zwischen den
 * uebergebenen kuratierten Font-Paaren -- eine Fremdschrift automatisch nachzuladen verstoesst
 * gegen die Datenschutz-Policy in packages/domain/src/fonts.ts.
 */
export interface FontPairingOption {
  key: string
  label: string
  styleDescription: string
}

export interface VisionAnalysisInput {
  imageBase64: string
  imageMediaType: 'image/png' | 'image/jpeg'
  detectedFontFamily: string | null
  fontPairingOptions: readonly FontPairingOption[]
  model: string
  baseUrl: string
  apiKey: string
  requestTimeoutMs?: number
}

export interface VisionAnalysisResult {
  primaryColor: string
  accentColor: string
  backgroundColor: string
  textColor: string
  onPrimaryColor: string
  /** null, wenn die KI keines der beiden kuratierten Paare passend fand. */
  suggestedFontPairingKey: string | null
}

export interface VisionAnalysisGenerator {
  analyzeBrand(input: VisionAnalysisInput): Promise<VisionAnalysisResult>
}

/** Error information intentionally contains no input or output text and is safe for worker logs. */
export class VisionAnalysisError extends Error {
  constructor(
    readonly errorClass: 'provider_network' | 'provider_rate_limit' | 'provider_server' | 'provider_schema' | 'provider_configuration',
    readonly retryable: boolean,
  ) {
    super(errorClass)
  }
}

const NO_FONT_PAIRING_MATCH = 'none'

function buildPrompt(input: VisionAnalysisInput) {
  const pairingLines = input.fontPairingOptions.map((option) => `- "${option.key}" (${option.label}): ${option.styleDescription}`).join('\n')
  return {
    system: [
      'Du analysierst den Screenshot der Startseite eines deutschen Sportvereins, um dessen Markenfarben vorzuschlagen.',
      'Bestimme fuenf Farbrollen als Hex-Werte (#rrggbb), abgeleitet aus der tatsaechlich sichtbaren Gestaltung der Seite:',
      '- primaryColor: die dominante Markenfarbe (Header, Buttons, Hervorhebungen)',
      '- accentColor: eine zweite, kontrastierende Akzentfarbe',
      '- backgroundColor: der Seitenhintergrund',
      '- textColor: die Hauptschriftfarbe auf dem Hintergrund',
      '- onPrimaryColor: eine Schriftfarbe, die auf primaryColor gut lesbar ist (meist #ffffff oder ein sehr dunkler Ton)',
      'Waehle zusaetzlich EINES der folgenden beiden kuratierten Schriftpaare, das dem visuellen Stil der Seite am naechsten kommt, oder "none", wenn keines passt:',
      pairingLines,
      input.detectedFontFamily ? `Auf der Seite technisch erkannte Schriftfamilie (nur als Hinweis, keine eigene Wahl): ${input.detectedFontFamily}` : 'Auf der Seite konnte keine Schriftfamilie technisch ausgelesen werden.',
      'Antworte ausschliesslich durch den Werkzeugaufruf, ohne zusaetzlichen Text.',
    ].join('\n'),
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

function joinUrlPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`
  return url.toString()
}

function parsePairingKey(value: unknown, options: readonly FontPairingOption[]): string | null {
  if (value === NO_FONT_PAIRING_MATCH) return null
  return options.some((option) => option.key === value) ? (value as string) : null
}

const ANTHROPIC_OUTPUT_TOOL_NAME = 'brand_color_analysis'

function jsonSchemaFor(input: VisionAnalysisInput) {
  const fontPairingEnum = [...input.fontPairingOptions.map((option) => option.key), NO_FONT_PAIRING_MATCH]
  const hexColor = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } as const
  return {
    type: 'object', additionalProperties: false,
    required: ['primaryColor', 'accentColor', 'backgroundColor', 'textColor', 'onPrimaryColor', 'suggestedFontPairingKey'],
    properties: {
      primaryColor: hexColor, accentColor: hexColor, backgroundColor: hexColor, textColor: hexColor, onPrimaryColor: hexColor,
      suggestedFontPairingKey: { type: 'string', enum: fontPairingEnum },
    },
  } as const
}

/** Anthropic Messages, Bild als Content-Block + erzwungener Tool-Use, analog zu AnthropicStructuredContentGenerator. */
export class AnthropicVisionAnalysisGenerator implements VisionAnalysisGenerator {
  constructor(private readonly fetcher: FetchLike = createGuardedFetch()) {}

  async analyzeBrand(input: VisionAnalysisInput): Promise<VisionAnalysisResult> {
    const prompt = buildPrompt(input)
    let response: Response
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.requestTimeoutMs ?? 60_000)
    try {
      response = await this.fetcher(joinUrlPath(input.baseUrl, 'messages'), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: input.model, max_tokens: 1024, system: prompt.system,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: input.imageMediaType, data: input.imageBase64 } },
            { type: 'text', text: 'Analysiere diesen Screenshot.' },
          ] }],
          tools: [{ name: ANTHROPIC_OUTPUT_TOOL_NAME, description: 'Gibt die vorgeschlagenen Markenfarben und Font-Wahl zurueck.', input_schema: jsonSchemaFor(input) }],
          tool_choice: { type: 'tool', name: ANTHROPIC_OUTPUT_TOOL_NAME },
        }),
      })
    } catch (error) {
      if (error instanceof OutboundFetchError) throw new VisionAnalysisError('provider_configuration', false)
      throw new VisionAnalysisError('provider_network', true)
    } finally { clearTimeout(timeout) }
    if (response.status === 429) throw new VisionAnalysisError('provider_rate_limit', true)
    if (response.status >= 500) throw new VisionAnalysisError('provider_server', true)
    if (!response.ok) throw new VisionAnalysisError('provider_schema', false)
    try {
      const body = await response.json() as { stop_reason?: unknown; content?: Array<{ type?: unknown; name?: unknown; input?: unknown }> }
      if (body.stop_reason === 'refusal') throw new VisionAnalysisError('provider_schema', false)
      const block = body.content?.find((entry) => entry.type === 'tool_use' && entry.name === ANTHROPIC_OUTPUT_TOOL_NAME)
      return parseResult(block?.input, input.fontPairingOptions)
    } catch (error) {
      if (error instanceof VisionAnalysisError) throw error
      throw new VisionAnalysisError('provider_schema', false)
    }
  }
}

/** OpenAI-kompatibel: Bild als data-URI in einem image_url-Content-Part, JSON-Schema erzwungen. */
export class OpenAiCompatibleVisionAnalysisGenerator implements VisionAnalysisGenerator {
  constructor(private readonly fetcher: FetchLike = createGuardedFetch()) {}

  async analyzeBrand(input: VisionAnalysisInput): Promise<VisionAnalysisResult> {
    const prompt = buildPrompt(input)
    let response: Response
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.requestTimeoutMs ?? 60_000)
    try {
      response = await this.fetcher(joinUrlPath(input.baseUrl, 'chat/completions'), {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: input.model, max_tokens: 1024,
          response_format: { type: 'json_schema', json_schema: { name: 'brand_color_analysis', strict: true, schema: jsonSchemaFor(input) } },
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: [
              { type: 'image_url', image_url: { url: `data:${input.imageMediaType};base64,${input.imageBase64}` } },
              { type: 'text', text: 'Analysiere diesen Screenshot.' },
            ] },
          ],
        }),
      })
    } catch (error) {
      if (error instanceof OutboundFetchError) throw new VisionAnalysisError('provider_configuration', false)
      throw new VisionAnalysisError('provider_network', true)
    } finally { clearTimeout(timeout) }
    if (response.status === 429) throw new VisionAnalysisError('provider_rate_limit', true)
    if (response.status >= 500) throw new VisionAnalysisError('provider_server', true)
    if (!response.ok) throw new VisionAnalysisError('provider_schema', false)
    try {
      const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
      const raw = body.choices?.[0]?.message?.content
      const content = typeof raw === 'string' ? JSON.parse(raw) : raw
      return parseResult(content, input.fontPairingOptions)
    } catch (error) {
      if (error instanceof VisionAnalysisError) throw error
      throw new VisionAnalysisError('provider_schema', false)
    }
  }
}

function parseResult(value: unknown, fontPairingOptions: readonly FontPairingOption[]): VisionAnalysisResult {
  const hex = /^#[0-9a-fA-F]{6}$/
  if (typeof value !== 'object' || value === null) throw new VisionAnalysisError('provider_schema', false)
  const record = value as Record<string, unknown>
  const colors = ['primaryColor', 'accentColor', 'backgroundColor', 'textColor', 'onPrimaryColor'] as const
  for (const key of colors) {
    if (typeof record[key] !== 'string' || !hex.test(record[key] as string)) throw new VisionAnalysisError('provider_schema', false)
  }
  return {
    primaryColor: record.primaryColor as string,
    accentColor: record.accentColor as string,
    backgroundColor: record.backgroundColor as string,
    textColor: record.textColor as string,
    onPrimaryColor: record.onPrimaryColor as string,
    suggestedFontPairingKey: parsePairingKey(record.suggestedFontPairingKey, fontPairingOptions),
  }
}
