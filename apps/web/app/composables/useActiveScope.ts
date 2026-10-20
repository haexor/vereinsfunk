import type { ComputedRef, Ref } from 'vue'
import type { ActiveScope } from './useScope'
import type { SessionScope } from './useSession'

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
  // Mitgliedschaft im aktiven Verein (Name, Rollen, Abteilungen) aus der Sitzung.
  organization: ComputedRef<SessionScope | null>
  // Zeitzone des aktiven Vereins fuer Datumsgrenzen (Saison, Kalender); ohne Angabe die des
  // Produkts.
  organizationTimezone: ComputedRef<string>
}

const DEFAULT_ORGANIZATION_TIMEZONE = 'Europe/Berlin'

// Lesemodell des persistierten Arbeitsbereichs. `useScope()` bleibt der einzige schreibbare
// Store; diese Ableitung gibt Seiten und Komponenten eine einheitliche, reaktive API.
export async function useActiveScope(): Promise<ActiveScopeContext> {
  // Beide Aufrufe vor dem ersten await -- danach fehlt der Nuxt-Kontext (NUXT_E1001, siehe useScope()).
  const sessionPromise = useSession()
  const scopePromise = useScope()
  const [session, scope] = await Promise.all([sessionPromise, scopePromise])
  const organizationId = computed(() => scope.value?.organizationId ?? null)
  const departmentId = computed(() => scope.value?.departmentId ?? null)
  const teamId = computed<string | null>(() => null)
  const level = computed<ActiveScopeLevel>(() =>
    departmentId.value ? 'department' : 'organization',
  )

  const organization = computed(() =>
    session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)
  const organizationTimezone = computed(() =>
    organization.value?.organizationTimezone ?? DEFAULT_ORGANIZATION_TIMEZONE)

  return { scope, organizationId, departmentId, teamId, level, organization, organizationTimezone }
}
