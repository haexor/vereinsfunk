<script setup lang="ts">
import { VEO_TEAM_KEY_METRICS } from '@vereinsfunk/domain'

// Spec 002, PR 4: "Kennzahlen bearbeiten" wie Veos Dialog (Inventar §1b.3): Kennzahlen nach
// Gruppen, Zaehler "n/max gewaehlt". Kennzahlenkarten: bis 4; Radar: genau 6 (min = max).
// PR 3: auch "Spalten bearbeiten" der Spielertabelle (Inventar §2.2) mit eigenem Katalog; die
// Reihenfolge der Wahl ist die Reihenfolge der Spalten.
interface PickerOption { id: string; group: string; label: string; description: string }
const props = withDefaults(defineProps<{
  title: string
  description: string
  selected: readonly string[]
  min: number
  max: number
  options?: readonly PickerOption[]
  groups?: readonly { id: string; label: string }[]
  // Mit Standardwahl bietet der Dialog "Zuruecksetzen" an.
  defaults?: readonly string[]
}>(), {
  options: () => VEO_TEAM_KEY_METRICS,
  groups: () => [
    { id: 'possession', label: 'Ballbesitz' },
    { id: 'passes', label: 'Pässe' },
    { id: 'events', label: 'Ereignisse' },
    { id: 'combos', label: 'Kombinationen' },
  ],
})
const emit = defineEmits<{ apply: [ids: string[]]; close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const chosen = ref<string[]>([...props.selected])
onMounted(() => dialog.value?.showModal())

const full = computed(() => chosen.value.length >= props.max)
const valid = computed(() => chosen.value.length >= props.min && chosen.value.length <= props.max)
function toggle(id: string) {
  chosen.value = chosen.value.includes(id) ? chosen.value.filter((entry) => entry !== id) : full.value ? chosen.value : [...chosen.value, id]
}
const headingId = useId()
</script>

<template>
  <dialog ref="dialog" class="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 text-ink backdrop:bg-black/40" :aria-labelledby="headingId" @close="emit('close')">
    <form method="dialog" class="flex max-h-[85vh] flex-col" @submit.prevent="valid && emit('apply', chosen)">
      <header class="border-b border-[#eef0ea] p-5">
        <h2 :id="headingId" class="font-display text-lg font-bold">{{ title }}</h2>
        <p class="mt-1 text-sm text-[#5b625d]">{{ description }}</p>
      </header>
      <div class="flex-1 overflow-y-auto p-5">
        <fieldset v-for="group in groups" :key="group.id" class="mb-4">
          <legend class="mb-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">{{ group.label }}</legend>
          <label v-for="metric in options.filter((entry) => entry.group === group.id)" :key="metric.id" class="flex min-h-11 items-start gap-2 py-1 text-sm">
            <input
              type="checkbox" class="mt-1 h-4 w-4 accent-forest" :checked="chosen.includes(metric.id)"
              :disabled="!chosen.includes(metric.id) && full" @change="toggle(metric.id)"
            />
            <span><span class="font-semibold">{{ metric.label }}</span><span class="block text-xs text-[#6c756f]">{{ metric.description }}</span></span>
          </label>
        </fieldset>
      </div>
      <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-[#eef0ea] p-4">
        <span class="text-xs text-[#5b625d]" role="status">{{ chosen.length }}/{{ max }} gewählt<template v-if="chosen.length < min"> · mindestens {{ min }}</template></span>
        <span class="flex flex-wrap gap-2">
          <button v-if="defaults" type="button" class="focus-ring min-h-11 rounded-xl px-3 text-sm font-semibold text-forest" @click="chosen = [...defaults]">Zurücksetzen</button>
          <button type="button" class="focus-ring min-h-11 rounded-xl border border-[#dfe0d9] bg-white px-4 text-sm font-semibold" @click="dialog?.close()">Abbrechen</button>
          <button type="submit" class="focus-ring min-h-11 rounded-xl bg-forest px-4 text-sm font-semibold text-white disabled:opacity-50" :disabled="!valid">Übernehmen</button>
        </span>
      </footer>
    </form>
  </dialog>
</template>
