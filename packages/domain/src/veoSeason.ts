// Spec 002 (research.md R-08): Kennzahlen der Saison wie Veos Analytics Studio (Inventar §1b.2-§1b.8).
// Je Spiel werden die Kennzahlen der eigenen Mannschaft aus Mannschaftswerten, Paessen und Ballbesitz
// und Ergebnis berechnet, ueber die Saison gemittelt und fuer Verlauf, Zonen und Radar aufbereitet.

import { statValue, type VeoPassPossessionInput, type VeoTeamStatInput } from './veoMetrics.js'
import type { PitchTeam, PitchThird } from './veoPitch.js'

export type VeoKeyMetricGroup = 'possession' | 'passes' | 'events' | 'combos'
export type VeoKeyMetricUnit = 'count' | 'percent' | 'minutes'

export interface VeoKeyMetricDefinition {
  id: string
  group: VeoKeyMetricGroup
  label: string
  description: string
  unit: VeoKeyMetricUnit
  // Nachkommastellen des Saisondurchschnitts (Veo: toFixed(0) bzw. toFixed(1)).
  decimals: 0 | 1
}

const metric = (id: string, group: VeoKeyMetricGroup, label: string, description: string, unit: VeoKeyMetricUnit = 'count', decimals: 0 | 1 = 1): VeoKeyMetricDefinition =>
  ({ id, group, label, description, unit, decimals })

// Katalog in Veos Reihenfolge ("Edit key metrics", Inventar §1b.3). Dieselben IDs fuehren SQL
// (authz.playerboard_veo_key_metric_ids) und contracts (PlayerboardVeoKeyMetricIdSchema).
export const VEO_TEAM_KEY_METRICS: readonly VeoKeyMetricDefinition[] = [
  metric('possession_percent', 'possession', 'Ballbesitz %', 'Ballbesitz der Mannschaft durch Pässe und Dribblings', 'percent', 0),
  metric('possession_minutes', 'possession', 'Ballbesitz-Minuten', 'Ballbesitz der Mannschaft in Minuten', 'minutes', 0),
  metric('possession_won', 'possession', 'Ballgewinne', 'Wie oft die Mannschaft den Ball im laufenden Spiel erobert hat', 'count', 0),
  metric('possession_location_in_defensive_third', 'possession', 'Ballbesitz % im Verteidigungsdrittel', 'Anteil des Ballbesitzes im eigenen Drittel', 'percent', 0),
  metric('possession_location_in_middle_third', 'possession', 'Ballbesitz % im Mitteldrittel', 'Anteil des Ballbesitzes im mittleren Drittel', 'percent', 0),
  metric('possession_location_in_attacking_third', 'possession', 'Ballbesitz % im Angriffsdrittel', 'Anteil des Ballbesitzes im gegnerischen Drittel', 'percent', 0),
  metric('pass_location_in_defensive_third', 'passes', 'Pässe % im Verteidigungsdrittel', 'Anteil der angekommenen Pässe im eigenen Drittel', 'percent', 0),
  metric('pass_location_in_middle_third', 'passes', 'Pässe % im Mitteldrittel', 'Anteil der angekommenen Pässe im mittleren Drittel', 'percent', 0),
  metric('pass_location_in_attacking_third', 'passes', 'Pässe % im Angriffsdrittel', 'Anteil der angekommenen Pässe im gegnerischen Drittel', 'percent', 0),
  metric('passes_completed', 'passes', 'Angekommene Pässe', 'Zahl der Pässe, die angekommen sind', 'count', 0),
  metric('three_to_five_passes', 'passes', '3 bis 5 Pässe', 'Passketten aus 3 bis 5 Pässen'),
  metric('six_or_more_passes', 'passes', '6 oder mehr Pässe', 'Passketten aus 6 oder mehr Pässen'),
  metric('longest_pass_string', 'passes', 'Längste Passkette', 'Die längste erkannte Passkette'),
  metric('goals_scored', 'events', 'Tore', 'Erzielte Tore'),
  metric('goals_conceded', 'events', 'Gegentore', 'Kassierte Tore'),
  metric('kick_free_kick', 'events', 'Freistöße', 'Ausgeführte Freistöße'),
  metric('shots_on_goal', 'events', 'Schüsse', 'Schüsse, die kein Tor wurden'),
  metric('shots_conceded', 'events', 'Zugelassene Schüsse', 'Schüsse des Gegners, die kein Tor wurden'),
  metric('kick_corner', 'events', 'Ecken', 'Ausgeführte Ecken'),
  metric('kick_goalie', 'events', 'Abstöße', 'Ausgeführte Abstöße'),
  metric('kick_penalty', 'events', 'Elfmeter', 'Ausgeführte Elfmeter'),
  metric('throw_in', 'events', 'Einwürfe', 'Ausgeführte Einwürfe'),
  metric('foul', 'events', 'Fouls', 'Begangene Fouls'),
  metric('tackles', 'events', 'Tacklings', 'Tacklings'),
  metric('duels', 'events', 'Zweikämpfe', 'Zweikämpfe'),
  metric('dribbles', 'events', 'Dribblings', 'Dribblings'),
  metric('interceptions', 'events', 'Abfangen', 'Abgefangene Bälle'),
  metric('loose_ball_recoveries', 'events', 'Ballgewinne (loser Ball)', 'Eroberte lose Bälle'),
  metric('saves', 'events', 'Paraden', 'Gehaltene Schüsse'),
  metric('shots_to_goal_conversion_rate', 'combos', 'Torquote', 'Anteil der Abschlüsse, die ein Tor wurden', 'percent', 0),
  metric('total_attempts', 'combos', 'Abschlüsse', 'Tore und Schüsse'),
  metric('total_attempts_conceded', 'combos', 'Zugelassene Abschlüsse', 'Tore und Schüsse des Gegners'),
  metric('attacking_events', 'combos', 'Offensivaktionen', 'Tore, Ecken, Freistöße, Elfmeter und Schüsse'),
  metric('defensive_events', 'combos', 'Defensivaktionen', 'Tore, Ecken, Freistöße, Elfmeter und Schüsse des Gegners'),
  metric('win_ratio', 'combos', 'Siegquote', 'Anteil der gewonnenen Spiele', 'percent', 0),
]

const DEFINITIONS = new Map(VEO_TEAM_KEY_METRICS.map((definition) => [definition.id, definition]))

/** Definition einer Kennzahl; unbekannte IDs ergeben null. */
export function keyMetricDefinition(id: string): VeoKeyMetricDefinition | null {
  return DEFINITIONS.get(id) ?? null
}

// Veos Standards, wenn die Mannschaft nichts gewaehlt hat (Inventar §1b.3, §1b.8).
export const DEFAULT_KEY_METRICS = ['possession_percent', 'goals_scored', 'shots_on_goal'] as const
export const DEFAULT_RADAR_METRICS = ['goals_scored', 'shots_on_goal', 'shots_to_goal_conversion_rate', 'win_ratio', 'passes_completed', 'possession_percent'] as const

export interface VeoSeasonMatchInput {
  fixtureId: string
  kickoffAt: string
  ownScore: number | null
  opponentScore: number | null
  teamStats: readonly VeoTeamStatInput[]
  passPossession: readonly VeoPassPossessionInput[] | null
}

export type VeoMatchResult = 'win' | 'draw' | 'loss'

/** Ergebnis aus Sicht der eigenen Mannschaft; null ohne Ergebnis. */
export function matchResult(match: Pick<VeoSeasonMatchInput, 'ownScore' | 'opponentScore'>): VeoMatchResult | null {
  if (match.ownScore === null || match.opponentScore === null) return null
  return match.ownScore > match.opponentScore ? 'win' : match.ownScore < match.opponentScore ? 'loss' : 'draw'
}

const THIRDS: readonly PitchThird[] = ['defensive', 'middle', 'attacking']

/** Drittel-Anteile eines Spiels in ganzen Prozent (Veo `Rte`/`Mte`); null ohne Werte. */
export function matchThirdPercents(match: Pick<VeoSeasonMatchInput, 'passPossession'>, team: PitchTeam, kind: 'pass' | 'possession'): Record<PitchThird, number> | null {
  const totals: Record<PitchThird, number> = { defensive: 0, middle: 0, attacking: 0 }
  for (const entry of match.passPossession ?? []) {
    const thirds = kind === 'pass' ? entry[team].passThirds : entry[team].possessionThirds
    for (const third of THIRDS) totals[third] += thirds[third]
  }
  const total = totals.defensive + totals.middle + totals.attacking
  if (total <= 0) return null
  return { defensive: Math.round((totals.defensive / total) * 100), middle: Math.round((totals.middle / total) * 100), attacking: Math.round((totals.attacking / total) * 100) }
}

// Ereigniswerte, die in Offensiv- und Defensivaktionen eingehen: alle Ereignisarten ausser Abstoss
// und Anstoss (Veo `Qte`); Abschluesse zaehlen als "kick_shot" einschliesslich der Tore.
const EVENT_SUM_STATS = [
  'football_goal_total', 'football_corner_total', 'football_free_kick_total', 'football_penalty_total', 'football_attempts_total',
  'football_throw_in_total', 'football_foul_total', 'football_tackle_total', 'football_duel_total', 'football_dribble_total',
  'football_interception_total', 'football_loose_total', 'football_save_total',
] as const

const EVENT_METRICS: Readonly<Record<string, [string, PitchTeam]>> = {
  kick_free_kick: ['football_free_kick_total', 'own'],
  shots_on_goal: ['football_shots_total', 'own'],
  shots_conceded: ['football_shots_total', 'opponent'],
  kick_corner: ['football_corner_total', 'own'],
  kick_goalie: ['football_goal_kick_total', 'own'],
  kick_penalty: ['football_penalty_total', 'own'],
  throw_in: ['football_throw_in_total', 'own'],
  foul: ['football_foul_total', 'own'],
  tackles: ['football_tackle_total', 'own'],
  duels: ['football_duel_total', 'own'],
  dribbles: ['football_dribble_total', 'own'],
  interceptions: ['football_interception_total', 'own'],
  loose_ball_recoveries: ['football_loose_total', 'own'],
  saves: ['football_save_total', 'own'],
}

/**
 * Kennzahlen der eigenen Mannschaft in einem Spiel (Veo Schritt D, Inventar §1b.2). Eine Kennzahl
 * fehlt, wenn Veo die Grundlage nicht geliefert hat (keine Paesse und kein Ballbesitz, keine
 * Mannschaftswerte, kein Ergebnis). Ballbesitz % ist wie bei Veo der Mittelwert der Halbzeiten.
 */
export function matchKeyMetrics(match: VeoSeasonMatchInput): Record<string, number> {
  const values: Record<string, number> = {}
  const periods = match.passPossession ?? []
  if (periods.length > 0) {
    const sum = (pick: (entry: VeoPassPossessionInput) => number) => periods.reduce((total, entry) => total + pick(entry), 0)
    values.passes_completed = sum((entry) => entry.own.passesCompleted)
    values.possession_minutes = sum((entry) => entry.own.possessionSeconds) / 60
    values.possession_won = sum((entry) => entry.own.possessionWon)
    const shares = periods.filter((entry) => entry.own.possessionSeconds + entry.opponent.possessionSeconds > 0)
      .map((entry) => Math.round((entry.own.possessionSeconds / (entry.own.possessionSeconds + entry.opponent.possessionSeconds)) * 100))
    if (shares.length > 0) values.possession_percent = shares.reduce((total, share) => total + share, 0) / shares.length
    const strings = periods.flatMap((entry) => entry.own.passStrings)
    values.longest_pass_string = strings.reduce((longest, [length, count]) => (count > 0 ? Math.max(longest, length) : longest), 0)
    values.three_to_five_passes = strings.reduce((total, [length, count]) => total + (length >= 3 && length <= 5 ? count : 0), 0)
    values.six_or_more_passes = strings.reduce((total, [length, count]) => total + (length >= 6 ? count : 0), 0)
    for (const [kind, prefix] of [['pass', 'pass_location_in'], ['possession', 'possession_location_in']] as const) {
      const thirds = matchThirdPercents(match, 'own', kind)
      if (thirds) for (const third of THIRDS) values[`${prefix}_${third}_third`] = thirds[third]
    }
  }

  if (match.teamStats.length > 0) {
    const stat = (statType: string, team: PitchTeam) => {
      const found = match.teamStats.find((entry) => entry.statType === statType && entry.teamAssociation === team)
      return found ? statValue(found, null) : 0
    }
    const attempts = (team: PitchTeam) => (match.teamStats.some((entry) => entry.statType === 'football_attempts_total')
      ? stat('football_attempts_total', team)
      : stat('football_goal_total', team) + stat('football_shots_total', team))
    for (const [id, [statType, team]] of Object.entries(EVENT_METRICS)) values[id] = stat(statType, team)
    values.total_attempts = attempts('own')
    values.total_attempts_conceded = attempts('opponent')
    if (values.total_attempts > 0) values.shots_to_goal_conversion_rate = Math.round((stat('football_goal_total', 'own') / values.total_attempts) * 100)
    const events = (team: PitchTeam) => EVENT_SUM_STATS.reduce((total, statType) => total + (statType === 'football_attempts_total' ? attempts(team) : stat(statType, team)), 0)
    values.attacking_events = events('own')
    values.defensive_events = events('opponent')
  }

  if (match.ownScore !== null && match.opponentScore !== null) {
    values.goals_scored = match.ownScore
    values.goals_conceded = match.opponentScore
    values.win_ratio = match.ownScore > match.opponentScore ? 100 : 0
  }
  return values
}

const round = (value: number, decimals: 0 | 1) => (decimals === 0 ? Math.round(value) : Math.round(value * 10) / 10)

export interface VeoSeasonKeyMetric {
  id: string
  // Saisondurchschnitt; null, wenn kein Spiel einen Wert hat.
  value: number | null
  // Zahl der Spiele, die beitragen -- weniger als alle heisst: Hinweis anzeigen.
  matchCount: number
}

/**
 * Saisonwerte (Veo Schritt E): Durchschnitt ueber die Spiele, die die Kennzahl liefern; Siegquote
 * = gewonnene / Spiele mit Ergebnis. Gerundet wie Veo.
 */
export function seasonKeyMetrics(matches: readonly VeoSeasonMatchInput[]): Map<string, VeoSeasonKeyMetric> {
  const perMatch = matches.map(matchKeyMetrics)
  const result = new Map<string, VeoSeasonKeyMetric>()
  for (const definition of VEO_TEAM_KEY_METRICS) {
    const values = perMatch.map((entry) => entry[definition.id]).filter((value): value is number => value !== undefined)
    const average = values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null
    result.set(definition.id, { id: definition.id, value: average === null ? null : round(average, definition.decimals), matchCount: values.length })
  }
  return result
}

/** Saisonanteile je Drittel: Mittel der gerundeten Spielanteile (Veo `uu`), auf ganze Prozent. */
export function seasonThirdPercents(matches: readonly Pick<VeoSeasonMatchInput, 'passPossession'>[], team: PitchTeam, kind: 'pass' | 'possession'): Record<PitchThird, number> | null {
  const perMatch = matches.map((match) => matchThirdPercents(match, team, kind)).filter((entry): entry is Record<PitchThird, number> => entry !== null)
  if (perMatch.length === 0) return null
  const mean = (third: PitchThird) => Math.round(perMatch.reduce((total, entry) => total + entry[third], 0) / perMatch.length)
  return { defensive: mean('defensive'), middle: mean('middle'), attacking: mean('attacking') }
}

/** Sieben gleichmaessige Teilstriche von 0 bis zu einem runden Hoechstwert (Veo `x`). */
export function progressionTicks(max: number): number[] {
  const target = Math.max(1, Math.ceil(max)) / 6
  const magnitude = 10 ** Math.floor(Math.log10(target))
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= target)!
  return Array.from({ length: 7 }, (_, index) => Math.round(index * step * 100) / 100)
}

/** Form: Ergebnisse der letzten n Spiele vor `beforeKickoff`, neuestes zuerst. */
export function recentForm(matches: readonly VeoSeasonMatchInput[], beforeKickoff: string, count = 3): { fixtureId: string; result: VeoMatchResult }[] {
  return matches
    .filter((match) => match.kickoffAt < beforeKickoff)
    .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt))
    .flatMap((match) => {
      const result = matchResult(match)
      return result ? [{ fixtureId: match.fixtureId, result }] : []
    })
    .slice(0, count)
}

// --- Vergleichsradar (Inventar §1b.8) ---------------------------------------------------------------

export interface VeoRadarAxis {
  id: string
  own: number | null
  comparing: number | null
  // 0-0,9 des Radius: jede Achse auf den groesseren der beiden Werte normiert.
  ownRadius: number
  comparingRadius: number
}

/** Achsen des Radars: `wert / max(eigen, vergleich) * 0,9`, fehlende Werte als 0. */
export function radarAxes(metrics: readonly string[], own: ReadonlyMap<string, VeoSeasonKeyMetric>, comparing: ReadonlyMap<string, VeoSeasonKeyMetric> | null): VeoRadarAxis[] {
  return metrics.map((id) => {
    const ownValue = own.get(id)?.value ?? null
    const comparingValue = comparing?.get(id)?.value ?? null
    const max = Math.max(ownValue ?? 0, comparingValue ?? 0)
    const radius = (value: number | null) => (max > 0 && value !== null ? (value / max) * 0.9 : 0)
    return { id, own: ownValue, comparing: comparingValue, ownRadius: radius(ownValue), comparingRadius: radius(comparingValue) }
  })
}

/** Veos Standardzeitraeume: eigene Mannschaft die letzten 30 Tage, Vergleich die 30 Tage davor. */
export function defaultRadarRanges(today: Date): { ownRange: [string, string]; comparingRange: [string, string] } {
  const day = (offset: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset)).toISOString().slice(0, 10)
  return { ownRange: [day(29), day(0)], comparingRange: [day(59), day(30)] }
}
