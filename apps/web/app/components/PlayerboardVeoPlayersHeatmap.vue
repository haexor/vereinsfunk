<script setup lang="ts">
import { DEFAULT_PLAYER_SORT, sortPlayerRows } from '@vereinsfunk/domain'
import type { VeoSeasonHeatmap } from '../composables/usePlayerboardVeoPlayerHeatmaps'
import { initialPlayerKey, playerRowName, type VeoPlayerRow } from '../utils/playerboardVeoPlayers'

// Spec 002, PR 5: Positions-Heatmap der Spieler ueber die gefilterten Spiele (Inventar §2.1.4):
// Spielerliste nach Name, daneben die Heatmap des gewaehlten Spielers. Ein Spieler, den die Seite
// vorwaehlt (Rangliste, Spielertabelle), ist zuerst gewaehlt; die Liste erlaubt jeden anderen.
const props = defineProps<{
  rows: readonly VeoPlayerRow[]
  preselected?: string | null
  heatmapOf: (player: { key: string; playerId: string | null; jerseyNumber: number | null }) => Promise<VeoSeasonHeatmap | null>
}>()

const listed = computed(() => sortPlayerRows(props.rows, DEFAULT_PLAYER_SORT))
const selected = ref<string | null>(null)
watch(listed, (rows) => { if (!rows.some((row) => row.key === selected.value)) selected.value = initialPlayerKey(rows, props.preselected) }, { immediate: true })
watch(() => props.preselected, (key) => { if (key && listed.value.some((row) => row.key === key)) selected.value = key })
const selectedRow = computed(() => listed.value.find((row) => row.key === selected.value) ?? null)
</script>

<template>
  <p v-if="listed.length === 0" class="text-sm text-[#6c756f]">Veo hat in diesen Spielen keine Spieler erkannt.</p>
  <div v-else class="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
    <PlayerboardVeoPlayerPicker v-model="selected" :rows="listed" label="Spieler für die Heatmap" />
    <PlayerboardVeoPlayerSeasonHeatmap v-if="selectedRow" :player="selectedRow" :heatmap-of="heatmapOf" :label="`Heatmap ${playerRowName(selectedRow)}`" />
  </div>
</template>
