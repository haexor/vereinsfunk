import { z } from 'zod'

// Sowohl Nuxt-State als auch das Cookie koennen aus einem frueheren Client-Build oder einer
// manipulierten Browser-Nutzlast stammen. Beide werden vor der Membership-Pruefung strikt
// validiert, damit sie keine unvollstaendigen Scope-Objekte in die App tragen.
export const ActiveScopeSchema = z.object({
  organizationId: z.string().min(1),
  departmentId: z.string().min(1).nullable(),
}).strict()

export type ActiveScope = z.infer<typeof ActiveScopeSchema>

export function parseActiveScope(candidate: unknown): ActiveScope | null {
  const parsed = ActiveScopeSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
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
  const session = await useSession()
  const scopes = session.value?.scopes ?? []

  const valid = findValidScope(scopes, parseActiveScope(active.value)) ?? findValidScope(scopes, parseActiveScope(remembered.value))
  if (valid) {
    active.value = valid
  } else {
    // Verein und Abteilung sind gleichwertige fachliche Kontexte. Der Verein darf deshalb beim
    // ersten Öffnen nicht stillschweigend auf seine erste Abteilung umgebogen werden.
    active.value = defaultScope(scopes)
  }
  // Das Cookie-Schreiben uebernimmt app/plugins/scope-cookie-sync.client.ts - dort laeuft es
  // clientseitig genau einmal pro App-Instanz, statt hier bei jedem useScope()-Aufruf erneut.

  return active
}
