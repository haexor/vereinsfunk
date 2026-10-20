import type { MatchStrategy } from '@vereinsfunk/integrations'
import type { ExternalFixture } from './fixture.js'
import { comparableInstant, type ScheduleMatchContext } from './scheduleTime.js'

export type FixtureStatus = 'scheduled' | 'postponed' | 'cancelled' | 'played' | 'unknown'

/**
 * Minimaler lokaler Spiel-Datensatz, den der Abgleich braucht -- keine Datenbankabhaengigkeit.
 * Die API bildet public.fixtures-Zeilen auf diese Form ab und zurueck.
 */
export interface FixtureLocal {
  readonly id: string
  readonly externalId: string | null
  readonly sourceId: string | null
  readonly teamId: string | null
  readonly isHome: boolean | null
  readonly ownTeamLabel: string | null
  readonly opponentName: string | null
  readonly competition: string | null
  readonly kickoffAt: Date | null
  readonly kickoffTimeConfirmed: boolean
  readonly venueName: string | null
  readonly venueAddress: string | null
  readonly status: FixtureStatus
  readonly homeScore: number | null
  readonly awayScore: number | null
  readonly note: string | null
  readonly sourceUpdatedAt: Date | null
  readonly updatedAt: Date
}

export interface TeamNameResolver {
  /** Versucht, einen Namen (z. B. aus einem iCal-Titel) einer bekannten eigenen Mannschaft zuzuordnen. */
  resolveTeamId(name: string): string | undefined
}

interface ResolvedSide {
  readonly teamId: string | null
  readonly opponentName: string | null
  readonly isHome: boolean | null
  readonly unknownRefs: readonly string[]
}

function isLocal(entity: FixtureLocal | ExternalFixture): entity is FixtureLocal {
  return 'id' in entity
}

/**
 * Loest auf, welche Seite eines Spiels die eigene Mannschaft ist. Kein Raten (plans/019,
 * "Mannschaftszuordnung"): wenn weder teamReference noch einer der beiden iCal-Rohnamen einer
 * bekannten eigenen Mannschaft entspricht, bleiben teamId/opponentName/isHome unbestimmt und
 * unknownRefs nicht leer -- planSync macht daraus einen 'unknown_structure'-Konflikt statt einer
 * erfundenen Zuweisung. fieldsOf und unknownStructureRefs teilen sich dieses Ergebnis, damit
 * beide exakt dieselbe Aufloesung sehen.
 */
function resolveOwnSide(entity: ExternalFixture, resolver: TeamNameResolver): ResolvedSide {
  if (entity.teamReference) {
    const teamId = resolver.resolveTeamId(entity.teamReference) ?? null
    return {
      teamId,
      opponentName: entity.opponentName ?? null,
      isHome: entity.isHome ?? null,
      unknownRefs: teamId ? [] : [entity.teamReference],
    }
  }

  if (entity.homeNameRaw || entity.awayNameRaw) {
    const homeTeamId = entity.homeNameRaw ? resolver.resolveTeamId(entity.homeNameRaw) : undefined
    if (homeTeamId) return { teamId: homeTeamId, opponentName: entity.awayNameRaw ?? null, isHome: true, unknownRefs: [] }

    const awayTeamId = entity.awayNameRaw ? resolver.resolveTeamId(entity.awayNameRaw) : undefined
    if (awayTeamId) return { teamId: awayTeamId, opponentName: entity.homeNameRaw ?? null, isHome: false, unknownRefs: [] }

    const unknownRefs = [entity.homeNameRaw, entity.awayNameRaw].filter((name): name is string => Boolean(name))
    return { teamId: null, opponentName: null, isHome: null, unknownRefs }
  }

  // Kein Feld nennt ueberhaupt eine Mannschaft (z. B. nur Anstoßzeit und Ort) -- nichts aufzuloesen.
  return { teamId: null, opponentName: entity.opponentName ?? null, isHome: entity.isHome ?? null, unknownRefs: [] }
}

/**
 * Baut eine MatchStrategy fuer planSync im Bereich "Spiele". Die Mannschaftszuordnung wird hier
 * aufgeloest, nicht in ExternalFixtureSchema selbst -- das Schema kennt keine Datenbank. Anstoss-
 * zeiten vergleicht sie als Instanz (comparableInstant), aufgeloest mit schedule.resolveDateTime.
 */
export function createFixtureMatchStrategy(resolver: TeamNameResolver, schedule: ScheduleMatchContext): MatchStrategy<FixtureLocal, ExternalFixture> {
  return {
    identityOf(entity) {
      if (entity.externalId) return { externalId: entity.externalId }
      // Unscharfer Schluessel: Gegner (aufgeloest oder roh) plus Anstoßzeit -- zwei Spiele gegen
      // denselben Gegner zu unterschiedlichen Zeiten sind keine Kandidaten fuereinander.
      return { fuzzy: [(entity.opponentName ?? entity.awayNameRaw ?? '').trim().toLowerCase(), entity.kickoffAt ? String(comparableInstant(schedule, entity.kickoffAt, entity.kickoffAtTzid)) : ''] }
    },
    externalIdOf(local) {
      return local.externalId ?? undefined
    },
    fuzzyKeyOf(local) {
      return [(local.opponentName ?? '').trim().toLowerCase(), local.kickoffAt ? String(local.kickoffAt.getTime()) : '']
    },
    fieldsOf(entity) {
      if (isLocal(entity)) {
        return {
          teamId: entity.teamId,
          opponentName: entity.opponentName,
          isHome: entity.isHome,
          competition: entity.competition,
          kickoffAt: entity.kickoffAt ? entity.kickoffAt.getTime() : null,
          status: entity.status,
          homeScore: entity.homeScore,
          awayScore: entity.awayScore,
          venueName: entity.venueName,
          venueAddress: entity.venueAddress,
          note: entity.note,
        }
      }
      const resolved = resolveOwnSide(entity, resolver)
      return {
        teamId: resolved.teamId,
        opponentName: resolved.opponentName,
        isHome: resolved.isHome,
        competition: entity.competition ?? null,
        // undefined statt null ohne Anstoss-Spalte: die Quelle sagt dazu nichts (MatchStrategy.fieldsOf).
        kickoffAt: entity.kickoffAt === undefined ? undefined : comparableInstant(schedule, entity.kickoffAt, entity.kickoffAtTzid),
        // Ergebnis, Status und Ort gehoeren zum Abgleich: ohne sie galt ein nachgetragenes Ergebnis
        // als "unchanged", wurde nie geschrieben, und ein spaeter verschwundenes Spiel landete
        // trotz Ergebnis als 'cancelled'. undefined (Spalte fehlt) zaehlt nie als Unterschied.
        status: entity.status,
        homeScore: entity.homeScore,
        awayScore: entity.awayScore,
        venueName: entity.venueName,
        venueAddress: entity.venueAddress,
        note: entity.note,
      }
    },
    labelOf(entity) {
      return entity.opponentName ?? 'Spiel ohne Gegner'
    },
    sourceUpdatedAtOf(entity) {
      return entity.sourceUpdatedAt ? new Date(entity.sourceUpdatedAt) : undefined
    },
    localUpdatedAtOf(local) {
      return local.sourceUpdatedAt ?? local.updatedAt
    },
    unknownStructureRefs(entity) {
      return resolveOwnSide(entity, resolver).unknownRefs
    },
    // Nur Spiele mit echter Quellenbindung koennen "aus der Quelle verschwunden" sein --
    // dieselbe Begruendung wie bei DirectoryPersonLocal (packages/member-directory/src/match.ts).
    // Abgesagt oder gespielt ist ein Spiel bereits endgueltig, ein vergangener Anstoss kann nicht
    // mehr abgesagt werden (ScheduleMatchContext.now) -- sonst blockierte jeder Saisonwechsel im
    // Feed den Lauf an der Verlustschwelle.
    isRetirable(local) {
      if (local.sourceId === null || local.status === 'cancelled' || local.status === 'played') return false
      return local.kickoffAt === null || local.kickoffAt.getTime() >= schedule.now.getTime()
    },
  }
}
