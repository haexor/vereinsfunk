import type { ScopeLevelName } from './index.js'

// Ersetzung, nicht Verschaerfung (Plan 013, "Datenmodell"): anders als bei den Richtlinien aus
// Paket 011 ist eine Abteilungsfarbe nicht "strenger" als die Vereinsfarbe. Die Erlaubnis, ueberhaupt
// abzuweichen, vererbt sich trotzdem nur nach unten -- was der Verein sperrt, kann die Abteilung
// nicht fuer ihre Mannschaften oeffnen.
const ORGANIZATION_FIELDS = [
  'primaryColor',
  'accentColor',
  'backgroundColor',
  'textColor',
  'onPrimaryColor',
  'displayFontKey',
  'displayFontAssetId',
  'bodyFontKey',
  'bodyFontAssetId',
  'logoAssetId',
] as const

// Genau die Spalten, die department_brand_profiles/team_brand_profiles fuehren -- und damit die
// einzigen Felder, bei denen "sperren" und "abweichen" ueberhaupt eine Wirkung haben. Hintergrund-,
// Text- und Auf-Primaer-Farbe sowie die kuratierten Schriftschluessel bleiben bewusst Vereinssache
// (siehe Migration): sie hier zuzulassen hiesse, in der Oberflaeche eine Sperre anzubieten, die
// nichts sperrt, weil die untere Ebene den Wert ohnehin nie setzen kann.
export const BRAND_LOCKABLE_FIELDS = [
  'primaryColor',
  'accentColor',
  'logoAssetId',
  'displayFontAssetId',
  'bodyFontAssetId',
] as const

export type BrandLockableField = (typeof BRAND_LOCKABLE_FIELDS)[number]

export interface BrandLevelProfile {
  primaryColor?: string | null
  accentColor?: string | null
  backgroundColor?: string | null
  textColor?: string | null
  onPrimaryColor?: string | null
  displayFontKey?: string | null
  displayFontAssetId?: string | null
  bodyFontKey?: string | null
  bodyFontAssetId?: string | null
  logoAssetId?: string | null
}

// Was eine Abteilung oder Mannschaft selbst fuehren kann -- eine echte Teilmenge von
// BrandLevelProfile, siehe BRAND_LOCKABLE_FIELDS.
export type BrandOverrideProfile = Pick<BrandLevelProfile, BrandLockableField>

export interface OrganizationBrandLevel extends BrandLevelProfile {
  allowDepartmentOverrides: boolean
  lockedFields: readonly string[]
}

export interface DepartmentBrandLevel extends BrandOverrideProfile {
  allowTeamOverrides: boolean
  lockedFields: readonly string[]
}

// Farben sind nach der Aufloesung immer gefuellt (DEFAULT_RESOLVED_BRAND traegt einen Wert fuer
// jedes Feld); nur die Schrift-/Logo-Referenzen bleiben optional, weil "kein Asset gesetzt" ein
// gueltiger Endzustand ist (kuratierter Schluessel bzw. kein eigenes Logo).
export interface ResolvedBrand {
  primaryColor: string
  accentColor: string
  backgroundColor: string
  textColor: string
  onPrimaryColor: string
  displayFontKey: string | null
  displayFontAssetId: string | null
  bodyFontKey: string | null
  bodyFontAssetId: string | null
  logoAssetId: string | null
}

function applyOverride(
  base: ResolvedBrand,
  fields: readonly (keyof BrandLevelProfile)[],
  lockedFields: ReadonlySet<string>,
  override: BrandLevelProfile,
): ResolvedBrand {
  const next = { ...base }
  for (const field of fields) {
    if (lockedFields.has(field)) continue
    const value = override[field]
    if (value !== undefined && value !== null) next[field] = value
  }
  return next
}

// SaaS-Standard, falls ein Verein sein Markenprofil noch nicht vollstaendig ausgefuellt hat --
// identische Werte zu organization_brand_profiles' eigenen Spaltendefaults.
export const DEFAULT_RESOLVED_BRAND: ResolvedBrand = {
  primaryColor: '#163a2c',
  accentColor: '#caff4a',
  backgroundColor: '#f6f4ec',
  textColor: '#122820',
  onPrimaryColor: '#ffffff',
  displayFontKey: 'manrope',
  displayFontAssetId: null,
  bodyFontKey: 'dm_sans',
  bodyFontAssetId: null,
  logoAssetId: null,
}

export function resolveBrand(
  organization: OrganizationBrandLevel,
  department?: DepartmentBrandLevel | null,
  team?: BrandOverrideProfile | null,
): ResolvedBrand {
  let result = applyOverride(DEFAULT_RESOLVED_BRAND, ORGANIZATION_FIELDS, new Set(), organization)

  // Laeuft nur nach unten fort: eine Sperre des Vereins gilt fuer die Mannschaft auch dann, wenn
  // die Abteilung selbst dasselbe Feld nicht sperrt (sie hat ohnehin nie die Erlaubnis erhalten,
  // es zu setzen).
  const cumulativeLockedFields = new Set(organization.lockedFields)

  if (department && organization.allowDepartmentOverrides) {
    result = applyOverride(result, BRAND_LOCKABLE_FIELDS, cumulativeLockedFields, department)
  }
  if (department) {
    for (const field of department.lockedFields) cumulativeLockedFields.add(field)
  }
  // allowDepartmentOverrides ist die Blankosperre des Vereins fuer ALLES unterhalb: eine
  // Abteilung, die selbst nicht abweichen darf, kann das Recht auch nicht an ihre Mannschaften
  // weiterreichen (sonst umginge ein gespeichertes allow_team_overrides = true die Vereinssperre).
  if (team && organization.allowDepartmentOverrides && department?.allowTeamOverrides) {
    result = applyOverride(result, BRAND_LOCKABLE_FIELDS, cumulativeLockedFields, team)
  }

  return result
}

export interface BrandAssetRef {
  scope: ScopeLevelName
  departmentId?: string
  teamId?: string
}

// Spiegelt grantCoversScope (Kanaele, Paket 012) fuer Branding-Assets: waehlbar in Scope S sind
// genau die Assets auf S selbst oder einer uebergeordneten Ebene -- das Vereinslogo ueberall,
// ein Abteilungslogo in der Abteilung und ihren Mannschaften, ein Mannschaftslogo nur dort selbst.
export function isBrandAssetSelectable(asset: BrandAssetRef, targetScope: ScopeLevelName, targetDepartmentId?: string, targetTeamId?: string): boolean {
  if (asset.scope === 'organization') return true
  if (asset.scope === 'department') return asset.departmentId === targetDepartmentId
  return targetScope === 'team' && asset.teamId === targetTeamId
}
