import { keyMetricDefinition, type VeoSeasonKeyMetric } from '@vereinsfunk/domain'
import type { VeoSeasonFilter } from '../composables/usePlayerboardVeoSeason'

// Spec 002, PR 4: Veo Analytics -- Filterzustand in der URL (Links lassen sich teilen) und
// Darstellung der Kennzahlen.

export const KIND_LABELS: Readonly<Record<string, string>> = {
  match: 'Punktspiel',
  friendly: 'Freundschaftsspiel',
  tournament: 'Turnier',
  cup: 'Pokal',
}
export const LAST_OPTIONS = [3, 5, 10, 20] as const
const DEFAULT_LAST = 10

export interface AnalyticsFilterState {
  mode: 'last' | 'range' | 'selection'
  last: number
  from: string
  to: string
  kinds: string[]
  fixtureIds: string[]
}

const listOf = (value: unknown) => (typeof value === 'string' && value ? value.split(',').filter(Boolean) : [])
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** Filter aus der URL-Query; Standard wie Veo: die letzten 10 Spiele aller Spielarten. */
export function filterFromQuery(query: Record<string, unknown>): AnalyticsFilterState {
  const kinds = listOf(query.art).filter((kind) => kind in KIND_LABELS)
  const fixtureIds = listOf(query.spiele)
  const last = Number(query.anzahl)
  const base = { last: (LAST_OPTIONS as readonly number[]).includes(last) ? last : DEFAULT_LAST, from: '', to: '', kinds, fixtureIds: [] as string[] }
  if (fixtureIds.length > 0) return { ...base, mode: 'selection', fixtureIds }
  if (isDate(query.von) || isDate(query.bis)) return { ...base, mode: 'range', from: isDate(query.von) ? query.von : '', to: isDate(query.bis) ? query.bis : '' }
  return { ...base, mode: 'last' }
}

/** Filter als URL-Query; Standardwerte bleiben weg, damit die URL kurz bleibt. */
export function filterToQuery(state: AnalyticsFilterState): Record<string, string> {
  const query: Record<string, string> = {}
  if (state.mode === 'selection' && state.fixtureIds.length) return { spiele: state.fixtureIds.join(',') }
  if (state.kinds.length) query.art = state.kinds.join(',')
  if (state.mode === 'range') {
    if (state.from) query.von = state.from
    if (state.to) query.bis = state.to
  } else if (state.last !== DEFAULT_LAST) query.anzahl = String(state.last)
  return query
}

/** Filter fuer die API; eine Auswahl gilt allein. */
export function seasonFilter(state: AnalyticsFilterState): VeoSeasonFilter {
  if (state.mode === 'selection' && state.fixtureIds.length) return { fixtureIds: state.fixtureIds }
  const kinds = state.kinds.length ? { kinds: state.kinds } : {}
  if (state.mode === 'range') return { ...kinds, ...(state.from ? { from: state.from } : {}), ...(state.to ? { to: state.to } : {}) }
  return { ...kinds, last: state.last }
}

/** Wert einer Kennzahl mit Einheit; ohne Wert ein Strich. */
export function formatKeyMetric(id: string, value: number | null): string {
  if (value === null) return '–'
  const unit = keyMetricDefinition(id)?.unit
  const number = value.toLocaleString('de-DE', { maximumFractionDigits: 1 })
  return unit === 'percent' ? `${number} %` : unit === 'minutes' ? `${number} min` : number
}

/** Hilfetext einer Kennzahlkarte wie Veo: "Durchschnitt ...", Siegquote ohne. */
export function keyMetricCaption(metric: VeoSeasonKeyMetric, matchCount: number): string {
  if (metric.matchCount === 0) return 'Noch kein Spiel mit Veo-Analyse.'
  const base = metric.id === 'win_ratio' ? 'Siegquote' : `Durchschnitt ${keyMetricDefinition(metric.id)?.label ?? metric.id}`
  return metric.matchCount < matchCount ? `${base} · aus ${metric.matchCount} von ${matchCount} Spielen` : base
}
