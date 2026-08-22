import { OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import { chromium } from 'playwright'
import { z } from 'zod'
import { assertNavigableUrl, guardOutboundRequests } from './browserGuard.js'
import { WorkflowExecutionError } from './workflows.js'

export interface LogoCandidate {
  url: string
  score: number
}

// Validiert das Ergebnis von page.evaluate(scoreLogoCandidates), bevor der Worker es anfasst --
// siehe die Verteidigung-in-der-Tiefe-Anmerkung an scoreLogoCandidates: eine fremde Seite kann
// globale Built-ins ueberschreiben, wodurch das serialisierte Ergebnis auch strukturell von
// LogoCandidate[] abweichen kann, nicht nur einzelne url-Werte betreffen.
const LogoCandidateSchema: z.ZodType<LogoCandidate> = z.object({ url: z.string().min(1), score: z.number().finite() })
const LogoCandidatesSchema = z.array(LogoCandidateSchema)

export interface WebsiteRenderResult {
  screenshotBase64: string
  screenshotMediaType: 'image/png'
  /** Nach Score absteigend sortiert (siehe scoreLogoCandidates). og:image/Favicon sind reine
   *  Fallback-Kandidaten mit einem fixen, niedrigen Score und stehen immer am Ende, unabhaengig
   *  vom Score echter DOM-Treffer. Der Aufrufer versucht der Reihe nach, bis eine Datei
   *  tatsaechlich als Logo taugt (siehe brandWebsiteAnalysis.ts). */
  logoCandidates: readonly LogoCandidate[]
  /** Aus getComputedStyle gelesen, nie geraten. null, wenn keine Ueberschrift/kein body existiert. */
  detectedFontFamily: string | null
}

export interface WebsiteRenderer {
  render(url: string): Promise<WebsiteRenderResult>
}

const NAVIGATION_TIMEOUT_MS = 15_000
const VIEWPORT = { width: 1280, height: 900 }
// Eine Obergrenze fuer die Kandidatenliste: der Aufrufer laedt jeden Eintrag der Reihe nach
// herunter und dekodiert ihn. Dank Scoring (statt reiner Selektor-Reihenfolge) darf die Grenze
// grosszuegiger sein, ohne dass eine Sponsorenleiste im Header die guten Kandidaten verdraengt.
const MAX_LOGO_CANDIDATES_TO_ATTEMPT = 10

/**
 * Bewertet jedes moegliche Logo-Bild rein anhand des DOM (keine Vision-/Farb-Analyse). Laeuft im
 * Seitenkontext ueber page.evaluate(scoreLogoCandidates) -- Playwright serialisiert die Funktion
 * per toString() und fuehrt sie im Browser aus, deshalb darf sie ausschliesslich auf Werte
 * zugreifen, die sie selbst im Funktionskoerper deklariert (keine Modul-Konstanten/Imports).
 * Exportiert, damit Regressionstests sie isoliert per page.setContent()+page.evaluate() gegen
 * Fixture-HTML pruefen koennen, ohne echte Websites zu laden.
 */
export function scoreLogoCandidates(): LogoCandidate[] {
  const LOGO_PATTERN = /logo/i
  // \b vor "ad-": ohne Wortgrenze matcht die Substring-Regex sonst zufaellig in Vereinsnamen wie
  // "Radsportverein" (rad-...) oder "Pfadfinder" (pfad-...) -- haeufig bei einem Dateinamen wie
  // "pfad-logo.png" ohne dass irgendein Sponsor-/Social-Bezug besteht.
  const SPONSOR_PATTERN = /sponsor|partner|werbung|anzeige|\bad-|banner|facebook|instagram|whatsapp|twitter|linkedin|youtube|tiktok|social/i

  const normalize = (raw: string): string | null => {
    try {
      return new URL(raw, location.href).href
    } catch {
      return null
    }
  }

  const scores = new Map<string, number>()
  const record = (url: string, score: number) => {
    const existing = scores.get(url)
    if (existing === undefined || score > existing) scores.set(url, score)
  }

  const selector = 'header img, nav img, [class*="logo" i] img, img[alt*="logo" i], img[class*="logo" i], img[id*="logo" i]'
  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>(selector))) {
    if (!img.src) continue
    const url = normalize(img.src)
    if (!url) continue

    const ownText = `${img.className} ${img.id} ${img.alt}`
    const hrefRaw = img.closest('a')?.getAttribute('href')
    // hrefRaw fliesst mit ein, weil ein generisch benanntes Icon (kein "sponsor"/"social" in
    // class/id/alt/src) oft erst am Linkziel als Social-Icon erkennbar ist, z.B. ein <img
    // class="icon"> innerhalb eines <a href="https://instagram.com/verein">.
    const combinedText = `${ownText} ${img.src} ${hrefRaw ?? ''}`

    // Ein Logo-Signal aus den eigenen Attributen (class/id/alt) sticht einen Sponsor-/Social-Treffer
    // in Dateiname oder Linkziel aus -- SPONSOR_PATTERN ist eine Substring-Regex und matcht sonst
    // auch auf einem echten Logo mit zufaelligem Treffer (z.B. "/partner-verein-logo.png") oder
    // einem Logo, das auf die eigene Facebook-Seite statt die Startseite verlinkt.
    const ownSignalsLogo = LOGO_PATTERN.test(ownText)
    // Nur ein eindeutiges Sponsor-/Social-Signal OHNE eigenes Logo-Signal schliesst den Kandidaten
    // komplett aus statt ihn nur abzuwerten -- ein solches Bild als Vereinslogo herunterzuladen
    // waere schlechter als gar keins, und eine reine Abwertung verhindert das nicht, wenn alle
    // anderen Kandidaten am Download scheitern.
    if (!ownSignalsLogo && SPONSOR_PATTERN.test(combinedText)) continue

    let score = 0
    if (ownSignalsLogo) score += 3
    if (img.parentElement?.closest('[class*="logo" i], [id*="logo" i]')) score += 2
    if (img.closest('header, nav')) score += 2
    const hrefUrl = hrefRaw ? normalize(hrefRaw) : null
    if (hrefUrl) {
      const parsed = new URL(hrefUrl)
      if (parsed.origin === location.origin && (parsed.pathname === '/' || parsed.pathname === '')) score += 2
    }
    // Mehrere Geschwister-Bilder sind ein rein strukturelles, schwaches Signal (Sponsorenzeile,
    // aber auch z.B. ein Sprachumschalter mit Flaggen-Icons) -- nur eine Abwertung, kein
    // Ausschluss, damit ein echtes Logo mit starken eigenen Signalen trotzdem gewinnt.
    if (img.parentElement && img.parentElement.querySelectorAll(':scope > img').length >= 3) score -= 3

    record(url, score)
  }

  const ranked = Array.from(scores.entries())
    .map(([url, score]) => ({ url, score }))
    .sort((a, b) => b.score - a.score)

  // Fallbacks werden absichtlich NICHT in die Sortierung einbezogen, sondern immer ans Ende
  // angehaengt: selbst ein stark abgewerteter DOM-Kandidat (Sponsorenbild) ist ein besserer
  // Download-Versuch als og:image/Favicon. Der Score dient hier nur der Beobachtbarkeit.
  const seen = new Set(ranked.map((candidate) => candidate.url))
  const ogImageRaw = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.getAttribute('content') ?? null
  const ogImage = ogImageRaw ? normalize(ogImageRaw) : null
  if (ogImage && !seen.has(ogImage)) {
    ranked.push({ url: ogImage, score: -100 })
    seen.add(ogImage)
  }
  const iconRaw = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute('href') ?? null
  const icon = iconRaw ? normalize(iconRaw) : null
  if (icon && !seen.has(icon)) ranked.push({ url: icon, score: -101 })

  // Verteidigung in der Tiefe: page.evaluate() laeuft in der Haupt-Welt der fremden Seite, nicht
  // isoliert -- ein Skript dieser Seite kann globale Built-ins wie Map/Array.from ueberschreiben
  // (beobachtet auf einer echten Vereinsseite mit veralteten Polyfills) und dadurch einen
  // kaputten Eintrag erzeugen. Der Aufrufer bricht daran zwar nicht (jeder Download-Versuch ist
  // ohnehin einzeln abgesichert), aber ein Kandidat ohne echte URL ist niemals brauchbar.
  return ranked.filter((candidate) => typeof candidate.url === 'string' && candidate.url.length > 0)
}

/**
 * Rendert die Startseite eines Vereins per echtem, headless Chromium (Paket 048). Die
 * SSRF-Pruefung laeuft zweifach: einmal vor der Navigation (assertNavigableUrl) und einmal je
 * Sub-Request der Seite selbst (guardOutboundRequests) -- Playwrights eigenes Networking laeuft
 * nicht durch fetch()/fetchPublicUrl(). Schrift- und Logo-Kandidaten werden deterministisch aus
 * dem DOM gelesen, nie von der Vision-KI geraten (siehe packages/content-engine/visionAnalysis.ts).
 */
export class PlaywrightWebsiteRenderer implements WebsiteRenderer {
  async render(url: string): Promise<WebsiteRenderResult> {
    try {
      await assertNavigableUrl(url)
    } catch (error) {
      if (error instanceof OutboundFetchError) throw new WorkflowExecutionError('blocked_url', false)
      throw error
    }

    const browser = await chromium.launch({ headless: true })
    try {
      // Eigener Context statt browser.newPage(), damit der Guard fuer jede Seite darin gilt --
      // auch fuer ein per window.open() geoeffnetes Fenster (siehe guardOutboundRequests).
      const context = await browser.newContext({ viewport: VIEWPORT })
      await guardOutboundRequests(context)
      const page = await context.newPage()
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
      } catch {
        throw new WorkflowExecutionError('website_unreachable', true)
      }
      // Above-the-fold layout/Web-Fonts brauchen nach domcontentloaded noch einen Moment.
      await page.waitForTimeout(500)

      const screenshotBuffer = await page.screenshot({ type: 'png' })
      const rawLogoCandidates = await page.evaluate(scoreLogoCandidates)
      const parsedLogoCandidates = LogoCandidatesSchema.safeParse(rawLogoCandidates)
      const logoCandidates = parsedLogoCandidates.success ? parsedLogoCandidates.data : []
      const detectedFontFamily = await page.evaluate(() => {
        const heading = document.querySelector<HTMLElement>('h1, h2') ?? document.body
        return heading ? getComputedStyle(heading).fontFamily || null : null
      })

      return {
        screenshotBase64: screenshotBuffer.toString('base64'), screenshotMediaType: 'image/png',
        logoCandidates: logoCandidates.slice(0, MAX_LOGO_CANDIDATES_TO_ATTEMPT), detectedFontFamily,
      }
    } finally {
      await browser.close()
    }
  }
}
