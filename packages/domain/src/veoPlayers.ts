// Spec 002 (research.md R-07): Spielerwerte wie Veo (Inventar §2.0.3, §2.0.4, §2.2, §2.3). Aus den
// gespeicherten Veo-Werttypen werden Veos Spielerkennzahlen samt Ableitungen, die Kacheln der
// Spielerkarte je Position, die Standardspalten und die Sortierung der Spielertabelle.

export type VeoPlayerMetricGroup = 'general' | 'physical' | 'events'
export type VeoPlayerMetricUnit = 'count' | 'percent' | 'minutes' | 'km' | 'kmh'

export interface VeoPlayerMetricDefinition {
  id: string
  group: VeoPlayerMetricGroup
  label: string
  // Kurzform fuer schmale Spaltenkoepfe (Veo label_abbrev).
  abbreviation: string
  description: string
  unit: VeoPlayerMetricUnit
  decimals: 0 | 1
}

const metric = (id: string, group: VeoPlayerMetricGroup, label: string, abbreviation: string, description: string, unit: VeoPlayerMetricUnit = 'count', decimals: 0 | 1 = 0): VeoPlayerMetricDefinition =>
  ({ id, group, label, abbreviation, description, unit, decimals })

// Katalog in Veos Reihenfolge je Gruppe (Inventar §2.0.4). "Ballgewinne" fehlt in Veos Tabelle,
// steht aber auf den Kacheln der Spielerkarte (§2.3) und kommt deshalb ans Ende.
export const VEO_PLAYER_METRICS: readonly VeoPlayerMetricDefinition[] = [
  metric('matches', 'general', 'Spiele', 'Sp', 'Wie oft der Spieler in der Aufstellung stand, in der Startelf oder eingewechselt'),
  metric('starts', 'general', 'Startelf', 'St', 'Wie oft der Spieler in der Startelf stand'),
  metric('captaincies', 'general', 'Kapitän', 'Kap', 'Wie oft der Spieler Kapitän war'),
  metric('player_of_the_match', 'general', 'Spieler des Spiels', 'SdS', 'Wie oft der Spieler zum Spieler des Spiels gewählt wurde'),
  metric('total_events', 'general', 'Ereignisse', 'Ereig.', 'Ereignisse, die dem Spieler zugeordnet sind'),
  metric('minutes_played', 'physical', 'Erfasste Minuten', 'Min', 'Minuten, in denen Veo den Spieler auf dem Feld erfasst hat', 'minutes'),
  metric('distance_covered', 'physical', 'Erfasste Distanz', 'Dist', 'Strecke, die Veo für den Spieler erfasst hat', 'km', 1),
  metric('average_speed', 'physical', 'Ø-Geschwindigkeit', 'ØG', 'Durchschnittliche Geschwindigkeit', 'kmh', 1),
  metric('top_speed', 'physical', 'Höchstgeschwindigkeit', 'HG', 'Höchste gemessene Geschwindigkeit', 'kmh', 1),
  metric('high_intensity_runs', 'physical', 'Intensivläufe', 'IL', 'Läufe mit hoher Intensität'),
  metric('sprints', 'physical', 'Sprints', 'Spr', 'Sprints'),
  metric('assists', 'events', 'Vorlagen', 'V', 'Vorlagen zu Toren'),
  metric('conversion_rate', 'events', 'Torquote', 'TQ', 'Anteil der Abschlüsse, die ein Tor wurden', 'percent'),
  metric('passes', 'events', 'Pässe', 'Pä', 'Gespielte Pässe'),
  metric('passes_success_rate', 'events', 'Passquote', 'PQ', 'Anteil der Pässe, die angekommen sind', 'percent'),
  metric('passes_successful', 'events', 'Angekommene Pässe', 'AP', 'Pässe, die angekommen sind'),
  metric('passes_unsuccessful', 'events', 'Fehlpässe', 'FP', 'Pässe, die nicht angekommen sind'),
  metric('dribbles', 'events', 'Dribblings', 'Dri', 'Dribblings'),
  metric('goals', 'events', 'Tore', 'T', 'Erzielte Tore'),
  metric('goal_involvements', 'events', 'Torbeteiligungen', 'TB', 'Tore und Vorlagen'),
  metric('shots', 'events', 'Schüsse', 'Sch', 'Schüsse, die kein Tor wurden'),
  metric('total_attempts', 'events', 'Abschlüsse', 'Abs', 'Tore und Schüsse'),
  metric('tackles', 'events', 'Tacklings', 'Tkl', 'Tacklings'),
  metric('duels', 'events', 'Zweikämpfe', 'ZK', 'Zweikämpfe'),
  metric('interceptions', 'events', 'Abfangen', 'Abf', 'Abgefangene Bälle'),
  metric('loose_ball_recoveries', 'events', 'Ballgewinne (loser Ball)', 'BLB', 'Eroberte lose Bälle'),
  metric('corners', 'events', 'Ecken', 'E', 'Ausgeführte Ecken'),
  metric('free_kicks', 'events', 'Freistöße', 'FS', 'Ausgeführte Freistöße'),
  metric('goal_kicks', 'events', 'Abstöße', 'AS', 'Ausgeführte Abstöße'),
  metric('penalty_kicks', 'events', 'Elfmeter', 'Elf', 'Ausgeführte Elfmeter'),
  metric('throw_ins', 'events', 'Einwürfe', 'EW', 'Ausgeführte Einwürfe'),
  metric('fouls', 'events', 'Fouls', 'F', 'Begangene Fouls'),
  metric('saves', 'events', 'Paraden', 'Par', 'Gehaltene Schüsse'),
  metric('recoveries', 'events', 'Ballgewinne', 'BG', 'Wie oft der Spieler den Ball erobert hat'),
]

const DEFINITIONS = new Map(VEO_PLAYER_METRICS.map((definition) => [definition.id, definition]))

/** Definition einer Spielerkennzahl; unbekannte IDs ergeben null. */
export function playerMetricDefinition(id: string): VeoPlayerMetricDefinition | null {
  return DEFINITIONS.get(id) ?? null
}

// Gespeicherter Veo-Werttyp je Kennzahl (Inventar §2.0.3). Die uebrigen Kennzahlen werden abgeleitet.
const SOURCES: Readonly<Record<string, string>> = {
  matches: 'matches_total',
  starts: 'starts_total',
  captaincies: 'captaincies_total',
  player_of_the_match: 'player_of_the_match_total',
  high_intensity_runs: 'high_intensity_runs_total',
  sprints: 'sprints_total',
  top_speed: 'top_speed_kmh',
  average_speed: 'average_speed_kmh',
  assists: 'football_assist_total',
  passes: 'football_passes_total',
  passes_successful: 'football_passes_completed_total',
  passes_unsuccessful: 'football_passes_unsuccessful_total',
  dribbles: 'football_dribble_total',
  goals: 'football_goal_total',
  goal_involvements: 'football_goal_involvement_total',
  shots: 'football_shots_total',
  total_attempts: 'football_attempts_total',
  tackles: 'football_tackle_total',
  duels: 'football_duel_total',
  interceptions: 'football_interception_total',
  loose_ball_recoveries: 'football_loose_total',
  corners: 'football_corner_total',
  free_kicks: 'football_free_kick_total',
  goal_kicks: 'football_goal_kick_total',
  penalty_kicks: 'football_penalty_total',
  throw_ins: 'football_throw_in_total',
  fouls: 'football_foul_total',
  saves: 'football_save_total',
  recoveries: 'football_possession_won_total',
}

// Bestandteile von Veos "Total events" (Inventar §2.0.3, TotalEvents).
const EVENT_PARTS = ['assists', 'goals', 'shots', 'corners', 'free_kicks', 'goal_kicks', 'penalty_kicks', 'throw_ins', 'fouls'] as const

export interface VeoPlayerStatInput {
  statType: string
  value: number
  periodValues?: readonly { period: number; value: number }[]
}

export type VeoPlayerMetricValues = Partial<Record<string, number>>

/**
 * Veos Spielerkennzahlen aus den gespeicherten Werten (Inventar §2.0.3): Spielzeit in ganzen Minuten,
 * Distanz in km, Quoten in ganzen Prozent; fehlende Werte werden wie bei Veo abgeleitet. Was weder
 * geliefert noch ableitbar ist, fehlt im Ergebnis ("k. A." statt 0).
 */
export function playerMetricValues(stats: readonly VeoPlayerStatInput[]): VeoPlayerMetricValues {
  const raw = new Map(stats.map((stat) => [stat.statType, stat.value]))
  const values: VeoPlayerMetricValues = {}
  for (const [id, statType] of Object.entries(SOURCES)) {
    const value = raw.get(statType)
    if (value !== undefined) values[id] = value
  }
  const seconds = raw.get('seconds_played_total')
  if (seconds !== undefined) values.minutes_played = Math.round(seconds / 60)
  const meters = raw.get('distance_total_meters')
  if (meters !== undefined) values.distance_covered = meters / 1000

  const { goals, assists, total_attempts: attempts, passes, passes_successful: successful } = values
  if (values.shots === undefined && attempts !== undefined) values.shots = Math.max(attempts - (goals ?? 0), 0)
  if (values.passes_unsuccessful === undefined && passes !== undefined && successful !== undefined) values.passes_unsuccessful = Math.max(passes - successful, 0)
  if (passes !== undefined && successful !== undefined) values.passes_success_rate = passes > 0 ? Math.round((successful / passes) * 100) : 0
  if (values.goal_involvements === undefined && (goals !== undefined || assists !== undefined)) values.goal_involvements = (goals ?? 0) + (assists ?? 0)
  const rate = raw.get('football_conversion_rate')
  if (rate !== undefined) values.conversion_rate = Math.round(rate * 100)
  else if (attempts !== undefined) values.conversion_rate = attempts > 0 ? Math.round(((goals ?? 0) / attempts) * 100) : 0
  if (EVENT_PARTS.some((part) => values[part] !== undefined)) values.total_events = EVENT_PARTS.reduce((sum, part) => sum + (values[part] ?? 0), 0)
  return values
}

/** Werte einer Halbzeit aus `periodValues`; Werte ohne Halbzeitangabe fehlen dann. */
export function playerStatsForPeriod<T extends VeoPlayerStatInput>(stats: readonly T[], period: number | null): VeoPlayerStatInput[] {
  if (period === null) return [...stats]
  return stats.flatMap((stat) => {
    const entry = stat.periodValues?.find((value) => value.period === period)
    return entry ? [{ statType: stat.statType, value: entry.value }] : []
  })
}

/**
 * Hat der Spieler im Spiel mitgewirkt? Veo blendet in Spielen mit Analyse 2 Zeilen aus, die ausser
 * "Spiele" nur Nullen haben und keine Position (Inventar §2.0.6, dropNonParticipants).
 */
export function isVeoParticipant(values: VeoPlayerMetricValues, position: string | null): boolean {
  if (position) return true
  return Object.entries(values).some(([id, value]) => id !== 'matches' && value !== undefined && value !== 0)
}

// --- Spielertabelle (Inventar §2.1.2, §2.2) ----------------------------------------------------------

export const DEFAULT_MATCH_PLAYER_COLUMNS = [
  'minutes_played', 'distance_covered', 'average_speed', 'top_speed', 'sprints', 'high_intensity_runs', 'total_events', 'goals', 'assists',
  'goal_involvements', 'conversion_rate', 'shots', 'total_attempts', 'tackles', 'corners', 'free_kicks', 'throw_ins', 'fouls', 'penalty_kicks', 'goal_kicks',
] as const
export const DEFAULT_SEASON_PLAYER_COLUMNS = [
  'matches', 'total_attempts', 'goals', 'shots', 'conversion_rate', 'total_events', 'distance_covered', 'average_speed', 'sprints', 'minutes_played', 'high_intensity_runs',
] as const

export interface VeoPlayerSortable {
  name: string | null
  jerseyNumber: number | null
  values: VeoPlayerMetricValues
}
export type VeoPlayerSortColumn = 'player' | string
export interface VeoPlayerSort { column: VeoPlayerSortColumn; direction: 'asc' | 'desc' }

export const DEFAULT_PLAYER_SORT: VeoPlayerSort = { column: 'player', direction: 'asc' }

/** Naechste Sortierung nach einem Klick: Zahlen zuerst absteigend, Spieler zuerst aufsteigend. */
export function nextPlayerSort(current: VeoPlayerSort, column: VeoPlayerSortColumn): VeoPlayerSort {
  if (current.column === column) return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  return { column, direction: column === 'player' ? 'asc' : 'desc' }
}

/**
 * Sortierung wie Veo (Inventar §2.1.2): Spieler mit Namen vor reinen Rueckennummern, nach Name und
 * dann Nummer; bei Zahlen fehlen Werte immer am Ende, gleich welche Richtung.
 */
export function sortPlayerRows<T extends VeoPlayerSortable>(rows: readonly T[], sort: VeoPlayerSort): T[] {
  const byPlayer = (a: T, b: T) => {
    if (a.name && !b.name) return -1
    if (!a.name && b.name) return 1
    return (a.name ?? '').localeCompare(b.name ?? '', 'de') || (a.jerseyNumber ?? Infinity) - (b.jerseyNumber ?? Infinity)
  }
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort.column === 'player') return sign * byPlayer(a, b)
    const left = a.values[sort.column]
    const right = b.values[sort.column]
    if (left === undefined || right === undefined) return left === right ? byPlayer(a, b) : left === undefined ? 1 : -1
    return sign * (left - right) || byPlayer(a, b)
  })
}

/** Gespeicherte Spaltenwahl pruefen: unbekannte IDs entfallen; ohne gueltige Spalte gilt der Standard. */
export function validPlayerColumns(stored: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(stored)) return [...fallback]
  const columns = [...new Set(stored.filter((id): id is string => typeof id === 'string' && DEFINITIONS.has(id)))]
  return columns.length > 0 ? columns : [...fallback]
}

// --- Spielerkarte (Inventar §2.3) ------------------------------------------------------------------

export type VeoPositionCode = 'GK' | 'LB' | 'RB' | 'CB' | 'LWB' | 'RWB' | 'DM' | 'LM' | 'RM' | 'CM' | 'LW' | 'RW' | 'AM' | 'ST'

// Positionen sind im Kader freier Text; gaengige deutsche und englische Kuerzel und Namen.
const POSITION_WORDS: readonly [VeoPositionCode, readonly string[]][] = [
  ['GK', ['GK', 'TW', 'TORWART', 'TORHÜTER', 'TORHUETER', 'KEEPER', 'GOALKEEPER']],
  ['LWB', ['LWB', 'LINKER SCHIENENSPIELER']],
  ['RWB', ['RWB', 'RECHTER SCHIENENSPIELER']],
  ['LB', ['LB', 'LV', 'LINKSVERTEIDIGER', 'LINKER VERTEIDIGER']],
  ['RB', ['RB', 'RV', 'RECHTSVERTEIDIGER', 'RECHTER VERTEIDIGER']],
  ['CB', ['CB', 'IV', 'INNENVERTEIDIGER', 'INNENVERTEIDIGUNG', 'ABWEHR', 'VERTEIDIGER', 'VERTEIDIGUNG']],
  ['DM', ['DM', 'CDM', 'ZDM', 'SECHSER', 'DEFENSIVES MITTELFELD']],
  ['LM', ['LM', 'LINKES MITTELFELD']],
  ['RM', ['RM', 'RECHTES MITTELFELD']],
  ['AM', ['AM', 'CAM', 'OM', 'ZOM', 'ZEHNER', 'OFFENSIVES MITTELFELD']],
  ['CM', ['CM', 'ZM', 'ACHTER', 'ZENTRALES MITTELFELD', 'MITTELFELD']],
  ['LW', ['LW', 'LA', 'LINKSAUSSEN', 'LINKER FLÜGEL']],
  ['RW', ['RW', 'RA', 'RECHTSAUSSEN', 'RECHTER FLÜGEL']],
  ['ST', ['ST', 'MS', 'CF', 'STÜRMER', 'STUERMER', 'MITTELSTÜRMER', 'ANGRIFF']],
]

/** Veo-Positionscode aus dem Kadertext ("IV", "Linksaußen", "ST / Kapitän"); null, wenn nichts passt. */
export function veoPositionCode(position: string | null): VeoPositionCode | null {
  // toUpperCase macht aus "ß" bereits "SS".
  const text = position?.trim().toUpperCase().replace(/\s+/g, ' ') ?? ''
  if (!text) return null
  const find = (candidate: string) => POSITION_WORDS.find(([, words]) => words.includes(candidate))?.[0] ?? null
  return find(text) ?? find(text.split(/\s*[/,(]\s*/)[0]!)
}

// Vier Kacheln der Uebersicht je Position (Inventar §2.3, `oa`).
const FOCUS_TILES: Readonly<Record<VeoPositionCode, readonly string[]>> = {
  GK: ['goal_kicks', 'saves', 'passes_successful', 'recoveries'],
  LB: ['tackles', 'passes_successful', 'distance_covered', 'interceptions'],
  RB: ['tackles', 'passes_successful', 'distance_covered', 'interceptions'],
  CB: ['interceptions', 'tackles', 'passes_successful', 'duels'],
  LWB: ['sprints', 'assists', 'distance_covered', 'recoveries'],
  RWB: ['sprints', 'assists', 'distance_covered', 'recoveries'],
  DM: ['recoveries', 'interceptions', 'passes_successful', 'tackles'],
  LM: ['passes_successful', 'distance_covered', 'assists', 'dribbles'],
  RM: ['passes_successful', 'distance_covered', 'assists', 'dribbles'],
  CM: ['passes_successful', 'distance_covered', 'dribbles', 'recoveries'],
  LW: ['dribbles', 'top_speed', 'sprints', 'goal_involvements'],
  RW: ['dribbles', 'top_speed', 'sprints', 'goal_involvements'],
  AM: ['assists', 'goal_involvements', 'dribbles', 'sprints'],
  ST: ['total_attempts', 'goals', 'assists', 'conversion_rate'],
}
const FALLBACK_TILES = ['distance_covered', 'top_speed', 'total_attempts', 'duels'] as const

/** Kacheln der Spielerkarte fuer eine Position; ohne erkannte Position Veos Rueckfall. */
export function playerFocusTiles(position: string | null): readonly string[] {
  const code = veoPositionCode(position)
  return code ? FOCUS_TILES[code] : FALLBACK_TILES
}

// Reiter "Werte" und "Physis" der Spielerkarte (Inventar §2.3).
export const PLAYER_CARD_SECTIONS: readonly { label: string; metrics: readonly string[] }[] = [
  { label: 'Allgemein', metrics: ['minutes_played', 'total_events'] },
  { label: 'Angriff', metrics: ['goals', 'assists', 'goal_involvements', 'conversion_rate', 'shots', 'total_attempts'] },
  { label: 'Verteidigung', metrics: ['tackles', 'duels'] },
  { label: 'Verteilung', metrics: ['passes', 'dribbles', 'interceptions', 'loose_ball_recoveries'] },
  { label: 'Standardsituationen', metrics: ['corners', 'free_kicks', 'fouls', 'penalty_kicks', 'goal_kicks', 'throw_ins'] },
  { label: 'Torwartspiel', metrics: ['saves'] },
]
export const PLAYER_CARD_PHYSICAL = ['distance_covered', 'average_speed', 'top_speed', 'sprints'] as const

// --- Saison (Inventar §2.1) ---------------------------------------------------------------------------

export interface VeoSeasonPlayerInput {
  jerseyNumber: number
  playerId: string | null
  personId: string | null
  name: string | null
  stats: Readonly<Record<string, number>>
}

export interface VeoSeasonPlayerRow {
  // "player:<id>" fuer zugeordnete Spieler, "jersey:<n>" fuer Nummern ohne Zuordnung (Veo "ai-<n>").
  key: string
  playerId: string | null
  personId: string | null
  name: string | null
  // Zuletzt getragene Nummer; ein Spieler kann von Spiel zu Spiel eine andere tragen.
  jerseyNumber: number
  matchCount: number
  values: VeoPlayerMetricValues
}

/** Schluessel einer Saisonzeile: der Spieler, sonst die Rueckennummer. */
export function seasonPlayerKey(player: { playerId: string | null; jerseyNumber: number | null }): string {
  return player.playerId ? `player:${player.playerId}` : `jersey:${player.jerseyNumber}`
}

/**
 * Saisonwerte je Spieler ueber die Spiele (aelteste zuerst): Summen, Hoechstgeschwindigkeit als
 * Maximum, Durchschnittsgeschwindigkeit nach Spielzeit gewichtet (ohne Spielzeit als Mittel). Quoten
 * und abgeleitete Werte kommen aus den Summen, wie Veos Saisontabelle sie zeigt.
 */
export function seasonPlayerRows(matches: readonly { players: readonly VeoSeasonPlayerInput[] }[]): VeoSeasonPlayerRow[] {
  const groups = new Map<string, { row: Omit<VeoSeasonPlayerRow, 'values'>; sums: Map<string, number>; speed: { weighted: number; weight: number; plain: number; count: number } }>()
  for (const match of matches) {
    for (const player of match.players) {
      const key = seasonPlayerKey(player)
      const group = groups.get(key) ?? { row: { key, playerId: player.playerId, personId: player.personId, name: player.name, jerseyNumber: player.jerseyNumber, matchCount: 0 }, sums: new Map(), speed: { weighted: 0, weight: 0, plain: 0, count: 0 } }
      groups.set(key, group)
      group.row = { ...group.row, name: player.name ?? group.row.name, personId: player.personId ?? group.row.personId, jerseyNumber: player.jerseyNumber, matchCount: group.row.matchCount + 1 }
      for (const [statType, value] of Object.entries(player.stats)) {
        if (statType === 'average_speed_kmh') {
          const seconds = player.stats.seconds_played_total ?? 0
          group.speed.weighted += value * seconds
          group.speed.weight += seconds
          group.speed.plain += value
          group.speed.count += 1
        } else if (statType === 'top_speed_kmh') {
          group.sums.set(statType, Math.max(group.sums.get(statType) ?? 0, value))
        } else {
          group.sums.set(statType, (group.sums.get(statType) ?? 0) + value)
        }
      }
    }
  }
  return [...groups.values()].map(({ row, sums, speed }) => {
    const stats = [...sums.entries()].map(([statType, value]) => ({ statType, value }))
    if (speed.count > 0) stats.push({ statType: 'average_speed_kmh', value: speed.weight > 0 ? speed.weighted / speed.weight : speed.plain / speed.count })
    const values = playerMetricValues(stats)
    // Ohne Veos Zaehler "Spiele" gilt die Zahl der Spiele mit Werten.
    values.matches ??= row.matchCount
    return { ...row, values }
  })
}

// Ranglisten (Inventar §2.1.1): Katalog ohne Paesse gesamt, Fehlpaesse, Passquote und Ballgewinne.
export const VEO_LEADERBOARD_METRICS: readonly string[] = VEO_PLAYER_METRICS
  .map((definition) => definition.id)
  .filter((id) => !['total_events', 'passes', 'passes_unsuccessful', 'passes_success_rate', 'recoveries'].includes(id))
export const DEFAULT_LEADERBOARD_METRICS = ['passes_successful', 'goals', 'high_intensity_runs'] as const
export const LEADERBOARD_MAX = 3
const LEADERBOARD_TOP = 5

export interface VeoLeaderboardEntry<T> { rank: number; row: T; value: number }

/**
 * Die besten fuenf einer Kennzahl. Nur Werte ueber 0 zaehlen ("Keine Tore erkannt" statt einer Liste
 * mit Nullen); gleiche Werte teilen den Rang und stehen nach Name.
 */
export function leaderboard<T extends VeoPlayerSortable>(rows: readonly T[], metric: string, top = LEADERBOARD_TOP): VeoLeaderboardEntry<T>[] {
  const ranked = sortPlayerRows(rows.filter((row) => (row.values[metric] ?? 0) > 0), { column: metric, direction: 'desc' })
  return ranked.slice(0, top).map((row, index, list) => {
    const value = row.values[metric]!
    const first = list.findIndex((other) => other.values[metric] === value)
    return { rank: first + 1, row, value }
  })
}

// Spielervergleich (Inventar §2.1.5): Gruppen und Reihenfolge wie Veo.
export const PLAYER_COMPARISON_GROUPS: readonly { label: string; metrics: readonly string[] }[] = [
  { label: 'Allgemein', metrics: ['matches', 'total_events', 'player_of_the_match', 'captaincies'] },
  { label: 'Physis', metrics: ['minutes_played', 'distance_covered', 'average_speed', 'top_speed', 'high_intensity_runs', 'sprints'] },
  { label: 'Verteilung', metrics: ['passes', 'passes_success_rate', 'passes_successful', 'passes_unsuccessful'] },
  { label: 'Angriff', metrics: ['assists', 'conversion_rate', 'dribbles', 'goals', 'goal_involvements', 'shots', 'total_attempts'] },
  { label: 'Verteidigung', metrics: ['tackles', 'duels', 'interceptions', 'loose_ball_recoveries'] },
  { label: 'Standardsituationen', metrics: ['corners', 'free_kicks', 'goal_kicks', 'penalty_kicks', 'throw_ins', 'fouls'] },
  { label: 'Torwartspiel', metrics: ['saves'] },
]

export interface VeoPlayerComparisonRow { id: string; a: number | undefined; b: number | undefined; higher: 'a' | 'b' | null }

/** Zwei Spieler nebeneinander; Zeilen ohne Wert bei beiden entfallen, der hoehere Wert ist markiert. */
export function comparePlayers(a: VeoPlayerMetricValues, b: VeoPlayerMetricValues): { label: string; rows: VeoPlayerComparisonRow[] }[] {
  return PLAYER_COMPARISON_GROUPS.map((group) => ({
    label: group.label,
    rows: group.metrics.flatMap((id) => {
      const left = a[id]
      const right = b[id]
      if (left === undefined && right === undefined) return []
      const higher = (left ?? -Infinity) > (right ?? -Infinity) ? 'a' : (right ?? -Infinity) > (left ?? -Infinity) ? 'b' : null
      return [{ id, a: left, b: right, higher } as VeoPlayerComparisonRow]
    }),
  })).filter((group) => group.rows.length > 0)
}
