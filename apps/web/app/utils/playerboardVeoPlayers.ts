import type { PlayerboardPlayer, PlayerboardVeoMatchAnalysis, PlayerboardVeoSeasonMatch } from '@vereinsfunk/contracts'
import {
  isVeoParticipant,
  LEADERBOARD_MAX,
  playerMetricDefinition,
  playerMetricValues,
  playerStatsForPeriod,
  seasonPlayerKey,
  shotsFromEvents,
  validPlayerColumns,
  VEO_LEADERBOARD_METRICS,
  type VeoPlayerMetricValues,
  type VeoSeasonPlayerRow,
} from '@vereinsfunk/domain'
import { veoVideoLink } from './playerboardVeoAnalysis'

// Spec 002, PR 3: Spielertabelle und Spielerkarte wie Veo (Inventar §2.2, §2.3). Zeilen aus der
// Spielauswertung, Darstellung der Werte und die Spaltenwahl im Browser-Speicher.

export interface VeoPlayerRow {
  key: string
  jerseyNumber: number | null
  playerId: string | null
  personId: string | null
  // Name aus der Zuordnung; null bei nicht zugeordneten Nummern.
  name: string | null
  position: string | null
  isSelf: boolean
  values: VeoPlayerMetricValues
}

type RosterEntry = Pick<PlayerboardPlayer, 'id' | 'position' | 'isSelf'>

/**
 * Zeilen der Spielertabelle eines Spiels, auf Wunsch fuer eine Halbzeit. Wie Veo entfallen Zeilen,
 * die ausser "Spiele" nur Nullen haben und keine Position. Position und eigene Zeile kommen aus dem
 * Kader, soweit er geladen ist.
 */
export function matchPlayerRows(players: PlayerboardVeoMatchAnalysis['players'], roster: readonly RosterEntry[], period: number | null): VeoPlayerRow[] {
  const byId = new Map(roster.map((player) => [player.id, player]))
  return players.flatMap((player) => {
    const entry = player.playerId ? byId.get(player.playerId) : undefined
    const values = playerMetricValues(playerStatsForPeriod(player.stats, period))
    const position = entry?.position ?? null
    if (!isVeoParticipant(values, position)) return []
    return [{
      key: `jersey:${player.jerseyNumber}`,
      jerseyNumber: player.jerseyNumber,
      playerId: player.playerId,
      personId: player.personId,
      name: player.name,
      position,
      isSelf: entry?.isSelf ?? false,
      values,
    }]
  })
}

/** Spec 002, PR 5: Saisonzeilen fuer Tabelle, Ranglisten und Vergleich, mit Position und eigener Zeile aus dem Kader. */
export function seasonTableRows(rows: readonly VeoSeasonPlayerRow[], roster: readonly RosterEntry[]): (VeoPlayerRow & { matchCount: number })[] {
  const byId = new Map(roster.map((player) => [player.id, player]))
  return rows.flatMap((row) => {
    const entry = row.playerId ? byId.get(row.playerId) : undefined
    const position = entry?.position ?? null
    if (!isVeoParticipant(row.values, position)) return []
    return [{ ...row, position, isSelf: entry?.isSelf ?? false }]
  })
}

/** Ein Abschluss auf der Spieler-Schusskarte; `href` oeffnet die Stelle im Veo-Video. */
export interface PlayerShotMarker {
  key: string
  goal: boolean
  x: number | null
  y: number | null
  href: string | null
  title: string
}

/** "Ada Arnold" bzw. "Nummer 7" fuer nicht zugeordnete Rueckennummern. */
// Auswahl einer Spielerliste: die Vorauswahl der Seite (Rangliste/Spielertabelle), wenn der Spieler in
// der Liste steht, sonst der erste. Die Karte darf danach frei einen anderen Spieler waehlen.
export function initialPlayerKey(rows: readonly { key: string }[], preselected: string | null | undefined): string | null {
  return rows.find((row) => row.key === preselected)?.key ?? rows[0]?.key ?? null
}

// Eintraege der gemeinsamen Spielerliste (PlayerboardVeoMapPlayers) aus Spielerzeilen.
export function playerMapOptions(rows: readonly (Pick<VeoPlayerRow, 'key' | 'name' | 'jerseyNumber' | 'position'> & { score?: number })[]): { key: string; name: string; subtitle?: string; score?: number }[] {
  return rows.map((row) => ({ key: row.key, name: playerRowName(row), subtitle: playerRowSubtitle(row) || undefined, score: row.score }))
}

export function playerRowName(row: Pick<VeoPlayerRow, 'name' | 'jerseyNumber'>): string {
  if (row.name) return row.name
  return row.jerseyNumber === null ? 'Unbekannter Spieler' : `Nummer ${row.jerseyNumber}`
}

/** Unterzeile "#7 · IV" wie Veos Spielerzelle. */
export function playerRowSubtitle(row: Pick<VeoPlayerRow, 'jerseyNumber' | 'position'>): string {
  return [row.jerseyNumber === null ? null : `#${row.jerseyNumber}`, row.position].filter(Boolean).join(' · ')
}

const UNITS = { count: '', percent: ' %', minutes: ' min', km: ' km', kmh: ' km/h' } as const

/** Wert einer Spielerkennzahl mit Einheit; ohne Wert "k. A." wie Veos "N/A". */
export function formatPlayerMetric(id: string, value: number | undefined, withUnit = true): string {
  if (value === undefined) return 'k. A.'
  const definition = playerMetricDefinition(id)
  const decimals = definition?.decimals ?? 1
  const formatted = value.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
  return withUnit && definition ? `${formatted}${UNITS[definition.unit]}` : formatted
}

/** Spaltenkopf mit Einheit, z. B. "Erfasste Distanz (km)". */
export function playerMetricHeader(id: string): string {
  const definition = playerMetricDefinition(id)
  if (!definition) return id
  const unit = UNITS[definition.unit].trim()
  return unit ? `${definition.label} (${unit})` : definition.label
}

/** Gespeicherte Spaltenwahl lesen; ohne Speicher oder bei kaputtem Inhalt der Standard. */
export function readPlayerColumns(key: string, fallback: readonly string[]): string[] {
  try {
    const stored = globalThis.localStorage?.getItem(key)
    return validPlayerColumns(stored ? JSON.parse(stored) : null, fallback)
  } catch {
    return [...fallback]
  }
}

/** Spaltenwahl speichern; ohne Speicher bleibt sie nur fuer diese Seite. */
export function writePlayerColumns(key: string, columns: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(columns))
  } catch {
    // Privates Fenster oder gesperrter Speicher: die Wahl gilt dann nur bis zum Neuladen.
  }
}

/** Gewaehlte Ranglisten (bis 3); ungueltiger Speicherinhalt ergibt den Standard. */
export function readLeaderboardMetrics(key: string, fallback: readonly string[]): string[] {
  const allowed = readPlayerColumns(key, fallback).filter((id) => VEO_LEADERBOARD_METRICS.includes(id)).slice(0, LEADERBOARD_MAX)
  return allowed.length > 0 ? allowed : [...fallback]
}

/** Spielervergleich je Mannschaft: zuletzt gewaehlte Schluessel, sonst null. */
export function readComparisonPlayers(key: string): { a: string; b: string } | null {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null') as unknown
    if (stored && typeof stored === 'object' && typeof (stored as { a?: unknown }).a === 'string' && typeof (stored as { b?: unknown }).b === 'string') {
      return { a: (stored as { a: string }).a, b: (stored as { b: string }).b }
    }
  } catch {
    // Kaputter oder gesperrter Speicher: Standardwahl.
  }
  return null
}

export function writeComparisonPlayers(key: string, value: { a: string; b: string }): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // Wie writePlayerColumns: die Wahl gilt dann nur bis zum Neuladen.
  }
}

/**
 * Eigene Schuesse und Tore der gefilterten Spiele je Saisonzeile (Schluessel wie seasonPlayerKey).
 * Abschluesse ohne Rueckennummer gehoeren zu keinem Spieler und fehlen hier.
 */
export function seasonShotsByPlayer(matches: readonly PlayerboardVeoSeasonMatch[], timeZone: string): Map<string, PlayerShotMarker[]> {
  const date = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', timeZone })
  const result = new Map<string, PlayerShotMarker[]>()
  for (const match of matches) {
    for (const shot of shotsFromEvents(match.shots)) {
      if (shot.team !== 'own' || (shot.playerId === null && shot.jerseyNumber === null)) continue
      const key = seasonPlayerKey(shot)
      const list = result.get(key) ?? []
      result.set(key, list)
      list.push({
        key: `${match.fixtureId}:${shot.id}`,
        goal: shot.goal,
        x: shot.x,
        y: shot.y,
        href: veoVideoLink(match.veoUrl, shot.videoTimeMs),
        title: `${shot.goal ? 'Tor' : 'Schuss'} gegen ${match.opponentName ?? 'unbekannt'} am ${date.format(new Date(match.kickoffAt))}`,
      })
    }
  }
  return result
}
