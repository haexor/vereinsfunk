import type { ResolvedIcalDateTime } from '@vereinsfunk/integrations'

/**
 * Loest einen rohen Quell-Zeitpunkt (iCal-Kompaktform samt TZID oder eine ISO-Spalte) in eine
 * UTC-Instanz auf. Die API reicht hier genau die Aufloesung in der Vereinszeitzone herein, mit der
 * sie kickoff_at/starts_at auch schreibt (resolveScheduleDateTime) -- dieses Package kennt die
 * Vereinszeitzone nicht. Abgleich und Schreibpfad sehen so dieselbe Instanz.
 */
export type ScheduleDateTimeResolver = (rawValue: string, tzid: string | undefined) => ResolvedIcalDateTime | undefined

export interface ScheduleMatchContext {
  readonly resolveDateTime: ScheduleDateTimeResolver
  /**
   * Bezugszeitpunkt des Laufs. Ein bereits vergangenes Spiel/eine vergangene Veranstaltung, die
   * aus der Quelle verschwindet, wurde nicht abgesagt -- Feeds lassen Vergangenes regelmaessig
   * fallen, spaetestens beim Saisonwechsel. Von aussen, damit der Abgleich ohne Uhr testbar bleibt.
   */
  readonly now: Date
}

// Vergleichswert eines rohen Zeitpunkts in Epoch-Millisekunden: "2026-08-12T19:30:00+02:00",
// "20260812T173000Z" und local.toISOString() bezeichnen dieselbe Instanz in drei Schreibweisen und
// duerfen weder als Aenderung noch als verfehlter unscharfer Schluessel gelten. Ein nicht
// aufloesbarer Wert bleibt roh und zaehlt damit als Unterschied; der Schreibpfad meldet ihn dann.
export function comparableInstant(context: ScheduleMatchContext, rawValue: string, tzid: string | undefined): number | string {
  const resolved = context.resolveDateTime(rawValue, tzid)
  return resolved ? Date.parse(resolved.iso) : rawValue
}
