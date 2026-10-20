<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import { PlayerboardPlayerSchema, type PlayerboardPlayer, type PlayerboardVeoMatch } from '@vereinsfunk/contracts'
import { veoSeasonMatches } from '../utils/playerboardVeo'

// Paket 053, PR 3: Veo-Saison je Spieler auf /playerboard. Ohne Veo-Spiele in der Saison
// erscheint nichts; Fehler beim Laden verstecken nur diesen Abschnitt, nicht die Rangliste.
const { teamId, organizationId, organizationTimezone } = await usePlayerboardTeam()
const { loadSeasonFrom } = usePlayerboardRanking()
const { loadMatches } = usePlayerboardVeo()
const api = useApiClient()

const matches = ref<PlayerboardVeoMatch[]>([])
// Nur fuer die Profil-Links: ohne Kader bleiben die Namen Text.
const roster = ref<PlayerboardPlayer[]>([])

/** Laedt die Spiele der laufenden Saison; spaete Antworten frueherer Mannschaften verfallen. */
const { ready } = useScopedLoad(() => teamId.value, async (requestedTeamId, isLatest) => {
  matches.value = []
  roster.value = []
  if (!requestedTeamId || !organizationId.value) return
  try {
    const from = await loadSeasonFrom(organizationId.value, requestedTeamId, organizationTimezone.value)
    const [loaded, players] = await Promise.all([
      loadMatches(requestedTeamId, from ? { from } : {}),
      api.request(`/v1/playerboard/teams/${requestedTeamId}/players`, {}, PlayerboardPlayerSchema.array()).catch(() => [] as PlayerboardPlayer[]),
    ])
    if (isLatest()) {
      matches.value = loaded
      roster.value = players
    }
  } catch {
    if (isLatest()) matches.value = []
  }
})
await ready

const seasonMatches = computed(() => veoSeasonMatches(matches.value, roster.value))
</script>

<template>
  <section v-if="matches.length" class="card mt-6 p-5" aria-labelledby="veo-overview-heading">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 id="veo-overview-heading" class="font-display text-base font-bold text-ink">Spiele der Saison · Veo</h2>
      <NuxtLink to="/playerboard/spiele" class="focus-ring inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-forest">
        Alle Spiele <ArrowRight :size="14" />
      </NuxtLink>
    </div>
    <PlayerboardVeoSeason :matches="seasonMatches" compact />
  </section>
</template>
