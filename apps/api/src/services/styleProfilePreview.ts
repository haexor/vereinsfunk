import type { GeneratedPost, StyleProfilePromptPreview, StyleProfileRules } from '@vereinsfunk/contracts'
import type { ApiEnvironment } from '@vereinsfunk/config'
import { AnthropicStructuredContentGenerator, buildStructuredTextPrompt, ContentGenerationError, OpenAiCompatibleStructuredContentGenerator, type StructuredContentGenerator, type TextGroundedContentBrief } from '@vereinsfunk/content-engine'
import { TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS, TEXT_GENERATION_DEFAULT_TEMPERATURE, UuidSchema } from '@vereinsfunk/contracts'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { byteaToBuffer, EmbeddedProviderSecretSchema, unwrapEmbeddedSecret } from '@vereinsfunk/secrets'
import { createSecretBoxFromEnvironment } from '../secretBox.js'
import type { SupabaseClientFactory } from '../routes/context.js'
import { readIdempotencyKeyHeader } from '../routes/shared.js'

// Paket 042: temperature/maxOutputTokens sind jetzt Beitrags-/Sitzungs-Einstellungen, nicht mehr
// Provider-Merkmale. Der Preview-Pfad hat keinen Beitrags-/Sitzungskontext (siehe
// runStyleProfilePreview unten) und bekommt dafuer bewusst keine neue UI -- die festen Vorgaben aus
// den Contracts statt eines Lookups. Dort stehen sie neben dem Regler und der Token-Spanne, damit
// Preview und echte Sitzung nicht auf zwei getrennt gepflegten Zahlen laufen.

// Plan 040: "Persona/Stilprofil testen" (routes/contentStyleProfiles.ts, routes/platformPersonas.routes.ts)
// calls the active text provider directly and synchronously, unlike POST
// /v1/text-workshop/sessions which only ever writes an ID-only Hatchet delivery for the worker to
// pick up. The provider row shape and its decryption mirror apps/worker/src/context.ts's
// loadActiveTextProvider/apps/worker/src/textGeneration.ts's parseSecretBox+ciphertextBuffer --
// duplicated deliberately rather than imported, since apps do not depend on each other in this
// workspace (see pnpm-workspace.yaml); the actual provider adapters
// (OpenAiCompatibleStructuredContentGenerator/AnthropicStructuredContentGenerator) and the secret
// box helpers already live in shared packages apps/api depends on regardless.
const ActiveTextProviderRowSchema = z.object({
  id: UuidSchema, protocol: z.string(), base_url: z.url(), model: z.string().trim().min(1),
  structured_output_required: z.boolean(),
  llm_provider_secrets: EmbeddedProviderSecretSchema,
})

const PREVIEW_TEXT_GENERATORS: Record<string, StructuredContentGenerator | undefined> = {
  openai: new OpenAiCompatibleStructuredContentGenerator(),
  anthropic: new AnthropicStructuredContentGenerator(),
}

export type StyleProfilePreviewResult =
  | { ok: true; post: GeneratedPost }
  | { ok: false; status: number; error: string }

// A client-side timeout/retry on either preview route must not trigger a second billed provider
// call for the same logical attempt (gefunden im Code-Review dieses Pakets). The integrations
// sync route (routes/integrations.ts) guards the same problem with an atomic RPC backed by the
// idempotency_keys table, but that table requires a non-null organization_id -- platform-style-
// personas/preview has none (Plan 037, platform personas are global). Mirrors checkRateLimit's
// in-memory approach (routes/shared.ts) instead: same one-process-only caveat, same low-stakes tradeoff for a
// preview button.
//
// Falls back to a random key when the client sends none, exactly like the sync route -- until PR
// 3/3's frontend actually resends the same key on retry, every call gets its own random key and
// this is a no-op, so today's behavior is unchanged.
//
// Der Schluessel wird mit der userId praefixiert (gefunden im Code-Review): der Header kommt vom
// Client, und die Dedupe-Maps unten sind allein nach diesem Schluessel geschluesselt. Ohne Praefix
// bekaeme ein zweiter Aufruf mit demselben (geratenen oder abgeschriebenen) Wert innerhalb des
// Fensters das Ergebnis des ersten Aufrufs zurueck -- ueber Vereinsgrenzen hinweg. Ein Retry
// desselben Nutzers dedupliziert weiterhin, genau darum geht es hier.
export function resolvePreviewIdempotencyKey(request: FastifyRequest): string | null {
  const key = readIdempotencyKeyHeader(request)
  if (!key || !request.auth) return null
  return `${request.auth.userId}:${key}`
}

const previewByIdempotencyKey = new Map<string, { promise: Promise<StyleProfilePreviewResult>; expiresAt: number }>()

let nextPreviewSweepAt = 0

const PREVIEW_DEDUPE_WINDOW_MS = 120_000

type StyleProfilePreviewInput = { name: string; description: string; styleRules: StyleProfileRules; avoidRules: readonly string[]; doRules: readonly string[]; sampleInput: string }

export async function previewStyleProfile(
  supabaseClients: SupabaseClientFactory,
  environment: ApiEnvironment,
  input: StyleProfilePreviewInput,
  idempotencyKey: string,
  generatorOverride?: StructuredContentGenerator,
): Promise<StyleProfilePreviewResult> {
  const now = Date.now()
  if (previewByIdempotencyKey.size > 1_000 && now >= nextPreviewSweepAt) {
    nextPreviewSweepAt = now + 60_000
    for (const [key, entry] of previewByIdempotencyKey) {
      if (entry.expiresAt < now) previewByIdempotencyKey.delete(key)
    }
  }
  const existing = previewByIdempotencyKey.get(idempotencyKey)
  if (existing && existing.expiresAt >= now) return existing.promise
  const promise = runStyleProfilePreview(supabaseClients, environment, input, generatorOverride)
  previewByIdempotencyKey.set(idempotencyKey, { promise, expiresAt: now + PREVIEW_DEDUPE_WINDOW_MS })
  return promise
}

// Built by hand instead of createTextGroundedContentBrief, which expects real source material.
// sampleInput is the sole allowedClaim, exactly as sourceMaterial.facts/observations feed
// allowedClaims for a real submission. Shared by the actual LLM preview below and by
// buildStyleProfilePromptPreview (the "show system prompt" readback), which needs the identical
// brief without calling a provider.
function styleProfilePreviewBrief(sampleInput: string): TextGroundedContentBrief {
  return {
    allowedClaims: [{ sourceId: 'sample', text: sampleInput }],
    approvedQuotes: [], prohibitedClaims: [],
    goal: 'inform',
  }
}

// Shared by the real preview (below) and buildStyleProfilePromptPreview (the "show system prompt"
// readback): both need the identical {brief, styleProfile} pair buildStructuredTextPrompt/
// generateText build their prompt from, for the same draft input.
function previewGenerationArgs(input: StyleProfilePreviewInput): { brief: TextGroundedContentBrief; styleProfile: { name: string; description: string; styleRules: StyleProfileRules; avoidRules: string[]; doRules: string[] } } {
  return {
    brief: styleProfilePreviewBrief(input.sampleInput),
    styleProfile: { name: input.name, description: input.description, styleRules: input.styleRules, avoidRules: [...input.avoidRules], doRules: [...input.doRules] },
  }
}

// "System-Prompt anzeigen": assembles the exact prompt a real preview/generation would send, with
// no provider call, no DB read and no secret involved -- a pure readback of the draft's current
// state, safe to call on every keystroke's worth of debouncing without cost or rate limiting.
export function buildStyleProfilePromptPreview(input: StyleProfilePreviewInput): StyleProfilePromptPreview {
  return buildStructuredTextPrompt(previewGenerationArgs(input))
}

async function runStyleProfilePreview(
  supabaseClients: SupabaseClientFactory,
  environment: ApiEnvironment,
  input: StyleProfilePreviewInput,
  generatorOverride?: StructuredContentGenerator,
): Promise<StyleProfilePreviewResult> {
  const service = supabaseClients.forService()
  // Repraesentativ, kein bestimmter Provider: seit Paket 050 gibt es fuer text_generation kein
  // Rangfolge-Kriterium mehr, ein beliebiger aktiver Provider mit hinterlegtem Geheimnis reicht fuer
  // diesen "Testen"-Knopf aus (anders als die echte Generierung, die alle aktiven Provider
  // gleichzeitig anfragt, siehe resolveTextGenerationProviderConfigurationIds in services/textGenerationSessions.ts).
  const configs = await service
    .from('llm_provider_configurations')
    .select('id, protocol, base_url, model, structured_output_required, llm_provider_secrets!inner(api_key_ciphertext, key_version)')
    .eq('task_kind', 'text_generation').eq('is_active', true).order('created_at').limit(1)
  if (configs.error) throw configs.error
  const rows = configs.data as Record<string, unknown>[]
  if (rows.length === 0) {
    return { ok: false, status: 422, error: 'text_provider_not_configured' }
  }
  const row = ActiveTextProviderRowSchema.parse(rows[0])
  const generator = generatorOverride ?? PREVIEW_TEXT_GENERATORS[row.protocol]
  if (!generator || !row.structured_output_required) {
    return { ok: false, status: 422, error: 'unsupported_provider_configuration' }
  }
  const secret = unwrapEmbeddedSecret(row.llm_provider_secrets)
  const apiKey = createSecretBoxFromEnvironment(environment).open(byteaToBuffer(secret.api_key_ciphertext), secret.key_version, row.id)
  try {
    const post = await generator.generateText({
      ...previewGenerationArgs(input),
      model: row.model, baseUrl: row.base_url, apiKey, temperature: TEXT_GENERATION_DEFAULT_TEMPERATURE, maxOutputTokens: TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS,
      // Kuerzer als die 60 s des Adapters (packages/content-engine): der Worker darf so lange
      // warten, weil dort niemand an einer offenen HTTP-Verbindung haengt -- hier wartet ein
      // Browser auf den "Testen"-Knopf, und jede wartende Anfrage haelt eine Verbindung.
      requestTimeoutMs: 30_000,
    })
    return { ok: true, post }
  } catch (error) {
    if (error instanceof ContentGenerationError) {
      return { ok: false, status: error.errorClass === 'provider_rate_limit' ? 429 : 502, error: error.errorClass }
    }
    throw error
  }
}
