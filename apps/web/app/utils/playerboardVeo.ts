import type { PlayerboardPlayer, PlayerboardVeoMatch, PlayerboardVeoStat, PlayerboardVeoTeamStat } from '@vereinsfunk/contracts'

// Paket 053, PR 3: Darstellung der Veo-Werte (aus playerboard utils/veoStatLabels.ts und
// useVeoAnalytics.ts). Intern und auf der oeffentlichen Seite gleich gerechnet.

const STAT_LABELS: Readonly<Record<string, string>> = {
  football_goal_total: 'Tore',
  football_shots_total: 'Schüsse',
  football_attempts_total: 'Abschlüsse',
  football_corner_total: 'Ecken',
  football_free_kick_total: 'Freistöße',
  football_goal_kick_total: 'Abstöße',
  football_throw_in_total: 'Einwürfe',
  football_foul_total: 'Fouls',
  football_penalty_total: 'Elfmeter',
  football_tackle_total: 'Tacklings',
  football_dribble_total: 'Dribblings',
  football_interception_total: 'Balleroberungen',
  football_loose_total: 'Zweikämpfe',
  football_duel_total: 'Duelle',
  football_save_total: 'Paraden',
  distance_total_meters: 'Distanz',
  sprints_total: 'Sprints',
  top_speed_kmh: 'Höchstgeschw.',
  average_speed_kmh: 'Ø-Geschw.',
  high_intensity_runs_total: 'Intensivläufe',
  seconds_played_total: 'Spielzeit',
  football_goal_involvement_total: 'Torbeteiligungen',
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  attacking: 'Angriff',
  set_pieces: 'Standardsituationen',
  discipline: 'Disziplin',
  defending: 'Verteidigung',
  goalkeeping: 'Torwartspiel',
  physical: 'Athletik',
}

// Feste Reihenfolge der neun Spielerwerte (playerboard 004 research.md §3).
export const PLAYER_STAT_ORDER = [
  'distance_total_meters',
  'sprints_total',
  'top_speed_kmh',
  'average_speed_kmh',
  'high_intensity_runs_total',
  'seconds_played_total',
  'football_shots_total',
  'football_goal_total',
  'football_goal_involvement_total',
] as const

const UNIT_SUFFIX: Readonly<Record<string, string>> = {
  distance_total_meters: 'm',
  top_speed_kmh: 'km/h',
  average_speed_kmh: 'km/h',
  seconds_played_total: 'min',
}

const MAX_STATS = new Set(['top_speed_kmh'])
const MEAN_STATS = new Set(['average_speed_kmh'])

/** Deutsche Bezeichnung eines Veo-Werts; Unbekanntes lesbar aus dem Schluessel. */
export function statLabel(statType: string): string {
  return STAT_LABELS[statType] ?? statType.replace(/^football_/, '').replace(/_total$/, '').replace(/_/g, ' ')
}

/** Deutsche Bezeichnung einer Veo-Kategorie. */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

/** Wert mit Einheit; Spielzeit kommt in Sekunden und wird in ganzen Minuten gezeigt. */
export function formatStatValue(statType: string, value: number): string {
  const display = statType === 'seconds_played_total' ? Math.round(value / 60) : value
  const formatted = display.toLocaleString('de-DE', { maximumFractionDigits: 1 })
  const unit = UNIT_SUFFIX[statType]
  return unit ? `${formatted} ${unit}` : formatted
}

export interface VeoMatchLike {
  ownScore: number | null
  opponentScore: number | null
  teamStats: readonly PlayerboardVeoTeamStat[]
}

export interface SeasonRecord {
  games: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
}

/** Bilanz aus den Spielen mit Endstand. */
export function seasonRecord(matches: readonly VeoMatchLike[]): SeasonRecord {
  const record: SeasonRecord = { games: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }
  for (const match of matches) {
    if (match.ownScore === null || match.opponentScore === null) continue
    record.games += 1
    record.goalsFor += match.ownScore
    record.goalsAgainst += match.opponentScore
    if (match.ownScore > match.opponentScore) record.wins += 1
    else if (match.ownScore < match.opponentScore) record.losses += 1
    else record.draws += 1
  }
  return record
}

export interface TeamStatRow {
  statType: string
  own: number | null
  opponent: number | null
}

/** Mannschaftswerte eines Spiels nach Kategorie, eigene und gegnerische Seite nebeneinander. */
export function teamStatsByCategory(stats: readonly PlayerboardVeoTeamStat[]): { category: string; rows: TeamStatRow[] }[] {
  const byCategory = new Map<string, Map<string, TeamStatRow>>()
  for (const stat of stats) {
    const rows = byCategory.get(stat.category) ?? new Map<string, TeamStatRow>()
    byCategory.set(stat.category, rows)
    const row = rows.get(stat.statType) ?? { statType: stat.statType, own: null, opponent: null }
    rows.set(stat.statType, row)
    row[stat.teamAssociation] = stat.value
  }
  return [...byCategory.entries()].map(([category, rows]) => ({ category, rows: [...rows.values()] }))
}

/** Summe der eigenen Mannschaftswerte ueber alle Spiele, in der Reihenfolge des ersten Auftretens. */
export function ownTeamTotals(matches: readonly VeoMatchLike[]): { statType: string; value: number }[] {
  const totals = new Map<string, number>()
  for (const match of matches) {
    for (const stat of match.teamStats) {
      if (stat.teamAssociation === 'own') totals.set(stat.statType, (totals.get(stat.statType) ?? 0) + stat.value)
    }
  }
  return [...totals.entries()].map(([statType, value]) => ({ statType, value }))
}

export interface PlayerStatRowInput {
  key: string
  label: string
  jerseyNumber: number
  // Verzeichnisperson fuer den Link auf ihr Profil; fehlt auf der oeffentlichen Seite.
  personId?: string
  stats: readonly PlayerboardVeoStat[]
}

export interface PlayerSeasonRow {
  key: string
  label: string
  jerseyNumber: number
  personId?: string
  games: number
  values: Record<string, number>
}

/**
 * Saisonwerte je Spieler: Summen, Hoechstgeschwindigkeit als Maximum, Durchschnittsgeschwindigkeit
 * als Mittel der Spiele. Ein Spieler zaehlt je Spiel einmal, sortiert nach Rueckennummer.
 */
export function playerSeasonRows(matches: readonly { players: readonly PlayerStatRowInput[] }[]): PlayerSeasonRow[] {
  const rows = new Map<string, PlayerSeasonRow & { means: Record<string, number> }>()
  for (const match of matches) {
    for (const player of match.players) {
      if (player.stats.length === 0) continue
      const row = rows.get(player.key) ?? { key: player.key, label: player.label, jerseyNumber: player.jerseyNumber, ...(player.personId ? { personId: player.personId } : {}), games: 0, values: {}, means: {} }
      rows.set(player.key, row)
      row.games += 1
      for (const stat of player.stats) {
        const previous = row.values[stat.statType]
        if (MAX_STATS.has(stat.statType)) {
          row.values[stat.statType] = Math.max(previous ?? -Infinity, stat.value)
        } else if (MEAN_STATS.has(stat.statType)) {
          const count = (row.means[stat.statType] ?? 0) + 1
          row.means[stat.statType] = count
          row.values[stat.statType] = ((previous ?? 0) * (count - 1) + stat.value) / count
        } else {
          row.values[stat.statType] = (previous ?? 0) + stat.value
        }
      }
    }
  }
  return [...rows.values()]
    .map((row) => ({ key: row.key, label: row.label, jerseyNumber: row.jerseyNumber, ...(row.personId ? { personId: row.personId } : {}), games: row.games, values: row.values }))
    .sort((a, b) => a.jerseyNumber - b.jerseyNumber || a.label.localeCompare(b.label, 'de'))
}

/** Werte eines Spielers in einem Spiel als Zuordnung statType -> Wert. */
export function statValues(stats: readonly PlayerboardVeoStat[]): Record<string, number> {
  return Object.fromEntries(stats.map((stat) => [stat.statType, stat.value]))
}

/** Ergebnis aus eigener Sicht, z. B. "3:1", oder ein Strich ohne Endstand. */
export function scoreLabel(match: { ownScore: number | null; opponentScore: number | null }): string {
  return match.ownScore === null || match.opponentScore === null ? '–' : `${match.ownScore}:${match.opponentScore}`
}

/** Sieg, Unentschieden oder Niederlage fuer die Faerbung; null ohne Endstand. */
export function matchOutcome(match: { ownScore: number | null; opponentScore: number | null }): 'win' | 'draw' | 'loss' | null {
  if (match.ownScore === null || match.opponentScore === null) return null
  return match.ownScore > match.opponentScore ? 'win' : match.ownScore < match.opponentScore ? 'loss' : 'draw'
}

/** Person-Id einer zugeordneten Veo-Zeile fuer den Profil-Link; ohne Kader oder Zuordnung leer. */
export function personIdLookup(roster: readonly Pick<PlayerboardPlayer, 'id' | 'directoryPersonId'>[]): (playerId: string | null) => { personId?: string } {
  const personByPlayer = new Map(roster.map((player) => [player.id, player.directoryPersonId]))
  return (playerId) => {
    const personId = playerId ? personByPlayer.get(playerId) : undefined
    return personId ? { personId } : {}
  }
}

/**
 * Spiele fuer die Saisonansicht: nur zugeordnete Nummern, damit jeder Spieler eine Zeile ueber alle
 * Spiele hat. Mit Kader verweist jede Zeile auf das Profil der Person, ohne bleibt der Name Text.
 */
export function veoSeasonMatches(
  matches: readonly PlayerboardVeoMatch[],
  roster: readonly Pick<PlayerboardPlayer, 'id' | 'directoryPersonId'>[],
): (VeoMatchLike & { players: PlayerStatRowInput[] })[] {
  const personIdOf = personIdLookup(roster)
  return matches.map((match) => ({
    ownScore: match.ownScore,
    opponentScore: match.opponentScore,
    teamStats: match.teamStats,
    players: match.players.flatMap((player) => player.playerId && player.name
      ? [{ key: player.playerId, label: player.name, jerseyNumber: player.jerseyNumber, ...personIdOf(player.playerId), stats: player.stats }]
      : []),
  }))
}
