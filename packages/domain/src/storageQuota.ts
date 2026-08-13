// Plan 021: Speicherpruefung beim Ausstellen einer Upload-URL. Geprueft wird gegen jede
// zutreffende Ebene -- Mannschaft, Abteilung, Verein -- und die ERSTE, die reisst, benennt die
// Antwort, von der spezifischsten zur allgemeinsten Ebene, damit "die Mannschaft ist voll"
// nicht durch eine noch nicht gepruefte Vereinsgrenze verdeckt wird.
export interface StorageReservationInput {
  limits: { organizationBytes: number; departmentBytes?: number; teamBytes?: number }
  usage: { organizationBytes: number; departmentBytes?: number; teamBytes?: number }
  announcedBytes: number
}

export interface StorageReservationResult {
  allowed: boolean
  blockingScope?: 'organization' | 'department' | 'team'
  limitBytes?: number
  usedBytes?: number
}

export function evaluateStorageReservation(input: StorageReservationInput): StorageReservationResult {
  const scopes: readonly ['team', 'department', 'organization'] = ['team', 'department', 'organization']
  for (const scope of scopes) {
    const limitBytes = scope === 'organization' ? input.limits.organizationBytes : scope === 'department' ? input.limits.departmentBytes : input.limits.teamBytes
    if (limitBytes === undefined) continue
    const usedBytes = scope === 'organization' ? input.usage.organizationBytes : scope === 'department' ? (input.usage.departmentBytes ?? 0) : (input.usage.teamBytes ?? 0)
    if (usedBytes + input.announcedBytes > limitBytes) {
      return { allowed: false, blockingScope: scope, limitBytes, usedBytes }
    }
  }
  return { allowed: true }
}
