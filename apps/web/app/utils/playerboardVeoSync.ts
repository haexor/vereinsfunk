import type { PlayerboardVeoSyncProgress, PlayerboardVeoSyncRun } from '@vereinsfunk/contracts'

// Spec 002: Anzeige des Zwischenstands eines Veo-Abgleichs. Der Balken zaehlt Spiele; das Spiel in
// Arbeit zaehlt anteilig nach den geladenen Fenstern seiner Positionsdaten, dem langsamsten Teil.

// So lange fragt die Seite bei einem laufenden Abgleich nach: laenger als Hatchets Zeitlimit samt
// Wiederholungen. Danach gilt der Lauf als haengend; der naechste Anstoss gibt ihn frei.
export const SYNC_POLL_LIMIT_MS = 35 * 60_000
// Ohne neuen Stand seit dieser Zeit weist die Seite darauf hin, dass der Abgleich nicht antwortet.
export const SYNC_SILENCE_MS = 3 * 60_000

/** Anteil 0..1 des Laufs; null, solange Veo die Spieleliste noch nicht geliefert hat. */
export function syncFraction(progress: PlayerboardVeoSyncProgress | null): number | null {
  if (!progress || progress.matchesTotal === 0) return null
  const current = progress.current
  const partial = current?.step === 'tracks' && current.tracksTotal ? (current.tracksDone ?? 0) / current.tracksTotal : 0
  return Math.min(1, (progress.matchesDone + partial) / progress.matchesTotal)
}

/** Was der Abgleich gerade tut, in einem Satz. */
export function syncStepText(progress: PlayerboardVeoSyncProgress | null): string {
  if (!progress) return 'Verbindung zu Veo wird aufgebaut …'
  const current = progress.current
  if (!current) return progress.matchesDone >= progress.matchesTotal ? 'Abgleich wird abgeschlossen …' : 'Spiele werden abgeglichen …'
  const match = `Spiel ${Math.min(progress.matchesDone + 1, progress.matchesTotal)} von ${progress.matchesTotal} · gegen ${current.opponentName}`
  if (current.step === 'values') return `${match}: Werte werden geladen`
  if (current.step === 'analysis') return `${match}: Spielanalyse wird geladen`
  return `${match}: Positionsdaten ${current.tracksDone ?? 0} von ${current.tracksTotal ?? 0}`
}

/** Minuten seit dem letzten Lebenszeichen eines laufenden Abgleichs, wenn es zu lange her ist. */
export function syncSilentMinutes(run: Pick<PlayerboardVeoSyncRun, 'status' | 'startedAt' | 'progress'>, now: number): number | null {
  if (run.status !== 'running') return null
  const silent = now - Date.parse(run.progress?.updatedAt ?? run.startedAt)
  return silent >= SYNC_SILENCE_MS ? Math.floor(silent / 60_000) : null
}

/** Offene Spielanalysen, die ein Lauf aus Zeitgruenden dem naechsten ueberlassen hat. */
export function deferredAnalyses(run: Pick<PlayerboardVeoSyncRun, 'progress'> | undefined): number {
  return run?.progress?.analysesDeferred ?? 0
}
