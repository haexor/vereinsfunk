import type { PlayerboardVeoAnalysisPart, PlayerboardVeoAvailability, PlayerboardVeoPeriod } from '@vereinsfunk/contracts'
import { statLabel } from './playerboardVeo'

// Spec 002, PR 2: Darstellung der Spielauswertung -- Hinweise je Teil (FR-066), Links ins
// Veo-Video (R-11), Zeiten und Bezeichnungen. Keine Werbung fuer Veo-Abos, keine Sperrhinweise.

const REASON_TEXT: Readonly<Record<string, string>> = {
  veo_processing: 'Veo wertet dieses Spiel noch aus. Der nächste Abgleich holt die Ansicht nach.',
  periods_missing: 'In Veo fehlen für dieses Spiel Seiten und Halbzeiten. Sobald sie in Veo gesetzt sind, erscheint die Ansicht nach dem nächsten Abgleich.',
  older_analytics_version: 'Dieses Spiel wurde mit einer älteren Veo-Analyse ausgewertet; diese Ansicht gibt es dafür nicht.',
  not_provided: 'Veo liefert diese Ansicht für dieses Spiel nicht.',
  no_jersey: 'Veo hat in diesem Spiel keine Rückennummern erkannt.',
}

/** Ist ein Teil der Analyse da? */
export function isPartAvailable(availability: PlayerboardVeoAvailability, part: PlayerboardVeoAnalysisPart): boolean {
  return availability[part]?.status === 'available'
}

/** Hinweis, warum ein Teil fehlt; null, wenn er da ist. */
export function availabilityHint(availability: PlayerboardVeoAvailability, part: PlayerboardVeoAnalysisPart): string | null {
  const entry = availability[part]
  if (entry?.status === 'available') return null
  if (!entry) return 'Für dieses Spiel liegt noch keine Veo-Analyse vor. Der nächste Abgleich holt sie.'
  if (entry.reason) return REASON_TEXT[entry.reason] ?? REASON_TEXT.not_provided!
  return entry.status === 'pending' ? REASON_TEXT.veo_processing! : REASON_TEXT.not_provided!
}

/** Sekunden als m:ss bzw. mm:ss; Minuten laufen ueber 59 hinaus wie bei Veo. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

// Veos "Full recording" springt 3 s vor das Ereignis.
const VIDEO_LEAD_S = 3

/** Link ins Veo-Video an der Stelle eines Ereignisses; null ohne bekannten Veo-Link. */
export function veoVideoLink(veoUrl: string | null, videoTimeMs: number): string | null {
  if (!veoUrl) return null
  return `${veoUrl}#t=${formatClock(videoTimeMs / 1000 - VIDEO_LEAD_S)}`
}

/** Auswahl der Halbzeit: null = ganzes Spiel. */
export function periodOptions(periods: readonly PlayerboardVeoPeriod[], withFullMatch = true): { value: number | null; label: string }[] {
  const options = periods.map((period) => ({ value: period.number as number | null, label: `${period.number}. Halbzeit` }))
  return withFullMatch ? [{ value: null, label: 'Ganzes Spiel' }, ...options] : options
}

const COMPARISON_LABELS: Readonly<Record<string, string>> = {
  football_shots_total: 'Schüsse ohne Tor',
  possession_percent: 'Ballbesitz %',
  possession_minutes: 'Ballbesitz-Minuten',
  passes_completed: 'Angekommene Pässe',
  possession_won: 'Ballgewinne',
}

/** Bezeichnung einer Zeile der Gegenueberstellung. */
export function comparisonLabel(key: string): string {
  return COMPARISON_LABELS[key] ?? statLabel(key)
}

export const EVENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  FootballGoal: 'Tor',
  FootballShot: 'Schuss',
  pass: 'Pass',
  tackle: 'Tackling',
  duel: 'Zweikampf',
  dribble: 'Dribbling',
  interception: 'Abfangen',
  loose: 'Ballgewinn (loser Ball)',
  save: 'Parade',
  FootballFoul: 'Foul',
  FootballOutOfPlay: 'Aus',
  FootballKickOff: 'Anstoß',
  FootballGoalKick: 'Abstoß',
  FootballCornerKick: 'Ecke',
  FootballFreeKick: 'Freistoß',
  FootballThrowIn: 'Einwurf',
  FootballPenaltyKick: 'Elfmeter',
}

/** Bezeichnung einer Ereignisart; Unbekanntes bleibt als Veo-Typ stehen. */
export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType
}

/** base64 (eine Zeile) als Bytes. */
export function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

/** Prozent ohne Nachkommastellen, null als Strich. */
export function percentLabel(value: number | null): string {
  return value === null ? '–' : `${value} %`
}
