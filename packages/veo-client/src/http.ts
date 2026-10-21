import { VeoError } from './errors.js'

// Paket 053, PR 1: alle ausgehenden Aufrufe gehen nur an Veos eigene Hosts. Die URLs setzt nie ein
// Nutzer, deshalb genuegt eine feste Allowlist statt packages/outbound-fetch.
// Spec 002 (research.md R-12): RAS, Veos Dienst fuer Paesse, Ballbesitz und Schuesse, liegt auf
// CloudFront. ponytail: fester Host aus window.VEO_SERVICE_URLS.RAS_URL der Veo-Seite; zieht Veo um,
// endet der Abruf mit upstream_error -- Ausbau: RAS_URL beim Abgleich aus app.veo.co lesen.
export const VEO_RAS_HOST = 'dt3kfuz4eo879.cloudfront.net'
export const VEO_HOSTS: ReadonlySet<string> = new Set(['auth.veo.co', 'app.veo.co', VEO_RAS_HOST])

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface VeoHttpOptions {
  // Fuer Tests austauschbar; Standard ist das globale fetch.
  fetch?: FetchLike
  // Abbruch nach dieser Zeit (Millisekunden), Standard 30 s.
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

/** Ruft eine Veo-URL auf; andere Hosts und Weiterleitungen auf andere Hosts werden abgelehnt. */
export async function veoRequest(url: string | URL, init: RequestInit, options: VeoHttpOptions = {}): Promise<Response> {
  const target = new URL(url)
  if (target.protocol !== 'https:' || !VEO_HOSTS.has(target.hostname) || (target.port !== '' && target.port !== '443')) {
    throw new Error(`refusing request to non-Veo host ${target.hostname}`)
  }
  const fetchImpl = options.fetch ?? fetch
  try {
    return await fetchImpl(target, {
      ...init,
      // Weiterleitungen werden nie automatisch verfolgt; der Token-Tausch liest "location" selbst.
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    throw new VeoError('upstream_error', `Veo request failed: ${target.hostname}${target.pathname} (${(error as Error).name})`)
  }
}
