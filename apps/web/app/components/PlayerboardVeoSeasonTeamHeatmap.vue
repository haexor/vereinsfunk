<script setup lang="ts">
import type { PlayerboardVeoTeamHeatmap } from '@vereinsfunk/contracts'
import { combineHeatmaps, seasonPlayerKey } from '@vereinsfunk/domain'
import { decodeBase64 } from '../utils/playerboardVeoAnalysis'

// Heatmap der Mannschaft ueber die gefilterten Spiele: Veos Matrizen aller eigenen Rueckennummern,
// nach Spielzeit gewichtet summiert (research.md R-05); jedes Spiel ist so gedreht, dass die
// Mannschaft nach rechts angreift. Links die Spieler wie bei Veos Karten.
const props = defineProps<{ heatmaps: readonly PlayerboardVeoTeamHeatmap[]; ownLabel: string }>()

const keyOf = (heatmap: PlayerboardVeoTeamHeatmap) => seasonPlayerKey(heatmap)
const playerOptions = computed(() => {
  const players = new Map<string, { name: string; jerseyNumber: number; named: boolean }>()
  // Aelteste zuerst: die zuletzt getragene Nummer gewinnt.
  for (const heatmap of props.heatmaps) {
    players.set(keyOf(heatmap), { name: heatmap.name ?? `Nummer ${heatmap.jerseyNumber}`, jerseyNumber: heatmap.jerseyNumber, named: heatmap.name !== null })
  }
  return [...players.entries()]
    .sort((a, b) => Number(b[1].named) - Number(a[1].named) || a[1].name.localeCompare(b[1].name, 'de', { numeric: true }) || a[1].jerseyNumber - b[1].jerseyNumber)
    .map(([key, player]) => ({ key, name: player.name, subtitle: `#${player.jerseyNumber}` }))
})
const player = ref<string | null>(null)

const chosen = computed(() => {
  const first = props.heatmaps[0]
  return props.heatmaps.filter((heatmap) => heatmap.width === first?.width && heatmap.height === first?.height && (player.value === null || keyOf(heatmap) === player.value))
})
const grid = computed(() => {
  const combined = combineHeatmaps(chosen.value.map((heatmap) => ({ cells: decodeBase64(heatmap.cells), weight: heatmap.secondsPlayed ?? 1 })))
  return combined && combined.some((value) => value > 0) ? combined : null
})
const matchCount = computed(() => new Set(chosen.value.map((heatmap) => heatmap.fixtureId)).size)
const label = computed(() => `Heatmap ${playerOptions.value.find((option) => option.key === player.value)?.name ?? props.ownLabel}`)
</script>

<template>
  <p v-if="heatmaps.length === 0" class="text-sm text-[#6c756f]">Veo hat in diesen Spielen keine Positionsdaten erkannt.</p>
  <PlayerboardVeoMapPlayers v-else v-model="player" :options="playerOptions" label="Heatmap nach Spieler">
    <template v-if="grid">
      <PlayerboardPitchHeatmap :grid="grid" :width="chosen[0]!.width" :height="chosen[0]!.height" :label="label" />
      <p class="mt-1 text-[11px] text-[#6c756f]">aus {{ matchCount }} {{ matchCount === 1 ? 'Spiel' : 'Spielen' }}</p>
    </template>
    <p v-else class="text-sm text-[#6c756f]">Für diese Auswahl gibt es keine Heatmap.</p>
  </PlayerboardVeoMapPlayers>
</template>
