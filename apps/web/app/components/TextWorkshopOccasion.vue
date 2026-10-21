<script setup lang="ts">
import { CalendarDays, X } from '@lucide/vue'
import type { ScheduleOccasion } from '@vereinsfunk/contracts'
import { occasionFactRows, occasionSourceLabel } from '../utils/scheduleOccasion'

// Anlass aus dem Kalender in der Textwerkstatt: die vorbelegten Fakten mit ihrer Herkunft, damit
// sie als Angabe der Quelle erkennbar bleiben und nicht als eigene Eingabe (plans/019, Abschnitt 3).
const props = defineProps<{ occasion: ScheduleOccasion; timezone: string }>()
defineEmits<{ remove: [] }>()
const rows = computed(() => occasionFactRows(props.occasion.facts))
const sourceName = computed(() => (props.occasion.kind === 'fixture' ? 'Spielplan' : 'Kalender'))
</script>

<template>
  <section class="rounded-2xl border border-sky-200 bg-sky-50/60 p-4" aria-label="Termin des Beitrags">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="flex items-center gap-2 text-sm font-bold text-sky-900"><CalendarDays :size="16" /> {{ occasion.label }}</p>
        <p class="mt-1 text-[11px] text-sky-800/80">{{ occasionSourceLabel(occasion, timezone) }}</p>
      </div>
      <button type="button" class="focus-ring inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100" @click="$emit('remove')"><X :size="14" /> Ohne Termin</button>
    </div>
    <dl v-if="rows.length" class="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      <template v-for="row in rows" :key="row.label"><dt class="text-xs font-semibold text-[#5c655f]">{{ row.label }}</dt><dd>{{ row.value }}</dd></template>
    </dl>
    <p v-if="occasion.missing.length" class="mt-3 text-xs text-amber-800">Im {{ sourceName }} fehlt noch: {{ occasion.missing.join(', ') }}. Ergänze es unten, wenn es in den Beitrag soll.</p>
    <p class="mt-3 text-[11px] text-[#727a75]">Diese Angaben kommen aus dem {{ sourceName }}. Ändert sich dort etwas, muss der Beitrag erneut freigegeben werden.</p>
  </section>
</template>
