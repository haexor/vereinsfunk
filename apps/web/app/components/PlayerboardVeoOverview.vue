<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import type { PlayerboardVeoMatch } from '@vereinsfunk/contracts'
import type { VeoSeasonMatch } from './PlayerboardVeoSeason.vue'

// Paket 053, PR 3: Veo-Saison je Spieler auf /playerboard. Ohne Veo-Spiele in der Saison
// erscheint nichts; Fehler beim Laden verstecken nur diesen Abschnitt, nicht die Rangliste.
const { teamId, organizationId, organizationTimezone } = await usePlayerboardTeam()
const { loadSeasonFrom } = usePlayerboardRanking()
const { loadMatches } = usePlayerboardVeo()

const matches = ref<PlayerboardVeoMatch[]>([])

/** Laedt die Spiele der laufenden Saison; spaete Antworten frueherer Mannschaften verfallen. */
let latestRequest = 0
async function load() {
  const request = ++latestRequest
  matches.value = []
  if (!teamId.value || !organizationId.value) return
  try {
    const from = await loadSeasonFrom(organizationId.value, teamId.value, organizationTimezone.value)
    const loaded = await loadMatches(teamId.value, from ? { from } : {})
    if (request === latestRequest) matches.value = loaded
  } catch {
    if (request === latestRequest) matches.value = []
  }
}
await load()
watch(teamId, () => { void load() })

const seasonMatches = computed<VeoSeasonMatch[]>(() => matches.value.map((match) => ({
  ownScore: match.ownScore,
  opponentScore: match.opponentScore,
  teamStats: match.teamStats,
  players: match.players.flatMap((player) => player.playerId && player.name
    ? [{ key: player.playerId, label: player.name, jerseyNumber: player.jerseyNumber, stats: player.stats }]
    : []),
})))
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
