import { evaluateMediaGate, type MediaGateInput } from './mediaGate.js'

export function assertApprovalSnapshot(input: MediaGateInput, derivativeHashes: readonly string[]): void {
  const gate = evaluateMediaGate(input)
  if (!gate.publishable) throw new Error(`Media approval is blocked: ${gate.blockers.join(',')}`)
  if (derivativeHashes.length === 0 || derivativeHashes.some((hash) => !/^[a-f0-9]{64}$/i.test(hash))) throw new Error('Approval requires immutable derivative hashes')
}

export interface LlmProviderConfiguration {
  id: string
  protocol: 'anthropic' | 'openai'
  purpose: string
  priority: number
  isActive: boolean
}

// Kein echter LLM-Aufruf existiert im Repository (siehe Plan 021), deshalb bewusst ohne
// Retry-bei-Fehlschlag-Logik -- dafuer gibt es noch keinen Aufrufer, den man testen koennte.
export function selectProviderConfiguration(
  purpose: string,
  configs: readonly LlmProviderConfiguration[],
): LlmProviderConfiguration | null {
  const active = configs.filter((config) => config.isActive)
  const exactMatch = active.filter((config) => config.purpose === purpose)
  const candidates = exactMatch.length > 0 ? exactMatch : active.filter((config) => config.purpose === 'default')
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => a.priority - b.priority)[0]!
}
