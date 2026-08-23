import { curatedFontPairings } from '@vereinsfunk/domain'
import {
  hashLogoBuffer,
  processBrandLogoUpload,
  type ProcessedLogo,
} from '@vereinsfunk/brand-assets'
import {
  AnthropicVisionAnalysisGenerator,
  OpenAiCompatibleVisionAnalysisGenerator,
  VisionAnalysisError,
  type VisionAnalysisGenerator,
} from '@vereinsfunk/content-engine'
import { fetchPublicBinary, OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import type { WorkflowPayload } from '@vereinsfunk/contracts'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { openProviderSecret } from './providerSecrets.js'
import type { LogoCandidate, WebsiteRenderer } from './websiteRenderer.js'
import { WorkflowExecutionError } from './workflows.js'

export type BrandAnalysisJobRow = {
  id: string
  organization_id: string
  website_url: string
  revision: number
}
export type VisionProviderRow = {
  id: string
  protocol: string
  base_url: string
  model: string
  api_key_ciphertext: string
  key_version: string
}
export interface BrandAnalysisResult {
  primaryColor: string
  accentColor: string
  backgroundColor: string
  textColor: string
  onPrimaryColor: string
  suggestedFontPairingKey: string | null
  detectedFontFamily: string | null
  logoCandidates: { objectPath: string; mimeType: string }[]
}

// Ein Verein kann mehrere echte Logos/Wortmarken fuehren -- die Vision-Analyse liefert deshalb bis
// zu MAX_LOGO_SUGGESTIONS Vorschlaege statt nur des bestbewerteten Kandidaten. Die eigentliche
// Uebernahme (welcher Vorschlag welche Asset-Art wird und ob er das aktive Logo ist) bleibt eine
// manuelle Entscheidung in marke.vue.
const MAX_LOGO_SUGGESTIONS = 8
const MAX_LOGO_DOWNLOAD_CONCURRENCY = 4

export interface BrandWebsiteAnalysisRepository {
  loadJob(id: string, organizationId: string): Promise<BrandAnalysisJobRow | null>
  markRunning(jobId: string, expectedRevision: number): Promise<void>
  markSucceeded(jobId: string, expectedRevision: number, result: BrandAnalysisResult): Promise<void>
  markFailed(jobId: string, expectedRevision: number, errorReason: string): Promise<void>
  resolveVisionProvider(): Promise<VisionProviderRow | null>
  uploadStagedLogo(
    jobId: string,
    organizationId: string,
    correlationId: string,
    logo: ProcessedLogo,
  ): Promise<string>
}

// Ein Adapter je Protokoll, analog zu textGeneration.ts's GENERATORS -- ein Protokoll ohne Eintrag
// gilt als nicht implementiert. Exportiert, weil visionProviderComparison.ts (Paket 050) denselben
// Adapter-Satz braucht, um mehrere aktive Vision-Provider parallel anzufragen.
export const VISION_GENERATORS: Record<string, VisionAnalysisGenerator | undefined> = {
  openai: new OpenAiCompatibleVisionAnalysisGenerator(),
  anthropic: new AnthropicVisionAnalysisGenerator(),
}

export const FONT_PAIRING_OPTIONS = curatedFontPairings.map((pairing) => ({
  key: pairing.key,
  label: pairing.label,
  styleDescription: pairing.styleDescription,
}))

// Exportiert aus demselben Grund wie VISION_GENERATORS. Die Zeit- und Groessengrenze steckt nicht
// mehr hier, sondern in fetchPublicBinary -- die Adresse stammt aus dem HTML einer fremden Seite
// und ist nichts, worauf man sich verlassen kann.
export type LogoFetcher = (url: string) => Promise<Buffer>

/** Maps independent candidates with a fixed worker pool while retaining input order in its result. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await mapper(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

/**
 * Laedt die bereits nach Score sortierten Kandidaten mit begrenzter Parallelitaet und sammelt die
 * ersten maxLogos unterschiedlichen Ergebnisse in dieser Reihenfolge. Fehlerhafte Downloads
 * werden einzeln uebersprungen; die Reihenfolge fuer Deduplizierung und Limitierung bleibt trotz
 * unterschiedlich schneller Antworten stabil. Exportiert aus demselben Grund wie
 * VISION_GENERATORS.
 */
export async function downloadValidLogos(
  candidates: readonly LogoCandidate[],
  fetcher: LogoFetcher,
  maxLogos: number = MAX_LOGO_SUGGESTIONS,
): Promise<ProcessedLogo[]> {
  const logos: ProcessedLogo[] = []
  const seenHashes = new Set<string>()
  const processedCandidates = await mapWithConcurrency(
    candidates,
    MAX_LOGO_DOWNLOAD_CONCURRENCY,
    async (candidate) => {
      try {
        // Ein Inline-SVG hat keine abrufbare Asset-URL. Es stammt dennoch aus einer fremden
        // Website und durchlaeuft deshalb exakt dieselbe zentrale SVG-Sanitisierung wie ein
        // heruntergeladenes Logo, bevor es in den privaten Storage gelangt.
        const bytes =
          candidate.inlineSvg === undefined
            ? await fetcher(candidate.url)
            : Buffer.from(candidate.inlineSvg, 'utf8')
        return await processBrandLogoUpload(bytes)
      } catch {
        return null // blockierte/zu grosse/abgelaufene Antwort, kein Bildformat, zu kleines Bild, ...
      }
    },
  )
  for (const processed of processedCandidates) {
    if (logos.length >= maxLogos) break
    if (!processed) continue
    const hash = hashLogoBuffer(processed.buffer)
    if (seenHashes.has(hash)) continue
    seenHashes.add(hash)
    logos.push(processed)
  }
  return logos
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
      const apiKey = openProviderSecret(
        this.config,
        provider.api_key_ciphertext,
        provider.key_version,
        provider.id,
      )

      const render = await this.renderer.render(job.website_url)
      const logos = await downloadValidLogos(render.logoCandidates, this.logoFetcher)
      const logoCandidates = await Promise.all(
        logos.map(async (logo) => ({
          objectPath: await this.repository.uploadStagedLogo(
            job.id,
            job.organization_id,
            payload.correlationId,
            logo,
          ),
          mimeType: logo.contentType,
        })),
      )

      const analysis = await generator.analyzeBrand({
        imageBase64: render.screenshotBase64,
        imageMediaType: render.screenshotMediaType,
        detectedFontFamily: render.detectedFontFamily,
        fontPairingOptions: FONT_PAIRING_OPTIONS,
        model: provider.model,
        baseUrl: provider.base_url,
        apiKey,
      })

      await this.repository.markSucceeded(job.id, job.revision, {
        ...analysis,
        detectedFontFamily: render.detectedFontFamily,
        logoCandidates,
      })
    } catch (error) {
      const classified =
        error instanceof WorkflowExecutionError
          ? error
          : error instanceof VisionAnalysisError
            ? new WorkflowExecutionError(error.errorClass, error.retryable)
            : error instanceof OutboundFetchError
              ? new WorkflowExecutionError('blocked_url', false)
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
