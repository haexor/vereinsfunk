export interface ActiveScope {
  organizationId: string
  departmentId: string | null
}

export function findValidScope(scopes: readonly { organizationId: string; departments: readonly { id: string }[] }[], candidate: ActiveScope | null): ActiveScope | null {
  if (!candidate) return null
  const organization = scopes.find((item) => item.organizationId === candidate.organizationId)
  if (!organization) return null
  if (candidate.departmentId && !organization.departments.some((department) => department.id === candidate.departmentId)) return null
  return candidate
}

export function defaultScope(scopes: readonly { organizationId: string }[]): ActiveScope | null {
  const firstScope = scopes[0]
  return firstScope ? { organizationId: firstScope.organizationId, departmentId: null } : null
}

// Aktive Verein-/Abteilungsauswahl. Wird bei jedem Laden gegen useSession() validiert;
// eine gespeicherte Abteilung ohne Mitgliedschaft wird verworfen, nicht angezeigt.
export async function useScope() {
  // useState/useCookie muessen vor dem await stehen, sonst verlaesst der Aufruf das
  // synchrone Nuxt-Instance-Fenster und schlaegt serverseitig fehl (NUXT_E1001).
  const active = useState<ActiveScope | null>('vf-scope', () => null)
  const remembered = useCookie<ActiveScope | null>('vf-scope-cookie', { default: () => null })
  const cookieSyncRegistered = useState<boolean>('vf-scope-cookie-sync-registered', () => false)
  const session = await useSession()
  const scopes = session.value?.scopes ?? []

  const valid = findValidScope(scopes, active.value) ?? findValidScope(scopes, remembered.value)
  if (valid) {
    active.value = valid
  } else {
    // Verein und Abteilung sind gleichwertige fachliche Kontexte. Der Verein darf deshalb beim
    // ersten Öffnen nicht stillschweigend auf seine erste Abteilung umgebogen werden.
    active.value = defaultScope(scopes)
  }
  // useSession() is always empty on the server, so a server-side write here would
  // overwrite the real, previously remembered cookie with null on every SSR pass.
  if (import.meta.client) {
    remembered.value = active.value
    // Das Layout wechselt den Kontext ohne einen erneuten useScope()-Aufruf. Genau ein globaler
    // Watcher hält deshalb die Auswahl für den nächsten Besuch fest, ohne pro Seite weitere
    // Watcher auf denselben State zu registrieren.
    if (!cookieSyncRegistered.value) {
      cookieSyncRegistered.value = true
      watch(active, (value) => { remembered.value = value }, { deep: true })
    }
  }

  return active
}
