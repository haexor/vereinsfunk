import { combineHeatmaps } from '@vereinsfunk/domain'
import { decodeBase64 } from '../utils/playerboardVeoAnalysis'
import type { VeoSeasonFilter } from './usePlayerboardVeoSeason'

// Spec 002, PR 5: Saison-Heatmap eines Spielers aus Veos Matrizen der gefilterten Spiele, nach
// Spielsekunden gewichtet (research.md R-05). Heatmap-Abschnitt, Vergleich und Spielerkarte fragen
// denselben Spieler oft mehrfach; der Zwischenspeicher gilt fuer eine Mannschaft und einen Filter.
export interface VeoSeasonHeatmap { grid: Float32Array; width: number; height: number; matchCount: number }

export function usePlayerboardVeoPlayerHeatmaps(teamId: Ref<string | null>, filter: Ref<VeoSeasonFilter>) {
  const { loadPlayerHeatmaps } = usePlayerboardVeoSeason()
  const cache = new Map<string, Promise<VeoSeasonHeatmap | null>>()
  watch([teamId, filter], () => cache.clear(), { deep: true })

  function heatmapOf(player: { key: string; playerId: string | null; jerseyNumber: number | null }): Promise<VeoSeasonHeatmap | null> {
    const cached = cache.get(player.key)
    if (cached) return cached
    if (!teamId.value || (!player.playerId && player.jerseyNumber === null)) return Promise.resolve(null)
    const target = player.playerId ? { playerId: player.playerId } : { jerseyNumber: player.jerseyNumber! }
    const request = loadPlayerHeatmaps(teamId.value, filter.value, target).then((heatmaps) => {
      const first = heatmaps[0]
      const sized = heatmaps.filter((heatmap) => heatmap.width === first?.width && heatmap.height === first?.height)
      const grid = combineHeatmaps(sized.map((heatmap) => ({ cells: decodeBase64(heatmap.cells), weight: heatmap.secondsPlayed ?? 1 })))
      return grid && first && grid.some((value) => value > 0) ? { grid, width: first.width, height: first.height, matchCount: sized.length } : null
    })
    // Ein Fehler soll beim naechsten Versuch neu laden.
    request.catch(() => { if (cache.get(player.key) === request) cache.delete(player.key) })
    cache.set(player.key, request)
    return request
  }

  return { heatmapOf }
}
