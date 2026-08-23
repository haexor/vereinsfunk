import type { ProcessedLogo } from '@vereinsfunk/brand-assets'
import { VisionAnalysisError } from '@vereinsfunk/content-engine'
import { fetchPublicBinary, OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { downloadValidLogos, FONT_PAIRING_OPTIONS, VISION_GENERATORS, type LogoFetcher } from './brandWebsiteAnalysis.js'
import { openProviderSecret } from './providerSecrets.js'
import type { WebsiteRenderer } from './websiteRenderer.js'
import { WorkflowExecutionError } from './workflows.js'

export type PendingVisionProviderComparisonRun = { id: string; websiteUrl: string }
export type VisionComparisonProviderRow = { id: string; label: string; protocol: string; base_url: string; model: string; api_key_ciphertext: string; key_version: string }
export type VisionComparisonResultEntry = {
  providerConfigurationId: string
  providerLabel: string
  status: 'succeeded' | 'failed'
  primaryColor?: string
  accentColor?: string
  backgroundColor?: string
  textColor?: string
  onPrimaryColor?: string
  suggestedFontPairingKey?: string | null
  errorReason?: string
}

/** Worker-only data access for the platform-admin vision-provider comparison tool (Paket 050). */
export interface VisionProviderComparisonRepository {
  claimPendingRun(): Promise<PendingVisionProviderComparisonRun | null>
  listActiveVisionProviders(): Promise<VisionComparisonProviderRow[]>
  uploadStagedLogo(runId: string, logo: ProcessedLogo): Promise<string>
  markSucceeded(runId: string, details: { detectedFontFamily: string | null; logoObjectPath: string | null; logoMimeType: string | null; results: VisionComparisonResultEntry[] }): Promise<void>
  markFailed(runId: string, errorReason: string): Promise<void>
}

/**
 * Rendert eine Test-URL genau einmal und fragt danach ALLE aktiven vision_analysis-Provider
 * parallel mit demselben Screenshot an -- anders als BrandWebsiteAnalysisExecutor (echter
 * Vereins-Marken-Crawl, immer genau ein Provider). Ein einzelner scheiternder Provider bekommt nur
 * seinen eigenen Ergebniseintrag auf 'failed' gesetzt, statt den ganzen Lauf abzubrechen -- genau
 * das ist der Zweck des Werkzeugs: sehen, welche Modelle ueberhaupt brauchbare Ergebnisse liefern.
 */
export class VisionProviderComparisonExecutor {
  constructor(
    private readonly config: WorkerEnvironment,
    private readonly repository: VisionProviderComparisonRepository,
    private readonly renderer: WebsiteRenderer,
    private readonly logoFetcher: LogoFetcher = fetchPublicBinary,
  ) {}

  /** Claims and runs at most one pending comparison. Returns false when the queue was empty. */
  async runOnce(): Promise<boolean> {
    const claimed = await this.repository.claimPendingRun()
    if (!claimed) return false
    try {
      const providers = await this.repository.listActiveVisionProviders()
      if (providers.length === 0) {
        await this.repository.markFailed(claimed.id, 'no_vision_provider_configured')
        return true
      }

      const render = await this.renderer.render(claimed.websiteUrl)
      // Nur der bestbewertete Kandidat: dieses Werkzeug vergleicht Vision-Provider anhand
      // desselben einzelnen Logos, kein Mehrfachvorschlag noetig (siehe VisionComparisonResultEntry).
      const [logo] = await downloadValidLogos(render.logoCandidates, this.logoFetcher, 1)
      const logoObjectPath = logo ? await this.repository.uploadStagedLogo(claimed.id, logo) : null

      const results = await Promise.all(providers.map((provider): Promise<VisionComparisonResultEntry> => this.analyzeWithProvider(provider, render)))

      await this.repository.markSucceeded(claimed.id, {
        detectedFontFamily: render.detectedFontFamily, logoObjectPath, logoMimeType: logo?.contentType ?? null, results,
      })
    } catch (error) {
      // Dieselbe Klassifizierung wie BrandWebsiteAnalysisExecutor fuer denselben Renderer: ein
      // OutboundFetchError kann aus einem Sub-Request der gerenderten Seite stammen, den
      // PlaywrightWebsiteRenderer nicht selbst abfaengt (nur die initiale Navigation tut das).
      const errorReason = error instanceof WorkflowExecutionError ? error.errorClass
        : error instanceof OutboundFetchError ? 'blocked_url'
          : 'website_analysis_failed'
      await this.repository.markFailed(claimed.id, errorReason)
    }
    return true
  }

  private async analyzeWithProvider(
    provider: VisionComparisonProviderRow,
    render: { screenshotBase64: string; screenshotMediaType: 'image/png'; detectedFontFamily: string | null },
  ): Promise<VisionComparisonResultEntry> {
    const generator = VISION_GENERATORS[provider.protocol]
    if (!generator) return { providerConfigurationId: provider.id, providerLabel: provider.label, status: 'failed', errorReason: 'unsupported_provider_configuration' }
    try {
      const apiKey = openProviderSecret(this.config, provider.api_key_ciphertext, provider.key_version, provider.id)
      const analysis = await generator.analyzeBrand({
        imageBase64: render.screenshotBase64, imageMediaType: render.screenshotMediaType,
        detectedFontFamily: render.detectedFontFamily, fontPairingOptions: FONT_PAIRING_OPTIONS,
        model: provider.model, baseUrl: provider.base_url, apiKey,
      })
      return { providerConfigurationId: provider.id, providerLabel: provider.label, status: 'succeeded', ...analysis }
    } catch (error) {
      const errorReason = error instanceof VisionAnalysisError ? error.errorClass
        : error instanceof WorkflowExecutionError ? error.errorClass
          : 'website_analysis_failed'
      return { providerConfigurationId: provider.id, providerLabel: provider.label, status: 'failed', errorReason }
    }
  }
}

// Bounded so a burst of submitted test URLs cannot monopolize the worker's single browser slot for
// this feature (see concurrency.browser in workflows.ts) -- the next cron tick drains the rest.
const MAX_RUNS_PER_TICK = 5

/** Drains up to MAX_RUNS_PER_TICK pending comparisons; called from the cron task in workflows.ts. */
export async function drainPendingVisionProviderComparisons(executor: VisionProviderComparisonExecutor): Promise<void> {
  for (let i = 0; i < MAX_RUNS_PER_TICK; i++) {
    const processed = await executor.runOnce()
    if (!processed) return
  }
}
