import type { MatchStrategy } from '@vereinsfunk/integrations'
import type { ExternalTeam } from './team.js'

/**
 * Minimaler lokaler Mannschafts-Datensatz, den der Abgleich braucht -- keine Datenbankabhaengigkeit.
 * Die API bildet public.teams-Zeilen auf diese Form ab und zurueck.
 */
export interface TeamLocal {
  readonly id: string
  readonly externalId: string | null
  // null = von Hand angelegt, nie einer Quelle zugeordnet. Bestimmt isRetirable() unten.
  readonly sourceId: string | null
  readonly name: string
  readonly departmentId: string
  readonly ageGroup: string | null
  readonly competition: string | null
  readonly sourceUpdatedAt: Date | null
  readonly updatedAt: Date
}

export interface TeamDepartmentResolver {
  resolveDepartmentId(name: string): string | undefined
}

function isLocal(entity: TeamLocal | ExternalTeam): entity is TeamLocal {
  return 'id' in entity
}

/**
 * Baut eine MatchStrategy fuer planSync im Bereich "Mannschaften". Der Abteilungsname wird hier
 * zur ID aufgeloest, nicht in ExternalTeamSchema selbst -- das Schema kennt keine Datenbank. Ein
 * nicht aufloesbarer Name wird zum Konflikt ('unknown_structure'), nie zu einer neuen Abteilung.
 */
export function createTeamMatchStrategy(resolver: TeamDepartmentResolver): MatchStrategy<TeamLocal, ExternalTeam> {
  const resolveDepartmentId = (entity: ExternalTeam) => (entity.departmentName ? resolver.resolveDepartmentId(entity.departmentName) : undefined)

  return {
    identityOf(entity) {
      if (entity.externalId) return { externalId: entity.externalId }
      return { fuzzy: [entity.name.trim().toLowerCase()] }
    },
    externalIdOf(local) {
      return local.externalId ?? undefined
    },
    fuzzyKeyOf(local) {
      return [local.name.trim().toLowerCase()]
    },
    fieldsOf(entity) {
      if (isLocal(entity)) {
        return {
          name: entity.name,
          ageGroup: entity.ageGroup,
          competition: entity.competition,
          departmentId: entity.departmentId,
        }
      }
      return {
        name: entity.name,
        ageGroup: entity.ageGroup ?? null,
        competition: entity.competition ?? null,
        departmentId: resolveDepartmentId(entity) ?? null,
      }
    },
    labelOf(entity) {
      return entity.name
    },
    sourceUpdatedAtOf(entity) {
      return entity.sourceUpdatedAt ? new Date(entity.sourceUpdatedAt) : undefined
    },
    localUpdatedAtOf(local) {
      return local.sourceUpdatedAt ?? local.updatedAt
    },
    unknownStructureRefs(entity) {
      if (entity.departmentName && !resolveDepartmentId(entity)) return [entity.departmentName]
      return []
    },
    // Nur Mannschaften mit echter Quellenbindung koennen "aus der Quelle verschwunden" sein --
    // dieselbe Begruendung wie bei DirectoryPersonLocal (packages/member-directory/src/match.ts).
    isRetirable(local) {
      return local.sourceId !== null
    },
  }
}
