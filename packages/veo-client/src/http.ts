import { VeoError } from './errors.js'

// Paket 053, PR 1: alle ausgehenden Aufrufe gehen nur an Veos eigene Hosts. Die URLs setzt nie ein
// Nutzer, deshalb genuegt eine feste Allowlist statt packages/outbound-fetch.
export const VEO_HOSTS: ReadonlySet<string> = new Set(['auth.veo.co', 'app.veo.co'])

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
  if (target.protocol !== 'https:' || !VEO_HOSTS.has(target.hostname)) {
    throw new Error(`refusing request to non-Veo host ${target.hostname}`)
  }
  const fetchImpl = options.fetch ?? fetch
  try {
    return await fetchImpl(target, {
      // Weiterleitungen folgt nur, wer sie ausdruecklich will (Token-Tausch liest "location").
      redirect: 'manual',
      ...init,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    throw new VeoError('upstream_error', `Veo request failed: ${target.hostname}${target.pathname} (${(error as Error).name})`)
  }
}
