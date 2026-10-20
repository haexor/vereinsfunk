import { OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import { classifyProviderStatus, type ProviderStatusErrorClass } from './providerStatus.js'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>
export type ProviderRequestErrorClass = ProviderStatusErrorClass | 'provider_network'

/**
 * Name des Werkzeugs, das die schemakonforme Antwort erzwingt. Der Wert ist nicht frei waehlbar:
 * haex-claude-proxy erkennt genau diesen Namen und uebergibt dessen `input_schema` als
 * `--json-schema` an die Claude-CLI (src/cli-format.js, OUTPUT_TOOL_NAME) -- ein anderer Name
 * landet dort im Ausgabe-Werkzeug-Filter und die Antwort kaeme als Prosa zurueck. Fuer
 * api.anthropic.com ist es ein gewoehnlicher Werkzeugname ohne Sonderbedeutung, derselbe Aufruf
 * funktioniert also gegen beide Gegenstellen. Gilt fuer Text- und Vision-Adapter gleichermassen.
 */
export const ANTHROPIC_OUTPUT_TOOL_NAME = 'final_result'

/**
 * Haengt `path` ueber `URL.pathname` an, nicht per String-Konkatenation: eine Basis-URL mit
 * Query-String wuerde sonst den Schlussteil des Pfads verschlucken, weil ein angehaengter "/"
 * hinter dem "?" landet statt davor.
 */
export function joinUrlPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`
  return url.toString()
}

/**
 * Gemeinsamer POST-Ablauf aller Provider-Adapter (Text und Vision, Anthropic und OpenAI-kompatibel):
 * liefert den geparsten JSON-Body oder wirft ueber `fail` eine Fehlerklasse ohne Ein- oder
 * Ausgabetext. Die Zeitgrenze gilt bis zum Ende des Bodys, nicht nur bis zu den Headern -- ein
 * Provider, der die Header schickt und dann haengt, blockierte sonst den Worker-Slot unbegrenzt.
 * Ein Abbruch oder Socket-Fehler beim Lesen des Bodys ist ein Netzwerkfehler (wiederholbar), nur
 * ein nicht parsebarer oder zu grosser Body ist eine unbrauchbare Antwort.
 */
export async function postProviderJson(
  fetcher: FetchLike,
  url: string,
  init: { headers: Record<string, string>; body: string },
  timeoutMs: number,
  fail: (errorClass: ProviderRequestErrorClass, retryable: boolean) => Error,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response: Response
    try {
      response = await fetcher(url, { method: 'POST', signal: controller.signal, headers: init.headers, body: init.body })
    } catch (error) {
      // Eine blockierte oder umgeleitete Zieladresse ist eine dauerhafte Fehlkonfiguration, kein
      // transienter Netzwerkfehler -- drei automatische Hatchet-Wiederholungen waeren verschwendet.
      if (error instanceof OutboundFetchError) throw fail('provider_configuration', false)
      throw fail('provider_network', true)
    }
    if (!response.ok) {
      const { errorClass, retryable } = classifyProviderStatus(response.status)
      throw fail(errorClass, retryable)
    }
    let text: string
    try {
      text = await response.text()
    } catch (error) {
      if (error instanceof OutboundFetchError) throw fail('provider_schema', false)
      throw fail('provider_network', true)
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw fail('provider_schema', false)
    }
  } finally {
    clearTimeout(timeout)
  }
}
