// Paket 052, PR 3: Mannschaftsauswahl fuer die PlayerBoard-Seiten. Die Sidebar kennt nur Verein
// und Abteilung als Arbeitsbereich; PlayerBoard arbeitet aber je Mannschaft. Auf Abteilungsebene
// stehen deren Mannschaften zur Wahl, auf Vereinsebene alle sichtbaren Mannschaften.

export interface PlayerboardTeamOption {
  id: string
  name: string
  departmentId: string
  departmentName: string
}

interface ScopeLike {
  organizationId: string
  departments: readonly { id: string; name: string; teams: readonly { id: string; name: string }[] }[]
}

/** Listet sichtbare Mannschaften des aktiven Vereins bzw. der Abteilung; ohne passenden Verein bleibt die Liste leer. */
export function teamsInScope(scopes: readonly ScopeLike[], active: { organizationId: string; departmentId: string | null } | null): PlayerboardTeamOption[] {
  if (!active) return []
  const organization = scopes.find((item) => item.organizationId === active.organizationId)
  if (!organization) return []
  const departments = active.departmentId ? organization.departments.filter((department) => department.id === active.departmentId) : organization.departments
  return departments.flatMap((department) =>
    department.teams.map((team) => ({ id: team.id, name: team.name, departmentId: department.id, departmentName: department.name })),
  )
}

// Gewaehlte Mannschaft: die zuletzt gewaehlte, solange sie im Arbeitsbereich liegt; sonst die
// einzige. Bei mehreren ohne Wahl bleibt es bei null -- die Seite fragt dann zuerst.
export function resolveTeamSelection(teams: readonly PlayerboardTeamOption[], ...candidates: readonly (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (candidate && teams.some((team) => team.id === candidate)) return candidate
  }
  return teams.length === 1 ? teams[0]!.id : null
}
