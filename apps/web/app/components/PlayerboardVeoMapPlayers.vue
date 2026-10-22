<script setup lang="ts">
// Spielerliste links neben einer Karte wie bei Veo ("Shots by player" mit "Whole team", Inventar
// §3.8): oben die ganze Mannschaft, darunter die Spieler mit ihrer Zahl. Auf schmalen Bildschirmen
// eine Auswahlliste ueber der Karte. Die Karte kommt ueber den Slot; ohne `enabled` (etwa beim Gegner,
// dessen Spieler Veo nicht kennt) steht sie allein.
export interface MapPlayerOption { key: string; name: string; subtitle?: string; score?: number }
const props = withDefaults(defineProps<{ options: readonly MapPlayerOption[]; label: string; teamLabel?: string; enabled?: boolean }>(), { enabled: true })
const selected = defineModel<string | null>({ required: true })
defineSlots<{ default?: () => unknown }>()

watch(() => props.options, (options) => { if (selected.value !== null && !options.some((option) => option.key === selected.value)) selected.value = null })
const buttonClass = (active: boolean) => [
  'focus-ring flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-1 text-left text-sm',
  active ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#e8e9e2] bg-white text-ink',
]
const selectId = useId()
</script>

<template>
  <div v-if="!enabled"><slot /></div>
  <div v-else class="grid gap-3 md:grid-cols-[13rem_minmax(0,1fr)] md:items-start">
    <div>
      <label :for="selectId" class="sr-only">{{ label }}</label>
      <select :id="selectId" class="focus-ring h-11 w-full rounded-xl border border-[#dfe0d9] bg-white px-2 text-sm text-ink md:hidden" :value="selected ?? ''" @change="selected = ($event.target as HTMLSelectElement).value || null">
        <option value="">{{ teamLabel ?? 'Ganze Mannschaft' }}</option>
        <option v-for="option in options" :key="option.key" :value="option.key">{{ option.name }}<template v-if="option.score !== undefined"> ({{ option.score }})</template></option>
      </select>
      <ul class="hidden max-h-[26rem] gap-1 overflow-y-auto pr-1 md:grid" :aria-label="label">
        <li>
          <button type="button" :class="buttonClass(selected === null)" :aria-pressed="selected === null" @click="selected = null">
            <span class="font-semibold">{{ teamLabel ?? 'Ganze Mannschaft' }}</span>
          </button>
        </li>
        <li v-for="option in options" :key="option.key">
          <button type="button" :class="buttonClass(selected === option.key)" :aria-pressed="selected === option.key" @click="selected = option.key">
            <span class="min-w-0">
              <span class="block truncate font-semibold">{{ option.name }}</span>
              <span v-if="option.subtitle" class="block text-[11px] text-[#6c756f]">{{ option.subtitle }}</span>
            </span>
            <span v-if="option.score !== undefined" class="font-display text-lg font-extrabold tabular-nums">{{ option.score }}</span>
          </button>
        </li>
      </ul>
    </div>
    <div class="min-w-0"><slot /></div>
  </div>
</template>
