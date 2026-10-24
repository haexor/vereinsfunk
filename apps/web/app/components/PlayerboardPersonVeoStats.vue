<script setup lang="ts">
import { seasonPlayerRows, VEO_PLAYER_METRICS, type VeoSeasonPlayerInput } from '@vereinsfunk/domain'
import type { PersonProfileTeam, PersonProfileVeoMatch, PlayerboardVeoSeasonMatch } from '@vereinsfunk/contracts'
import { usePlayerboardVeoPlayerHeatmaps } from '../composables/usePlayerboardVeoPlayerHeatmaps'
import { usePlayerboardVeoSeason } from '../composables/usePlayerboardVeoSeason'
import { playerboardErrorMessage } from '../utils/playerboardErrors'
import { playerRowName, seasonShotsByPlayer, type VeoPlayerRow } from '../utils/playerboardVeoPlayers'

// Das Profil nutzt dieselbe Aggregation, Tabelle und Kartenlogik wie Veo Analytics. Die
// Profildaten liefern bereits die sichtbaren Rohwerte; fuer Schusskarte und Heatmap werden nur
// die zugehoerigen Saisonspiele aus den bestehenden Veo-Analytics-Routen nachgeladen.
const props = defineProps<{
  team: PersonProfileTeam
  personName: string
  period: 'season' | 'all'
  timezone: string
}>()

const fixtureIds = computed(() => props.team.veoMatches.map((match) => match.fixtureId))
const teamId = computed(() => props.team.teamId)
const filter = computed(() => ({ fixtureIds: fixtureIds.value }))
const { loadSeason } = usePlayerboardVeoSeason()
const { heatmapOf } = usePlayerboardVeoPlayerHeatmaps(teamId, filter)

const seasonMatches = ref<PlayerboardVeoSeasonMatch[]>([])
const loadingMaps = ref(false)
const mapsError = ref('')
const { ready } = useScopedLoad(() => `${teamId.value}:${fixtureIds.value.join(',')}`, async (key, isLatest) => {
  const [requestedTeamId, ids] = key.split(':', 2)
  const requestedFixtureIds = ids ? ids.split(',').filter(Boolean) : []
  seasonMatches.value = []
  mapsError.value = ''
  if (!requestedTeamId || requestedFixtureIds.length === 0) return
  loadingMaps.value = true
  try {
    const loaded = await loadSeason(requestedTeamId, { fixtureIds: requestedFixtureIds })
    if (isLatest()) seasonMatches.value = loaded
  } catch (error) {
    if (isLatest()) mapsError.value = playerboardErrorMessage(error, 'Die Veo-Karten konnten nicht geladen werden.')
  } finally {
    if (isLatest()) loadingMaps.value = false
  }
})
await ready

const row = computed<VeoPlayerRow | null>(() => {
  const input: VeoSeasonPlayerInput[] = props.team.veoMatches.map((match: PersonProfileVeoMatch) => ({
    jerseyNumber: match.jerseyNumber,
    playerId: props.team.playerId,
    personId: null,
    name: props.personName,
    stats: match.stats,
  }))
  const aggregated = seasonPlayerRows(input.map((player) => ({ players: [player] })))[0]
  return aggregated ? { ...aggregated, position: props.team.position, isSelf: props.team.isSelf } : null
})
const shotsByPlayer = computed(() => seasonShotsByPlayer(seasonMatches.value, props.timezone))
const sourceLabel = computed(() => `${props.team.veoMatches.length} ${props.team.veoMatches.length === 1 ? 'Spiel' : 'Spiele'} · ${props.period === 'all' ? 'gesamte Zeit' : 'laufende Saison'}`)
const allPlayerColumns = VEO_PLAYER_METRICS.map((metric) => metric.id)
</script>

<template>
  <section class="mt-4 border-t border-[#eef0ea] pt-4" aria-label="Veo-Statistiken">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">Veo-Statistiken und Karten</h3>
      <span class="text-[11px] text-[#6c756f]">{{ sourceLabel }}</span>
    </div>
    <template v-if="row">
      <PlayerboardVeoPlayerStatsTable
        :rows="[row]" :caption="`Alle Veo-Spielerwerte ${sourceLabel}`" storage-key="vereinsfunk.veo.profile-columns"
        :default-columns="allPlayerColumns"
      />
      <p v-if="loadingMaps" class="mt-4 text-sm text-[#6c756f]" role="status">Veo-Karten werden geladen …</p>
      <p v-else-if="mapsError" class="mt-4 text-sm text-amber-800" role="alert">{{ mapsError }}</p>
      <div v-else class="mt-5 grid gap-5 md:grid-cols-2">
        <section>
          <h4 class="mb-2 text-sm font-bold text-ink">Heatmap</h4>
          <PlayerboardVeoPlayerSeasonHeatmap :player="row" :heatmap-of="heatmapOf" :label="`Heatmap ${playerRowName(row)}`" />
        </section>
        <section>
          <h4 class="mb-2 text-sm font-bold text-ink">Schusskarte</h4>
          <PlayerboardVeoPlayerShotMap :shots="shotsByPlayer.get(row.key) ?? []" :label="`Schusskarte ${playerRowName(row)}`" />
        </section>
      </div>
    </template>
    <p v-else class="text-xs text-[#6c756f]">Für diesen Zeitraum liegen keine Veo-Spielerwerte vor.</p>
  </section>
</template>
