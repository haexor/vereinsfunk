export interface ActiveScope {
  organizationId: string
  departmentId: string | null
}

function findValidScope(scopes: readonly { organizationId: string; departments: readonly { id: string }[] }[], candidate: ActiveScope | null): ActiveScope | null {
  if (!candidate) return null
  const organization = scopes.find((item) => item.organizationId === candidate.organizationId)
  if (!organization) return null
  if (candidate.departmentId && !organization.departments.some((department) => department.id === candidate.departmentId)) return null
  return candidate
}

// Aktive Verein-/Abteilungsauswahl. Wird bei jedem Laden gegen useSession() validiert;
// eine gespeicherte Abteilung ohne Mitgliedschaft wird verworfen, nicht angezeigt.
export async function useScope() {
  // useState/useCookie muessen vor dem await stehen, sonst verlaesst der Aufruf das
  // synchrone Nuxt-Instance-Fenster und schlaegt serverseitig fehl (NUXT_E1001).
  const active = useState<ActiveScope | null>('vf-scope', () => null)
  const remembered = useCookie<ActiveScope | null>('vf-scope-cookie', { default: () => null })
  const session = await useSession()
  const scopes = session.value?.scopes ?? []

  const valid = findValidScope(scopes, active.value) ?? findValidScope(scopes, remembered.value)
  if (valid) {
    active.value = valid
  } else {
    const firstScope = scopes[0]
    active.value = firstScope ? { organizationId: firstScope.organizationId, departmentId: firstScope.departments[0]?.id ?? null } : null
  }
  remembered.value = active.value

  return active
}
