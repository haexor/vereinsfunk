import { describe, expect, it, vi } from 'vitest'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import type { WorkflowPayload } from '@vereinsfunk/contracts'
import { createSecretBox } from '@vereinsfunk/secrets'
import { ContentGenerationError } from '@vereinsfunk/content-engine'
import { WorkflowExecutionError } from './workflows.js'
import { TextGenerationExecutor, type TextGenerationRepository } from './textGeneration.js'

const payload: WorkflowPayload = { candidateId: '10000000-1300-4000-8000-000000000001', entityId: '10000000-0000-4000-8000-000000000001', organizationId: '10000000-1000-4000-8000-000000000001', departmentId: '10000000-1100-4000-8000-000000000001', correlationId: '10000000-1200-4000-8000-000000000001', sourceRevision: 1, purpose: 'initial', idempotencyKey: 'generate-text:test' }
const config = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service', HATCHET_CLIENT_TOKEN: 'token', SECRET_BOX_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 1).toString('base64') }), SECRET_BOX_CURRENT_KEY_VERSION: 'v1' } as WorkerEnvironment
const post = { verifiedFacts: ['topic: Passen'], missingFacts: [], headline: 'Passen', caption: 'Passen', shortCaption: 'Passen', callToAction: '', hashtags: [], altText: 'Passen', templateId: 'v1', safetyFlags: [], generatedClaims: [{ sourceId: 'fact:topic', text: 'topic: Passen' }], variants: [] }

function repository(): TextGenerationRepository {
  const sealed = createSecretBox({ v1: Buffer.alloc(32, 1).toString('base64') }, 'v1').seal('provider-key', 'provider-1')
  return {
    loadSession: vi.fn().mockResolvedValue({ id: payload.entityId, organization_id: payload.organizationId, department_id: payload.departmentId, team_id: null, preset_slug: 'training', communication_goal: 'inform', source_material: { facts: { topic: 'Passen' }, observations: [], quotes: [], doNotMention: [] }, style_profile_snapshot: { name: 'Klar', description: 'klar', styleRules: { sentenceLength: 'short', energy: 2, humour: 'none', formality: 'balanced', perspective: 'we', bannedPhrases: [], additionalInstructions: '' }, avoidRules: [] } }),
    acquirePendingCandidate: vi.fn().mockResolvedValue({ id: payload.candidateId, status: 'generating', lease_token: '10000000-1300-4000-8000-000000000099' }),
    loadActiveTextProvider: vi.fn().mockResolvedValue({ id: 'provider-1', protocol: 'openai', base_url: 'https://provider.example/v1', model: 'synthetic', temperature: 0.2, max_output_tokens: 400, structured_output_required: true, api_key_ciphertext: `\\x${sealed.ciphertext.toString('hex')}`, key_version: 'v1' }), markReady: vi.fn().mockResolvedValue(undefined), markFailed: vi.fn().mockResolvedValue(undefined), releaseCandidate: vi.fn().mockResolvedValue(undefined),
  }
}

describe('TextGenerationExecutor', () => {
  it('writes one candidate and never a post version', async () => {
    const repo = repository()
    const generator = { generateText: vi.fn().mockResolvedValue(post) }
    await new TextGenerationExecutor(config, repo, generator).execute(payload)
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
})
