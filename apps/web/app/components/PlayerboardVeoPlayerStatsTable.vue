<script setup lang="ts">
import { DEFAULT_PLAYER_SORT, nextPlayerSort, playerMetricDefinition, sortPlayerRows, VEO_PLAYER_METRICS, type VeoPlayerSort } from '@vereinsfunk/domain'
import { formatPlayerMetric, playerMetricHeader, playerRowName, playerRowSubtitle, readPlayerColumns, writePlayerColumns, type VeoPlayerRow } from '../utils/playerboardVeoPlayers'

// Spec 002, PR 3: Spielertabelle wie Veos "Player Stats Overview" und "Player stats table"
// (Inventar §2.1.2, §2.2): Spalten nach Gruppen waehlbar (mindestens 1, im Browser gespeichert),
// jede Spalte sortierbar, die Spielerspalte bleibt beim seitlichen Scrollen stehen. Ein Klick auf
// den Spieler oeffnet die Spielerkarte. Neben PlayerboardVeoPlayerTable (Paket 053), das die
// oeffentliche Seite und die Veo-Seite weiter nutzen.
const props = defineProps<{
  rows: readonly VeoPlayerRow[]
  caption: string
  storageKey: string
  defaultColumns: readonly string[]
  selectedKey?: string | null
}>()
const emit = defineEmits<{ select: [row: VeoPlayerRow] }>()

const columns = ref<string[]>([...props.defaultColumns])
onMounted(() => { columns.value = readPlayerColumns(props.storageKey, props.defaultColumns) })
function applyColumns(ids: string[]) {
  columns.value = ids
  writePlayerColumns(props.storageKey, ids)
  editing.value = false
}
const editing = ref(false)

const sort = ref<VeoPlayerSort>(DEFAULT_PLAYER_SORT)
const sorted = computed(() => sortPlayerRows(props.rows, sort.value))
const ariaSort = (column: string) => (sort.value.column === column ? (sort.value.direction === 'asc' ? 'ascending' : 'descending') : 'none')
const sortLabel = (column: string, label: string) => {
  const next = nextPlayerSort(sort.value, column)
  return `Nach ${label} ${next.direction === 'asc' ? 'aufsteigend' : 'absteigend'} sortieren`
}
const arrow = (column: string) => (sort.value.column !== column ? '' : sort.value.direction === 'asc' ? '▲' : '▼')

const PICKER_GROUPS = [
  { id: 'general', label: 'Allgemein' },
  { id: 'physical', label: 'Physis' },
  { id: 'events', label: 'Ereignisse' },
] as const
const headClass = 'whitespace-nowrap px-3 py-2 text-right'
</script>

<template>
  <div>
    <div class="mb-2 flex justify-end">
      <button type="button" class="focus-ring min-h-11 rounded-xl border border-[#dfe0d9] bg-white px-4 text-sm font-semibold text-ink" @click="editing = true">Spalten bearbeiten</button>
    </div>
    <!-- w-0 min-w-full: die breite Tabelle zaehlt nicht zur Mindestbreite der Umgebung und scrollt in sich. -->
    <div class="w-0 min-w-full overflow-x-auto rounded-2xl border border-[#e8e9e2] bg-white">
      <table class="w-full min-w-max text-left text-xs">
        <caption class="sr-only">{{ caption }}</caption>
        <thead class="bg-[#f7f8f4] text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">
          <tr>
            <th scope="col" class="sticky left-0 z-10 bg-[#f7f8f4] px-1 py-1" :aria-sort="ariaSort('player')">
              <button type="button" class="focus-ring min-h-11 rounded-lg px-2 text-left uppercase" :aria-label="sortLabel('player', 'Spieler')" @click="sort = nextPlayerSort(sort, 'player')">
                Spieler <span aria-hidden="true">{{ arrow('player') }}</span>
              </button>
            </th>
            <th v-for="column in columns" :key="column" scope="col" :class="headClass" class="px-1 py-1" :aria-sort="ariaSort(column)">
              <button
                type="button" class="focus-ring min-h-11 rounded-lg px-2 text-right uppercase" :title="playerMetricDefinition(column)?.description"
                :aria-label="sortLabel(column, playerMetricDefinition(column)?.label ?? column)" @click="sort = nextPlayerSort(sort, column)"
              >
                <span class="sm:hidden">{{ playerMetricDefinition(column)?.abbreviation }}</span>
                <span class="hidden sm:inline">{{ playerMetricHeader(column) }}</span>
                <span aria-hidden="true"> {{ arrow(column) }}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in sorted" :key="row.key" class="border-t border-[#eef0ea]"
            :class="[row.playerId ? 'text-ink' : 'text-[#5b625d]', row.key === selectedKey ? 'bg-[#e4f1e7]' : row.isSelf ? 'bg-[#f3f7ef]' : '']"
          >
            <th scope="row" class="sticky left-0 z-10 px-1 py-1 font-semibold" :class="row.key === selectedKey ? 'bg-[#e4f1e7]' : row.isSelf ? 'bg-[#f3f7ef]' : 'bg-white'">
              <button type="button" class="focus-ring min-h-11 rounded-lg px-2 text-left" :aria-pressed="row.key === selectedKey" @click="emit('select', row)">
                <span class="block">{{ playerRowName(row) }}<span v-if="row.isSelf" class="font-normal text-[#5b625d]"> (du)</span></span>
                <span v-if="playerRowSubtitle(row)" class="block text-[11px] font-normal text-[#6c756f]">{{ playerRowSubtitle(row) }}</span>
              </button>
            </th>
            <td v-for="column in columns" :key="column" :class="headClass" class="tabular-nums">
              {{ formatPlayerMetric(column, row.values[column], false) }}
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td :colspan="columns.length + 1" class="px-3 py-4 text-center text-[#6c756f]">Veo hat keine Spielerwerte erkannt.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <PlayerboardVeoMetricPicker
      v-if="editing" title="Spalten bearbeiten" description="Wähle die Werte in der Reihenfolge, in der sie von links nach rechts in der Tabelle stehen sollen."
      :selected="columns" :min="1" :max="VEO_PLAYER_METRICS.length" :options="VEO_PLAYER_METRICS" :groups="PICKER_GROUPS" :defaults="defaultColumns"
      @apply="applyColumns" @close="editing = false"
    />
  </div>
</template>
