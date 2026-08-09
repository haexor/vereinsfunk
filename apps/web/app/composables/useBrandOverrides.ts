import type { BrandLevelOverride } from './useBrandAssets'

function emptyOverride(): BrandLevelOverride {
  return {
    primaryColor: null,
    accentColor: null,
    tone: null,
    logoAssetId: null,
    displayFontAssetId: null,
    bodyFontAssetId: null,
    displayFontKey: null,
    bodyFontKey: null,
  }
}

function newDepartmentOverride(): BrandLevelOverride {
  return { ...emptyOverride(), allowTeamOverrides: true, lockedFields: [] }
}

export function useBrandOverrides() {
  const departmentOverrides = ref<Record<string, BrandLevelOverride>>({})
  const teamOverrides = ref<Record<string, BrandLevelOverride>>({})

  // Computeds dürfen ihre Abhängigkeiten nicht verändern: Der frühere Schreibzugriff aus einer
  // Berechnung erzeugte bei /marke unterschiedliche SSR- und Client-Zustände.
  function readOverride(departmentId: string): BrandLevelOverride {
    return departmentOverrides.value[departmentId] ?? newDepartmentOverride()
  }
  function readTeamOverride(teamId: string): BrandLevelOverride {
    return teamOverrides.value[teamId] ?? emptyOverride()
  }

  // Leere Profile entstehen ausschließlich in Event-Handlern oder nach einem erfolgreichen Load.
  function overrideFor(departmentId: string): BrandLevelOverride {
    if (!departmentOverrides.value[departmentId]) departmentOverrides.value[departmentId] = newDepartmentOverride()
    return departmentOverrides.value[departmentId]!
  }
  function teamOverrideFor(teamId: string): BrandLevelOverride {
    if (!teamOverrides.value[teamId]) teamOverrides.value[teamId] = emptyOverride()
    return teamOverrides.value[teamId]!
  }

  return { departmentOverrides, teamOverrides, readOverride, readTeamOverride, overrideFor, teamOverrideFor }
}
