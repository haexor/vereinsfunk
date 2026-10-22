<script setup lang="ts">
import type { PlayerboardVeoMatchAnalysis, PlayerboardVeoMatchTracks } from '@vereinsfunk/contracts'
import { playerHeatmapFromTracks, shotsFromEvents, type StoredTrack } from '@vereinsfunk/domain'
import { playerboardErrorMessage } from '../utils/playerboardErrors'
import { decodeBase64, formatClock, veoVideoLink } from '../utils/playerboardVeoAnalysis'
import type { PlayerShotMarker } from './PlayerboardVeoPlayerShotMap.vue'

// Spec 002, PR 3: Reiter "Karten" der Spielerkarte in einem Spiel (Inventar §2.3): Heatmap je
// Halbzeit mit Zeitabschnitt in 60-s-Schritten aus den Positionsdaten der Rueckennummer, sonst Veos
// Matrix der Halbzeit oder des ganzen Spiels; darunter die Schusskarte des Spielers.
const props = defineProps<{
  analysis: Pick<PlayerboardVeoMatchAnalysis, 'periods' | 'heatmaps' | 'events' | 'veoUrl' | 'hasTracking'>
  jerseyNumber: number
  playerLabel: string
  loadTracks: () => Promise<PlayerboardVeoMatchTracks>
}>()

const STEP_S = 60
const tracks = ref<StoredTrack[] | null>(null)
const loading = ref(false)
const errorMessage = ref('')
onMounted(async () => {
  if (!props.analysis.hasTracking) return
  loading.value = true
  try {
    const loaded = await props.loadTracks()
    tracks.value = loaded.tracks.map((track) => ({ side: track.side, goalkeeper: track.goalkeeper, jerseyNumber: track.jerseyNumber, startS: track.startS, samples: decodeBase64(track.samples) }))
  } catch (error) {
    errorMessage.value = playerboardErrorMessage(error, 'Die Positionsdaten konnten nicht geladen werden.')
  } finally {
    loading.value = false
  }
})
const fromTracks = computed(() => tracks.value !== null && tracks.value.some((track) => track.jerseyNumber === props.jerseyNumber))

// Mit Positionsdaten nur Halbzeiten (der Schieber braucht ihre Grenzen), sonst auch das ganze Spiel.
const period = ref<number | null>(props.analysis.periods[0]?.number ?? null)
watch(fromTracks, (value) => { if (value && period.value === null) period.value = props.analysis.periods[0]?.number ?? null })
const current = computed(() => props.analysis.periods.find((entry) => entry.number === period.value) ?? null)
const fromS = ref(0)
const toS = ref(0)
watch(current, (value) => {
  fromS.value = value?.startS ?? 0
  toS.value = value?.endS ?? 0
}, { immediate: true })
watch(fromS, (value) => { if (value > toS.value) toS.value = value })
watch(toS, (value) => { if (value < fromS.value) fromS.value = value })

const grid = computed<Float32Array | null>(() => {
  if (fromTracks.value && tracks.value) return playerHeatmapFromTracks(tracks.value, props.analysis.periods, props.jerseyNumber, fromS.value, toS.value)
  const matrix = props.analysis.heatmaps.find((heatmap) => heatmap.jerseyNumber === props.jerseyNumber && heatmap.periodNumber === (period.value ?? 0))
  if (!matrix) return null
  const cells = decodeBase64(matrix.cells)
  return Float32Array.from(cells, (value) => value / 255)
})
const matrixSize = computed(() => {
  const matrix = props.analysis.heatmaps.find((heatmap) => heatmap.jerseyNumber === props.jerseyNumber)
  return fromTracks.value || !matrix ? {} : { width: matrix.width, height: matrix.height }
})

function matchClock(second: number): string {
  if (!current.value) return formatClock(0)
  const before = props.analysis.periods.filter((entry) => entry.number < current.value!.number).reduce((sum, entry) => sum + entry.endS - entry.startS, 0)
  return formatClock(before + second - current.value.startS)
}
const heatmapLabel = computed(() => {
  const part = period.value === null ? 'ganzes Spiel' : `${period.value}. Halbzeit`
  return fromTracks.value ? `Heatmap ${props.playerLabel}, ${part}, ${matchClock(fromS.value)} bis ${matchClock(toS.value)}` : `Heatmap ${props.playerLabel}, ${part}`
})

const shots = computed<PlayerShotMarker[]>(() => shotsFromEvents(props.analysis.events)
  .filter((shot) => shot.team === 'own' && shot.jerseyNumber === props.jerseyNumber)
  .map((shot) => ({
    key: shot.id,
    goal: shot.goal,
    x: shot.x,
    y: shot.y,
    href: veoVideoLink(props.analysis.veoUrl, shot.videoTimeMs),
    title: `${shot.goal ? 'Tor' : 'Schuss'} in der ${shot.periodNumber}. Halbzeit, ${formatClock(shot.periodTimeMs / 1000)}`,
  })))
const sliderClass = 'h-11 w-full accent-forest'
</script>

<template>
  <div class="grid gap-5">
    <section>
      <h4 class="mb-2 text-sm font-bold text-ink">Heatmap</h4>
      <PlayerboardVeoPanelFilters v-model:period="period" :periods="analysis.periods" own-label="" opponent-label="" :with-team="false" :with-full-match="!fromTracks" />
      <div v-if="fromTracks && current" class="mb-3 grid gap-1">
        <label class="text-xs text-[#5b625d]">Von {{ matchClock(fromS) }}
          <input v-model.number="fromS" type="range" :min="current.startS" :max="current.endS" :step="STEP_S" :class="sliderClass" :aria-valuetext="matchClock(fromS)" />
        </label>
        <label class="text-xs text-[#5b625d]">Bis {{ matchClock(toS) }}
          <input v-model.number="toS" type="range" :min="current.startS" :max="current.endS" :step="STEP_S" :class="sliderClass" :aria-valuetext="matchClock(toS)" />
        </label>
      </div>
      <p v-if="loading" class="mb-2 text-xs text-[#6c756f]" role="status">Positionsdaten werden geladen …</p>
      <p v-else-if="errorMessage" class="mb-2 text-xs text-amber-800" role="alert">{{ errorMessage }}</p>
      <PlayerboardPitchHeatmap v-if="grid" :grid="grid" :label="heatmapLabel" v-bind="matrixSize" />
      <p v-else class="text-sm text-[#6c756f]">Veo hat diese Rückennummer hier nicht erkannt; es gibt keine Heatmap.</p>
    </section>
    <section>
      <h4 class="mb-2 text-sm font-bold text-ink">Schusskarte</h4>
      <PlayerboardVeoPlayerShotMap :shots="shots" :label="`Schusskarte ${playerLabel}`" />
    </section>
  </div>
</template>
