import type { PlayerboardSettingsValues, ScopePlayerboardSettings } from '@vereinsfunk/contracts'

// Paket 052, PR 3: Zustaende der Einstellungsseite, Muster PolicyFlagToggles.vue.

// Ersetzbare Felder (Saisonbeginn, Sichtbarkeit): oben verbindlich gesetzt -> gesperrt; sonst
// geerbt (kein eigener Wert) oder eigener Wert.
export type ReplaceableState = 'inherited' | 'own' | 'locked'

export function replaceableState(entry: ScopePlayerboardSettings, field: 'seasonStart' | 'statsVisibility'): ReplaceableState {
  if (entry.locked[field]) return 'locked'
  return entry.own[field] === null ? 'inherited' : 'own'
}

// Nur verschaerfbare Erlaubnisse: hier verboten (eigener Wert false), oben verboten (wirksam false
// ohne eigenes Verbot -> hier wirkungslos, deshalb gesperrt) oder erlaubt.
export type RestrictionState = 'allowed' | 'restricted' | 'locked'

export function restrictionState(entry: ScopePlayerboardSettings, field: 'teamCategoriesAllowed' | 'publicSharingAllowed'): RestrictionState {
  if (entry.own[field] === false) return 'restricted'
  return entry.effective[field] ? 'allowed' : 'locked'
}

// Nur die geaenderten Felder gehen an PUT /v1/playerboard/settings.
export function settingsPatch(own: PlayerboardSettingsValues, draft: PlayerboardSettingsValues): Partial<PlayerboardSettingsValues> {
  const patch: Partial<PlayerboardSettingsValues> = {}
  for (const field of Object.keys(draft) as (keyof PlayerboardSettingsValues)[]) {
    const before = own[field]
    const after = draft[field]
    const same = Array.isArray(before) && Array.isArray(after)
      ? before.length === after.length && [...before].sort().join() === [...after].sort().join()
      : before === after
    if (!same) Object.assign(patch, { [field]: after })
  }
  return patch
}

// Vorschlag fuer die Adresse der oeffentlichen Seite aus dem Mannschaftsnamen ("U13 Mädchen" ->
// "u13-maedchen"), passend zu PublicSlugSchema.
export function suggestPublicSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
