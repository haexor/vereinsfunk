// createSecretBoxFromEnvironment/ciphertextToBytea zogen nach ./secretBox.ts um (Paket 012 nutzt
// beide Helfer fuer Social-Connection-Tokens wieder, ein Import von hier waere fuer eine
// kanalfremde Datei irrefuehrend gewesen -- Aufrufer importieren jetzt direkt aus ./secretBox.js).

/**
 * Protokolle, fuer die es im Worker einen Adapter gibt (siehe GENERATORS in
 * apps/worker/src/textGeneration.ts). Eine Konfiguration mit einem anderen Protokoll darf nicht
 * aktiviert werden -- sie wuerde erst im Worker scheitern, wo der Fehler niemandem auffaellt.
 */
export const IMPLEMENTED_LLM_PROTOCOLS = new Set(['openai', 'anthropic'])

/**
 * Aufgabenarten, fuer die es im Worker einen Adapter gibt (siehe GENERATORS in
 * apps/worker/src/textGeneration.ts und VISION_GENERATORS in apps/worker/src/brandWebsiteAnalysis.ts).
 * Eine Konfiguration mit einer anderen Aufgabenart darf nicht aktiviert werden -- Vokabular, das
 * schon existiert, aber noch keinen Adapter hat (image_generation, video_generation), bleibt hier
 * bewusst aussen vor.
 */
export const IMPLEMENTED_LLM_TASK_KINDS = new Set(['text_generation', 'vision_analysis'])

/**
 * Haengt `path` ueber `URL.pathname` an, nicht per String-Konkatenation: eine Basis-URL mit
 * Query-String (z.B. "…/v1?key=abc") wuerde sonst den Schlussteil des Pfads verschlucken, weil ein
 * angehaengter "/" hinter dem "?" landet statt davor.
 */
export function joinUrlPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`
  return url.toString()
}

/**
 * Antwort eines `GET /models`: `{ data: [{ id }] }` -- die Huelle ist bei OpenAI-kompatiblen
 * Endpunkten und bei Anthropic dieselbe, nur die Authentifizierung unterscheidet sich. Alles
 * andere wird verworfen statt den Aufruf scheitern zu lassen: die Liste fuellt ein Auswahlfeld,
 * und ein Anbieter, der zusaetzliche oder unbrauchbare Eintraege liefert, soll das Formular nicht
 * blockieren. Die Laengengrenze ist die des `model`-Feldes der Konfiguration: was laenger ist,
 * liesse sich anschliessend ohnehin nicht speichern.
 */
export function parseModelListingIds(payload: unknown): string[] {
  const data = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const ids = new Set<string>()
  for (const entry of data) {
    const id = (entry as { id?: unknown } | null)?.id
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (trimmed.length > 0 && trimmed.length <= 120) ids.add(trimmed)
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function mapLlmProviderConfigurationRow(row: Record<string, unknown>, hasSecret: boolean) {
  return {
    id: row.id,
    label: row.label,
    protocol: row.protocol,
    baseUrl: row.base_url,
    model: row.model,
    purpose: row.purpose,
    taskKind: row.task_kind,
    structuredOutputRequired: row.structured_output_required,
    isActive: row.is_active,
    hasSecret,
  }
}
