function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value !== 'object') throw new TypeError('proposal input must be JSON serializable')
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`
}

// Ein Proposal wird nicht über die rohe JSON-Reihenfolge gebunden. Der kanonische Hash ist der
// Nachweis, dass genau die bestätigte Eingabe erneut autorisiert und ausgeführt wird.
//
// Web Crypto (crypto.subtle) statt node:crypto: dieses Modul haengt am gemeinsamen
// @vereinsfunk/domain-Barrel, das apps/web auch fuer client-seitige Zwecke importiert (z. B.
// evaluateMediaGate) -- ein node:crypto-Import hier bricht im Dev-Server jede Seite mit
// "__vite-browser-external:node:crypto does not provide an export named 'createHash'", weil Vite
// node:crypto im Browser-Bundle nur als leeren Stub bereitstellt. crypto.subtle ist sowohl im
// Browser als auch in Node (>= 19, global) identisch verfuegbar.
export async function hashAgentProposalInput(input: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(input)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
