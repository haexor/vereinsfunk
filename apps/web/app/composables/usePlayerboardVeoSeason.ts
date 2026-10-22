import {
  PlayerboardVeoSeasonMatchSchema,
  PlayerboardVeoTeamViewsSchema,
  type PlayerboardVeoTeamViews,
} from '@vereinsfunk/contracts'

// Spec 002, PR 4: Veo Analytics -- Saison einer Mannschaft und ihre Kennzahlen-Auswahl.
export interface VeoSeasonFilter {
  from?: string
  to?: string
  kinds?: readonly string[]
  last?: number
  fixtureIds?: readonly string[]
}

export function usePlayerboardVeoSeason() {
  const api = useApiClient()

  /** Gefilterte Spiele der Mannschaft, aeltestes zuerst. */
  function loadSeason(teamId: string, filter: VeoSeasonFilter) {
    const query: Record<string, string> = {}
    if (filter.from) query.from = filter.from
    if (filter.to) query.to = filter.to
    if (filter.kinds?.length) query.kinds = filter.kinds.join(',')
    if (filter.last) query.last = String(filter.last)
    if (filter.fixtureIds?.length) query.fixtureIds = filter.fixtureIds.join(',')
    return api.request(`/v1/playerboard/teams/${teamId}/veo/season`, { query }, PlayerboardVeoSeasonMatchSchema.array())
  }

  /** Kennzahlen-Auswahl und Radar der Mannschaft; leer = Veos Standard. */
  function loadViews(teamId: string) {
    return api.request(`/v1/playerboard/teams/${teamId}/veo/views`, {}, PlayerboardVeoTeamViewsSchema)
  }

  /** Speichert Auswahl und Radar (training.manage). */
  function saveViews(teamId: string, views: PlayerboardVeoTeamViews) {
    return api.request(`/v1/playerboard/teams/${teamId}/veo/views`, { method: 'PUT', body: views }, PlayerboardVeoTeamViewsSchema)
  }

  return { loadSeason, loadViews, saveViews }
}
