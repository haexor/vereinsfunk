import { PlayerboardVeoMatchAnalysisSchema, PlayerboardVeoMatchTracksSchema } from '@vereinsfunk/contracts'

// Spec 002, PR 2: Spielauswertung eines Veo-Spiels. Die Positionsdaten sind gross und werden erst
// geladen, wenn die Heatmap der Mannschaft sie braucht.
export function usePlayerboardVeoAnalysis() {
  const api = useApiClient()

  /** Auswertung eines Spiels der Mannschaft. */
  function loadAnalysis(teamId: string, fixtureId: string) {
    return api.request(`/v1/playerboard/teams/${teamId}/veo/matches/${fixtureId}/analysis`, {}, PlayerboardVeoMatchAnalysisSchema)
  }

  /** Positionsdaten des Spiels je Spielfeldseite (1 Hz). */
  function loadTracks(teamId: string, fixtureId: string) {
    return api.request(`/v1/playerboard/teams/${teamId}/veo/matches/${fixtureId}/tracks`, {}, PlayerboardVeoMatchTracksSchema)
  }

  return { loadAnalysis, loadTracks }
}
