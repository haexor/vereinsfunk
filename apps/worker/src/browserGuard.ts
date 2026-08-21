import { assertResolvesPublicly, isAllowedOutboundUrl, OutboundFetchError, systemLookup, type AddressLookup } from '@vereinsfunk/outbound-fetch'
import type { Page } from 'playwright'

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

/**
 * Blockiert jeden Sub-Request der Seite gegen ein internes Ziel, bevor Chromium ihn absendet.
 * Pro Seite gecacht (dieselbe Domain taucht auf einer Homepage typischerweise mehrfach auf --
 * Logo, Icons, Skripte vom selben Host), damit nicht jede einzelne Ressource eine eigene
 * DNS-Aufloesung ausloest.
 */
export function guardPageNavigation(page: Page, lookupImpl: AddressLookup = systemLookup): void {
  const decided = new Map<string, boolean>()
  page.route('**/*', (route) => {
    void (async () => {
      const url = route.request().url()
      let hostname: string
      try {
        hostname = new URL(url).hostname
      } catch {
        await route.abort()
        return
      }
      let allowed = decided.get(hostname)
      if (allowed === undefined) {
        try {
          await assertNavigableUrl(url, lookupImpl)
          allowed = true
        } catch {
          allowed = false
        }
        decided.set(hostname, allowed)
      }
      if (allowed) await route.continue()
      else await route.abort()
    })()
  })
}
