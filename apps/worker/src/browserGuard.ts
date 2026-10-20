import { assertResolvesPublicly, isAllowedOutboundUrl, OutboundFetchError, systemLookup, type AddressLookup } from '@vereinsfunk/outbound-fetch'
import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright'

/**
 * Paket 048: eine von einem Verein hinterlegte Homepage-URL wird per echtem Chromium-Browser
 * gerendert. Playwrights eigenes Networking laeuft nicht durch fetch()/fetchPublicUrl(), deshalb
 * braucht jede von der Seite selbst ausgeloeste Anfrage (Redirects, Bilder, Skripte, Fonts) hier
 * dieselbe Pruefung, die fetchPublicUrl/createGuardedFetch fuer gewoehnliche Aufrufe durchsetzen --
 * sonst waere der Worker ein SSRF-Proxy ins interne Netz, gesteuert durch beliebiges JavaScript
 * auf der ferngeladenen Seite.
 */
export async function assertNavigableUrl(rawUrl: string, lookupImpl: AddressLookup = systemLookup): Promise<void> {
  if (!isAllowedOutboundUrl(rawUrl)) throw new OutboundFetchError('blocked_url', `blocked url ${rawUrl}`)
  await assertResolvesPublicly(new URL(rawUrl).hostname, lookupImpl)
}

/** Nur die Routing-Faehigkeit, damit ein Test einen schmalen Doppelgaenger einsetzen kann. */
type RequestRouter = Pick<BrowserContext, 'route'>

/**
 * Blockiert jeden Sub-Request der Seite gegen ein internes Ziel, bevor Chromium ihn absendet.
 * Pro Hostname gecacht (dieselbe Domain taucht auf einer Homepage typischerweise mehrfach auf --
 * Logo, Icons, Skripte vom selben Host), damit nicht jede einzelne Ressource eine eigene
 * DNS-Aufloesung ausloest.
 *
 * Am BrowserContext statt an der einzelnen Seite: `page.route()` deckt nur diese eine Seite ab, ein
 * per window.open() geoeffnetes Fenster waere eine zweite, ungeschuetzte Seite -- und damit genau
 * der SSRF-Weg, den dieser Guard schliessen soll. Der Aufruf wird bewusst abgewartet: bis
 * `route()` erfuellt ist, hat Chromium das Abfangen noch nicht aktiviert, eine Navigation davor
 * liefe ungeprueft hinaus.
 */
export async function guardOutboundRequests(target: RequestRouter, lookupImpl: AddressLookup = systemLookup): Promise<void> {
  const decided = new Map<string, boolean>()
  await target.route('**/*', async (route) => {
    const url = route.request().url()
    let allowed = false
    let hostname: string | null = null
    try {
      hostname = new URL(url).hostname
    } catch {
      hostname = null // eine URL, die sich nicht einmal parsen laesst, wird nie zugelassen
    }
    if (hostname !== null) {
      const cached = decided.get(hostname)
      if (cached !== undefined) {
        allowed = cached
      } else {
        try {
          await assertNavigableUrl(url, lookupImpl)
          allowed = true
        } catch {
          allowed = false
        }
        decided.set(hostname, allowed)
      }
    }
    // continue()/abort() scheitert, sobald Seite oder Browser bereits geschlossen sind -- ein
    // Normalfall am Ende von render(), waehrend noch Anfragen laufen. Ohne dieses catch waere das
    // eine unbehandelte Rejection und wuerde den ganzen Worker-Prozess beenden.
    try {
      if (allowed) await route.continue()
      else await route.abort()
    } catch {
      // nichts mehr zu tun: die Anfrage geht mit der geschlossenen Seite ohnehin nicht hinaus
    }
  })
}

/**
 * Oeffnet den BrowserContext fuer eine fremde Seite mit allen Wegen nach draussen unter Kontrolle.
 * context.route() sieht weder Anfragen eines Service Workers (Playwright reicht sie an der Route
 * vorbei) noch WebSocket-Handshakes -- beides waere sonst ein ungeprueftes Ziel ins interne Netz.
 * Service Worker werden deshalb gar nicht erst registriert, und jeder WebSocket wird geschlossen,
 * ohne den Server je zu kontaktieren: eine Marken-Analyse braucht keine Live-Verbindung.
 */
export async function newGuardedContext(browser: Pick<Browser, 'newContext'>, options: BrowserContextOptions, lookupImpl: AddressLookup = systemLookup): Promise<BrowserContext> {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' })
  await guardOutboundRequests(context, lookupImpl)
  await context.routeWebSocket(/.*/, (ws) => ws.close())
  return context
}
