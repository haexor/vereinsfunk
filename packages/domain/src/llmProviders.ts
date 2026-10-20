import { evaluateMediaGate, type MediaGateInput } from './mediaGate.js'

export function assertApprovalSnapshot(input: MediaGateInput, derivativeHashes: readonly string[]): void {
  const gate = evaluateMediaGate(input)
  if (!gate.publishable) throw new Error(`Media approval is blocked: ${gate.blockers.join(',')}`)
  if (derivativeHashes.length === 0 || derivativeHashes.some((hash) => !/^[a-f0-9]{64}$/i.test(hash))) throw new Error('Approval requires immutable derivative hashes')
}
