import {
  PlayerboardCategorySchema,
  PlayerboardPlayerSchema,
  PlayerboardRankingEntrySchema,
  ScopePlayerboardSettingsSchema,
  type PlayerboardPlayer,
} from '@vereinsfunk/contracts'
import { currentSeasonStart } from '@vereinsfunk/domain'
import { localDateKey } from '../utils/memberDates'
import type { RankingListItem, RankingRange } from '../utils/playerboardRanking'

// Paket 052, PR 4: gemeinsame Ladelogik fuer Rangliste, PlayerBoard-Uebersicht und die Kachel auf
// der Startseite. Lesen duerfen alle, die die Werte der Mannschaft sehen (stats_visibility).
export function usePlayerboardRanking() {
  const api = useApiClient()

  /** Anfang der laufenden Saison aus dem wirksamen Saisonbeginn der Mannschaft; null ohne Saisonbeginn. */
  async function loadSeasonFrom(organizationId: string, teamId: string, timezone: string): Promise<string | null> {
    const entries = await api.request(`/v1/organizations/${organizationId}/playerboard/settings`, {}, ScopePlayerboardSettingsSchema.array())
    const team = entries.find((entry) => entry.scope === 'team' && entry.scopeId === teamId)
    return currentSeasonStart(team?.effective.seasonStart ?? null, localDateKey(new Date(), timezone))
  }

  /**
   * Rangliste eines Zeitraums als Listeneintraege: Kategorien in der Reihenfolge der Mannschaft,
   * die eigene Zeile (isSelf im Kader) hervorgehoben.
   */
  async function loadRankingItems(teamId: string, range: RankingRange): Promise<{ items: RankingListItem[]; players: PlayerboardPlayer[] }> {
    const [ranking, categories, players] = await Promise.all([
      api.request(`/v1/playerboard/teams/${teamId}/ranking`, { query: { ...range } }, PlayerboardRankingEntrySchema.array()),
      api.request('/v1/playerboard/categories', { query: { scope: 'team', scopeId: teamId } }, PlayerboardCategorySchema.array()),
      api.request(`/v1/playerboard/teams/${teamId}/players`, {}, PlayerboardPlayerSchema.array()),
    ])
    const selfId = players.find((player) => player.isSelf)?.id ?? null
    const items = ranking.map((entry) => ({
      key: entry.playerId,
      rank: entry.rank,
      label: `${entry.jerseyNumber !== null ? `#${entry.jerseyNumber} ` : ''}${entry.firstName} ${entry.lastName}`,
      total: entry.total,
      highlight: entry.playerId === selfId,
      categories: categories
        .filter((category) => category.id in entry.categoryTotals)
        .map((category) => ({ name: category.name, points: entry.categoryTotals[category.id] ?? 0 })),
    }))
    return { items, players }
  }

  return { loadSeasonFrom, loadRankingItems }
}
