<script setup lang="ts">
import { KIND_LABELS, LAST_OPTIONS, type AnalyticsFilterState } from '../utils/playerboardVeoAnalytics'

// Spec 002, PR 4: Filter von Veo Analytics wie in Veos Analytics Studio (Inventar §1b.1): die
// letzten n Spiele, ein Zeitraum oder eine Auswahl einzelner Spiele, dazu die Spielarten. Eine
// Auswahl gilt allein. Den Zustand haelt die Seite in der URL.
const props = defineProps<{ options: readonly { fixtureId: string; label: string }[] }>()
const model = defineModel<AnalyticsFilterState>({ required: true })
const emit = defineEmits<{ needOptions: [] }>()

const update = (patch: Partial<AnalyticsFilterState>) => { model.value = { ...model.value, ...patch } }
function setMode(mode: AnalyticsFilterState['mode']) {
  update({ mode })
  if (mode === 'selection') emit('needOptions')
}
function toggle(list: 'kinds' | 'fixtureIds', value: string) {
  const current = model.value[list]
  update({ [list]: current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value] })
}
const modes = [{ value: 'last', label: 'Letzte Spiele' }, { value: 'range', label: 'Zeitraum' }, { value: 'selection', label: 'Auswahl' }] as const
const buttonClass = (active: boolean) => [
  'focus-ring min-h-11 rounded-xl border px-3 text-xs font-semibold',
  active ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] bg-white text-ink',
]
const inputClass = 'focus-ring h-11 min-w-0 rounded-xl border border-[#dfe0d9] bg-white px-3 text-sm text-ink'
</script>

<template>
  <div class="card space-y-3 p-4">
    <div class="flex flex-wrap gap-2" role="group" aria-label="Spiele auswählen nach">
      <button v-for="mode in modes" :key="mode.value" type="button" :class="buttonClass(model.mode === mode.value)" :aria-pressed="model.mode === mode.value" @click="setMode(mode.value)">
        {{ mode.label }}
      </button>
    </div>

    <label v-if="model.mode === 'last'" class="grid max-w-xs gap-1 text-xs font-semibold text-[#5b625d]">Anzahl
      <select :value="model.last" :class="inputClass" @change="update({ last: Number(($event.target as HTMLSelectElement).value) })">
        <option v-for="count in LAST_OPTIONS" :key="count" :value="count">Letzte {{ count }} Spiele</option>
      </select>
    </label>
    <div v-else-if="model.mode === 'range'" class="grid gap-2 sm:grid-cols-2">
      <label class="grid gap-1 text-xs font-semibold text-[#5b625d]">Von
        <input type="date" :value="model.from" :class="inputClass" @change="update({ from: ($event.target as HTMLInputElement).value })" />
      </label>
      <label class="grid gap-1 text-xs font-semibold text-[#5b625d]">Bis
        <input type="date" :value="model.to" :class="inputClass" @change="update({ to: ($event.target as HTMLInputElement).value })" />
      </label>
    </div>
    <fieldset v-else class="max-h-64 overflow-y-auto rounded-xl border border-[#eef0ea] p-2">
      <legend class="px-1 text-xs font-semibold text-[#5b625d]">Spiele ({{ model.fixtureIds.length }} gewählt)</legend>
      <p v-if="props.options.length === 0" class="p-2 text-sm text-[#6c756f]">Spiele werden geladen …</p>
      <label v-for="option in props.options" :key="option.fixtureId" class="flex min-h-11 items-center gap-2 px-1 text-sm text-ink">
        <input type="checkbox" class="h-4 w-4 accent-forest" :checked="model.fixtureIds.includes(option.fixtureId)" @change="toggle('fixtureIds', option.fixtureId)" />
        {{ option.label }}
      </label>
    </fieldset>

    <fieldset v-if="model.mode !== 'selection'" class="flex flex-wrap items-center gap-2">
      <legend class="sr-only">Spielarten</legend>
      <span class="text-xs font-semibold text-[#5b625d]" aria-hidden="true">Spielarten:</span>
      <button type="button" :class="buttonClass(model.kinds.length === 0)" :aria-pressed="model.kinds.length === 0" @click="update({ kinds: [] })">Alle</button>
      <button v-for="(label, kind) in KIND_LABELS" :key="kind" type="button" :class="buttonClass(model.kinds.includes(kind))" :aria-pressed="model.kinds.includes(kind)" @click="toggle('kinds', kind)">
        {{ label }}
      </button>
    </fieldset>
  </div>
</template>
