import type { ScopeLevel } from '@vereinsfunk/contracts'
import { resolveTeamSelection, teamsInScope, type PlayerboardTeamOption } from '../utils/playerboardTeams'

export interface PlayerboardLevel {
  scope: ScopeLevel
  scopeId: string
  label: string
  name: string
  permissionScope: { organizationId: string; departmentId?: string; teamId?: string }
}

// Paket 052, PR 3: die Mannschaft, an der die PlayerBoard-Seiten arbeiten. Abgeleitet aus dem
// aktiven Arbeitsbereich (Verein oder Abteilung) und einer gemerkten Wahl -- app-weit geteilt,
// damit Kader, Trainings, Kategorien und Einstellungen dieselbe Mannschaft zeigen.
export async function usePlayerboardTeam() {
  // Nuxt-Zustand vor dem ersten await (NUXT_E1001, siehe useScope()).
  const selected = useState<string | null>('vf-playerboard-team', () => null)
  const remembered = useCookie<string | null>('vf-playerboard-team', { default: () => null, sameSite: 'lax' })
  const session = await useSession()
  const scope = await useScope()

  const teams = computed<PlayerboardTeamOption[]>(() => teamsInScope(session.value?.scopes ?? [], scope.value))
  const teamId = computed<string | null>({
    get: () => resolveTeamSelection(teams.value, selected.value, remembered.value),
    set: (value) => {
      selected.value = value
      remembered.value = value
    },
  })
  const team = computed(() => teams.value.find((item) => item.id === teamId.value) ?? null)
  const organizationId = computed(() => scope.value?.organizationId ?? null)
  const organizationTimezone = computed(() =>
    session.value?.scopes.find((item) => item.organizationId === organizationId.value)?.organizationTimezone ?? 'Europe/Berlin')
  // Rechte auf der gewaehlten Mannschaft -- Komfort, durchgesetzt wird in API und RLS.
  const permissionScope = computed(() =>
    team.value && organizationId.value ? { organizationId: organizationId.value, departmentId: team.value.departmentId, teamId: team.value.id } : null)
  const canManage = computed(() => (permissionScope.value ? useCan('training.manage', permissionScope.value) : false))

  // Ebenen fuer Kategorien und Einstellungen: Verein, Abteilung (aktive oder die der Mannschaft),
  // gewaehlte Mannschaft.
  const levels = computed<PlayerboardLevel[]>(() => {
    const organization = session.value?.scopes.find((item) => item.organizationId === organizationId.value)
    if (!organization) return []
    const result: PlayerboardLevel[] = [{
      scope: 'organization', scopeId: organization.organizationId, label: 'Verein', name: organization.organizationName,
      permissionScope: { organizationId: organization.organizationId },
    }]
    const departmentId = scope.value?.departmentId ?? team.value?.departmentId ?? null
    const department = organization.departments.find((item) => item.id === departmentId)
    if (department) {
      result.push({
        scope: 'department', scopeId: department.id, label: 'Abteilung', name: department.name,
        permissionScope: { organizationId: organization.organizationId, departmentId: department.id },
      })
    }
    if (team.value) {
      result.push({
        scope: 'team', scopeId: team.value.id, label: 'Mannschaft', name: team.value.name,
        permissionScope: { organizationId: organization.organizationId, departmentId: team.value.departmentId, teamId: team.value.id },
      })
    }
    return result
  })

  return { teams, teamId, team, organizationId, organizationTimezone, permissionScope, canManage, levels }
}
