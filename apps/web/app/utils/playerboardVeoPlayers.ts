import type { PlayerboardPlayer, PlayerboardVeoMatchAnalysis } from '@vereinsfunk/contracts'
import { isVeoParticipant, playerMetricDefinition, playerMetricValues, playerStatsForPeriod, validPlayerColumns, type VeoPlayerMetricValues } from '@vereinsfunk/domain'

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

/** "Ada Arnold" bzw. "Nummer 7" fuer nicht zugeordnete Rueckennummern. */
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
