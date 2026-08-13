<script setup lang="ts">
// Plan 021: derselbe Balken wird an mehreren Stellen gebraucht (Speicher/Kontingente auf
// /einstellungen/tarif, Speicher je Abteilung/Team auf /struktur) -- hier einmal extrahiert statt
// dreifach kopiert, nach dem Vorbild des bisher unextrahierten Balkens in auswertung.vue.
const props = defineProps<{
  label: string
  used: number
  max: number | null
  formatValue?: (value: number) => string
}>()

const format = (value: number) => (props.formatValue ? props.formatValue(value) : new Intl.NumberFormat('de-DE').format(value))
const percentage = computed(() => (props.max === null ? 0 : Math.min(100, (props.used / props.max) * 100)))
const overLimit = computed(() => props.max !== null && props.used > props.max)
</script>

<template>
  <div class="flex items-center gap-3">
    <span class="w-36 shrink-0 truncate text-xs font-semibold text-ink">{{ label }}</span>
    <div v-if="max !== null" class="h-2.5 flex-1 overflow-hidden rounded-full bg-[#eceee7]">
      <div class="h-full rounded-full" :class="overLimit ? 'bg-red-600' : 'bg-forest'" :style="{ width: `${percentage}%` }" />
    </div>
    <span v-else class="flex-1 text-xs text-[#9aa096]">unbegrenzt</span>
    <span class="w-28 shrink-0 text-right text-xs font-bold text-ink">
      {{ format(used) }}<template v-if="max !== null"> / {{ format(max) }}</template>
    </span>
  </div>
</template>
