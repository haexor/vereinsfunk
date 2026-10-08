import { BarChart3, Bot, CheckCircle2, ClipboardList, Feather, FileSignature, FileText, Frame, LayoutGrid, Medal, Megaphone, Share2, SlidersHorizontal, Tags, Trophy, Users } from '@lucide/vue'
import type { AppModule, ModuleBlockSource, ScopeLevel, ScopeModules } from '@vereinsfunk/contracts'
import type { Component } from 'vue'

// Paket 051, PR 3: die Oberflaeche als Rahmen. Jedes Modul bringt seine Navigation und seine
// Routen mit; die Shell zeigt nur, was im aktiven Arbeitsbereich wirksam ist. Gespiegelt zu
// public.app_module / AppModuleSchema -- registry.test.ts haelt beide deckungsgleich.
//
// Die URLs des Social-Media-Moduls bleiben bewusst ohne Praefix (/beitraege, /freigaben, ...),
// damit keine Lesezeichen sterben. Neue Module bekommen ein eigenes Praefix (/playerboard/...).

export interface ModuleNavItem {
  label: string
  to: string
  icon: Component
}

export interface AppModuleDefinition {
  key: AppModule
  label: string
  icon: Component
  // Arbeitsseiten, als eigene Gruppe unter dem Modulnamen.
  navigation: readonly ModuleNavItem[]
  // Einstellungen des Moduls, unter "Verein verwalten".
  managementNavigation: readonly ModuleNavItem[]
  // Weitere Routen ohne Navigationseintrag (z. B. /erstellen).
  extraRoutes: readonly string[]
}

export const appModuleRegistry: Readonly<Record<AppModule, AppModuleDefinition>> = {
  social_media: {
    key: 'social_media',
    label: 'Social Media',
    icon: Megaphone,
    navigation: [
      { label: 'Assistent', to: '/assistent', icon: Bot },
      { label: 'Beiträge', to: '/beitraege', icon: FileText },
      { label: 'Freigaben', to: '/freigaben', icon: CheckCircle2 },
      { label: 'Auswertung', to: '/auswertung', icon: BarChart3 },
    ],
    managementNavigation: [
      { label: 'Kanäle', to: '/kanaele', icon: Share2 },
      { label: 'Bildstil', to: '/bildstil', icon: Frame },
      { label: 'Bildkomposition', to: '/bildkomposition', icon: LayoutGrid },
      { label: 'Stilprofile', to: '/stilprofile', icon: Feather },
      { label: 'Textbausteine', to: '/textbausteine', icon: FileSignature },
    ],
    extraRoutes: ['/erstellen'],
  },
  playerboard: {
    key: 'playerboard',
    label: 'PlayerBoard',
    icon: Trophy,
    // Paket 052: Uebersicht und Rangliste fuer alle (PR 4), Trainings und Kader fuer Trainer (PR 3).
    navigation: [
      { label: 'Übersicht', to: '/playerboard', icon: Trophy },
      { label: 'Rangliste', to: '/playerboard/rangliste', icon: Medal },
      { label: 'Trainings', to: '/playerboard/trainings', icon: ClipboardList },
      { label: 'Kader', to: '/playerboard/kader', icon: Users },
    ],
    managementNavigation: [
      { label: 'Kategorien', to: '/playerboard/kategorien', icon: Tags },
      { label: 'Einstellungen', to: '/playerboard/einstellungen', icon: SlidersHorizontal },
    ],
    extraRoutes: [],
  },
}

export const appModuleOrder: readonly AppModule[] = ['social_media', 'playerboard']

function routesOf(definition: AppModuleDefinition): string[] {
  return [...definition.navigation, ...definition.managementNavigation].map((item) => item.to).concat(definition.extraRoutes)
}

// Zu welchem Modul gehoert ein Pfad? Exakter Treffer oder Unterpfad (/playerboard/...), nie ein
// blosses Praefix -- /beitraege-archiv gehoerte sonst zu /beitraege.
export function moduleForPath(path: string): AppModule | null {
  for (const module of appModuleOrder) {
    if (routesOf(appModuleRegistry[module]).some((route) => path === route || path.startsWith(`${route}/`))) return module
  }
  return null
}

// Der Eintrag der Modulliste fuer den aktiven Arbeitsbereich (Verein oder Abteilung).
export function scopeModulesFor(entries: readonly ScopeModules[], scope: { organizationId: string; departmentId: string | null }): ScopeModules | null {
  if (scope.departmentId) return entries.find((entry) => entry.scope === 'department' && entry.scopeId === scope.departmentId) ?? null
  return entries.find((entry) => entry.scope === 'organization' && entry.scopeId === scope.organizationId) ?? null
}

export function enabledModulesOf(entry: ScopeModules | null): AppModule[] {
  return entry ? entry.modules.filter((state) => state.enabled).map((state) => state.module) : []
}

// --- Einstellungsseite "Module" ---------------------------------------------------------------

// Die drei Zustaende aus PolicyFlagToggles.vue, auf Module uebertragen:
//   * aktiv/geerbt: wirksam, die Ebene hat keine eigene Auswahl (own = null);
//   * aktiv/gewaehlt: wirksam und in der eigenen Auswahl;
//   * abgewaehlt: auf DIESER Ebene abgewaehlt -- hier wieder einschaltbar;
//   * gesperrt: oben aus (Tarif oder hoehere Ebene) -- hier nicht einschaltbar.
export type ModuleToggleState = 'inherited' | 'selected' | 'deselected' | 'locked'

const levelRank: Record<ModuleBlockSource, number> = { plan: 0, organization: 1, department: 2, team: 3 }

export function moduleToggleState(entry: ScopeModules, module: AppModule): ModuleToggleState {
  const state = entry.modules.find((item) => item.module === module)
  if (!state) return 'locked'
  if (state.enabled) return entry.own === null ? 'inherited' : 'selected'
  // Ausgeschlossen auf einer Ebene oberhalb (oder im Tarif) -> gesperrt; auf dieser Ebene -> abgewaehlt.
  return state.blockedBy !== null && levelRank[state.blockedBy] < levelRank[entry.scope] ? 'locked' : 'deselected'
}

// Die neue eigene Auswahl, wenn ein Modul auf dieser Ebene ein- oder ausgeschaltet wird. Aus
// "erben" wird beim ersten Abwaehlen eine explizite Liste der Module, die oben aktiv sind.
export function nextModuleSelection(entry: ScopeModules, module: AppModule, enable: boolean): AppModule[] {
  const availableAbove = entry.modules
    .filter((state) => state.enabled || (state.blockedBy !== null && levelRank[state.blockedBy] >= levelRank[entry.scope]))
    .map((state) => state.module)
  const base = entry.own ?? availableAbove
  const next = enable ? [...new Set([...base, module])] : base.filter((item) => item !== module)
  return appModuleOrder.filter((item) => next.includes(item))
}

export function blockedByLabel(source: ModuleBlockSource | null, scope: ScopeLevel): string {
  switch (source) {
    case 'plan': return 'nicht im Tarif enthalten'
    case 'organization': return scope === 'organization' ? 'für den Verein abgewählt' : 'vom Verein abgeschaltet'
    case 'department': return scope === 'department' ? 'für diese Abteilung abgewählt' : 'von der Abteilung abgeschaltet'
    case 'team': return 'für diese Mannschaft abgewählt'
    default: return ''
  }
}

// Wer eine Sperre aufheben kann -- fuer die Erklaerseite einer inaktiven Modulroute.
export function responsibleForBlock(source: ModuleBlockSource | null): string {
  switch (source) {
    case 'plan': return 'die Vereinsverwaltung über den Tarif'
    case 'organization': return 'die Vereinsverwaltung'
    case 'department': return 'die Abteilungsleitung'
    case 'team': return 'die Mannschaftsleitung'
    default: return 'die Vereinsverwaltung'
  }
}
