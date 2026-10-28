import { CalendarDays, LayoutDashboard } from '@lucide/vue'
import type { Component, Ref } from 'vue'
import { frameworkNavigation, visibleFrameworkNavigation } from '../modules/frameworkNavigation'
import { appModuleOrder, appModuleRegistry, moduleForPath, type ModuleNavItem } from '../modules/registry'
import type { ActiveScope } from './useScope'

export interface ShellNavItem {
  label: string
  to: string
  icon: Component
  badge?: number
}

type ScopeModules = Awaited<ReturnType<typeof useScopeModules>>

// Paket 051, PR 3: die Shell besteht aus Rahmen-Eintraegen (immer sichtbar) und den Eintraegen der
// im Arbeitsbereich wirksamen Module, gruppiert nach Modul (modules/registry.ts). Solange die
// Modulauswahl unbekannt ist (enabled = null: laedt noch oder Ladefehler), zeigt sie alle Module --
// die API setzt die Auswahl ohnehin selbst durch.
const navigation: readonly ShellNavItem[] = [
  { label: 'Übersicht', to: '/', icon: LayoutDashboard },
  { label: 'Kalender', to: '/kalender', icon: CalendarDays },
]
const organizationOnlyRoutes = new Set(frameworkNavigation.filter((item) => item.organizationOnly).map((item) => item.to))

export function useShellNavigation(scope: Ref<ActiveScope | null>, modules: ScopeModules) {
  const route = useRoute()
  const { enabled: enabledModules, isEnabled: isModuleEnabled, canUse, ensureLoaded } = modules

  // Modul- und Verwaltungslinks erscheinen nur mit einem der fuer die konkrete Seite noetigen
  // Rechte; Gruppen ohne sichtbaren Eintrag entfallen ganz.
  const navItemVisible = (item: ModuleNavItem) => item.permissions.some((permission) => canUse(permission))
  const moduleGroups = computed(() =>
    appModuleOrder
      .filter((module) => isModuleEnabled(module))
      .map((module) => ({
        ...appModuleRegistry[module],
        navigation: appModuleRegistry[module].navigation.filter(navItemVisible),
      }))
      .filter((group) => group.navigation.length > 0),
  )
  // Paket 056: "Verein verwalten" nur mit den Rechten, die die jeweilige Seite braucht
  // (modules/frameworkNavigation.ts); ohne einen Eintrag entfaellt die Ueberschrift.
  const organizationNavigation = computed(() => visibleFrameworkNavigation(frameworkNavigation, {
    inDepartment: Boolean(scope.value?.departmentId),
    canUse,
    isModuleVisible: isModuleEnabled,
  }))
  const moduleManagementGroups = computed(() =>
    appModuleOrder
      .filter((module) => isModuleEnabled(module))
      .map((module) => ({
        ...appModuleRegistry[module],
        managementNavigation: appModuleRegistry[module].managementNavigation.filter(navItemVisible),
      }))
      .filter((group) => group.managementNavigation.length > 0),
  )

  // Wechsel des Vereins laedt dessen Modulauswahl neu. Wird ein Bereich gewaehlt, in dem das Modul
  // der offenen Seite aus ist, fuehrt das auf die Erklaerseite -- wie ein Direktaufruf
  // (middleware/module.global.ts); umgekehrt fuehrt die Erklaerseite selbst zurueck, sobald es wirkt.
  watch(
    () => scope.value?.organizationId,
    (organizationId, previous) => {
      if (organizationId && previous && organizationId !== previous) void ensureLoaded()
    },
  )
  watch(
    () => [enabledModules.value, route.path] as const,
    ([, path]) => {
      const module = moduleForPath(path)
      if (module && !isModuleEnabled(module))
        void navigateTo({ path: '/modul-inaktiv', query: { modul: module, von: route.fullPath } })
    },
  )

  // Vereinsweite Vertrags- und Datenschutzthemen dürfen nicht im Arbeitsbereich einer
  // Abteilung offen bleiben, auch nicht über einen alten Tab oder einen Direktlink.
  watch(
    () => [scope.value?.departmentId, route.path] as const,
    ([departmentId, path]) => {
      if (departmentId && organizationOnlyRoutes.has(path)) void navigateTo('/')
    },
    { immediate: true },
  )

  return { navigation, moduleGroups, organizationNavigation, moduleManagementGroups }
}
