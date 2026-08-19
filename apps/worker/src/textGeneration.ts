import { createHash } from 'node:crypto'
import { createSecretBox } from '@vereinsfunk/secrets'
import { AnthropicStructuredContentGenerator, ContentGenerationError, OpenAiCompatibleStructuredContentGenerator, TEXT_PROMPT_TEMPLATE_VERSION, createTextGroundedContentBrief, type StructuredContentGenerator } from '@vereinsfunk/content-engine'
import { deriveTextGenerationMaxOutputTokens, providerSendsTemperature, SourceMaterialSchema, StyleProfileSnapshotSchema, UuidSchema, type GeneratedPost, type WorkflowPayload } from '@vereinsfunk/contracts'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { WorkflowExecutionError } from './workflows.js'

export type SessionRow = { id: string; organization_id: string; department_id: string; team_id: string | null; communication_goal: 'inform' | 'inspire' | 'thank' | 'invite' | 'recruit' | 'educate' | 'strengthen_community'; source_material: unknown; style_profile_snapshot: unknown; max_characters: number; temperature: number }
// provider_configuration_id ist ab Paket 046 fest zugewiesen (create_text_generation_session
// weist die Zeile beim Anlegen einem bestimmten Provider zu, siehe Migration 2026081912) --
// execute() unten laedt genau diesen statt "den gerade aktiven".
export type CandidateRow = { id: string; status: string; revision_instruction: string | null; lease_token: string; provider_configuration_id: string }
export type ProviderRow = { id: string; protocol: string; base_url: string; model: string; structured_output_required: boolean; api_key_ciphertext: string; key_version: string }

export interface TextGenerationRepository {
  loadSession(id: string, organizationId: string): Promise<SessionRow | null>
  acquirePendingCandidate(candidateId: string, sessionId: string, organizationId: string): Promise<CandidateRow | null>
  loadProvider(providerConfigurationId: string): Promise<ProviderRow>
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
// Plan 039, PR 1 Step 4: maxOutputTokens ist seitdem abgeleitet statt eine feste Konstante -- der
// Hash aendert sich dadurch bewusst (der tatsaechlich gesendete Parameter aendert sich ja auch),
// das ist eine gewollte Provenienz-Aenderung, keine Regression. Der Wert wird hereingereicht statt
// hier neu berechnet: er haengt neben max_characters auch an der Belegzahl des Briefs, und zwei
// Ableitungen derselben Zahl liefen sonst auseinander (Review dieses PRs).
function parameterHash(provider: ProviderRow, session: SessionRow, maxOutputTokens: number) {
  return createHash('sha256').update(JSON.stringify({
    baseUrl: provider.base_url, model: provider.model,
    ...(providerSendsTemperature(provider.protocol) ? { temperature: session.temperature } : {}),
    maxCharacters: session.max_characters, maxOutputTokens,
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
      const provider = await this.repository.loadProvider(candidate.provider_configuration_id)
      const generator = this.generator ?? GENERATORS[provider.protocol]
      if (!generator || !provider.structured_output_required) throw new WorkflowExecutionError('unsupported_provider_configuration', false)
      const style = StyleProfileSnapshotSchema.parse(session.style_profile_snapshot)
      const brief = createTextGroundedContentBrief({ communicationGoal: session.communication_goal, sourceMaterial: SourceMaterialSchema.parse(session.source_material) })
      const apiKey = parseSecretBox(this.config).open(ciphertextBuffer(provider.api_key_ciphertext), provider.key_version, provider.id)
      // Belegzahl aus dem Brief, nicht aus dem Rohmaterial: assertGroundedPost prueft gegen genau
      // diese Menge, und sie ist es, die die Antwort ueber verifiedFacts/generatedClaims verlaengert.
      const maxOutputTokens = deriveTextGenerationMaxOutputTokens(session.max_characters, brief.allowedClaims.length + brief.approvedQuotes.length)
      const generationArgs = {
        brief,
        styleProfile: { name: style.name, description: style.description, styleRules: style.styleRules, avoidRules: style.avoidRules, doRules: style.doRules },
        // maxOutputTokens ist nur die Leine fuer den Aufruf; die verbindliche Grenze der Ziel-
        // Plattform ist maxCharacters und steht im Prompt. Aus maxCharacters und der Belegzahl
        // abgeleitet (Plan 039, PR 1 Step 4), damit weder eine hoehere Plattform-Vorgabe (Website:
        // 5000 Zeichen) noch ein belegreicher Spielbericht an einem festen Token-Budget scheitert.
        model: provider.model, baseUrl: provider.base_url, apiKey, temperature: session.temperature,
        maxOutputTokens, maxCharacters: session.max_characters,
      }
      let post: GeneratedPost
      try {
        post = await generator.generateText({ ...generationArgs, ...(candidate.revision_instruction ? { revisionInstruction: candidate.revision_instruction } : {}) })
      } catch (error) {
        if (!(error instanceof ContentGenerationError) || error.errorClass !== 'caption_too_long') throw error
        // Ein interner, kandidatenslot-neutraler Wiederholversuch (Plan 044, Step 6): das Modell
        // erfaehrt die tatsaechliche Ueberlaenge, statt dass der Kandidat sofort als gescheitert
        // gilt. composition_sessions.candidate_count zaehlt nur neue Kandidatenzeilen -- hier
        // entsteht keine, derselbe Grundsatz wie bei Infrastruktur-Wiederholungen ("die Zaehlstelle
        // so legen, dass interne Versuche sie nicht erreichen"). Scheitert auch dieser zweite
        // Versuch (an derselben oder einer anderen Ursache), propagiert der Fehler unveraendert in
        // den aeusseren catch-Block unten -- echter Fehlschlag statt eines weiteren Versuchs.
        const correction = `Der vorige Entwurf war ${error.overBy} Zeichen zu lang, kuerze auf hoechstens ${session.max_characters} Zeichen.`
        const revisionInstruction = candidate.revision_instruction ? `${candidate.revision_instruction} ${correction}` : correction
        post = await generator.generateText({ ...generationArgs, revisionInstruction })
      }
      await this.repository.markReady(candidate.id, session.id, candidate.lease_token, post, { providerConfigurationId: provider.id, providerModelId: provider.model, providerParameterHash: parameterHash(provider, session, maxOutputTokens), promptTemplateVersion: TEXT_PROMPT_TEMPLATE_VERSION })
    } catch (error) {
      const classified = error instanceof ContentGenerationError ? error : error instanceof WorkflowExecutionError ? error : new WorkflowExecutionError('generation_validation', false)
      if (classified.retryable) await this.repository.releaseCandidate(candidate.id, session.id, candidate.lease_token)
      else await this.repository.markFailed(candidate.id, session.id, candidate.lease_token, classified.errorClass)
      throw new WorkflowExecutionError(classified.errorClass, classified.retryable)
    }
  }
}
