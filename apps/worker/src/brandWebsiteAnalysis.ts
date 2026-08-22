import { curatedFontPairings } from '@vereinsfunk/domain'
import { processBrandLogoUpload, type ProcessedLogo } from '@vereinsfunk/brand-assets'
import { AnthropicVisionAnalysisGenerator, OpenAiCompatibleVisionAnalysisGenerator, VisionAnalysisError, type VisionAnalysisGenerator } from '@vereinsfunk/content-engine'
import { fetchPublicBinary, OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import type { WorkflowPayload } from '@vereinsfunk/contracts'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { openProviderSecret } from './providerSecrets.js'
import type { WebsiteRenderer } from './websiteRenderer.js'
import { WorkflowExecutionError } from './workflows.js'

export type BrandAnalysisJobRow = { id: string; organization_id: string; website_url: string; revision: number }
export type VisionProviderRow = { id: string; protocol: string; base_url: string; model: string; api_key_ciphertext: string; key_version: string }
export interface BrandAnalysisResult {
  primaryColor: string
  accentColor: string
  backgroundColor: string
  textColor: string
  onPrimaryColor: string
  suggestedFontPairingKey: string | null
  detectedFontFamily: string | null
  logoObjectPath: string | null
  logoMimeType: string | null
}

export interface BrandWebsiteAnalysisRepository {
  loadJob(id: string, organizationId: string): Promise<BrandAnalysisJobRow | null>
  markRunning(jobId: string, expectedRevision: number): Promise<void>
  markSucceeded(jobId: string, expectedRevision: number, result: BrandAnalysisResult): Promise<void>
  markFailed(jobId: string, expectedRevision: number, errorReason: string): Promise<void>
  resolveVisionProvider(): Promise<VisionProviderRow | null>
  uploadStagedLogo(organizationId: string, logo: ProcessedLogo): Promise<string>
}

// Ein Adapter je Protokoll, analog zu textGeneration.ts's GENERATORS -- ein Protokoll ohne Eintrag
// gilt als nicht implementiert.
const VISION_GENERATORS: Record<string, VisionAnalysisGenerator | undefined> = {
  openai: new OpenAiCompatibleVisionAnalysisGenerator(),
  anthropic: new AnthropicVisionAnalysisGenerator(),
}

const FONT_PAIRING_OPTIONS = curatedFontPairings.map((pairing) => ({ key: pairing.key, label: pairing.label, styleDescription: pairing.styleDescription }))

type LogoFetcher = (url: string) => Promise<Buffer>

/**
 * Versucht der Reihe nach jeden Kandidaten und nimmt den ersten, der sich als Logo verarbeiten
 * laesst. Wirft nie: ein Kandidat, der nicht laedt oder kein brauchbares Bild ist, darf weder die
 * uebrigen Kandidaten noch die Farb-/Font-Analyse verhindern -- ohne Logo-Vorschlag ist das
 * Ergebnis unvollstaendig, aber nicht falsch.
 */
async function downloadFirstValidLogo(candidateUrls: readonly string[], fetcher: LogoFetcher): Promise<ProcessedLogo | null> {
  for (const url of candidateUrls) {
    try {
      return await processBrandLogoUpload(await fetcher(url))
    } catch {
      continue // blockierte/zu grosse/abgelaufene Antwort, kein Bildformat, zu kleines Bild, ...
    }
  }
  return null
}

/** Executes one ID-only analyze-website-branding delivery. No content crosses the Hatchet envelope. */
export class BrandWebsiteAnalysisExecutor {
  constructor(
    private readonly config: WorkerEnvironment,
    private readonly repository: BrandWebsiteAnalysisRepository,
    private readonly renderer: WebsiteRenderer,
    private readonly visionGenerator?: VisionAnalysisGenerator,
    /**
     * Testklammer fuer den Logo-Download; sonst fetchPublicBinary -- SSRF-geprueft je Hop, mit
     * Zeit- und Groessengrenze, und Weiterleitungen folgend. Letzteres ist hier keine Bequemlichkeit:
     * die Bild-Adressen stammen aus dem HTML einer fremden Seite, und Vereinsseiten liefern sie
     * regelmaessig ohne `www` aus, obwohl der Server von dort dauerhaft auf `www` weiterleitet.
     */
    private readonly logoFetcher: LogoFetcher = fetchPublicBinary,
  ) {}

  async execute(payload: WorkflowPayload): Promise<void> {
    const job = await this.repository.loadJob(payload.entityId, payload.organizationId)
    if (!job || job.revision !== payload.sourceRevision) return // duplicate delivery or a superseded job
    await this.repository.markRunning(job.id, job.revision)
    try {
      // Provider und Schluessel zuerst, vor dem Browserstart: ohne konfigurierten
      // vision_analysis-Provider (der Ausgangszustand jeder Installation) scheitert der Job
      // ohnehin -- dann sind ein Chromium-Start, ein fremder Seitenabruf und ein hochgeladener
      // Logo-Kandidat, den danach nichts mehr referenziert, reine Verschwendung.
      const provider = await this.repository.resolveVisionProvider()
      if (!provider) throw new WorkflowExecutionError('no_vision_provider_configured', false)
      const generator = this.visionGenerator ?? VISION_GENERATORS[provider.protocol]
      if (!generator) throw new WorkflowExecutionError('unsupported_provider_configuration', false)
      const apiKey = openProviderSecret(this.config, provider.api_key_ciphertext, provider.key_version, provider.id)

      const render = await this.renderer.render(job.website_url)
      const logo = await downloadFirstValidLogo(render.logoCandidateUrls, this.logoFetcher)
      const logoObjectPath = logo ? await this.repository.uploadStagedLogo(job.organization_id, logo) : null

      const analysis = await generator.analyzeBrand({
        imageBase64: render.screenshotBase64, imageMediaType: render.screenshotMediaType,
        detectedFontFamily: render.detectedFontFamily, fontPairingOptions: FONT_PAIRING_OPTIONS,
        model: provider.model, baseUrl: provider.base_url, apiKey,
      })

      await this.repository.markSucceeded(job.id, job.revision, {
        ...analysis, detectedFontFamily: render.detectedFontFamily,
        logoObjectPath, logoMimeType: logo?.contentType ?? null,
      })
    } catch (error) {
      const classified = error instanceof WorkflowExecutionError ? error
        : error instanceof VisionAnalysisError ? new WorkflowExecutionError(error.errorClass, error.retryable)
        : error instanceof OutboundFetchError ? new WorkflowExecutionError('blocked_url', false)
        : new WorkflowExecutionError('website_analysis_failed', true)
      // Anders als bei der Textwerkstatt-Ensemble-Kandidatenzeile (releaseCandidate faellt auf
      // 'pending' zurueck, eine eigene Recovery-Scan-Cron greift bei Erschoepfung) gibt es hier
      // genau eine Job-Zeile pro Verein ohne Fan-out: jeder Fehler -- auch ein retryable-Fehler --
      // setzt sie auf 'failed'. Greift Hatchets eigener automatischer Retry danach doch noch
      // erfolgreich, ueberschreibt markSucceeded diesen Zwischenstand einfach wieder; erschoepfen
      // sich die Versuche, bleibt der Job in einem klaren Endzustand, den der Verein selbst per
      // erneutem Klick neu ausloesen kann (start_brand_website_analysis blockiert nur
      // 'pending'/'running', nicht 'failed').
      await this.repository.markFailed(job.id, job.revision, classified.errorClass)
      throw classified
    }
  }
}
