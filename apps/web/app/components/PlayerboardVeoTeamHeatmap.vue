<script setup lang="ts">
import type { PlayerboardVeoMatchAnalysis, PlayerboardVeoMatchTracks } from '@vereinsfunk/contracts'
import { combineHeatmaps, teamHeatmapFromTracks, type StoredTrack } from '@vereinsfunk/domain'
import { playerboardErrorMessage } from '../utils/playerboardErrors'
import { decodeBase64, formatClock } from '../utils/playerboardVeoAnalysis'

// Spec 002, PR 2: Heatmap der Mannschaft (Inventar §1a.8). Halbzeit waehlen, Zeitabschnitt in
// 60-s-Schritten; gerechnet aus den Positionsdaten (R-05). Ohne Positionsdaten nur ganze Halbzeiten
// der eigenen Mannschaft als Summe der Spieler-Matrizen -- der Gegner hat keine.
const props = defineProps<{
  analysis: Pick<PlayerboardVeoMatchAnalysis, 'periods' | 'heatmaps' | 'hasTracking'>
  ownLabel: string
  opponentLabel: string
  loadTracks: () => Promise<PlayerboardVeoMatchTracks>
}>()

const STEP_S = 60
const period = ref<number | null>(props.analysis.periods[0]?.number ?? null)
const team = ref<'own' | 'opponent'>('own')
const current = computed(() => props.analysis.periods.find((entry) => entry.number === period.value) ?? null)
const fromS = ref(0)
const toS = ref(0)
watch(current, (value) => {
  fromS.value = value?.startS ?? 0
  toS.value = value?.endS ?? 0
}, { immediate: true })
watch(fromS, (value) => { if (value > toS.value) toS.value = value })
watch(toS, (value) => { if (value < fromS.value) fromS.value = value })

const tracks = ref<StoredTrack[] | null>(null)
const loading = ref(false)
const errorMessage = ref('')
onMounted(async () => {
  if (!props.analysis.hasTracking) return
  loading.value = true
  try {
    const loaded = await props.loadTracks()
    tracks.value = loaded.tracks.map((track) => ({ side: track.side, goalkeeper: track.goalkeeper, startS: track.startS, samples: decodeBase64(track.samples) }))
  } catch (error) {
    errorMessage.value = playerboardErrorMessage(error, 'Die Positionsdaten konnten nicht geladen werden.')
  } finally {
    loading.value = false
  }
})

const fallback = computed(() => tracks.value === null)
const grid = computed<Float32Array | null>(() => {
  if (tracks.value) return teamHeatmapFromTracks(tracks.value, props.analysis.periods, team.value, fromS.value, toS.value)
  if (team.value === 'opponent' || period.value === null) return null
  const matrices = props.analysis.heatmaps.filter((heatmap) => heatmap.periodNumber === period.value)
  return combineHeatmaps(matrices.map((heatmap) => ({ cells: decodeBase64(heatmap.cells), weight: 1 })))
})

/** Spielzeit einer Videosekunde: Dauer der Halbzeiten davor plus Zeit in dieser Halbzeit. */
function matchClock(second: number): string {
  if (!current.value) return formatClock(0)
  const before = props.analysis.periods.filter((entry) => entry.number < current.value!.number).reduce((sum, entry) => sum + entry.endS - entry.startS, 0)
  return formatClock(before + second - current.value.startS)
}
const teamLabel = computed(() => (team.value === 'own' ? props.ownLabel : props.opponentLabel))
const label = computed(() => `Heatmap ${teamLabel.value}, ${period.value}. Halbzeit, ${matchClock(fromS.value)} bis ${matchClock(toS.value)}`)
const sliderClass = 'h-11 w-full accent-forest'
</script>

<template>
  <div>
    <PlayerboardVeoPanelFilters v-model:period="period" v-model:team="team" :periods="analysis.periods" :own-label="ownLabel" :opponent-label="opponentLabel" :with-full-match="false" />
    <div v-if="!fallback && current" class="mb-3 grid gap-1 sm:grid-cols-2 sm:gap-4">
      <label class="text-xs text-[#5b625d]">Von {{ matchClock(fromS) }}
        <input v-model.number="fromS" type="range" :min="current.startS" :max="current.endS" :step="STEP_S" :class="sliderClass" :aria-valuetext="matchClock(fromS)" />
      </label>
      <label class="text-xs text-[#5b625d]">Bis {{ matchClock(toS) }}
        <input v-model.number="toS" type="range" :min="current.startS" :max="current.endS" :step="STEP_S" :class="sliderClass" :aria-valuetext="matchClock(toS)" />
      </label>
    </div>
    <p v-if="loading" class="mb-2 text-xs text-[#6c756f]" role="status">Positionsdaten werden geladen …</p>
    <p v-else-if="errorMessage" class="mb-2 text-xs text-amber-800" role="alert">{{ errorMessage }}</p>
    <p v-else-if="fallback" class="mb-2 text-xs text-[#6c756f]">Ohne Positionsdaten zeigt die Heatmap ganze Halbzeiten der eigenen Mannschaft aus den Spieler-Heatmaps.</p>
    <PlayerboardPitchHeatmap v-if="grid" :grid="grid" :label="label" />
    <p v-else class="text-sm text-[#6c756f]">Für diese Auswahl gibt es keine Heatmap.</p>
  </div>
</template>
