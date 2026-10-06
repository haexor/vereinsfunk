import { mergeAllowedList } from './effectiveConfig.js'
import type { ScopeLevelName } from './reviewRoute.js'

// Paket 051: fachliche Module unter dem Rahmen. Gespiegelt im SQL-Enum public.app_module
// (Migration 2026100602_app_modules.sql), in packages/contracts (AppModuleSchema) und in
// packages/authorization (permissionModule) -- alle vier muessen bei einem neuen Modul gemeinsam
// angepasst werden, wie die Permission-Listen zwischen TS und SQL.
export const appModules = ['social_media', 'playerboard'] as const
export type AppModule = (typeof appModules)[number]

// Wo ein Modul abgeschaltet wurde: im Tarif oder auf einer Ebene der Hierarchie.
export type ModuleBlockSource = 'plan' | ScopeLevelName

export interface ModuleLayers {
  // null = kein Abo hinterlegt, der Tarif schraenkt nichts ein (wie effective_limits, Paket 021).
  planModules: readonly AppModule[] | null
  // Je Ebene: null/undefined = erben, [] = kein Modul.
  organization?: readonly AppModule[] | null
  department?: readonly AppModule[] | null
  team?: readonly AppModule[] | null
}

export interface ResolvedModules {
  enabled: readonly AppModule[]
  // Fuer jedes nicht wirksame Modul die aeusserste Stelle, die es ausschliesst. Die Oberflaeche
  // zeigt daran "gesperrt" (oben aus) im Unterschied zu "abgewaehlt" (auf dieser Ebene aus).
  blockedBy: Readonly<Partial<Record<AppModule, ModuleBlockSource>>>
}

/**
 * Wirksame Module einer Ebene = Tarif ∩ Verein ∩ Abteilung ∩ Mannschaft. Eine untere Ebene kann
 * ein Modul nur abwaehlen, nie eines hinzunehmen -- dieselbe Regel wie allowedChannelIds
 * (mergeAllowedList, Paket 011). TS-Gegenstueck zu authz.module_enabled().
 */
export function resolveEnabledModules(layers: ModuleLayers): ResolvedModules {
  const steps: readonly [ModuleBlockSource, readonly AppModule[] | null | undefined][] = [
    ['plan', layers.planModules],
    ['organization', layers.organization],
    ['department', layers.department],
    ['team', layers.team],
  ]
  // Startet mit allen Modulen, deshalb liefert mergeAllowedList nie null zurueck.
  let current: readonly AppModule[] = appModules
  const blockedBy: Partial<Record<AppModule, ModuleBlockSource>> = {}
  for (const [source, list] of steps) {
    const next = mergeAllowedList(current, list) ?? current
    // Ein bereits ausgeschlossenes Modul steht in current nicht mehr -- es behaelt so die
    // aeusserste Quelle.
    for (const module of current) if (!next.includes(module)) blockedBy[module] = source
    current = next
  }
  return { enabled: appModules.filter((module) => current.includes(module)), blockedBy }
}

export function isModuleEnabled(layers: ModuleLayers, module: AppModule): boolean {
  return resolveEnabledModules(layers).enabled.includes(module)
}
