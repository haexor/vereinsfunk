import type { MatchStrategy } from '@vereinsfunk/integrations'
import type { PersonExternal } from './person.js'

export type DirectoryPersonStatus = 'active' | 'inactive' | 'left' | 'unknown'

/**
 * Minimaler lokaler Personen-Datensatz, den der Abgleich braucht -- keine Datenbankabhaengigkeit.
 * Die API bildet public.directory_people-Zeilen auf diese Form ab und zurueck.
 */
export interface DirectoryPersonLocal {
  readonly id: string
  readonly externalId: string | null
  // null = von Hand angelegt, nie einer Quelle zugeordnet. Bestimmt isRetirable() unten -- eine
  // solche Person darf nie "aus der Quelle verschwunden" sein, weil sie nie in einer stand.
  readonly sourceId: string | null
  readonly firstName: string
  readonly lastName: string
  readonly birthYear: number | null
  readonly departmentId: string | null
  readonly teamId: string | null
  readonly status: DirectoryPersonStatus
  readonly sourceUpdatedAt: Date | null
  readonly updatedAt: Date
}

export interface DepartmentResolver {
  resolveDepartmentId(name: string): string | undefined
  resolveTeamId(departmentId: string, name: string): string | undefined
}

function isLocal(entity: DirectoryPersonLocal | PersonExternal): entity is DirectoryPersonLocal {
  return 'id' in entity
}

/**
 * Baut eine MatchStrategy fuer planSync im Bereich "Personen". Abteilungs-/Mannschaftsnamen
 * werden hier zu IDs aufgeloest, nicht in PersonExternalSchema selbst -- das Schema kennt keine
 * Datenbank. Ein nicht aufloesbarer Name wird zum Konflikt ('unknown_structure'), nie zu einer
 * neuen Abteilung (plans/014: "Keine Strukturaenderung durch Import").
 */
export function createPeopleMatchStrategy(resolver: DepartmentResolver): MatchStrategy<DirectoryPersonLocal, PersonExternal> {
  const resolveIds = (entity: PersonExternal) => {
    const departmentId = entity.departmentName ? resolver.resolveDepartmentId(entity.departmentName) : undefined
    const teamId = entity.teamName && departmentId ? resolver.resolveTeamId(departmentId, entity.teamName) : undefined
    return { departmentId, teamId }
  }

  return {
    identityOf(entity) {
      if (entity.externalId) return { externalId: entity.externalId }
      return { fuzzy: [entity.firstName.trim().toLowerCase(), entity.lastName.trim().toLowerCase(), String(entity.birthYear ?? '')] }
    },
    externalIdOf(local) {
      return local.externalId ?? undefined
    },
    fuzzyKeyOf(local) {
      return [local.firstName.trim().toLowerCase(), local.lastName.trim().toLowerCase(), String(local.birthYear ?? '')]
    },
    fieldsOf(entity) {
      if (isLocal(entity)) {
        return {
          firstName: entity.firstName,
          lastName: entity.lastName,
          birthYear: entity.birthYear,
          departmentId: entity.departmentId,
          teamId: entity.teamId,
          status: entity.status,
        }
      }
      // Fehlende Felder bleiben undefined, nicht null/'active': eine Importdatei ohne
      // Geburtsjahr-, Abteilungs- oder Statusspalte sagt zu diesen Feldern nichts und darf den
      // lokal gepflegten Wert weder als Aenderung melden noch ueberschreiben (siehe
      // MatchStrategy.fieldsOf). Sonst leert der erste Import ohne Geburtsjahrspalte jedes
      // Geburtsjahr im Verzeichnis -- und mit ihm die Grundlage der Minderjaehrigkeitspruefung.
      const { departmentId, teamId } = resolveIds(entity)
      return {
        firstName: entity.firstName,
        lastName: entity.lastName,
        birthYear: entity.birthYear,
        departmentId,
        teamId,
        status: entity.status,
      }
    },
    labelOf(entity) {
      return `${entity.firstName} ${entity.lastName}`
    },
    sourceUpdatedAtOf(entity) {
      return entity.sourceUpdatedAt ? new Date(entity.sourceUpdatedAt) : undefined
    },
    localUpdatedAtOf(local) {
      return local.sourceUpdatedAt ?? local.updatedAt
    },
    unknownStructureRefs(entity) {
      const refs: string[] = []
      if (entity.departmentName && !resolver.resolveDepartmentId(entity.departmentName)) refs.push(entity.departmentName)
      if (entity.teamName) {
        const departmentId = entity.departmentName ? resolver.resolveDepartmentId(entity.departmentName) : undefined
        if (!departmentId || !resolver.resolveTeamId(departmentId, entity.teamName)) refs.push(entity.teamName)
      }
      return refs
    },
    // Nur Personen mit echter Quellenbindung koennen "aus der Quelle verschwunden" sein. Eine von
    // Hand angelegte Person (sourceId null) taucht in existing ausschliesslich fuer den unscharfen
    // Abgleich auf -- ohne diese Einschraenkung wuerde ein voellig unabhaengiger Import sie als
    // "left" markieren, nur weil sie in dieser einen Datei nicht vorkommt.
    isRetirable(local) {
      return local.sourceId !== null
    },
  }
}
