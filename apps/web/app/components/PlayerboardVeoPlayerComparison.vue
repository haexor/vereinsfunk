<script setup lang="ts">
import { comparePlayers, DEFAULT_PLAYER_SORT, playerMetricDefinition, sortPlayerRows } from '@vereinsfunk/domain'
import type { VeoSeasonHeatmap } from '../composables/usePlayerboardVeoPlayerHeatmaps'
import { formatPlayerMetric, playerRowName, readComparisonPlayers, writeComparisonPlayers, type PlayerShotMarker, type VeoPlayerRow } from '../utils/playerboardVeoPlayers'

// Spec 002, PR 5: Spielervergleich wie Veo (Inventar §2.1.5): zwei Spieler nebeneinander, Werte in
// Veos Gruppen, der hoehere Wert hervorgehoben; darunter Heatmaps und Schusskarten. Die Wahl liegt je
// Mannschaft im Browser. Waehlt die Seite einen Spieler vor (Rangliste, Spielertabelle), steht er als
// Spieler A; die Vorauswahl wird nicht gespeichert.
const props = defineProps<{
  teamId: string
  rows: readonly VeoPlayerRow[]
  preselected?: string | null
  shotsByPlayer: ReadonlyMap<string, readonly PlayerShotMarker[]>
  heatmapOf: (player: { key: string; playerId: string | null; jerseyNumber: number | null }) => Promise<VeoSeasonHeatmap | null>
}>()

const listed = computed(() => sortPlayerRows(props.rows, DEFAULT_PLAYER_SORT))
const storageKey = computed(() => `vereinsfunk.veo.comparison-players.${props.teamId}`)
const picks = ref<{ a: string | null; b: string | null }>({ a: null, b: null })
function resetPicks() {
  const stored = readComparisonPlayers(storageKey.value)
  const has = (key: string | null | undefined) => Boolean(key && listed.value.some((row) => row.key === key))
  picks.value = {
    a: has(stored?.a) ? stored!.a : listed.value[0]?.key ?? null,
    b: has(stored?.b) ? stored!.b : listed.value[1]?.key ?? null,
  }
}
onMounted(resetPicks)
watch([listed, storageKey], resetPicks)
watch(() => props.preselected, (key) => {
  if (!key || !listed.value.some((row) => row.key === key) || picks.value.a === key) return
  // Ist der Spieler schon B, tauschen die beiden, damit nie derselbe Spieler zweimal steht.
  picks.value = { a: key, b: picks.value.b === key ? picks.value.a : picks.value.b }
})
function pick(side: 'a' | 'b', key: string) {
  picks.value = { ...picks.value, [side]: key }
  if (picks.value.a && picks.value.b) writeComparisonPlayers(storageKey.value, { a: picks.value.a, b: picks.value.b })
}

const playerA = computed(() => listed.value.find((row) => row.key === picks.value.a) ?? null)
const playerB = computed(() => listed.value.find((row) => row.key === picks.value.b) ?? null)
const groups = computed(() => (playerA.value && playerB.value ? comparePlayers(playerA.value.values, playerB.value.values) : []))
const valueClass = (strong: boolean) => (strong ? 'font-extrabold text-forest' : 'text-[#5b625d]')
const selectClass = 'focus-ring h-11 w-full min-w-0 rounded-xl border border-[#dfe0d9] bg-white px-2 text-sm text-ink'
</script>

<template>
  <p v-if="listed.length < 2" class="text-sm text-[#6c756f]">Für einen Vergleich braucht es mindestens zwei Spieler mit Werten.</p>
  <div v-else>
    <div class="mb-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
      <label class="grid gap-1 text-xs text-[#5b625d]">Spieler A
        <select :class="selectClass" :value="picks.a ?? ''" @change="pick('a', ($event.target as HTMLSelectElement).value)">
          <option v-for="row in listed" :key="row.key" :value="row.key">{{ playerRowName(row) }}</option>
        </select>
      </label>
      <span class="pb-3 text-xs font-bold text-[#7b827d]">gegen</span>
      <label class="grid gap-1 text-xs text-[#5b625d]">Spieler B
        <select :class="selectClass" :value="picks.b ?? ''" @change="pick('b', ($event.target as HTMLSelectElement).value)">
          <option v-for="row in listed" :key="row.key" :value="row.key">{{ playerRowName(row) }}</option>
        </select>
      </label>
    </div>

    <template v-if="playerA && playerB">
      <div class="grid gap-4">
        <section v-for="group in groups" :key="group.label">
          <h3 class="mb-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">{{ group.label }}</h3>
          <table class="w-full text-sm">
            <caption class="sr-only">{{ group.label }}: {{ playerRowName(playerA) }} gegen {{ playerRowName(playerB) }}</caption>
            <thead class="sr-only"><tr><th scope="col">{{ playerRowName(playerA) }}</th><th scope="col">Kennzahl</th><th scope="col">{{ playerRowName(playerB) }}</th></tr></thead>
            <tbody class="divide-y divide-[#eef0ea]">
              <tr v-for="row in group.rows" :key="row.id">
                <td class="w-1/4 py-1.5 tabular-nums" :class="valueClass(row.higher === 'a')">{{ formatPlayerMetric(row.id, row.a) }}</td>
                <th scope="row" class="py-1.5 text-center text-xs font-normal text-[#5b625d]">{{ playerMetricDefinition(row.id)?.label ?? row.id }}</th>
                <td class="w-1/4 py-1.5 text-right tabular-nums" :class="valueClass(row.higher === 'b')">{{ formatPlayerMetric(row.id, row.b) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <p v-if="groups.length === 0" class="text-sm text-[#6c756f]">Für diese beiden Spieler gibt es keine Werte.</p>
      </div>

      <h3 class="mb-2 mt-5 text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">Karten</h3>
      <div class="grid gap-4 sm:grid-cols-2">
        <section v-for="player in [playerA, playerB]" :key="player.key" class="grid gap-3">
          <h4 class="text-sm font-bold text-ink">{{ playerRowName(player) }}</h4>
          <PlayerboardVeoPlayerSeasonHeatmap :player="player" :heatmap-of="heatmapOf" :label="`Heatmap ${playerRowName(player)}`" />
          <PlayerboardVeoPlayerShotMap :shots="shotsByPlayer.get(player.key) ?? []" :label="`Schusskarte ${playerRowName(player)}`" :with-summary="false" />
        </section>
      </div>
    </template>
  </div>
</template>
