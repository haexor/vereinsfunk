import { ScheduleOccasionSchema, type ScheduleOccasion } from '@vereinsfunk/contracts'
import { ref } from 'vue'
import { ApiRequestError } from '../utils/apiClient'
import { occasionLoadErrorMessage, type ScheduleOccasionReference } from '../utils/scheduleOccasion'
import type { useApiClient } from './useApiClient'
import { useLatestRequest } from './useLatestRequest'

/**
 * Anlass eines Beitrags aus dem Kalender (Spiel oder Veranstaltung) fuer die Textwerkstatt.
 * loadOccasion liefert bei einem Fehler die Meldung fuer die Seite, sonst null; nur der zuletzt
 * gestartete Lauf schreibt.
 */
export function useScheduleOccasion(api: ReturnType<typeof useApiClient>) {
  const occasion = ref<ScheduleOccasion | null>(null)
  const { begin } = useLatestRequest()

  async function loadOccasion(scope: { organizationId: string; departmentId: string | null }, reference: ScheduleOccasionReference): Promise<string | null> {
    const isLatest = begin()
    try {
      const loaded = await api.request('/v1/text-workshop/occasion', { query: { organizationId: scope.organizationId, departmentId: scope.departmentId ?? undefined, ...reference } }, ScheduleOccasionSchema)
      if (isLatest()) occasion.value = loaded
      return null
    } catch (error) {
      if (isLatest()) occasion.value = null
      return occasionLoadErrorMessage(error instanceof ApiRequestError ? error.code : '')
    }
  }

  function clearOccasion() {
    begin()
    occasion.value = null
  }

  return { occasion, loadOccasion, clearOccasion }
}
