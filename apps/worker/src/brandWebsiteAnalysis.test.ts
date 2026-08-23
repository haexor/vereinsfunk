import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { hashLogoBuffer } from '@vereinsfunk/brand-assets'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import type { WorkflowPayload } from '@vereinsfunk/contracts'
import { createSecretBox } from '@vereinsfunk/secrets'
import { VisionAnalysisError } from '@vereinsfunk/content-engine'
import { OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import {
  BrandWebsiteAnalysisExecutor,
  type BrandWebsiteAnalysisRepository,
} from './brandWebsiteAnalysis.js'
import type { LogoCandidate, WebsiteRenderer } from './websiteRenderer.js'

const payload: WorkflowPayload = {
  entityId: '20000000-0000-4000-8000-000000000001',
  organizationId: '20000000-1000-4000-8000-000000000001',
  departmentId: '20000000-1100-4000-8000-000000000001',
  correlationId: '20000000-1200-4000-8000-000000000001',
  sourceRevision: 1,
  purpose: 'default',
  idempotencyKey: 'analyze-website-branding:test',
}
const config = {
  SUPABASE_URL: 'https://db.example',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  DATABASE_URL: 'postgresql://postgres:secret@db.example:5432/postgres',
  HATCHET_CLIENT_TOKEN: 'token',
  SECRET_BOX_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 1).toString('base64') }),
  SECRET_BOX_CURRENT_KEY_VERSION: 'v1',
} as WorkerEnvironment
const analysis = {
  primaryColor: '#163a2c',
  accentColor: '#caff4a',
  backgroundColor: '#f6f4ec',
  textColor: '#122820',
  onPrimaryColor: '#ffffff',
  suggestedFontPairingKey: 'manrope_dm_sans',
}
const renderResult = {
  screenshotBase64: 'ZmFrZS1wbmc=',
  screenshotMediaType: 'image/png' as const,
  logoCandidates: [] as LogoCandidate[],
  detectedFontFamily: 'Roboto, sans-serif',
}

function repository(): BrandWebsiteAnalysisRepository {
  const sealed = createSecretBox({ v1: Buffer.alloc(32, 1).toString('base64') }, 'v1').seal(
    'provider-key',
    'provider-1',
  )
  return {
    loadJob: vi
      .fn()
      .mockResolvedValue({
        id: payload.entityId,
        organization_id: payload.organizationId,
        website_url: 'https://verein.example.org',
        revision: 1,
      }),
    markRunning: vi.fn().mockResolvedValue(undefined),
    markSucceeded: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    resolveVisionProvider: vi
      .fn()
      .mockResolvedValue({
        id: 'provider-1',
        protocol: 'openai',
        base_url: 'https://provider.example/v1',
        model: 'vision-model',
        api_key_ciphertext: `\\x${sealed.ciphertext.toString('hex')}`,
        key_version: 'v1',
      }),
    uploadStagedLogo: vi.fn().mockResolvedValue('organizations/x/brand/analysis-staging/abc.png'),
  }
}

function renderer(result: typeof renderResult = renderResult): WebsiteRenderer {
  return { render: vi.fn().mockResolvedValue(result) }
}

describe('BrandWebsiteAnalysisExecutor', () => {
  it('runs the full pipeline and marks the job succeeded with no logo candidates when none was found', async () => {
    const repo = repository()
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    await new BrandWebsiteAnalysisExecutor(config, repo, renderer(), generator).execute(payload)
    expect(repo.markRunning).toHaveBeenCalledWith(payload.entityId, 1)
    expect(repo.markSucceeded).toHaveBeenCalledWith(payload.entityId, 1, {
      ...analysis,
      detectedFontFamily: 'Roboto, sans-serif',
      logoCandidates: [],
    })
    expect(repo.markFailed).not.toHaveBeenCalled()
    expect(repo.uploadStagedLogo).not.toHaveBeenCalled()
  })

  it('no-ops for a duplicate delivery or a job already superseded by a newer revision', async () => {
    const repo = repository()
    repo.loadJob = vi
      .fn()
      .mockResolvedValue({
        id: payload.entityId,
        organization_id: payload.organizationId,
        website_url: 'https://verein.example.org',
        revision: 2,
      })
    const generator = { analyzeBrand: vi.fn() }
    await expect(
      new BrandWebsiteAnalysisExecutor(config, repo, renderer(), generator).execute(payload),
    ).resolves.toBeUndefined()
    expect(repo.markRunning).not.toHaveBeenCalled()
    expect(generator.analyzeBrand).not.toHaveBeenCalled()
  })

  it('no-ops when the job no longer exists', async () => {
    const repo = repository()
    repo.loadJob = vi.fn().mockResolvedValue(null)
    const generator = { analyzeBrand: vi.fn() }
    await expect(
      new BrandWebsiteAnalysisExecutor(config, repo, renderer(), generator).execute(payload),
    ).resolves.toBeUndefined()
  })

  it('marks the job failed (not just left running) when the vision provider call fails, even for a retryable error', async () => {
    const repo = repository()
    const generator = {
      analyzeBrand: vi.fn().mockRejectedValue(new VisionAnalysisError('provider_rate_limit', true)),
    }
    await expect(
      new BrandWebsiteAnalysisExecutor(config, repo, renderer(), generator).execute(payload),
    ).rejects.toMatchObject({ errorClass: 'provider_rate_limit', retryable: true })
    expect(repo.markFailed).toHaveBeenCalledWith(payload.entityId, 1, 'provider_rate_limit')
  })

  it('fails without rendering anything when no active vision provider is configured', async () => {
    const repo = repository()
    repo.resolveVisionProvider = vi.fn().mockResolvedValue(null)
    const generator = { analyzeBrand: vi.fn() }
    const websiteRenderer = renderer()
    await expect(
      new BrandWebsiteAnalysisExecutor(config, repo, websiteRenderer, generator).execute(payload),
    ).rejects.toMatchObject({ errorClass: 'no_vision_provider_configured', retryable: false })
    expect(generator.analyzeBrand).not.toHaveBeenCalled()
    // Der Ausgangszustand jeder Installation: dann darf der Job weder einen Browser starten noch
    // eine fremde Seite abrufen oder einen Logo-Kandidaten ablegen, den danach nichts referenziert.
    expect(websiteRenderer.render).not.toHaveBeenCalled()
    expect(repo.uploadStagedLogo).not.toHaveBeenCalled()
    expect(repo.markFailed).toHaveBeenCalledWith(
      payload.entityId,
      1,
      'no_vision_provider_configured',
    )
  })

  it('classifies a blocked/redirected renderer target as a non-retryable failure', async () => {
    const repo = repository()
    const blockedRenderer: WebsiteRenderer = {
      render: vi.fn().mockRejectedValue(new OutboundFetchError('blocked_url', 'blocked')),
    }
    const generator = { analyzeBrand: vi.fn() }
    await expect(
      new BrandWebsiteAnalysisExecutor(config, repo, blockedRenderer, generator).execute(payload),
    ).rejects.toMatchObject({ errorClass: 'blocked_url', retryable: false })
    expect(repo.markFailed).toHaveBeenCalledWith(payload.entityId, 1, 'blocked_url')
  })

  it('uploads a successfully processed logo candidate and records its object path and mime type', async () => {
    const repo = repository()
    const withLogo = renderer({
      ...renderResult,
      logoCandidates: [{ url: 'https://verein.example.org/logo.png', score: 5 }],
    })
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    // A real 40x40 PNG (above MIN_DIMENSION_PX) so processBrandLogoUpload's magic-byte + sharp decode succeed for real.
    const pngBytes = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 22, g: 58, b: 44, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const logoFetcher = vi.fn().mockResolvedValue(pngBytes)
    await new BrandWebsiteAnalysisExecutor(config, repo, withLogo, generator, logoFetcher).execute(
      payload,
    )
    expect(repo.uploadStagedLogo).toHaveBeenCalledTimes(1)
    expect(repo.markSucceeded).toHaveBeenCalledWith(
      payload.entityId,
      1,
      expect.objectContaining({
        logoCandidates: [
          { objectPath: 'organizations/x/brand/analysis-staging/abc.png', mimeType: 'image/png' },
        ],
      }),
    )
  })

  it('collects every distinct logo candidate instead of only the first', async () => {
    const repo = repository()
    const withLogos = renderer({
      ...renderResult,
      logoCandidates: [
        { url: 'https://verein.example.org/logo.png', score: 5 },
        { url: 'https://verein.example.org/wortmarke.png', score: 3 },
      ],
    })
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    const first = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 22, g: 58, b: 44, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const second = await sharp({
      create: {
        width: 60,
        height: 40,
        channels: 4,
        background: { r: 200, g: 200, b: 200, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    repo.uploadStagedLogo = vi
      .fn()
      .mockResolvedValueOnce('organizations/x/brand/analysis-staging/abc.png')
      .mockResolvedValueOnce('organizations/x/brand/analysis-staging/def.png')
    const logoFetcher = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    await new BrandWebsiteAnalysisExecutor(config, repo, withLogos, generator, logoFetcher).execute(
      payload,
    )
    expect(repo.uploadStagedLogo).toHaveBeenCalledTimes(2)
    expect(repo.markSucceeded).toHaveBeenCalledWith(
      payload.entityId,
      1,
      expect.objectContaining({
        logoCandidates: [
          { objectPath: 'organizations/x/brand/analysis-staging/abc.png', mimeType: 'image/png' },
          { objectPath: 'organizations/x/brand/analysis-staging/def.png', mimeType: 'image/png' },
        ],
      }),
    )
  })

  it('drops a repeated candidate whose downloaded bytes are identical to one already collected', async () => {
    const repo = repository()
    const withLogos = renderer({
      ...renderResult,
      logoCandidates: [
        { url: 'https://verein.example.org/logo.png', score: 5 },
        { url: 'https://verein.example.org/logo-again.png', score: 3 },
      ],
    })
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    const pngBytes = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 22, g: 58, b: 44, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const logoFetcher = vi.fn().mockResolvedValue(pngBytes)
    await new BrandWebsiteAnalysisExecutor(config, repo, withLogos, generator, logoFetcher).execute(
      payload,
    )
    expect(logoFetcher).toHaveBeenCalledTimes(2)
    expect(repo.uploadStagedLogo).toHaveBeenCalledTimes(1)
  })

  it('sanitizes and stores an inline SVG without downloading its pseudo URL', async () => {
    const repo = repository()
    const withInlineSvg = renderer({
      ...renderResult,
      logoCandidates: [
        {
          url: 'https://verein.example.org/#inline-svg-0',
          score: 4,
          inlineSvg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h40v40H0z"/></svg>',
        },
      ],
    })
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    const logoFetcher = vi.fn()
    await new BrandWebsiteAnalysisExecutor(
      config,
      repo,
      withInlineSvg,
      generator,
      logoFetcher,
    ).execute(payload)
    expect(logoFetcher).not.toHaveBeenCalled()
    expect(repo.uploadStagedLogo).toHaveBeenCalledWith(
      payload.entityId,
      payload.organizationId,
      payload.correlationId,
      expect.objectContaining({ contentType: 'image/svg+xml' }),
    )
  })

  it('keeps only the first eight distinct logo candidates after processing the bounded download pool', async () => {
    const repo = repository()
    const candidates: LogoCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      url: `https://verein.example.org/logo-${i}.png`,
      score: 10 - i,
    }))
    const withLogos = renderer({ ...renderResult, logoCandidates: candidates })
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    const logoFetcher = vi.fn().mockImplementation(async (url: string) => {
      const index = Number(/logo-(\d+)\.png$/.exec(url)![1])
      return sharp({
        create: {
          width: 40,
          height: 40,
          channels: 4,
          background: { r: index * 20, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer()
    })
    await new BrandWebsiteAnalysisExecutor(config, repo, withLogos, generator, logoFetcher).execute(
      payload,
    )
    expect(logoFetcher).toHaveBeenCalledTimes(10)
    expect(repo.uploadStagedLogo).toHaveBeenCalledTimes(8)
  })

  it('downloads at most four candidates concurrently while keeping the score order in the result', async () => {
    const candidates: LogoCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      url: `https://verein.example.org/logo-${i}.png`,
      score: 5 - i,
    }))
    const pngs = await Promise.all(
      candidates.map((_, i) =>
        sharp({
          create: {
            width: 40,
            height: 40,
            channels: 4,
            background: { r: i * 30, g: 0, b: 0, alpha: 1 },
          },
        })
          .png()
          .toBuffer(),
      ),
    )
    let inFlight = 0
    let maximumInFlight = 0
    const logoFetcher = vi.fn(async (url: string) => {
      inFlight += 1
      maximumInFlight = Math.max(maximumInFlight, inFlight)
      const index = Number(/logo-(\d+)\.png$/.exec(url)![1])
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 20 : 5))
      inFlight -= 1
      return pngs[index]!
    })
    const repo = repository()
    repo.uploadStagedLogo = vi
      .fn()
      .mockImplementation(
        async (_jobId, _organizationId, _correlationId, logo) =>
          `organizations/x/brand/analysis-staging/${logo.width}.png`,
      )
    await new BrandWebsiteAnalysisExecutor(
      config,
      repo,
      renderer({ ...renderResult, logoCandidates: candidates }),
      { analyzeBrand: vi.fn().mockResolvedValue(analysis) },
      logoFetcher,
    ).execute(payload)
    expect(maximumInFlight).toBe(4)
    expect(
      vi.mocked(repo.uploadStagedLogo).mock.calls.map((call) => hashLogoBuffer(call[3].buffer)),
    ).toEqual(pngs.map(hashLogoBuffer))
  })

  it('passes each candidate url to the download unchanged', async () => {
    const repo = repository()
    const withLogo = renderer({
      ...renderResult,
      logoCandidates: [{ url: 'https://verein.example.org/logo.png', score: 5 }],
    })
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    const logoFetcher = vi.fn().mockResolvedValue(Buffer.from('not an image'))
    await new BrandWebsiteAnalysisExecutor(config, repo, withLogo, generator, logoFetcher).execute(
      payload,
    )
    expect(logoFetcher).toHaveBeenCalledWith('https://verein.example.org/logo.png')
  })

  it('moves on to the next candidate instead of giving up on the first unusable one', async () => {
    const repo = repository()
    const withLogos = renderer({
      ...renderResult,
      logoCandidates: [
        { url: 'https://verein.example.org/broken.svg', score: 5 },
        { url: 'https://verein.example.org/logo.png', score: 3 },
      ],
    })
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    const pngBytes = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 22, g: 58, b: 44, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const logoFetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(pngBytes)
    await new BrandWebsiteAnalysisExecutor(config, repo, withLogos, generator, logoFetcher).execute(
      payload,
    )
    expect(logoFetcher).toHaveBeenCalledTimes(2)
    expect(repo.markSucceeded).toHaveBeenCalledWith(
      payload.entityId,
      1,
      expect.objectContaining({
        logoCandidates: [
          { objectPath: 'organizations/x/brand/analysis-staging/abc.png', mimeType: 'image/png' },
        ],
      }),
    )
  })

  it('does not fail the whole analysis when the only logo candidate cannot be downloaded', async () => {
    const repo = repository()
    const withLogo = renderer({
      ...renderResult,
      logoCandidates: [{ url: 'https://verein.example.org/missing-logo.png', score: 5 }],
    })
    const generator = { analyzeBrand: vi.fn().mockResolvedValue(analysis) }
    const logoFetcher = vi
      .fn()
      .mockRejectedValue(new OutboundFetchError('request_failed', 'unexpected status 404'))
    await new BrandWebsiteAnalysisExecutor(config, repo, withLogo, generator, logoFetcher).execute(
      payload,
    )
    expect(repo.uploadStagedLogo).not.toHaveBeenCalled()
    expect(repo.markSucceeded).toHaveBeenCalledWith(
      payload.entityId,
      1,
      expect.objectContaining({ logoCandidates: [] }),
    )
  })
})
