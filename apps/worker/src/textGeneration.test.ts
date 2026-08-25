import { describe, expect, it, vi } from 'vitest'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import type { WorkflowPayload } from '@vereinsfunk/contracts'
import { createSecretBox } from '@vereinsfunk/secrets'
import { ContentGenerationError } from '@vereinsfunk/content-engine'
import { WorkflowExecutionError } from './workflows.js'
import { TextGenerationExecutor, type TextGenerationRepository } from './textGeneration.js'

const payload: WorkflowPayload = { candidateId: '10000000-1300-4000-8000-000000000001', entityId: '10000000-0000-4000-8000-000000000001', organizationId: '10000000-1000-4000-8000-000000000001', departmentId: '10000000-1100-4000-8000-000000000001', departmentConcurrencyKey: '10000000-1100-4000-8000-000000000001', correlationId: '10000000-1200-4000-8000-000000000001', sourceRevision: 1, purpose: 'initial', idempotencyKey: 'generate-text:test' }
const config = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service', DATABASE_URL: 'postgresql://postgres:secret@db.example:5432/postgres', HATCHET_CLIENT_TOKEN: 'token', SECRET_BOX_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 1).toString('base64') }), SECRET_BOX_CURRENT_KEY_VERSION: 'v1' } as WorkerEnvironment
const post = { verifiedFacts: ['topic: Passen'], missingFacts: [], headline: 'Passen', caption: 'Passen', shortCaption: 'Passen', callToAction: '', hashtags: [], altText: 'Passen', templateId: 'v1', safetyFlags: [], generatedClaims: [{ sourceId: 'fact:topic', text: 'topic: Passen' }], variants: [] }

function repository(): TextGenerationRepository {
  const sealed = createSecretBox({ v1: Buffer.alloc(32, 1).toString('base64') }, 'v1').seal('provider-key', 'provider-1')
  return {
    loadSession: vi.fn().mockResolvedValue({ id: payload.entityId, organization_id: payload.organizationId, department_id: payload.departmentId, team_id: null, communication_goal: 'inform', source_material: { facts: { topic: 'Passen' }, observations: [], quotes: [], doNotMention: [] }, style_profile_snapshot: { name: 'Klar', description: 'klar', styleRules: { toneTags: ['klar'], catchphrases: [], examples: [], additionalInstructions: '' }, avoidRules: [], doRules: [] }, max_characters: 2200, temperature: 0.6 }),
    acquirePendingCandidate: vi.fn().mockResolvedValue({ id: payload.candidateId, status: 'generating', lease_token: '10000000-1300-4000-8000-000000000099', provider_configuration_id: 'provider-1' }),
    loadProvider: vi.fn().mockResolvedValue({ id: 'provider-1', protocol: 'openai', base_url: 'https://provider.example/v1', model: 'synthetic', structured_output_required: true, api_key_ciphertext: `\\x${sealed.ciphertext.toString('hex')}`, key_version: 'v1' }), markReady: vi.fn().mockResolvedValue(undefined), markFailed: vi.fn().mockResolvedValue(undefined), releaseCandidate: vi.fn().mockResolvedValue(undefined),
  }
}

function repositoryWithProtocolAndTemperature(protocol: string, temperature: number): TextGenerationRepository {
  const repo = repository()
  repo.loadSession = vi.fn().mockResolvedValue({ id: payload.entityId, organization_id: payload.organizationId, department_id: payload.departmentId, team_id: null, communication_goal: 'inform', source_material: { facts: { topic: 'Passen' }, observations: [], quotes: [], doNotMention: [] }, style_profile_snapshot: { name: 'Klar', description: 'klar', styleRules: { toneTags: ['klar'], catchphrases: [], examples: [], additionalInstructions: '' }, avoidRules: [], doRules: [] }, max_characters: 2200, temperature })
  const sealed = createSecretBox({ v1: Buffer.alloc(32, 1).toString('base64') }, 'v1').seal('provider-key', 'provider-1')
  repo.loadProvider = vi.fn().mockResolvedValue({ id: 'provider-1', protocol, base_url: 'https://provider.example/v1', model: 'synthetic', structured_output_required: true, api_key_ciphertext: `\\x${sealed.ciphertext.toString('hex')}`, key_version: 'v1' })
  return repo
}

function repositoryWithRevisionInstruction(instruction: string): TextGenerationRepository {
  const repo = repository()
  repo.acquirePendingCandidate = vi.fn().mockResolvedValue({ id: payload.candidateId, status: 'generating', lease_token: '10000000-1300-4000-8000-000000000099', provider_configuration_id: 'provider-1', revision_instruction: instruction })
  return repo
}

function repositoryWithMaxCharacters(maxCharacters: number, observations: string[] = []): TextGenerationRepository {
  const repo = repository()
  repo.loadSession = vi.fn().mockResolvedValue({ id: payload.entityId, organization_id: payload.organizationId, department_id: payload.departmentId, team_id: null, communication_goal: 'inform', source_material: { facts: { topic: 'Passen' }, observations, quotes: [], doNotMention: [] }, style_profile_snapshot: { name: 'Klar', description: 'klar', styleRules: { toneTags: ['klar'], catchphrases: [], examples: [], additionalInstructions: '' }, avoidRules: [], doRules: [] }, max_characters: maxCharacters, temperature: 0.6 })
  return repo
}

describe('TextGenerationExecutor', () => {
  it('writes one candidate and never a post version', async () => {
    const repo = repository()
    const generator = { generateText: vi.fn().mockResolvedValue(post) }
    await new TextGenerationExecutor(config, repo, generator).execute(payload)
    expect(repo.markReady).toHaveBeenCalledTimes(1)
    expect(repo.markFailed).not.toHaveBeenCalled()
  })
  it('accepts an organization-level session (null departmentId on both session and payload)', async () => {
    const repo = repository()
    repo.loadSession = vi.fn().mockResolvedValue({ id: payload.entityId, organization_id: payload.organizationId, department_id: null, team_id: null, communication_goal: 'inform', source_material: { facts: { topic: 'Passen' }, observations: [], quotes: [], doNotMention: [] }, style_profile_snapshot: { name: 'Klar', description: 'klar', styleRules: { toneTags: ['klar'], catchphrases: [], examples: [], additionalInstructions: '' }, avoidRules: [], doRules: [] }, max_characters: 2200, temperature: 0.6 })
    const generator = { generateText: vi.fn().mockResolvedValue(post) }
    // departmentId absent (jsonb_strip_nulls strips it server-side), not just null -- the naive
    // `session.department_id !== payload.departmentId` comparison this guards against would see
    // `null !== undefined` and wrongly reject every organization-level delivery.
    const orgLevelPayload: WorkflowPayload = { ...payload, departmentId: undefined, departmentConcurrencyKey: 'org' }
    await new TextGenerationExecutor(config, repo, generator).execute(orgLevelPayload)
    expect(repo.markReady).toHaveBeenCalledTimes(1)
    expect(repo.markFailed).not.toHaveBeenCalled()
  })
  it('releases a retryable provider failure for Hatchet retry', async () => {
    const repo = repository()
    const generator = { generateText: vi.fn().mockRejectedValue(new ContentGenerationError('provider_rate_limit', true)) }
    await expect(new TextGenerationExecutor(config, repo, generator).execute(payload)).rejects.toMatchObject({ errorClass: 'provider_rate_limit', retryable: true })
    expect(repo.markFailed).not.toHaveBeenCalled()
    expect(repo.releaseCandidate).toHaveBeenCalledWith(payload.candidateId, payload.entityId, '10000000-1300-4000-8000-000000000099')
  })
  it('accepts a candidate-qualified purpose and rejects a mismatched candidate ID', async () => {
    const repo = repository()
    const generator = { generateText: vi.fn().mockResolvedValue(post) }
    await expect(new TextGenerationExecutor(config, repo, generator).execute({ ...payload, purpose: `revise:${payload.candidateId}` })).resolves.toBeUndefined()
    await expect(new TextGenerationExecutor(config, repository(), generator).execute({ ...payload, purpose: 'revise:10000000-1300-4000-8000-000000000002' })).rejects.toMatchObject({ errorClass: 'invalid_generation_purpose', retryable: false })
  })
  it('no-ops for a duplicate delivery or an already-terminal candidate', async () => {
    const repo = repository()
    repo.acquirePendingCandidate = vi.fn().mockResolvedValue(null)
    const generator = { generateText: vi.fn() }
    await expect(new TextGenerationExecutor(config, repo, generator).execute(payload)).resolves.toBeUndefined()
    expect(generator.generateText).not.toHaveBeenCalled()
  })
  it('propagates a retryable failure instead of a silent no-op for a candidate still within the recovery window', async () => {
    const repo = repository()
    repo.acquirePendingCandidate = vi.fn().mockRejectedValue(new WorkflowExecutionError('generation_candidate_still_in_progress', true))
    const generator = { generateText: vi.fn() }
    await expect(new TextGenerationExecutor(config, repo, generator).execute(payload)).rejects.toMatchObject({ errorClass: 'generation_candidate_still_in_progress', retryable: true })
    expect(generator.generateText).not.toHaveBeenCalled()
  })
  it('marks a candidate failed instead of crashing when a pre-migration snapshot has the old dial shape', async () => {
    const repo = repository()
    repo.loadSession = vi.fn().mockResolvedValue({ id: payload.entityId, organization_id: payload.organizationId, department_id: payload.departmentId, team_id: null, communication_goal: 'inform', source_material: { facts: { topic: 'Passen' }, observations: [], quotes: [], doNotMention: [] }, style_profile_snapshot: { name: 'Klar', description: 'klar', styleRules: { sentenceLength: 'short', energy: 3, humour: 'none', formality: 'balanced', perspective: 'we', bannedPhrases: [], additionalInstructions: '' }, avoidRules: [] }, max_characters: 2200, temperature: 0.6 })
    const generator = { generateText: vi.fn() }
    await expect(new TextGenerationExecutor(config, repo, generator).execute(payload)).rejects.toMatchObject({ errorClass: 'generation_validation', retryable: false })
    expect(repo.markFailed).toHaveBeenCalledWith(payload.candidateId, payload.entityId, '10000000-1300-4000-8000-000000000099', 'generation_validation')
    expect(repo.releaseCandidate).not.toHaveBeenCalled()
    expect(generator.generateText).not.toHaveBeenCalled()
  })

  // Plan 042, PR 3 Step 5: the Anthropic adapter never sends temperature (AnthropicStructuredContentGenerator
  // in packages/content-engine), so provider_parameter_hash must not vary with it for that protocol --
  // otherwise the hash would claim a parameter was used that was never actually sent.
  it('excludes temperature from provider_parameter_hash for a protocol that never sends it, includes it otherwise', async () => {
    const generator = { generateText: vi.fn().mockResolvedValue(post) }
    const anthropicLow = repositoryWithProtocolAndTemperature('anthropic', 0.3)
    await new TextGenerationExecutor(config, anthropicLow, generator).execute(payload)
    const anthropicLowHash = vi.mocked(anthropicLow.markReady).mock.calls[0]![4]!.providerParameterHash

    const anthropicHigh = repositoryWithProtocolAndTemperature('anthropic', 1.0)
    await new TextGenerationExecutor(config, anthropicHigh, generator).execute(payload)
    const anthropicHighHash = vi.mocked(anthropicHigh.markReady).mock.calls[0]![4]!.providerParameterHash
    expect(anthropicHighHash).toBe(anthropicLowHash)

    const openaiLow = repositoryWithProtocolAndTemperature('openai', 0.3)
    await new TextGenerationExecutor(config, openaiLow, generator).execute(payload)
    const openaiLowHash = vi.mocked(openaiLow.markReady).mock.calls[0]![4]!.providerParameterHash

    const openaiHigh = repositoryWithProtocolAndTemperature('openai', 1.0)
    await new TextGenerationExecutor(config, openaiHigh, generator).execute(payload)
    const openaiHighHash = vi.mocked(openaiHigh.markReady).mock.calls[0]![4]!.providerParameterHash
    expect(openaiHighHash).not.toBe(openaiLowHash)
  })

  // Plan 039, PR 1 Step 4: ohne diese Ableitung waere eine hoehere Plattform-Vorgabe (Website:
  // 5000 Zeichen) ein leeres Versprechen -- der Aufruf haette weiterhin nur das feste
  // 1200-Token-Budget, unabhaengig davon, was die Sitzung tatsaechlich erlaubt.
  it('derives maxOutputTokens from session.max_characters', async () => {
    const shortSession = repositoryWithMaxCharacters(2200)
    const generatorForShort = { generateText: vi.fn().mockResolvedValue(post) }
    await new TextGenerationExecutor(config, shortSession, generatorForShort).execute(payload)
    const shortTokens = vi.mocked(generatorForShort.generateText).mock.calls[0]![0]!.maxOutputTokens

    const longSession = repositoryWithMaxCharacters(5000)
    const generatorForLong = { generateText: vi.fn().mockResolvedValue(post) }
    await new TextGenerationExecutor(config, longSession, generatorForLong).execute(payload)
    const longTokens = vi.mocked(generatorForLong.generateText).mock.calls[0]![0]!.maxOutputTokens

    expect(longTokens).toBeGreaterThan(shortTokens)
  })

  // Isoliert den abgeleiteten Wert IM HASH: beide Sitzungen haben dieselbe max_characters, die schon
  // fuer sich im Hash steht -- unterschiedlich ist allein die Belegzahl, und die wirkt ausschliesslich
  // ueber maxOutputTokens. Ein Vergleich zweier max_characters-Werte (so stand es hier bis zum Review
  // dieses PRs) haette auch dann bestanden, wenn der abgeleitete Wert gar nicht im Hash landet.
  it('feeds the derived maxOutputTokens into provider_parameter_hash, independently of max_characters', async () => {
    const sparse = repositoryWithMaxCharacters(2200)
    const generatorForSparse = { generateText: vi.fn().mockResolvedValue(post) }
    await new TextGenerationExecutor(config, sparse, generatorForSparse).execute(payload)
    const sparseTokens = vi.mocked(generatorForSparse.generateText).mock.calls[0]![0]!.maxOutputTokens
    const sparseHash = vi.mocked(sparse.markReady).mock.calls[0]![4]!.providerParameterHash

    const rich = repositoryWithMaxCharacters(2200, ['Erste Beobachtung', 'Zweite Beobachtung', 'Dritte Beobachtung'])
    const generatorForRich = { generateText: vi.fn().mockResolvedValue(post) }
    await new TextGenerationExecutor(config, rich, generatorForRich).execute(payload)
    const richTokens = vi.mocked(generatorForRich.generateText).mock.calls[0]![0]!.maxOutputTokens
    const richHash = vi.mocked(rich.markReady).mock.calls[0]![4]!.providerParameterHash

    expect(richTokens).toBeGreaterThan(sparseTokens)
    expect(richHash).not.toBe(sparseHash)
  })

  // Plan 044, Step 6: der interne Wiederholversuch darf keinen Kandidaten-Slot verbrauchen -- er
  // laeuft komplett innerhalb dieses einen execute()-Aufrufs, ohne releaseCandidate/markFailed
  // zwischen den beiden generateText-Versuchen.
  it('retries once internally after a too-long caption, without releasing or failing the candidate', async () => {
    const repo = repository()
    const generator = { generateText: vi.fn().mockRejectedValueOnce(new ContentGenerationError('caption_too_long', false, 37)).mockResolvedValueOnce(post) }
    await new TextGenerationExecutor(config, repo, generator).execute(payload)
    expect(generator.generateText).toHaveBeenCalledTimes(2)
    expect(vi.mocked(generator.generateText).mock.calls[1]![0]!.revisionInstruction).toContain('37 Zeichen zu lang')
    expect(vi.mocked(generator.generateText).mock.calls[1]![0]!.revisionInstruction).toContain('2200 Zeichen')
    expect(repo.markReady).toHaveBeenCalledTimes(1)
    expect(repo.markFailed).not.toHaveBeenCalled()
    expect(repo.releaseCandidate).not.toHaveBeenCalled()
  })

  it('combines an existing revision instruction with the length correction on retry', async () => {
    const repo = repositoryWithRevisionInstruction('Mehr Emotionen bitte.')
    const generator = { generateText: vi.fn().mockRejectedValueOnce(new ContentGenerationError('caption_too_long', false, 10)).mockResolvedValueOnce(post) }
    await new TextGenerationExecutor(config, repo, generator).execute(payload)
    const secondCallArgs = vi.mocked(generator.generateText).mock.calls[1]![0]!
    expect(secondCallArgs.revisionInstruction).toContain('Mehr Emotionen bitte.')
    expect(secondCallArgs.revisionInstruction).toContain('10 Zeichen zu lang')
    // Der erste Versuch traegt weiterhin nur die urspruengliche Anweisung des Mitglieds.
    expect(vi.mocked(generator.generateText).mock.calls[0]![0]!.revisionInstruction).toBe('Mehr Emotionen bitte.')
  })

  it('fails the candidate, not retryable, when the internal retry is also too long -- exactly two attempts, no second candidate', async () => {
    const repo = repository()
    const generator = { generateText: vi.fn().mockRejectedValue(new ContentGenerationError('caption_too_long', false, 12)) }
    await expect(new TextGenerationExecutor(config, repo, generator).execute(payload)).rejects.toMatchObject({ errorClass: 'caption_too_long', retryable: false })
    expect(generator.generateText).toHaveBeenCalledTimes(2)
    expect(repo.markFailed).toHaveBeenCalledWith(payload.candidateId, payload.entityId, '10000000-1300-4000-8000-000000000099', 'caption_too_long')
    expect(repo.releaseCandidate).not.toHaveBeenCalled()
  })

  it('does not intercept an unrelated error on the first attempt', async () => {
    const repo = repository()
    const generator = { generateText: vi.fn().mockRejectedValue(new ContentGenerationError('provider_rate_limit', true)) }
    await expect(new TextGenerationExecutor(config, repo, generator).execute(payload)).rejects.toMatchObject({ errorClass: 'provider_rate_limit', retryable: true })
    expect(generator.generateText).toHaveBeenCalledTimes(1)
    expect(repo.releaseCandidate).toHaveBeenCalled()
  })
})
