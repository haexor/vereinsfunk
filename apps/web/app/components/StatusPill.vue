<script setup lang="ts">
const props = defineProps<{ status: 'Entwurf' | 'Freigabe' | 'Geplant' | 'Veröffentlicht' }>()
const classes = computed(() => ({
  Entwurf: 'bg-stone-100 text-stone-600',
  Freigabe: 'bg-amber-100 text-amber-800',
  Geplant: 'bg-sky-100 text-sky-800',
  Veröffentlicht: 'bg-emerald-100 text-emerald-800',
})[props.status])
</script>

<template>
  <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" :class="classes">
    <span class="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{{ props.status }}
  </span>
</template>
