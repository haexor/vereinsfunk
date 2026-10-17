export type ProviderStatusErrorClass = 'provider_rate_limit' | 'provider_server' | 'provider_configuration' | 'provider_schema'

/**
 * Fehlerklasse fuer eine nicht erfolgreiche Provider-Antwort, fuer alle Adapter (Textgenerator und
 * Vision-Analyse, Anthropic und OpenAI-kompatibel) gleich. 401/403 (Schluessel falsch oder ohne
 * Berechtigung) und 404 (Modell oder Basis-URL existiert nicht) sind dauerhafte Fehlkonfiguration:
 * Wiederholen hilft nicht, und der Betreiber muss den Provider korrigieren -- als `provider_schema`
 * gemeldet sahen sie aus wie eine unbrauchbare Antwort eines funktionierenden Providers.
 */
export function classifyProviderStatus(status: number): { errorClass: ProviderStatusErrorClass; retryable: boolean } {
  if (status === 429) return { errorClass: 'provider_rate_limit', retryable: true }
  if (status >= 500) return { errorClass: 'provider_server', retryable: true }
  if (status === 401 || status === 403 || status === 404) return { errorClass: 'provider_configuration', retryable: false }
  return { errorClass: 'provider_schema', retryable: false }
}
