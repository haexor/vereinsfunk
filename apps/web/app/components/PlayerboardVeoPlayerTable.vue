<script setup lang="ts">
import { formatStatValue, PLAYER_STAT_ORDER, statLabel } from '../utils/playerboardVeo'

// Paket 053, PR 3: Spielerwerte als Tabelle (je Spiel oder je Saison). Die erste Spalte bleibt beim
// seitlichen Scrollen stehen; Spalten erscheinen nur fuer Werte, die Veo geliefert hat.
export interface VeoPlayerTableRow {
  key: string
  label: string
  values: Record<string, number>
  games?: number
  muted?: boolean
}

const props = defineProps<{ rows: VeoPlayerTableRow[]; caption: string; showGames?: boolean }>()
defineSlots<{ label?(props: { row: VeoPlayerTableRow }): unknown }>()

const columns = computed(() => PLAYER_STAT_ORDER.filter((statType) => props.rows.some((row) => statType in row.values)))
</script>

<template>
  <!-- w-0 min-w-full: die breite Tabelle zaehlt nicht zur Mindestbreite der Umgebung (sonst schiebt sie
       inhaltsbemessene Layouts wie die oeffentliche Seite auf) und scrollt stattdessen in sich. -->
  <div class="w-0 min-w-full overflow-x-auto rounded-2xl border border-[#e8e9e2] bg-white">
    <table class="w-full min-w-max text-left text-xs">
      <caption class="sr-only">{{ caption }}</caption>
      <thead class="bg-[#f7f8f4] text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">
        <tr>
          <th scope="col" class="sticky left-0 z-10 bg-[#f7f8f4] px-3 py-2">Spieler</th>
          <th v-if="showGames" scope="col" class="px-3 py-2 text-right">Spiele</th>
          <th v-for="column in columns" :key="column" scope="col" class="whitespace-nowrap px-3 py-2 text-right">{{ statLabel(column) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key" class="border-t border-[#eef0ea]" :class="row.muted ? 'text-[#7b827d]' : 'text-ink'">
          <th scope="row" class="sticky left-0 z-10 bg-white px-3 py-2 font-semibold">
            <slot name="label" :row="row">{{ row.label }}</slot>
          </th>
          <td v-if="showGames" class="px-3 py-2 text-right tabular-nums">{{ row.games ?? '' }}</td>
          <td v-for="column in columns" :key="column" class="whitespace-nowrap px-3 py-2 text-right tabular-nums">
            {{ column in row.values ? formatStatValue(column, row.values[column]!) : '–' }}
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length + (showGames ? 2 : 1)" class="px-3 py-4 text-center text-[#6c756f]">Noch keine Spielerwerte.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
