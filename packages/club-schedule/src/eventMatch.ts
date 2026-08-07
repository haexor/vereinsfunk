import type { MatchStrategy } from '@vereinsfunk/integrations'
import type { ExternalClubEvent } from './event.js'

/**
 * Minimaler lokaler Veranstaltungs-Datensatz, den der Abgleich braucht -- keine
 * Datenbankabhaengigkeit. Die API bildet public.club_events-Zeilen auf diese Form ab und zurueck.
 */
export interface ClubEventLocal {
  readonly id: string
  readonly externalId: string | null
  // Bei Serien identifiziert externalId (die iCal-UID) nur die Serie -- die Instanz braucht
  // recurrenceKey zusaetzlich, sonst kollabieren alle Einzeltermine einer Wiederholung auf
  // dieselbe Identitaet (siehe club_events_external_unique, Migration 2026080704).
  readonly recurrenceKey: string | null
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
  // externalId allein identifiziert bei einer Serie nur die Serie (RFC 5545: UID ist seriengleich,
  // RECURRENCE-ID/recurrenceKey erst die Instanz) -- ohne recurrenceKey in der Identitaet wuerden
  // zwei verschiedene Termine derselben Serie faelschlich als derselbe Datensatz abgeglichen,
  // waehrend club_events_external_unique sie als eigene Zeilen erwartet.
  const compositeExternalId = (externalId: string, recurrenceKey: string | null | undefined) => [externalId, recurrenceKey ?? ''].join('\u0000')

  return {
    identityOf(entity) {
      if (entity.externalId) return { externalId: compositeExternalId(entity.externalId, entity.recurrenceKey) }
      return { fuzzy: [entity.title.trim().toLowerCase(), entity.startsAt] }
    },
    externalIdOf(local) {
      return local.externalId ? compositeExternalId(local.externalId, local.recurrenceKey) : undefined
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
      // Keine Vergleichsfallbacks hier: undefined heisst "die Quelle sagt zu diesem Feld nichts"
      // (MatchStrategy.fieldsOf-Vertrag) und darf in diffFields nie als Aenderung gegen einen
      // lokal gepflegten Wert erscheinen. 'other'/false/'scheduled'/null gelten nur beim Anlegen
      // (siehe handleEventsSync, insertRows), nicht beim Abgleich.
      return {
        title: entity.title,
        description: entity.description,
        category: entity.category,
        startsAt: entity.startsAt,
        endsAt: entity.endsAt,
        allDay: entity.allDay,
        locationName: entity.locationName,
        status: entity.status,
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
