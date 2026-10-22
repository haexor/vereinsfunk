<script setup lang="ts">
import { DEFAULT_LEADERBOARD_METRICS, leaderboard, LEADERBOARD_MAX, playerMetricDefinition, VEO_LEADERBOARD_METRICS, VEO_PLAYER_METRICS } from '@vereinsfunk/domain'
import { formatPlayerMetric, playerMetricHeader, playerRowName, playerRowSubtitle, readLeaderboardMetrics, writePlayerColumns, type VeoPlayerRow } from '../utils/playerboardVeoPlayers'

// Spec 002, PR 5: Ranglisten wie Veo (Inventar §2.1.1): je Kennzahl eine Karte mit den besten fuenf,
// bis zu drei Kennzahlen waehlbar und im Browser gespeichert. Ein Name oeffnet die Spielerkarte.
const props = defineProps<{ rows: readonly VeoPlayerRow[] }>()
const emit = defineEmits<{ select: [row: VeoPlayerRow] }>()

const STORAGE_KEY = 'vereinsfunk.veo.leaderboard-metrics'
const metrics = ref<string[]>([...DEFAULT_LEADERBOARD_METRICS])
onMounted(() => { metrics.value = readLeaderboardMetrics(STORAGE_KEY, DEFAULT_LEADERBOARD_METRICS) })
const editing = ref(false)
function apply(ids: string[]) {
  metrics.value = ids
  writePlayerColumns(STORAGE_KEY, ids)
  editing.value = false
}

const boards = computed(() => metrics.value.map((id) => ({ id, title: playerMetricHeader(id), label: playerMetricDefinition(id)?.label ?? id, entries: leaderboard(props.rows, id) })))
const options = VEO_PLAYER_METRICS.filter((metric) => VEO_LEADERBOARD_METRICS.includes(metric.id))
const GROUPS = [{ id: 'physical', label: 'Physis' }, { id: 'events', label: 'Ereignisse' }, { id: 'general', label: 'Allgemein' }] as const
</script>

<template>
  <div>
    <div class="mb-3 flex justify-end">
      <button type="button" class="focus-ring min-h-11 rounded-xl border border-[#dfe0d9] bg-white px-4 text-sm font-semibold text-ink" @click="editing = true">Ranglisten bearbeiten</button>
    </div>
    <div class="grid gap-3 md:grid-cols-3">
      <section v-for="board in boards" :key="board.id" class="rounded-2xl border border-[#e8e9e2] bg-white p-4" :aria-label="`Rangliste ${board.label}`">
        <h3 class="mb-2 text-sm font-bold text-ink">{{ board.title }}</h3>
        <ol v-if="board.entries.length" class="grid gap-1">
          <li v-for="(entry, index) in board.entries" :key="entry.row.key">
            <button type="button" class="focus-ring flex min-h-11 w-full items-center gap-2 rounded-xl px-2 py-1 text-left hover:bg-[#f7f8f4]" @click="emit('select', entry.row)">
              <span class="w-5 shrink-0 text-xs font-bold text-[#7b827d]">{{ entry.rank }}.</span>
              <span class="min-w-0 flex-1">
                <span class="block font-semibold text-ink" :class="index === 0 ? 'text-base' : 'truncate text-sm'">{{ playerRowName(entry.row) }}</span>
                <span v-if="playerRowSubtitle(entry.row)" class="block text-[11px] text-[#6c756f]">{{ playerRowSubtitle(entry.row) }}</span>
              </span>
              <span class="font-display font-extrabold tabular-nums text-ink" :class="index === 0 ? 'text-2xl' : 'text-base'">{{ formatPlayerMetric(board.id, entry.value, false) }}</span>
            </button>
          </li>
        </ol>
        <p v-else class="text-sm text-[#6c756f]">Veo hat für „{{ board.label }}“ keine Werte erkannt.</p>
      </section>
    </div>
    <PlayerboardVeoMetricPicker
      v-if="editing" title="Ranglisten bearbeiten" :description="`Wähle bis zu ${LEADERBOARD_MAX} Kennzahlen, die als Rangliste erscheinen.`"
      :selected="metrics" :min="1" :max="LEADERBOARD_MAX" :options="options" :groups="GROUPS" :defaults="DEFAULT_LEADERBOARD_METRICS"
      @apply="apply" @close="editing = false"
    />
  </div>
</template>
