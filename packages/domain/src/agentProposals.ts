import { createHash } from 'node:crypto'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key]!)}`).join(',')}}`
}

// Ein Proposal wird nicht über die rohe JSON-Reihenfolge gebunden. Der kanonische Hash ist der
// Nachweis, dass genau die bestätigte Eingabe erneut autorisiert und ausgeführt wird.
export function hashAgentProposalInput(input: JsonValue): string {
  return createHash('sha256').update(canonicalize(input)).digest('hex')
}
