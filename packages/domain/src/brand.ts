import type { ScopeLevelName } from './index.js'

// Ersetzung, nicht Verschaerfung (Plan 013, "Datenmodell"): anders als bei den Richtlinien aus
// Paket 011 ist eine Abteilungsfarbe nicht "strenger" als die Vereinsfarbe. Die Erlaubnis, ueberhaupt
// abzuweichen, vererbt sich trotzdem nur nach unten -- was der Verein sperrt, kann die Abteilung
// nicht fuer ihre Mannschaften oeffnen.
const OVERRIDABLE_FIELDS = [
  'primaryColor',
  'accentColor',
  'backgroundColor',
  'textColor',
  'onPrimaryColor',
  'tone',
  'displayFontKey',
  'displayFontAssetId',
  'bodyFontKey',
  'bodyFontAssetId',
  'logoAssetId',
] as const

export interface BrandLevelProfile {
  primaryColor?: string | null
  accentColor?: string | null
  backgroundColor?: string | null
  textColor?: string | null
  onPrimaryColor?: string | null
  tone?: string | null
  displayFontKey?: string | null
  displayFontAssetId?: string | null
  bodyFontKey?: string | null
  bodyFontAssetId?: string | null
  logoAssetId?: string | null
}

export interface OrganizationBrandLevel extends BrandLevelProfile {
  allowDepartmentOverrides: boolean
  lockedFields: readonly string[]
}

export interface DepartmentBrandLevel extends BrandLevelProfile {
  allowTeamOverrides: boolean
  lockedFields: readonly string[]
}

// Farben und Tonalitaet sind nach der Aufloesung immer gefuellt (DEFAULT_RESOLVED_BRAND traegt
// einen Wert fuer jedes Feld); nur die Schrift-/Logo-Referenzen bleiben optional, weil "kein
// Asset gesetzt" ein gueltiger Endzustand ist (kuratierter Schluessel bzw. kein eigenes Logo).
export interface ResolvedBrand {
  primaryColor: string
  accentColor: string
  backgroundColor: string
  textColor: string
  onPrimaryColor: string
  tone: string
  displayFontKey: string | null
  displayFontAssetId: string | null
  bodyFontKey: string | null
  bodyFontAssetId: string | null
  logoAssetId: string | null
}

function applyOverride(base: ResolvedBrand, lockedFields: ReadonlySet<string>, override: BrandLevelProfile): ResolvedBrand {
  const next = { ...base }
  for (const field of OVERRIDABLE_FIELDS) {
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
  tone: 'nahbar',
  displayFontKey: 'manrope',
  displayFontAssetId: null,
  bodyFontKey: 'dm_sans',
  bodyFontAssetId: null,
  logoAssetId: null,
}

export function resolveBrand(
  organization: OrganizationBrandLevel,
  department?: DepartmentBrandLevel | null,
  team?: BrandLevelProfile | null,
): ResolvedBrand {
  let result = applyOverride(DEFAULT_RESOLVED_BRAND, new Set(), organization)

  // Laeuft nur nach unten fort: eine Sperre des Vereins gilt fuer die Mannschaft auch dann, wenn
  // die Abteilung selbst dasselbe Feld nicht sperrt (sie hat ohnehin nie die Erlaubnis erhalten,
  // es zu setzen).
  const cumulativeLockedFields = new Set(organization.lockedFields)

  if (department && organization.allowDepartmentOverrides) {
    result = applyOverride(result, cumulativeLockedFields, department)
  }
  if (department) {
    for (const field of department.lockedFields) cumulativeLockedFields.add(field)
  }
  if (team && department?.allowTeamOverrides) {
    result = applyOverride(result, cumulativeLockedFields, team)
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
