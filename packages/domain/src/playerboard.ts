import type { ScopeLevelName } from './reviewRoute.js'

// Paket 052: TS-Spiegel der PlayerBoard-Regeln aus 2026100802_playerboard_core.sql. Die Datenbank
// setzt sie durch (authz.resolve_playerboard_setting, authz.playerboard_effective_categories,
// authz.playerboard_ranking_rows); hier entstehen daraus die Zustaende der Oberflaeche
// (geerbt / eigener Wert / gesperrt) ohne zusaetzliche Abfragen je Ebene.

export type PlayerboardStatsVisibility = 'team' | 'department' | 'organization'
export type PlayerboardReplaceableField = 'season_start' | 'stats_visibility'

export interface PlayerboardSettingsLevel {
  seasonStart: string | null
  statsVisibility: PlayerboardStatsVisibility | null
  overridableFields: readonly PlayerboardReplaceableField[]
  teamCategoriesAllowed: boolean | null
  publicSharingAllowed: boolean | null
}

export interface PlayerboardSettingsPath {
  organization?: PlayerboardSettingsLevel | null
  department?: PlayerboardSettingsLevel | null
  team?: PlayerboardSettingsLevel | null
}

export interface ResolvedPlayerboardSettings {
  seasonStart: string | null
  statsVisibility: PlayerboardStatsVisibility
  teamCategoriesAllowed: boolean
  publicSharingAllowed: boolean
  // true = ein Wert oberhalb der Zielebene bindet; ein eigener Wert hier waere wirkungslos.
  locked: { seasonStart: boolean; statsVisibility: boolean }
}

const levelOrder: readonly ScopeLevelName[] = ['organization', 'department', 'team']

function resolveReplaceable<T>(
  path: PlayerboardSettingsPath,
  target: ScopeLevelName,
  field: PlayerboardReplaceableField,
  read: (level: PlayerboardSettingsLevel) => T | null,
): { value: T | null; lockedAtTarget: boolean } {
  let current: T | null = null
  let open = true
  let lockedAtTarget = false
  for (const levelName of levelOrder.slice(0, levelOrder.indexOf(target) + 1)) {
    if (levelName === target) lockedAtTarget = !open
    const level = path[levelName]
    if (!level) {
      // Ohne eigene Zeile gibt eine Ebene nichts frei: ein gesetzter Wert bleibt bindend.
      if (current !== null) open = false
      continue
    }
    const own = read(level)
    if (open && own !== null) current = own
    open = current === null || (open && level.overridableFields.includes(field))
  }
  return { value: current, lockedAtTarget }
}

/**
 * Wirksame Einstellungen einer Ebene. Ersetzbare Felder (season_start, stats_visibility) binden
 * alles darunter, bis die Ebene sie ueber overridableFields freigibt; eine Freigabe reicht nur
 * eine Ebene tief. team_categories_allowed und public_sharing_allowed lassen sich nur
 * verschaerfen (false irgendwo auf dem Pfad gewinnt).
 */
export function resolvePlayerboardSettings(path: PlayerboardSettingsPath, target: ScopeLevelName): ResolvedPlayerboardSettings {
  const levels = levelOrder.slice(0, levelOrder.indexOf(target) + 1).map((name) => path[name]).filter((level): level is PlayerboardSettingsLevel => !!level)
  const seasonStart = resolveReplaceable(path, target, 'season_start', (level) => level.seasonStart)
  const statsVisibility = resolveReplaceable(path, target, 'stats_visibility', (level) => level.statsVisibility)
  return {
    seasonStart: seasonStart.value,
    statsVisibility: statsVisibility.value ?? 'team',
    teamCategoriesAllowed: !levels.some((level) => level.teamCategoriesAllowed === false),
    publicSharingAllowed: !levels.some((level) => level.publicSharingAllowed === false),
    locked: { seasonStart: seasonStart.lockedAtTarget, statsVisibility: statsVisibility.lockedAtTarget },
  }
}

export interface PlayerboardCategoryLike {
  scope: ScopeLevelName
  departmentId: string | null
  teamId: string | null
  active: boolean
}

/** Kategorie wirkt fuer die Mannschaft: aktiv, auf ihrem Pfad und bei Mannschaftskategorien erlaubt. */
export function isPlayerboardCategoryEffective(
  category: PlayerboardCategoryLike,
  team: { departmentId: string; teamId: string },
  teamCategoriesAllowed: boolean,
): boolean {
  if (!category.active) return false
  if (category.scope === 'organization') return true
  if (category.scope === 'department') return category.departmentId === team.departmentId
  return teamCategoriesAllowed && category.teamId === team.teamId
}

/** Geteilte Raenge nach Summe (1, 2, 2, 4), in der Reihenfolge der Eingabe gemeldet. */
export function competitionRanks(totals: readonly number[]): number[] {
  return totals.map((total) => totals.filter((other) => other > total).length + 1)
}

/** Saisonbeginn als Zeitraumanfang: letzter Saisonstart (Monat/Tag) am oder vor `today`. */
export function currentSeasonStart(seasonStart: string | null, today: string): string | null {
  if (!seasonStart) return null
  const month = Number(seasonStart.slice(5, 7))
  const day = Number(seasonStart.slice(8, 10))
  const dateOnYear = (year: number) => {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
  }
  const year = Number(today.slice(0, 4))
  const candidate = dateOnYear(year)
  return candidate <= today ? candidate : dateOnYear(year - 1)
}
