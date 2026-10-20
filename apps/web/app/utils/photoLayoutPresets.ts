import { isBrandAssetSelectable, type ScopeLevelName } from '@vereinsfunk/domain'
import type { PhotoLayoutPreset } from '@vereinsfunk/contracts'

// Spiegelt selectableImageStylePresets (dieselbe Vererbungsrichtung wie brand_assets): vereinsweite
// Presets ueberall, ein Abteilungs-Preset in der Abteilung und ihren Mannschaften, ein
// Mannschafts-Preset nur dort selbst.
export function selectablePhotoLayoutPresets(
  presets: readonly PhotoLayoutPreset[],
  targetScope: ScopeLevelName,
  targetDepartmentId?: string,
  targetTeamId?: string,
): PhotoLayoutPreset[] {
  return presets.filter((preset) =>
    isBrandAssetSelectable(
      { scope: preset.teamId ? 'team' : preset.departmentId ? 'department' : 'organization', departmentId: preset.departmentId ?? undefined, teamId: preset.teamId ?? undefined },
      targetScope,
      targetDepartmentId,
      targetTeamId,
    ),
  )
}

// dividerColor ist eine Rolle ('primary'/'accent') oder ein fester Hexwert; die Rollen folgen den
// Vereinsfarben, damit ein Preset einen spaeteren Farbwechsel mitmacht.
export function resolveDividerColor(dividerColor: string, colors: { primaryColor: string; accentColor: string }): string {
  if (dividerColor === 'primary') return colors.primaryColor
  if (dividerColor === 'accent') return colors.accentColor
  return dividerColor
}
