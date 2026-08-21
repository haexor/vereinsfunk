import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import type { WorkflowPayload } from '@vereinsfunk/contracts'
import { createSecretBox } from '@vereinsfunk/secrets'
import { VisionAnalysisError } from '@vereinsfunk/content-engine'
import { OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import { BrandWebsiteAnalysisExecutor, type BrandWebsiteAnalysisRepository } from './brandWebsiteAnalysis.js'
import type { WebsiteRenderer } from './websiteRenderer.js'

const payload: WorkflowPayload = { entityId: '20000000-0000-4000-8000-000000000001', organizationId: '20000000-1000-4000-8000-000000000001', departmentId: '20000000-1100-4000-8000-000000000001', correlationId: '20000000-1200-4000-8000-000000000001', sourceRevision: 1, purpose: 'default', idempotencyKey: 'analyze-website-branding:test' }
const config = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service', DATABASE_URL: 'postgresql://postgres:secret@db.example:5432/postgres', HATCHET_CLIENT_TOKEN: 'token', SECRET_BOX_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 1).toString('base64') }), SECRET_BOX_CURRENT_KEY_VERSION: 'v1' } as WorkerEnvironment
const analysis = { primaryColor: '#163a2c', accentColor: '#caff4a', backgroundColor: '#f6f4ec', textColor: '#122820', onPrimaryColor: '#ffffff', suggestedFontPairingKey: 'manrope_dm_sans' }
const renderResult = { screenshotBase64: 'ZmFrZS1wbmc=', screenshotMediaType: 'image/png' as const, logoCandidateUrls: [] as string[], detectedFontFamily: 'Roboto, sans-serif' }

function repository(): BrandWebsiteAnalysisRepository {
  const sealed = createSecretBox({ v1: Buffer.alloc(32, 1).toString('base64') }, 'v1').seal('provider-key', 'provider-1')
  return {
    loadJob: vi.fn().mockResolvedValue({ id: payload.entityId, organization_id: payload.organizationId, website_url: 'https://verein.example.org', revision: 1 }),
    markRunning: vi.fn().mockResolvedValue(undefined),
    markSucceeded: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    resolveVisionProvider: vi.fn().mockResolvedValue({ id: 'provider-1', protocol: 'openai', base_url: 'https://provider.example/v1', model: 'vision-model', api_key_ciphertext: `\\x${sealed.ciphertext.toString('hex')}`, key_version: 'v1' }),
    uploadStagedLogo: vi.fn().mockResolvedValue('organizations/x/brand/analysis-staging/abc.png'),
  }
}

function renderer(result: typeof renderResult = renderResult): WebsiteRenderer {
  return { render: vi.fn().mockResolvedValue(result) }
}

describe('BrandWebsiteAnalysisExecutor', () => {
  it('runs the full pipeline and marks the job succeeded with no logo when none was found', async () => {
    const repo = repository()
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    await new BrandWebsiteAnalysisExecutor(config, repo, renderer(), generator).execute(payload)
    expect(repo.markRunning).toHaveBeenCalledWith(payload.entityId, 1)
    expect(repo.markSucceeded).toHaveBeenCalledWith(payload.entityId, 1, { ...analysis, detectedFontFamily: 'Roboto, sans-serif', logoObjectPath: null, logoMimeType: null })
    expect(repo.markFailed).not.toHaveBeenCalled()
    expect(repo.uploadStagedLogo).not.toHaveBeenCalled()
  })

  it('no-ops for a duplicate delivery or a job already superseded by a newer revision', async () => {
    const repo = repository()
    repo.loadJob = vi.fn().mockResolvedValue({ id: payload.entityId, organization_id: payload.organizationId, website_url: 'https://verein.example.org', revision: 2 })
    const generator = { analyzeBrand: vi.fn() }
    await expect(new BrandWebsiteAnalysisExecutor(config, repo, renderer(), generator).execute(payload)).resolves.toBeUndefined()
    expect(repo.markRunning).not.toHaveBeenCalled()
    expect(generator.analyzeBrand).not.toHaveBeenCalled()
  })

  it('no-ops when the job no longer exists', async () => {
    const repo = repository()
    repo.loadJob = vi.fn().mockResolvedValue(null)
    const generator = { analyzeBrand: vi.fn() }
    await expect(new BrandWebsiteAnalysisExecutor(config, repo, renderer(), generator).execute(payload)).resolves.toBeUndefined()
  })

  it('marks the job failed (not just left running) when the vision provider call fails, even for a retryable error', async () => {
    const repo = repository()
    const generator = { analyzeBrand: vi.fn().mockRejectedValue(new VisionAnalysisError('provider_rate_limit', true)) }
    await expect(new BrandWebsiteAnalysisExecutor(config, repo, renderer(), generator).execute(payload)).rejects.toMatchObject({ errorClass: 'provider_rate_limit', retryable: true })
    expect(repo.markFailed).toHaveBeenCalledWith(payload.entityId, 1, 'provider_rate_limit')
  })

  it('fails without ever calling the vision provider when no active vision provider is configured', async () => {
    const repo = repository()
    repo.resolveVisionProvider = vi.fn().mockResolvedValue(null)
    const generator = { analyzeBrand: vi.fn() }
    await expect(new BrandWebsiteAnalysisExecutor(config, repo, renderer(), generator).execute(payload)).rejects.toMatchObject({ errorClass: 'no_vision_provider_configured', retryable: false })
    expect(generator.analyzeBrand).not.toHaveBeenCalled()
  })

  it('classifies a blocked/redirected renderer target as a non-retryable failure', async () => {
    const repo = repository()
    const blockedRenderer: WebsiteRenderer = { render: vi.fn().mockRejectedValue(new OutboundFetchError('blocked_url', 'blocked')) }
    const generator = { analyzeBrand: vi.fn() }
    await expect(new BrandWebsiteAnalysisExecutor(config, repo, blockedRenderer, generator).execute(payload)).rejects.toMatchObject({ errorClass: 'blocked_url', retryable: false })
    expect(repo.markFailed).toHaveBeenCalledWith(payload.entityId, 1, 'blocked_url')
  })

  it('uploads a successfully processed logo candidate and records its object path and mime type', async () => {
    const repo = repository()
    const withLogo = renderer({ ...renderResult, logoCandidateUrls: ['https://verein.example.org/logo.png'] })
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    // A real 40x40 PNG (above MIN_DIMENSION_PX) so processBrandLogoUpload's magic-byte + sharp decode succeed for real.
    const pngBytes = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 22, g: 58, b: 44, alpha: 1 } } }).png().toBuffer()
    const logoFetcher = vi.fn().mockResolvedValue(new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } }))
    await new BrandWebsiteAnalysisExecutor(config, repo, withLogo, generator, logoFetcher).execute(payload)
    expect(repo.uploadStagedLogo).toHaveBeenCalledTimes(1)
    expect(repo.markSucceeded).toHaveBeenCalledWith(payload.entityId, 1, expect.objectContaining({ logoObjectPath: 'organizations/x/brand/analysis-staging/abc.png', logoMimeType: 'image/png' }))
  })

  it('does not fail the whole analysis when the only logo candidate cannot be downloaded', async () => {
    const repo = repository()
    const withLogo = renderer({ ...renderResult, logoCandidateUrls: ['https://verein.example.org/missing-logo.png'] })
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    const logoFetcher = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }))
    await new BrandWebsiteAnalysisExecutor(config, repo, withLogo, generator, logoFetcher).execute(payload)
    expect(repo.uploadStagedLogo).not.toHaveBeenCalled()
    expect(repo.markSucceeded).toHaveBeenCalledWith(payload.entityId, 1, expect.objectContaining({ logoObjectPath: null }))
  })
})
