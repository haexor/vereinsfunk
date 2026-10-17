<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import { PlayerboardPlayerSchema, type PlayerboardPlayer, type PlayerboardVeoMatch } from '@vereinsfunk/contracts'
import type { VeoSeasonMatch } from './PlayerboardVeoSeason.vue'

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
let latestRequest = 0
async function load() {
  const request = ++latestRequest
  matches.value = []
  roster.value = []
  if (!teamId.value || !organizationId.value) return
  try {
    const requestedTeamId = teamId.value
    const from = await loadSeasonFrom(organizationId.value, requestedTeamId, organizationTimezone.value)
    const [loaded, players] = await Promise.all([
      loadMatches(requestedTeamId, from ? { from } : {}),
      api.request(`/v1/playerboard/teams/${requestedTeamId}/players`, {}, PlayerboardPlayerSchema.array()).catch(() => [] as PlayerboardPlayer[]),
    ])
    if (request === latestRequest) {
      matches.value = loaded
      roster.value = players
    }
  } catch {
    if (request === latestRequest) matches.value = []
  }
}
await load()
watch(teamId, () => { void load() })

const personByPlayer = computed(() => new Map(roster.value.map((player) => [player.id, player.directoryPersonId])))

/** Person-Id einer zugeordneten Veo-Zeile fuer den Profil-Link; ohne Kader leer. */
function personIdOf(playerId: string): { personId?: string } {
  const personId = personByPlayer.value.get(playerId)
  return personId ? { personId } : {}
}

const seasonMatches = computed<VeoSeasonMatch[]>(() => matches.value.map((match) => ({
  ownScore: match.ownScore,
  opponentScore: match.opponentScore,
  teamStats: match.teamStats,
  players: match.players.flatMap((player) => player.playerId && player.name
    ? [{ key: player.playerId, label: player.name, jerseyNumber: player.jerseyNumber, ...personIdOf(player.playerId), stats: player.stats }]
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
