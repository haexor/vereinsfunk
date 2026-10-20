import { isBrandAssetSelectable, type ScopeLevelName } from '@vereinsfunk/domain'

/**
 * Was eine Ebene waehlen kann -- dieselbe Vererbungsrichtung wie brand_assets
 * (isBrandAssetSelectable), fuer alles, was ueber departmentId/teamId einer Ebene gehoert
 * (Marken-Assets, Bildstil- und Bildkompositions-Presets, Stilprofile): vereinsweite Eintraege
 * ueberall, ein Abteilungs-Eintrag in der Abteilung und ihren Mannschaften, ein Mannschafts-Eintrag
 * nur dort selbst. Eine Ebene ohne eigenen Eintrag "erbt" so, bis sie einen eigenen anlegt.
 */
export function selectableAtLevel<T extends { departmentId?: string | null; teamId?: string | null }>(
  items: readonly T[],
  targetScope: ScopeLevelName,
  targetDepartmentId?: string,
  targetTeamId?: string,
): T[] {
  return items.filter((item) =>
    isBrandAssetSelectable(
      { scope: item.teamId ? 'team' : item.departmentId ? 'department' : 'organization', departmentId: item.departmentId ?? undefined, teamId: item.teamId ?? undefined },
      targetScope,
      targetDepartmentId,
      targetTeamId,
    ),
  )
}
