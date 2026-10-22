<script setup lang="ts">
import { sortPlayerRows } from '@vereinsfunk/domain'
import { playerRowName, type PlayerShotMarker, type VeoPlayerRow } from '../utils/playerboardVeoPlayers'

// Spec 002, PR 5: Spieler-Schusskarte ueber die gefilterten Spiele (Inventar §2.1.3): Auswahl
// Abschluesse, Schuesse oder Tore; daneben die Spieler mit mindestens einem solchen Abschluss, nach
// Anzahl sortiert. Zuerst ist der Spieler mit den meisten gewaehlt.
const props = defineProps<{ rows: readonly VeoPlayerRow[]; shotsByPlayer: ReadonlyMap<string, readonly PlayerShotMarker[]> }>()

type Kind = 'all' | 'shots' | 'goals'
const KINDS: { id: Kind; label: string }[] = [{ id: 'all', label: 'Abschlüsse' }, { id: 'shots', label: 'Schüsse' }, { id: 'goals', label: 'Tore' }]
const kind = ref<Kind>('all')
const matches = (shot: PlayerShotMarker, which: Kind) => which === 'all' || (which === 'goals') === shot.goal
const available = (which: Kind) => props.rows.some((row) => (props.shotsByPlayer.get(row.key) ?? []).some((shot) => matches(shot, which)))

const listed = computed(() => sortPlayerRows(
  props.rows.map((row) => ({ ...row, score: (props.shotsByPlayer.get(row.key) ?? []).filter((shot) => matches(shot, kind.value)).length }))
    .filter((row) => row.score > 0)
    .map((row) => ({ ...row, values: { ...row.values, score: row.score } })),
  { column: 'score', direction: 'desc' },
))
const selected = ref<string | null>(null)
watch(listed, (rows) => { if (!rows.some((row) => row.key === selected.value)) selected.value = rows[0]?.key ?? null }, { immediate: true })
const selectedRow = computed(() => listed.value.find((row) => row.key === selected.value) ?? null)
const shots = computed(() => (selectedRow.value ? (props.shotsByPlayer.get(selectedRow.value.key) ?? []).filter((shot) => matches(shot, kind.value)) : []))
const EMPTY: Record<Kind, string> = {
  all: 'Veo hat keine Tore oder Schüsse erkannt.',
  shots: 'Veo hat keine Schüsse erkannt.',
  goals: 'Veo hat keine Tore erkannt.',
}
const chipClass = (active: boolean) => ['focus-ring min-h-11 rounded-xl border px-3 text-xs font-semibold disabled:opacity-40', active ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] bg-white text-ink']
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap gap-2" role="group" aria-label="Abschlüsse">
      <button v-for="entry in KINDS" :key="entry.id" type="button" :class="chipClass(kind === entry.id)" :aria-pressed="kind === entry.id" :disabled="!available(entry.id)" @click="kind = entry.id">{{ entry.label }}</button>
    </div>
    <p v-if="listed.length === 0" class="text-sm text-[#6c756f]">{{ EMPTY[kind] }}</p>
    <div v-else class="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
      <PlayerboardVeoPlayerPicker v-model="selected" :rows="listed" label="Spieler mit Abschlüssen" />
      <PlayerboardVeoPlayerShotMap v-if="selectedRow" :shots="shots" :label="`Schusskarte ${playerRowName(selectedRow)}`" :with-summary="kind === 'all'" />
    </div>
  </div>
</template>
