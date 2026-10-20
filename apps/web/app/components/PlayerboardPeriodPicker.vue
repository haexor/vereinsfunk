<script setup lang="ts" generic="Period extends string">
// Zeitraumwahl von Rangliste und Spielen: dieselben Knoepfe und derselbe Saison-Hinweis. Eingaben,
// die nur eine Seite kennt (Monat, freier Zeitraum), kommen ueber den Slot in die Hinweiszeile.
const props = defineProps<{ periods: readonly { kind: Period; label: string }[]; seasonFrom: string | null }>()
const period = defineModel<Period>({ required: true })

const seasonFormat = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const seasonHint = computed(() => (props.seasonFrom
  ? `Seit ${seasonFormat.format(new Date(`${props.seasonFrom}T00:00:00Z`))}`
  : 'Kein Saisonbeginn festgelegt – es zählt die gesamte Zeit.'))
</script>

<template>
  <div class="mb-5">
    <div class="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Zeitraum">
      <button
        v-for="item in props.periods"
        :key="item.kind"
        type="button"
        role="radio"
        :aria-checked="period === item.kind"
        class="focus-ring min-h-11 rounded-xl border px-4 text-xs font-semibold"
        :class="period === item.kind ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] bg-white text-ink'"
        @click="period = item.kind"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="flex min-h-11 flex-wrap items-center gap-3 text-xs text-[#6c756f]">
      <span v-if="period === 'season'">{{ seasonHint }}</span>
      <slot />
    </div>
  </div>
</template>
