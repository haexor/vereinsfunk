import { isBrandAssetSelectable, type ScopeLevelName } from '@vereinsfunk/domain'
import type { ImageStylePreset } from '@vereinsfunk/contracts'

// Plan 045, PR 1: welche Presets eine Ebene waehlen kann -- dieselbe Vererbungsrichtung wie
// brand_assets (isBrandAssetSelectable): vereinsweite Presets ueberall, ein Abteilungs-Preset in
// der Abteilung und ihren Mannschaften, ein Mannschafts-Preset nur dort selbst. Eine Abteilung
// ohne eigenes Preset sieht deshalb weiterhin die vereinsweiten -- "erbt", bis sie eigene anlegt.
export function selectableImageStylePresets(
  presets: readonly ImageStylePreset[],
  targetScope: ScopeLevelName,
  targetDepartmentId?: string,
  targetTeamId?: string,
): ImageStylePreset[] {
  return presets.filter((preset) =>
    isBrandAssetSelectable(
      { scope: preset.teamId ? 'team' : preset.departmentId ? 'department' : 'organization', departmentId: preset.departmentId ?? undefined, teamId: preset.teamId ?? undefined },
      targetScope,
      targetDepartmentId,
      targetTeamId,
    ),
  )
}
