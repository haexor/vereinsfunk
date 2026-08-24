import { createHash } from 'node:crypto'

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value !== 'object') throw new TypeError('proposal input must be JSON serializable')
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`
}

// Ein Proposal wird nicht über die rohe JSON-Reihenfolge gebunden. Der kanonische Hash ist der
// Nachweis, dass genau die bestätigte Eingabe erneut autorisiert und ausgeführt wird.
export function hashAgentProposalInput(input: unknown): string {
  return createHash('sha256').update(canonicalize(input)).digest('hex')
}
