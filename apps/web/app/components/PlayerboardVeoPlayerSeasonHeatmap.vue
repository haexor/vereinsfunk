<script setup lang="ts">
import type { VeoSeasonHeatmap } from '../composables/usePlayerboardVeoPlayerHeatmaps'
import { playerboardErrorMessage } from '../utils/playerboardErrors'

// Spec 002, PR 5: Positions-Heatmap eines Spielers ueber die gefilterten Spiele (Inventar §2.1.4).
// Jedes Spiel ist so gedreht, dass die Mannschaft nach rechts angreift.
const props = defineProps<{
  player: { key: string; playerId: string | null; jerseyNumber: number | null }
  label: string
  heatmapOf: (player: { key: string; playerId: string | null; jerseyNumber: number | null }) => Promise<VeoSeasonHeatmap | null>
}>()

const heatmap = ref<VeoSeasonHeatmap | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const runs = useLatestRequest()
async function load() {
  const isLatest = runs.begin()
  loading.value = true
  errorMessage.value = ''
  try {
    const loaded = await props.heatmapOf(props.player)
    if (isLatest()) heatmap.value = loaded
  } catch (error) {
    if (isLatest()) errorMessage.value = playerboardErrorMessage(error, 'Die Heatmap konnte nicht geladen werden.')
  } finally {
    if (isLatest()) loading.value = false
  }
}
onMounted(load)
watch(() => [props.player.key, props.heatmapOf], () => { void load() })
</script>

<template>
  <div>
    <p v-if="loading" class="mb-2 text-xs text-[#6c756f]" role="status">Heatmap wird geladen …</p>
    <p v-else-if="errorMessage" class="mb-2 text-xs text-amber-800" role="alert">{{ errorMessage }}</p>
    <template v-if="heatmap">
      <PlayerboardPitchHeatmap :grid="heatmap.grid" :width="heatmap.width" :height="heatmap.height" :label="label" />
      <p class="mt-1 text-[11px] text-[#6c756f]">aus {{ heatmap.matchCount }} {{ heatmap.matchCount === 1 ? 'Spiel' : 'Spielen' }}</p>
    </template>
    <p v-else-if="!loading && !errorMessage" class="text-sm text-[#6c756f]">Veo hat für diesen Spieler keine Positionsdaten erkannt.</p>
  </div>
</template>
