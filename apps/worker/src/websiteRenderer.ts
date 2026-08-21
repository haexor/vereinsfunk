import { OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import { chromium } from 'playwright'
import { assertNavigableUrl, guardOutboundRequests } from './browserGuard.js'
import { WorkflowExecutionError } from './workflows.js'

export interface WebsiteRenderResult {
  screenshotBase64: string
  screenshotMediaType: 'image/png'
  /** In der Reihenfolge, in der ein Logo am wahrscheinlichsten gefunden wird -- Header/Nav-Bild
   *  zuerst, dann og:image, dann das Favicon. Der Aufrufer versucht der Reihe nach, bis eine
   *  Datei tatsaechlich als Logo taugt (siehe brandWebsiteAnalysis.ts). */
  logoCandidateUrls: readonly string[]
  /** Aus getComputedStyle gelesen, nie geraten. null, wenn keine Ueberschrift/kein body existiert. */
  detectedFontFamily: string | null
}

export interface WebsiteRenderer {
  render(url: string): Promise<WebsiteRenderResult>
}

const NAVIGATION_TIMEOUT_MS = 15_000
const VIEWPORT = { width: 1280, height: 900 }
// Eine Obergrenze fuer die Kandidatenliste: der Aufrufer laedt jeden Eintrag der Reihe nach
// herunter und dekodiert ihn, und eine Seite mit einer Sponsorenleiste im Header liefert sonst
// dutzende Treffer -- Arbeit, die nach den ersten Kandidaten nichts mehr beitraegt.
const MAX_LOGO_CANDIDATES = 5

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
      const hints = await page.evaluate(() => {
        const pickLogo = () => {
          const selectors = ['header img', 'nav img', '[class*="logo" i] img', 'img[alt*="logo" i]']
          const urls: string[] = []
          for (const selector of selectors) {
            for (const img of Array.from(document.querySelectorAll<HTMLImageElement>(selector))) {
              if (img.src && !urls.includes(img.src)) urls.push(img.src)
            }
          }
          return urls
        }
        const ogImage = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content ?? null
        const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href ?? null
        const heading = document.querySelector<HTMLElement>('h1, h2') ?? document.body
        const detectedFontFamily = heading ? getComputedStyle(heading).fontFamily || null : null
        return { logoCandidateUrls: [...pickLogo(), ...(ogImage ? [ogImage] : []), ...(icon ? [icon] : [])], detectedFontFamily }
      })

      return {
        screenshotBase64: screenshotBuffer.toString('base64'), screenshotMediaType: 'image/png',
        logoCandidateUrls: hints.logoCandidateUrls.slice(0, MAX_LOGO_CANDIDATES), detectedFontFamily: hints.detectedFontFamily,
      }
    } finally {
      await browser.close()
    }
  }
}
