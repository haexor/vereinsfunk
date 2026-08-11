import { createHash } from 'node:crypto'
import { createSecretBox } from '@vereinsfunk/secrets'
import { ContentGenerationError, OpenAiCompatibleStructuredContentGenerator, TEXT_PROMPT_TEMPLATE_VERSION, createTextGroundedContentBrief, type StructuredContentGenerator } from '@vereinsfunk/content-engine'
import { SourceMaterialSchema, StyleProfileRulesSchema, type WorkflowPayload } from '@vereinsfunk/contracts'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { WorkflowExecutionError } from './workflows.js'

type SessionRow = { id: string; organization_id: string; department_id: string; team_id: string | null; preset_slug: string; communication_goal: 'inform' | 'inspire' | 'thank' | 'invite' | 'recruit' | 'educate' | 'strengthen_community'; source_material: unknown; style_profile_snapshot: unknown }
type CandidateRow = { id: string; status: string; revision_instruction: string | null }
type ProviderRow = { id: string; protocol: string; base_url: string; model: string; temperature: number; max_output_tokens: number; structured_output_required: boolean; api_key_ciphertext: string; key_version: string }

export interface TextGenerationRepository {
  loadSession(id: string, organizationId: string): Promise<SessionRow | null>
  acquirePendingCandidate(sessionId: string, organizationId: string): Promise<CandidateRow | null>
  loadActiveTextProvider(): Promise<ProviderRow>
  markReady(candidateId: string, sessionId: string, generatedContent: unknown, metadata: { providerConfigurationId: string; providerModelId: string; providerParameterHash: string; promptTemplateVersion: string }): Promise<void>
  markFailed(candidateId: string, sessionId: string, errorClass: string): Promise<void>
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

function parameterHash(provider: ProviderRow) {
  return createHash('sha256').update(JSON.stringify({ baseUrl: provider.base_url, model: provider.model, temperature: provider.temperature, maxOutputTokens: provider.max_output_tokens, structuredOutputRequired: provider.structured_output_required })).digest('hex')
}

/** Executes one ID-only generate-text-post delivery. No content crosses the Hatchet envelope. */
export class TextGenerationExecutor {
  constructor(private readonly config: WorkerEnvironment, private readonly repository: TextGenerationRepository, private readonly generator: StructuredContentGenerator = new OpenAiCompatibleStructuredContentGenerator()) {}

  async execute(payload: WorkflowPayload) {
    if (payload.purpose !== 'initial' && payload.purpose !== 'revise') throw new WorkflowExecutionError('invalid_generation_purpose', false)
    const session = await this.repository.loadSession(payload.entityId, payload.organizationId)
    if (!session || session.department_id !== payload.departmentId) throw new WorkflowExecutionError('generation_session_not_found', false)
    const candidate = await this.repository.acquirePendingCandidate(session.id, session.organization_id)
    if (!candidate) return // duplicate delivery or a terminal candidate; never create a second one
    try {
      const provider = await this.repository.loadActiveTextProvider()
      if (provider.protocol !== 'openai' || !provider.structured_output_required) throw new WorkflowExecutionError('unsupported_provider_configuration', false)
      const style = session.style_profile_snapshot as { name?: unknown; description?: unknown; styleRules?: unknown; avoidRules?: unknown }
      const brief = createTextGroundedContentBrief({ presetSlug: session.preset_slug, communicationGoal: session.communication_goal, sourceMaterial: SourceMaterialSchema.parse(session.source_material) })
      const apiKey = parseSecretBox(this.config).open(ciphertextBuffer(provider.api_key_ciphertext), provider.key_version, provider.id)
      const post = await this.generator.generateText({
        brief,
        styleProfile: { name: String(style.name ?? 'Systemstil'), description: String(style.description ?? ''), styleRules: StyleProfileRulesSchema.parse(style.styleRules), avoidRules: Array.isArray(style.avoidRules) ? style.avoidRules.map(String) : [] },
        ...(candidate.revision_instruction ? { revisionInstruction: candidate.revision_instruction } : {}),
        model: provider.model, baseUrl: provider.base_url, apiKey, temperature: provider.temperature, maxOutputTokens: provider.max_output_tokens,
      })
      await this.repository.markReady(candidate.id, session.id, post, { providerConfigurationId: provider.id, providerModelId: provider.model, providerParameterHash: parameterHash(provider), promptTemplateVersion: TEXT_PROMPT_TEMPLATE_VERSION })
    } catch (error) {
      const classified = error instanceof ContentGenerationError ? error : error instanceof WorkflowExecutionError ? error : new WorkflowExecutionError('generation_validation', false)
      if (!classified.retryable) await this.repository.markFailed(candidate.id, session.id, classified.errorClass)
      throw new WorkflowExecutionError(classified.errorClass, classified.retryable)
    }
  }
}
