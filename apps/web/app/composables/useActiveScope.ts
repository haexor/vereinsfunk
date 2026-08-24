import type { ComputedRef, Ref } from 'vue'
import type { ActiveScope } from './useScope'

// Team bleibt im Typ enthalten, weil die Konfigurationsdaten dieses Level bereits kennen. Die
// aktuelle Sidebar liefert dort noch immer `null`; bei einer späteren Team-Auswahl muss deshalb
// kein Aufrufer umgebaut werden.
export type ActiveScopeLevel = 'organization' | 'department' | 'team'

export interface ActiveScopeContext {
  scope: Ref<ActiveScope | null>
  organizationId: ComputedRef<string | null>
  departmentId: ComputedRef<string | null>
  // Mannschaften sind aktuell kein auswählbarer Arbeitsbereich in der Sidebar. Der Wert ist
  // trotzdem Teil des Kontextes, damit Aufrufer keine eigenen Platzhalter-Refs anlegen und eine
  // spätere Erweiterung nur an dieser zentralen Stelle erfolgt.
  teamId: ComputedRef<string | null>
  level: ComputedRef<ActiveScopeLevel>
}

// Lesemodell des persistierten Arbeitsbereichs. `useScope()` bleibt der einzige schreibbare
// Store; diese Ableitung gibt Seiten und Komponenten eine einheitliche, reaktive API.
export async function useActiveScope(): Promise<ActiveScopeContext> {
  const scope = await useScope()
  const organizationId = computed(() => scope.value?.organizationId ?? null)
  const departmentId = computed(() => scope.value?.departmentId ?? null)
  const teamId = computed<string | null>(() => null)
  const level = computed<ActiveScopeLevel>(() =>
    departmentId.value ? 'department' : 'organization',
  )

  return { scope, organizationId, departmentId, teamId, level }
}
