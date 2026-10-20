<script setup lang="ts">
import { CalendarDays, X } from '@lucide/vue'
import { ContentSuggestionsResponseSchema, type ContentSuggestion } from '@vereinsfunk/contracts'
import { ApiRequestError } from '../utils/apiClient'

// Anlassvorschlaege des Dashboards (Spielankuendigung, Ergebnis, Veranstaltung) fuer die aktive
// Abteilung. Nur wer dort Beitraege anlegen darf, bekommt sie; die Seite bindet die Liste nur ein,
// solange Social Media aktiv ist.
const props = defineProps<{
  organizationId: string | null
  departmentId: string | null
  timezone: string
}>()

const api = useApiClient()
const suggestions = ref<ContentSuggestion[]>([])
const loaded = ref(false)

// Die Sidebar wechselt Verein/Abteilung ohne Remount: nur der zuletzt gestartete Lauf schreibt.
useScopedLoad(() => `${props.organizationId}:${props.departmentId}`, async (_key, isLatest) => {
  if (import.meta.server) return
  suggestions.value = []
  loaded.value = false
  const { organizationId, departmentId } = props
  if (!organizationId || !departmentId || !useCan('post.create', { organizationId, departmentId })) return
  try {
    const response = await api.request(`/v1/departments/${departmentId}/content-suggestions`, {}, ContentSuggestionsResponseSchema)
    if (!isLatest()) return
    suggestions.value = response.suggestions
    loaded.value = true
  } catch {
    // Anlassvorschlaege sind ein Zusatz, kein Kern-Dashboard-Datum -- ein Ausfall bleibt hier
    // unsichtbar statt das Dashboard mit einer Fehlermeldung zu stoeren.
  }
})

function suggestionHref(item: ContentSuggestion) {
  if (item.fixtureId) return `/erstellen?fixtureId=${item.fixtureId}`
  if (item.clubEventId) return `/erstellen?clubEventId=${item.clubEventId}`
  return '/erstellen'
}

function occursLabel(iso: string) {
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', timeZone: props.timezone }).format(new Date(iso))
}

async function dismissSuggestion(item: ContentSuggestion) {
  const endpoint =
    item.kind === 'fixture_announcement'
      ? `/v1/fixtures/${item.fixtureId}/dismiss-announcement`
      : item.kind === 'fixture_result'
        ? `/v1/fixtures/${item.fixtureId}/dismiss-result`
        : item.kind === 'event_invitation'
          ? `/v1/club-events/${item.clubEventId}/dismiss-invitation`
          : null
  if (!endpoint) return
  try {
    await api.request(endpoint, { method: 'POST' })
    suggestions.value = suggestions.value.filter((suggestion) => suggestion !== item)
  } catch (error) {
    // Nur der Status: der urspruengliche FetchError traegt in options.headers das Bearer-Token
    // der Sitzung.
    console.error(
      'Anlassvorschlag konnte nicht verworfen werden',
      error instanceof ApiRequestError ? error.statusCode : undefined,
    )
  }
}
</script>

<template>
  <article v-if="loaded && suggestions.length > 0" class="card p-5">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="font-display text-sm font-bold">Anlassvorschläge</h2>
      <span class="grid h-8 w-8 place-items-center rounded-xl bg-sky-100 text-sky-700"
        ><CalendarDays :size="15"
      /></span>
    </div>
    <ul class="space-y-2">
      <li
        v-for="item in suggestions"
        :key="`${item.kind}-${item.fixtureId ?? item.clubEventId ?? item.label}`"
        class="flex items-center gap-2 rounded-xl border border-[#e6e7e0] p-3"
      >
        <NuxtLink :to="suggestionHref(item)" class="focus-ring min-w-0 flex-1">
          <span class="block truncate text-xs font-semibold text-ink">{{ item.label }}</span>
          <span v-if="item.occursAt" class="block text-[10px] text-[#9aa196]">{{
            occursLabel(item.occursAt)
          }}</span>
        </NuxtLink>
        <button
          v-if="item.fixtureId || item.clubEventId"
          class="focus-ring rounded-lg p-1.5 text-[#9aa196] hover:text-red-600"
          aria-label="Vorschlag verwerfen"
          @click="dismissSuggestion(item)"
        >
          <X :size="14" />
        </button>
      </li>
    </ul>
  </article>
  <article v-else-if="loaded" class="card p-5 text-center text-xs text-[#7b827d]">
    Keine offenen Anlässe.
  </article>
</template>
