<script setup lang="ts">
// Spec 002, PR 2: Rahmen einer Grafik der Spielauswertung. Fehlt der Teil, steht statt der Grafik
// der Grund (FR-066); darunter "So liest du ..." (FR-004).
const props = defineProps<{ title: string; readMe?: string; hint?: string | null }>()
const headingId = useId()
</script>

<template>
  <section class="card min-w-0 p-5" :aria-labelledby="headingId">
    <h2 :id="headingId" class="mb-3 font-display text-base font-bold text-ink">{{ props.title }}</h2>
    <p v-if="props.hint" class="text-sm text-[#6c756f]">{{ props.hint }}</p>
    <slot v-else />
    <details v-if="props.readMe && !props.hint" class="mt-4 text-sm text-[#5b625d]">
      <summary class="focus-ring inline-flex min-h-11 cursor-pointer items-center font-semibold text-forest">So liest du: {{ props.title }}</summary>
      <p class="mt-1">{{ props.readMe }}</p>
    </details>
  </section>
</template>
