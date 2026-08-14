import { createHash } from 'node:crypto'
import { createSecretBox } from '@vereinsfunk/secrets'
import { AnthropicStructuredContentGenerator, ContentGenerationError, OpenAiCompatibleStructuredContentGenerator, TEXT_PROMPT_TEMPLATE_VERSION, createTextGroundedContentBrief, type StructuredContentGenerator } from '@vereinsfunk/content-engine'
import { deriveTextGenerationMaxOutputTokens, providerSendsTemperature, SourceMaterialSchema, StyleProfileSnapshotSchema, UuidSchema, type WorkflowPayload } from '@vereinsfunk/contracts'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { WorkflowExecutionError } from './workflows.js'

export type SessionRow = { id: string; organization_id: string; department_id: string; team_id: string | null; preset_slug: string; communication_goal: 'inform' | 'inspire' | 'thank' | 'invite' | 'recruit' | 'educate' | 'strengthen_community'; source_material: unknown; style_profile_snapshot: unknown; max_characters: number; temperature: number }
export type CandidateRow = { id: string; status: string; revision_instruction: string | null; lease_token: string }
export type ProviderRow = { id: string; protocol: string; base_url: string; model: string; structured_output_required: boolean; api_key_ciphertext: string; key_version: string }

export interface TextGenerationRepository {
  loadSession(id: string, organizationId: string): Promise<SessionRow | null>
  acquirePendingCandidate(candidateId: string, sessionId: string, organizationId: string): Promise<CandidateRow | null>
  loadActiveTextProvider(): Promise<ProviderRow>
  markReady(candidateId: string, sessionId: string, leaseToken: string, generatedContent: unknown, metadata: { providerConfigurationId: string; providerModelId: string; providerParameterHash: string; promptTemplateVersion: string }): Promise<void>
  markFailed(candidateId: string, sessionId: string, leaseToken: string, errorClass: string): Promise<void>
  releaseCandidate(candidateId: string, sessionId: string, leaseToken: string): Promise<void>
}

function parseSecretBox(config: WorkerEnvironment) {
  let keys: unknown
  try { keys = JSON.parse(config.SECRET_BOX_KEYS) } catch { throw new WorkflowExecutionError('secret_configuration', false) }
  if (typeof keys !== 'object' || !keys || Array.isArray(keys)) throw new WorkflowExecutionError('secret_configuration', false)
  return createSecretBox(keys as Record<string, string>, config.SECRET_BOX_CURRENT_KEY_VERSION)
}

function ciphertextBuffer(value: string) {
  if (!value.startsWith('\\x')) throw new WorkflowExecutionError('provider_secret_encoding', false)
  return Buffer.from(value.slice(2), 'hex')
}

// Plan 042, PR 3 Step 5: provider_parameter_hash muss die tatsaechlich benutzten Parameter
// hashen. Der Anthropic-Adapter sendet temperature bewusst nie (siehe generateText unten) -- sie
// in den Hash aufzunehmen, waere eine falsche Provenienz-Angabe. providerSendsTemperature() ist
// dieselbe Quelle, aus der GET /v1/text-generation-capabilities den Regler aus- oder einblendet.
//
// Plan 039, PR 1 Step 4: maxOutputTokens ist seitdem aus session.max_characters abgeleitet statt
// einer festen Konstante -- der Hash aendert sich dadurch bewusst (der tatsaechlich gesendete
// Parameter aendert sich ja auch), das ist eine gewollte Provenienz-Aenderung, keine Regression.
function parameterHash(provider: ProviderRow, session: SessionRow) {
  return createHash('sha256').update(JSON.stringify({
    baseUrl: provider.base_url, model: provider.model,
    ...(providerSendsTemperature(provider.protocol) ? { temperature: session.temperature } : {}),
    maxCharacters: session.max_characters, maxOutputTokens: deriveTextGenerationMaxOutputTokens(session.max_characters),
    structuredOutputRequired: provider.structured_output_required,
  })).digest('hex')
}

function hasGenerationPurpose(payload: WorkflowPayload): boolean {
  if (!payload.candidateId) return false
  if (payload.purpose === 'initial' || payload.purpose === 'revise') return true // pre-migration deliveries
  const match = /^(initial|revise):([0-9a-f-]{36})$/i.exec(payload.purpose)
  return match !== null && match[2] === payload.candidateId && UuidSchema.safeParse(match[2]).success
}

// Ein Adapter je Protokoll. Beide sind zustandslos, eine Instanz je Prozess genuegt. Ein Protokoll
// ohne Eintrag hier gilt als nicht implementiert -- das ist die einzige Stelle, die darueber
// entscheidet, statt einer zweiten Liste neben der Datenbank-Constraint.
const GENERATORS: Record<string, StructuredContentGenerator | undefined> = {
  openai: new OpenAiCompatibleStructuredContentGenerator(),
  anthropic: new AnthropicStructuredContentGenerator(),
}

/** Executes one ID-only generate-text-post delivery. No content crosses the Hatchet envelope. */
export class TextGenerationExecutor {
  /** `generator` ueberschreibt die Protokollauswahl vollstaendig und ist die Testklammer. */
  constructor(private readonly config: WorkerEnvironment, private readonly repository: TextGenerationRepository, private readonly generator?: StructuredContentGenerator) {}

  async execute(payload: WorkflowPayload) {
    if (!payload.candidateId) throw new WorkflowExecutionError('generation_candidate_not_found', false)
    if (!hasGenerationPurpose(payload)) throw new WorkflowExecutionError('invalid_generation_purpose', false)
    const session = await this.repository.loadSession(payload.entityId, payload.organizationId)
    if (!session || session.department_id !== payload.departmentId) throw new WorkflowExecutionError('generation_session_not_found', false)
    const candidate = await this.repository.acquirePendingCandidate(payload.candidateId, session.id, session.organization_id)
    if (!candidate) return // duplicate delivery or a terminal candidate; never create a second one
    try {
      const provider = await this.repository.loadActiveTextProvider()
      const generator = this.generator ?? GENERATORS[provider.protocol]
      if (!generator || !provider.structured_output_required) throw new WorkflowExecutionError('unsupported_provider_configuration', false)
      const style = StyleProfileSnapshotSchema.parse(session.style_profile_snapshot)
      const brief = createTextGroundedContentBrief({ presetSlug: session.preset_slug, communicationGoal: session.communication_goal, sourceMaterial: SourceMaterialSchema.parse(session.source_material) })
      const apiKey = parseSecretBox(this.config).open(ciphertextBuffer(provider.api_key_ciphertext), provider.key_version, provider.id)
      const post = await generator.generateText({
        brief,
        styleProfile: { name: style.name, description: style.description, styleRules: style.styleRules, avoidRules: style.avoidRules, doRules: style.doRules },
        ...(candidate.revision_instruction ? { revisionInstruction: candidate.revision_instruction } : {}),
        // maxOutputTokens ist nur die Leine fuer den Aufruf; die verbindliche Grenze der Ziel-
        // Plattform ist maxCharacters und steht im Prompt. Aus maxCharacters abgeleitet (Plan 039,
        // PR 1 Step 4), damit eine hoehere Plattform-Vorgabe (Website: 5000 Zeichen) nicht an einem
        // festen Token-Budget scheitert.
        model: provider.model, baseUrl: provider.base_url, apiKey, temperature: session.temperature,
        maxOutputTokens: deriveTextGenerationMaxOutputTokens(session.max_characters), maxCharacters: session.max_characters,
      })
      await this.repository.markReady(candidate.id, session.id, candidate.lease_token, post, { providerConfigurationId: provider.id, providerModelId: provider.model, providerParameterHash: parameterHash(provider, session), promptTemplateVersion: TEXT_PROMPT_TEMPLATE_VERSION })
    } catch (error) {
      const classified = error instanceof ContentGenerationError ? error : error instanceof WorkflowExecutionError ? error : new WorkflowExecutionError('generation_validation', false)
      if (classified.retryable) await this.repository.releaseCandidate(candidate.id, session.id, candidate.lease_token)
      else await this.repository.markFailed(candidate.id, session.id, candidate.lease_token, classified.errorClass)
      throw new WorkflowExecutionError(classified.errorClass, classified.retryable)
    }
  }
}
