import type { MatchStrategy } from '@vereinsfunk/integrations'
import type { ExternalClubEvent } from './event.js'

/**
 * Minimaler lokaler Veranstaltungs-Datensatz, den der Abgleich braucht -- keine
 * Datenbankabhaengigkeit. Die API bildet public.club_events-Zeilen auf diese Form ab und zurueck.
 */
export interface ClubEventLocal {
  readonly id: string
  readonly externalId: string | null
  readonly sourceId: string | null
  readonly title: string
  readonly description: string | null
  readonly category: string
  readonly startsAt: Date
  readonly endsAt: Date | null
  readonly allDay: boolean
  readonly locationName: string | null
  readonly locationAddress: string | null
  readonly registrationUrl: string | null
  readonly status: string
  readonly sourceUpdatedAt: Date | null
  readonly updatedAt: Date
}

function isLocal(entity: ClubEventLocal | ExternalClubEvent): entity is ClubEventLocal {
  return 'id' in entity
}

/**
 * Baut eine MatchStrategy fuer planSync im Bereich "Veranstaltungen". Anders als bei Personen/
 * Mannschaften/Spielen braucht es hier keinen Resolver: eine Veranstaltung referenziert im Rahmen
 * dieses Packages keine Abteilung/Mannschaft ueber einen Namen. Eine synchronisierte Zeile behaelt
 * die department_id der eigenen integration_sources-Quelle -- das passiert im Schreibpfad der API,
 * nicht hier (genau wie bei directory_people).
 */
export function createClubEventMatchStrategy(): MatchStrategy<ClubEventLocal, ExternalClubEvent> {
  return {
    identityOf(entity) {
      if (entity.externalId) return { externalId: entity.externalId }
      return { fuzzy: [entity.title.trim().toLowerCase(), entity.startsAt] }
    },
    externalIdOf(local) {
      return local.externalId ?? undefined
    },
    fuzzyKeyOf(local) {
      return [local.title.trim().toLowerCase(), local.startsAt.toISOString()]
    },
    fieldsOf(entity) {
      if (isLocal(entity)) {
        return {
          title: entity.title,
          description: entity.description,
          category: entity.category,
          startsAt: entity.startsAt.toISOString(),
          endsAt: entity.endsAt ? entity.endsAt.toISOString() : null,
          allDay: entity.allDay,
          locationName: entity.locationName,
          status: entity.status,
        }
      }
      return {
        title: entity.title,
        description: entity.description ?? null,
        category: entity.category ?? 'other',
        startsAt: entity.startsAt,
        endsAt: entity.endsAt ?? null,
        allDay: entity.allDay ?? false,
        locationName: entity.locationName ?? null,
        status: entity.status ?? 'scheduled',
      }
    },
    labelOf(entity) {
      return entity.title
    },
    sourceUpdatedAtOf(entity) {
      return entity.sourceUpdatedAt ? new Date(entity.sourceUpdatedAt) : undefined
    },
    localUpdatedAtOf(local) {
      return local.sourceUpdatedAt ?? local.updatedAt
    },
    // Nur Veranstaltungen mit echter Quellenbindung koennen "aus der Quelle verschwunden" sein --
    // dieselbe Begruendung wie bei DirectoryPersonLocal (packages/member-directory/src/match.ts).
    isRetirable(local) {
      return local.sourceId !== null
    },
  }
}
