// Spec 002 (research.md R-08): Ableitungen der Veo-Spielauswertung als reine Funktionen, mit Veos
// Regeln und Rundungen aus dem Inventar. Eingaben sind die normierten Daten der Lesefunktion (jede
// Mannschaft greift Richtung x = 1 an); `period` null steht fuer das ganze Spiel.

import { isInsidePenaltyBox, periodAt, type PitchPeriod, type PitchTeam, type PitchThird } from './veoPitch.js'

export interface VeoPeriodValue { period: number; value: number }
export interface VeoTeamStatInput { teamAssociation: PitchTeam; statType: string; value: number; periodValues: readonly VeoPeriodValue[] }

interface VeoTeamPassPossession {
  possessionSeconds: number
  passesCompleted: number
  possessionWon: number
  passStrings: readonly (readonly [number, number])[]
  passThirds: Readonly<Record<PitchThird, number>>
  possessionThirds: Readonly<Record<PitchThird, number>>
}
export interface VeoPassPossessionInput { periodNumber: number; durationS: number; own: VeoTeamPassPossession; opponent: VeoTeamPassPossession }

/** Wert eines Spielwerts fuer das ganze Spiel oder eine Halbzeit; fehlt die Halbzeit, ist er 0 (Inventar §1a.2). */
export function statValue(stat: Pick<VeoTeamStatInput, 'value' | 'periodValues'>, period: number | null): number {
  if (period === null) return stat.value
  return stat.periodValues.find((entry) => entry.period === period)?.value ?? 0
}

// --- Gegenueberstellung (Inventar §1a.2, §1a.3.1) -------------------------------------------------

export type VeoComparisonUnit = 'count' | 'percent' | 'minutes'
export interface VeoComparisonRow {
  key: string
  own: number
  opponent: number
  // Nur bei Ballbesitzminuten: Zeit ohne Ballbesitz einer Mannschaft.
  unassigned: number | null
  unit: VeoComparisonUnit
  // Der unterlegene Wert wird in Veo abgeschwaecht; bei Gleichstand keiner.
  losing: PitchTeam | null
}

// Reihenfolge der Zeilen: Tore und Abschluesse, Ballbesitz und Paesse (RAS), dann die Ereignisse.
const EVENT_ROWS_BEFORE = ['football_goal_total', 'football_attempts_total', 'football_shots_total'] as const
const EVENT_ROWS_AFTER = [
  'football_corner_total', 'football_free_kick_total', 'football_throw_in_total', 'football_goal_kick_total', 'football_penalty_total',
  'football_foul_total', 'football_tackle_total', 'football_duel_total', 'football_dribble_total', 'football_interception_total',
  'football_loose_total', 'football_save_total',
] as const

function row(key: string, own: number, opponent: number, unit: VeoComparisonUnit, unassigned: number | null = null): VeoComparisonRow {
  return { key, own, opponent, unassigned, unit, losing: own === opponent ? null : own < opponent ? 'own' : 'opponent' }
}

function passPossessionFor(input: readonly VeoPassPossessionInput[] | null, period: number | null): VeoPassPossessionInput[] {
  return (input ?? []).filter((entry) => period === null || entry.periodNumber === period)
}

/**
 * Zeilen der Gegenueberstellung wir/Gegner. Abschluesse = Tore + Schuesse ohne Tor, wenn Veo sie
 * nicht selbst liefert (`mt`/`gt`). Ballbesitz % rundet je Seite, Ballbesitzminuten zeigen dazu die
 * Zeit ohne Ballbesitz (Summe der Halbzeitdauern minus beider Ballbesitzzeiten).
 */
export function comparisonRows(teamStats: readonly VeoTeamStatInput[], passPossession: readonly VeoPassPossessionInput[] | null, period: number | null): VeoComparisonRow[] {
  const values = new Map<string, Record<PitchTeam, number>>()
  for (const stat of teamStats) {
    const entry = values.get(stat.statType) ?? { own: 0, opponent: 0 }
    entry[stat.teamAssociation] = statValue(stat, period)
    values.set(stat.statType, entry)
  }
  const goals = values.get('football_goal_total')
  const shots = values.get('football_shots_total')
  if (!values.has('football_attempts_total') && goals && shots) {
    values.set('football_attempts_total', { own: goals.own + shots.own, opponent: goals.opponent + shots.opponent })
  }
  const eventRows = (keys: readonly string[]) => keys.flatMap((key) => {
    const entry = values.get(key)
    return entry ? [row(key, entry.own, entry.opponent, 'count')] : []
  })

  const rasRows: VeoComparisonRow[] = []
  const periods = passPossessionFor(passPossession, period)
  if (periods.length > 0) {
    const sum = (pick: (entry: VeoPassPossessionInput) => number) => periods.reduce((total, entry) => total + pick(entry), 0)
    const own = sum((entry) => entry.own.possessionSeconds)
    const opponent = sum((entry) => entry.opponent.possessionSeconds)
    if (own + opponent > 0) {
      rasRows.push(row('possession_percent', Math.round((own / (own + opponent)) * 100), Math.round((opponent / (own + opponent)) * 100), 'percent'))
      const unassigned = Math.max(0, sum((entry) => entry.durationS) - own - opponent)
      rasRows.push(row('possession_minutes', Math.round(own / 60), Math.round(opponent / 60), 'minutes', Math.round(unassigned / 60)))
    }
    rasRows.push(row('passes_completed', sum((entry) => entry.own.passesCompleted), sum((entry) => entry.opponent.passesCompleted), 'count'))
    rasRows.push(row('possession_won', sum((entry) => entry.own.possessionWon), sum((entry) => entry.opponent.possessionWon), 'count'))
  }
  return [...eventRows(EVENT_ROWS_BEFORE), ...rasRows, ...eventRows(EVENT_ROWS_AFTER)]
}

/** Balkenanteile in Prozent: eigene Mannschaft, ohne Ballbesitz, Gegner (`Ps`). */
export function comparisonShares(entry: Pick<VeoComparisonRow, 'own' | 'opponent' | 'unassigned'>): { own: number; unassigned: number; opponent: number } {
  const total = entry.own + entry.opponent + (entry.unassigned ?? 0)
  if (total <= 0) return { own: 0, unassigned: 0, opponent: 0 }
  const own = (entry.own / total) * 100
  const opponent = (entry.opponent / total) * 100
  return { own, unassigned: 100 - own - opponent, opponent }
}

// --- Schusskarte (Inventar §1a.7, §1a.12) ---------------------------------------------------------

export interface VeoEventInput {
  id: string
  teamAssociation: PitchTeam
  eventType: string
  jerseyNumber: number | null
  playerId: string | null
  periodNumber: number
  periodTimeMs: number
  videoTimeMs: number
  x: number | null
  y: number | null
  assistJerseyNumber: number | null
}

export interface VeoShot {
  id: string
  team: PitchTeam
  goal: boolean
  x: number | null
  y: number | null
  jerseyNumber: number | null
  playerId: string | null
  assistJerseyNumber: number | null
  periodNumber: number
  periodTimeMs: number
  videoTimeMs: number
}

// Veo fuehrt ein Tor mit dem Schuss derselben Mannschaft davor zusammen, wenn er hoechstens 10 s
// vorher war (eventsSlice). Das Tor hat bei Veo keinen eigenen Ort; er kommt vom Schuss.
const GOAL_SHOT_WINDOW_MS = 10_000

/**
 * Schuesse und Tore beider Mannschaften. Ein Tor ohne Schuss davor (etwa von Hand in Veo angelegt)
 * zaehlt trotzdem als Tor, aber ohne Ort -- so stimmt die Zahl der Tore mit dem Ergebnis.
 */
export function shotsFromEvents(events: readonly VeoEventInput[]): VeoShot[] {
  const sorted = [...events].sort((a, b) => a.videoTimeMs - b.videoTimeMs)
  const shots = sorted.filter((event) => event.eventType === 'FootballShot')
  const merged = new Set<string>()
  const result: VeoShot[] = []
  for (const goal of sorted.filter((event) => event.eventType === 'FootballGoal')) {
    const shot = shots.filter((candidate) => !merged.has(candidate.id) && candidate.teamAssociation === goal.teamAssociation
      && candidate.videoTimeMs <= goal.videoTimeMs && goal.videoTimeMs - candidate.videoTimeMs <= GOAL_SHOT_WINDOW_MS).at(-1)
    if (shot) merged.add(shot.id)
    result.push({
      ...toShot(goal, true),
      x: shot?.x ?? goal.x, y: shot?.y ?? goal.y,
      jerseyNumber: goal.jerseyNumber ?? shot?.jerseyNumber ?? null,
      playerId: goal.playerId ?? shot?.playerId ?? null,
    })
  }
  for (const shot of shots) if (!merged.has(shot.id)) result.push(toShot(shot, false))
  return result.sort((a, b) => a.videoTimeMs - b.videoTimeMs)
}

function toShot(event: VeoEventInput, goal: boolean): VeoShot {
  return {
    id: event.id, team: event.teamAssociation, goal, x: event.x, y: event.y, jerseyNumber: event.jerseyNumber, playerId: event.playerId,
    assistJerseyNumber: event.assistJerseyNumber, periodNumber: event.periodNumber, periodTimeMs: event.periodTimeMs, videoTimeMs: event.videoTimeMs,
  }
}

export interface VeoShotSummary {
  goals: number
  // Schuesse ohne Tor ("Shots" in Veo).
  shots: number
  total: number
  // Quoten in ganzen Prozent; null, wenn es nichts zu teilen gibt.
  conversionRate: number | null
  insideBoxConversionRate: number | null
  outsideBoxConversionRate: number | null
  insideBoxShare: number | null
  outsideBoxShare: number | null
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null)

/** Zahlen und Quoten der Schusskarte; Strafraumwerte nur aus Abschluessen mit Ort. */
export function shotSummary(shots: readonly VeoShot[]): VeoShotSummary {
  const goals = shots.filter((shot) => shot.goal).length
  const located = shots.filter((shot) => shot.x !== null && shot.y !== null)
  const inside = located.filter((shot) => isInsidePenaltyBox({ x: shot.x!, y: shot.y! }))
  const outside = located.filter((shot) => !inside.includes(shot))
  return {
    goals,
    shots: shots.length - goals,
    total: shots.length,
    conversionRate: percent(goals, shots.length),
    insideBoxConversionRate: percent(inside.filter((shot) => shot.goal).length, inside.length),
    outsideBoxConversionRate: percent(outside.filter((shot) => shot.goal).length, outside.length),
    insideBoxShare: percent(inside.length, located.length),
    outsideBoxShare: percent(outside.length, located.length),
  }
}

// --- Drittel (Inventar §1a.3.2, §1a.3.3) ----------------------------------------------------------

/** Anteile (0-1) der angekommenen Paesse bzw. des Ballbesitzes je Drittel aus Sicht der Mannschaft. */
export function thirdShares(passPossession: readonly VeoPassPossessionInput[] | null, team: PitchTeam, period: number | null, kind: 'pass' | 'possession'): Record<PitchThird, number> | null {
  const totals = { defensive: 0, middle: 0, attacking: 0 }
  for (const entry of passPossessionFor(passPossession, period)) {
    const thirds = kind === 'pass' ? entry[team].passThirds : entry[team].possessionThirds
    totals.defensive += thirds.defensive
    totals.middle += thirds.middle
    totals.attacking += thirds.attacking
  }
  const total = totals.defensive + totals.middle + totals.attacking
  if (total <= 0) return null
  return { defensive: totals.defensive / total, middle: totals.middle / total, attacking: totals.attacking / total }
}

// --- Passketten (Inventar §1a.6) ------------------------------------------------------------------

// Veo zeigt Ketten ab drei Paessen; 2er-Ketten nur hinter einem Schalter. 10 steht fuer "+10".
export const PASS_STRING_LENGTHS = [3, 4, 5, 6, 7, 8, 9, 10] as const
// Feste Hoehe der Achse: 20 Ketten fuellen den Balken.
export const PASS_STRING_AXIS_MAX = 20

export interface VeoPassStringSummary {
  bars: { length: number; count: number }[]
  threeToFive: number
  sixOrMore: number
  // Laengste Kette; null ohne Ketten ("?" in Veo).
  longest: number | null
}

/** Passketten einer Mannschaft; fuers ganze Spiel werden die Halbzeiten je Laenge zusammengezaehlt. */
export function passStringSummary(passPossession: readonly VeoPassPossessionInput[] | null, team: PitchTeam, period: number | null): VeoPassStringSummary {
  const counts = new Map<number, number>()
  for (const entry of passPossessionFor(passPossession, period)) {
    for (const [length, count] of entry[team].passStrings) counts.set(length, (counts.get(length) ?? 0) + count)
  }
  const sumWhere = (match: (length: number) => boolean) => [...counts].reduce((total, [length, count]) => total + (match(length) ? count : 0), 0)
  const lengths = [...counts].filter(([, count]) => count > 0).map(([length]) => length)
  return {
    bars: PASS_STRING_LENGTHS.map((length) => ({ length, count: length === 10 ? sumWhere((n) => n >= 10) : counts.get(length) ?? 0 })),
    threeToFive: sumWhere((n) => n >= 3 && n <= 5),
    sixOrMore: sumWhere((n) => n >= 6),
    longest: lengths.length > 0 ? Math.max(...lengths) : null,
  }
}

// --- Spielverlauf (Inventar §1a.11) ---------------------------------------------------------------

export interface VeoMomentum {
  // Positiv = Geschehen am Ende der Heimmannschaft zum Angriff hin; null ausserhalb der Halbzeiten.
  points: [number, number | null][]
  // Anteil der Punkte je Seite in ganzen Prozent ("Action location %").
  homeShare: number | null
  awayShare: number | null
}

/**
 * Normiert Veos Spielverlauf auf die Heimmannschaft: Veo dreht das Vorzeichen, wenn die eigene
 * Mannschaft zu Hause rechts bzw. auswaerts links verteidigt. Ist unbekannt, ob die eigene
 * Mannschaft zu Hause spielt, gilt sie wie bei Veo als Heimmannschaft.
 */
export function momentumSeries(raw: readonly (readonly [number, number | null])[], periods: readonly PitchPeriod[], isHome: boolean | null): VeoMomentum {
  const ownHome = isHome !== false
  const points = raw.map(([time, value]): [number, number | null] => {
    const period = periodAt(periods, time)
    if (!period || value === null) return [time, null]
    const flip = ownHome ? period.ownSide === 'right' : period.ownSide === 'left'
    return [time, flip ? -value : value]
  })
  const known = points.filter(([, value]) => value !== null).length
  const count = (match: (value: number) => boolean) => points.filter(([, value]) => value !== null && match(value)).length
  return {
    points,
    homeShare: percent(count((value) => value > 0), known),
    awayShare: percent(count((value) => value < 0), known),
  }
}

// --- Spielzeit (Inventar §3.3) --------------------------------------------------------------------

/** Spielminute eines Ereignisses: Dauer der Halbzeiten davor plus Zeit in der Halbzeit, ab Minute 1. */
export function matchMinute(periods: readonly PitchPeriod[], periodNumber: number, periodTimeMs: number): number {
  const before = periods.filter((period) => period.number < periodNumber).reduce((total, period) => total + (period.endS - period.startS), 0)
  return Math.floor((before + periodTimeMs / 1000) / 60) + 1
}
