import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Abruf einer vom Verein selbst hinterlegten Adresse (heute: iCal-Feed einer Integrationsquelle).
 *
 * Ohne Pruefung waere die API ein Server-zu-Server-Proxy: die Adresse kommt aus der Datenbank,
 * gesetzt von einer Person mit `integration.manage`, und der Server ruft sie aus seinem eigenen
 * Netz auf. Damit waeren Ziele erreichbar, die von aussen nie erreichbar sind -- der
 * Metadatendienst einer Cloud (169.254.169.254), Supabase/Postgres auf dem Loopback, interne
 * Verwaltungsoberflaechen. Schon die Unterscheidung "502 oder nicht" verraet dabei, was im
 * internen Netz antwortet.
 */
export class OutboundFetchError extends Error {
  constructor(
    readonly reason: 'blocked_url' | 'request_failed' | 'too_large',
    message: string,
  ) {
    super(message)
    this.name = 'OutboundFetchError'
  }
}

// IPv4-Bereiche, die nie ein oeffentliches Ziel sind (RFC 1918, Loopback, Link-Local inkl. des
// Cloud-Metadatendienstes, CGNAT, "this host", Broadcast/reserviert).
function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a >= 224) return true
  return false
}

function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|]$/g, '')
  if (value === '::' || value === '::1') return true
  // ::ffff:10.0.0.1 -- IPv4 in IPv6-Schreibweise umgeht die IPv4-Pruefung sonst vollstaendig.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  if (mapped?.[1]) return isPrivateIpv4(mapped[1])
  if (/^f[cd]/.test(value)) return true // fc00::/7, Unique Local
  if (value.startsWith('fe80')) return true // Link-Local
  if (value.startsWith('ff')) return true // Multicast
  return false
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) return isPrivateIpv6(address)
  return true
}

/**
 * Prueft eine Adresse, bevor sie gespeichert wird -- ein unzulaessiger Wert soll gar nicht erst in
 * `integration_sources.endpoint_url` landen. Namen, die erst zur Laufzeit aufgeloest werden, prueft
 * zusaetzlich {@link fetchPublicUrl}.
 */
export function isAllowedOutboundUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  // Nur https: http gaebe den Feed (und damit Personendaten) im Klartext preis, und alles andere
  // (file:, gopher:, ...) hat als Quelle ohnehin keinen Zweck.
  if (url.protocol !== 'https:') return false
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false
  // Namen, die per Konvention nie ins oeffentliche Netz zeigen (mDNS, interne Suffixe).
  if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.home.arpa')) return false
  // URL.hostname behaelt bei IPv6 die eckigen Klammern ("[::1]"), isIP versteht sie nicht.
  const literal = hostname.replace(/^\[|]$/g, '')
  if (isIP(literal) !== 0) return !isBlockedAddress(literal)
  return true
}

export type AddressLookup = (hostname: string) => Promise<readonly string[]>

// Exportiert, damit ein Aufrufer von assertResolvesPublicly() (die selbst keinen Default kapselt)
// nicht dieselbe node:dns/promises-Aufloesung ein zweites Mal nachbauen muss (siehe apps/worker,
// browserGuard.ts).
export const systemLookup: AddressLookup = async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address)

/**
 * Exportiert (nicht nur intern in fetchPublicUrl/createGuardedFetch genutzt), weil Paket 048
 * (Playwright-Navigation fuer die KI-Markenerkennung) dieselbe DNS-Rebinding-Pruefung fuer jeden
 * einzelnen von Chromium selbst ausgeloesten Request braucht -- Playwrights eigenes Networking
 * laeuft nicht durch fetch()/fetchPublicUrl().
 */
export async function assertResolvesPublicly(hostname: string, resolve: AddressLookup): Promise<void> {
  const bare = hostname.replace(/^\[|]$/g, '')
  if (isIP(bare) !== 0) {
    if (isBlockedAddress(bare)) throw new OutboundFetchError('blocked_url', `blocked address ${bare}`)
    return
  }
  // Ein Name kann auf eine interne Adresse zeigen ("rebinding"): die Literal-Pruefung oben allein
  // reicht deshalb nicht, jede aufgeloeste Adresse muss oeffentlich sein.
  let addresses: readonly string[]
  try {
    addresses = await resolve(bare)
  } catch {
    throw new OutboundFetchError('request_failed', `cannot resolve ${bare}`)
  }
  if (addresses.length === 0) throw new OutboundFetchError('request_failed', `cannot resolve ${bare}`)
  for (const address of addresses) {
    if (isBlockedAddress(address)) throw new OutboundFetchError('blocked_url', `blocked address ${address}`)
  }
}

const DEFAULT_MAX_BYTES = 5_000_000

export interface FetchPublicUrlOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  /**
   * Zusaetzliche Kopfzeilen, etwa ein `authorization`-Bearer. Ein Geheimnis darf einer
   * Weiterleitung nicht ueber die Herkunft hinaus folgen (siehe Redirect-Zweig unten).
   */
  headers?: Record<string, string>
  /** Nur für Tests; sonst der globale fetch. */
  fetchImpl?: typeof fetch
  /** Nur für Tests; sonst die Namensauflösung des Systems. */
  lookupImpl?: AddressLookup
}

// Weiterleitung auf eine fremde Herkunft: die Gegenstelle bekaeme sonst ein Geheimnis, das nie fuer
// sie bestimmt war. Browser verwerfen `authorization` hier ebenso; `x-api-key` ist derselbe Fall
// fuer den Anthropic-Adapter (siehe app.ts, /v1/llm-providers/models).
const CREDENTIAL_HEADER_NAMES = new Set(['authorization', 'x-api-key'])
function stripCredentialHeadersOnCrossOrigin(headers: Record<string, string>, from: string, to: string): Record<string, string> {
  if (new URL(from).origin === new URL(to).origin) return headers
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADER_NAMES.has(name.toLowerCase())))
}

/**
 * Folgt Weiterleitungen selbst und prueft jeden Hop erneut -- gemeinsame Grundlage von
 * {@link fetchPublicUrl} (Text) und {@link fetchPublicBinary} (Bytes). Weiterleitungen werden
 * bewusst nicht `fetch` ueberlassen: das folgt ihnen stillschweigend, und eine Weiterleitung auf
 * `http://169.254.169.254` haette die Pruefung des urspruenglichen Ziels wertlos gemacht.
 *
 * Gibt die Antwort des letzten Hops zurueck; die Groessengrenze auf dem Body zieht der Aufrufer,
 * weil Text und Bytes unterschiedlich gelesen werden muessen.
 */
async function followGuardedRedirects(rawUrl: string, options: FetchPublicUrlOptions): Promise<Response> {
  const { timeoutMs = 10_000, maxBytes = DEFAULT_MAX_BYTES, maxRedirects = 3, headers = {}, fetchImpl = fetch, lookupImpl = systemLookup } = options
  let current = rawUrl
  let currentHeaders = headers
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isAllowedOutboundUrl(current)) throw new OutboundFetchError('blocked_url', `blocked url ${current}`)
    await assertResolvesPublicly(new URL(current).hostname, lookupImpl)

    let response: Response
    try {
      response = await fetchImpl(current, { redirect: 'manual', headers: currentHeaders, signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      throw new OutboundFetchError('request_failed', error instanceof Error ? error.message : 'fetch failed')
    }

    if (response.status >= 300 && response.status < 400) {
      // Der Body eines Redirects wird nie gelesen. Ohne cancel() bleibt die Verbindung belegt, bis
      // der GC sie einsammelt -- fuer fetchPublicUrl (ein iCal-Abruf, selten weitergeleitet) kaum
      // messbar, fuer fetchPublicBinary aber der Normalfall: bis zu fuenf Logo-Kandidaten je Lauf,
      // jeder mit Weiterleitung, in einem langlebigen Worker-Prozess.
      await response.body?.cancel().catch(() => {})
      const location = response.headers.get('location')
      if (!location) throw new OutboundFetchError('request_failed', `redirect without location (${response.status})`)
      let next: string
      try {
        next = new URL(location, current).toString()
      } catch {
        throw new OutboundFetchError('request_failed', `invalid redirect location (${location})`)
      }
      currentHeaders = stripCredentialHeadersOnCrossOrigin(currentHeaders, current, next)
      current = next
      continue
    }
    if (!response.ok) throw new OutboundFetchError('request_failed', `unexpected status ${response.status}`)

    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new OutboundFetchError('too_large', `content-length ${declaredLength} exceeds ${maxBytes}`)
    }
    return response
  }
  throw new OutboundFetchError('request_failed', `too many redirects for ${rawUrl}`)
}

/**
 * Holt eine Adresse als Text -- mit Zieladressenpruefung (auch je Weiterleitung), Zeitgrenze und
 * Groessengrenze.
 */
export async function fetchPublicUrl(rawUrl: string, options: FetchPublicUrlOptions = {}): Promise<string> {
  const response = await followGuardedRedirects(rawUrl, options)
  return await readCapped(response, options.maxBytes ?? DEFAULT_MAX_BYTES)
}

/**
 * Wie {@link fetchPublicUrl}, aber als Bytes: fuer Binaerdaten, die ein TextDecoder zerstoeren
 * wuerde. Gedacht fuer die Logo-Kandidaten, die die KI-Markenerkennung von der Homepage eines
 * Vereins herunterlaedt (Paket 048) -- dort ist eine Weiterleitung innerhalb von https der
 * Normalfall, nicht die Ausnahme (`example.org` -> `www.example.org`, Auslieferung ueber ein CDN),
 * weshalb {@link createGuardedFetch} mit seiner bewussten Weiterleitungssperre dafuer nicht taugt.
 *
 * Nicht mitverfolgt wird der Sprung von http auf https: `isAllowedOutboundUrl` laesst je Hop nur
 * https zu. Ein Kandidat, den eine Seite hartkodiert als `http://.../logo.png` ausliefert, faellt
 * damit als `blocked_url` durch -- bewusst, denn diese Grenze ist die Zusage des Pakets und nicht
 * fuer einen Logo-Vorschlag aufzuweichen.
 */
export async function fetchPublicBinary(rawUrl: string, options: FetchPublicUrlOptions = {}): Promise<Buffer> {
  const response = await followGuardedRedirects(rawUrl, options)
  return await readCappedBytes(response, options.maxBytes ?? DEFAULT_MAX_BYTES)
}

// content-length ist nur eine Behauptung der Gegenstelle -- ohne diese Grenze koennte eine Quelle
// beliebig viel Speicher belegen (response.text() liest bis zum Ende).
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const body = response.body
  if (!body) return ''
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let received = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) throw new OutboundFetchError('too_large', `response exceeds ${maxBytes} bytes`)
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return text + decoder.decode()
}

// Dasselbe wie readCapped, nur ohne TextDecoder: ein PNG durch einen TextDecoder zu schicken
// ersetzt jede Bytefolge, die kein gueltiges UTF-8 ist, durch U+FFFD -- das Bild waere danach
// unbrauchbar, ohne dass irgendwo ein Fehler auffiele.
async function readCappedBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const body = response.body
  if (!body) return Buffer.alloc(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) throw new OutboundFetchError('too_large', `response exceeds ${maxBytes} bytes`)
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks)
}

export interface GuardedFetchOptions {
  /** Nur für Tests; sonst der globale fetch. */
  fetchImpl?: typeof fetch
  /** Nur für Tests; sonst die Namensauflösung des Systems. */
  lookupImpl?: AddressLookup
  /** Wie bei {@link fetchPublicUrl}: eine Obergrenze gegen eine Gegenstelle, die beliebig viel Speicher belegen will. */
  maxBytes?: number
}

const DEFAULT_GUARDED_FETCH_MAX_BYTES = 5_000_000

/**
 * Wie {@link fetchPublicUrl}, aber fuer Aufrufer, die die `Response` selbst auswerten wollen
 * (Statuscode, Header, strukturierter Body) statt nur den Text zu bekommen -- gedacht fuer
 * LLM-Provider-Endpunkte mit einer vom Verein oder einer Plattform-Administration hinterlegten
 * Basis-URL. Eine Weiterleitung wird nicht verfolgt, sondern als `blocked_url` abgelehnt: kein
 * bekannter Provider-Endpunkt (OpenAI-kompatibel, Anthropic Messages, haex-claude-proxy) leitet im
 * Normalbetrieb weiter, und ihr zu folgen wuerde die Credential-Header-Entfernung aus
 * {@link fetchPublicUrl} hier duplizieren, ohne einen echten Anwendungsfall zu bedienen.
 */
export function createGuardedFetch(options: GuardedFetchOptions = {}): (input: string, init: RequestInit) => Promise<Response> {
  const { fetchImpl = fetch, lookupImpl = systemLookup, maxBytes = DEFAULT_GUARDED_FETCH_MAX_BYTES } = options
  return async (input, init) => {
    if (!isAllowedOutboundUrl(input)) throw new OutboundFetchError('blocked_url', `blocked url ${input}`)
    await assertResolvesPublicly(new URL(input).hostname, lookupImpl)
    const response = await fetchImpl(input, { ...init, redirect: 'manual' })
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new OutboundFetchError('blocked_url', `refusing to follow a redirect from ${input}`)
    }
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new OutboundFetchError('too_large', `content-length ${declaredLength} exceeds ${maxBytes}`)
    }
    return capResponseBody(response, maxBytes)
  }
}

// content-length ist nur eine Behauptung der Gegenstelle (wie in fetchPublicUrl/readCapped) --
// ohne diese Grenze koennte eine Gegenstelle beliebig viel Speicher belegen, sobald der Aufrufer
// den Body liest (z.B. per response.json()). Anders als readCapped gibt diese Funktion eine
// Response zurueck, kein Text -- der Body-Stream selbst traegt die Grenze durch.
function capResponseBody(response: Response, maxBytes: number): Response {
  const body = response.body
  if (!body) return response
  let received = 0
  const capped = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          if (received > maxBytes) { controller.error(new OutboundFetchError('too_large', `response exceeds ${maxBytes} bytes`)); return }
          controller.enqueue(value)
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      } finally {
        reader.releaseLock()
      }
    },
    cancel(reason) { return body.cancel(reason) },
  })
  return new Response(capped, { status: response.status, statusText: response.statusText, headers: response.headers })
}
