<script setup lang="ts">
import { Plus } from '@lucide/vue'
</script>

<template>
  <div class="mx-auto max-w-[1280px] px-5 py-8 sm:px-10">
    <header class="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div class="eyebrow mb-3">Content</div><h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Beiträge</h1><p class="mt-2 text-sm text-[#727a75]">Alle Entwürfe, Freigaben und geplanten Inhalte.</p></div><NuxtLink to="/erstellen" class="focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white"><Plus :size="17" /> Beitrag erstellen</NuxtLink></header>
    <div class="card overflow-hidden">
      <div class="p-12 text-center text-sm text-[#7b827d]">Es liegen noch keine Beiträge vor.</div>
    </div>
  </div>
</template>
