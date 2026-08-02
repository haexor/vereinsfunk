<script setup lang="ts">
import { Filter, Plus, Search } from '@lucide/vue'
const { drafts } = useDemoData()
const query = ref('')
const filtered = computed(() => drafts.value.filter((item) => item.title.toLowerCase().includes(query.value.toLowerCase())))
</script>

<template>
  <div class="mx-auto max-w-[1280px] px-5 py-8 sm:px-10">
    <header class="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div class="eyebrow mb-3">Content</div><h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Beiträge</h1><p class="mt-2 text-sm text-[#727a75]">Alle Entwürfe, Freigaben und geplanten Inhalte.</p></div><NuxtLink to="/erstellen" class="focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white"><Plus :size="17" /> Beitrag erstellen</NuxtLink></header>
    <div class="card overflow-hidden">
      <div class="flex flex-col gap-3 border-b border-[#e7e7df] p-4 sm:flex-row sm:items-center"><label class="relative flex-1"><Search :size="16" class="absolute left-3 top-3 text-[#8a918c]" /><input v-model="query" class="focus-ring w-full rounded-xl border border-[#dedfd8] bg-white py-2.5 pl-10 pr-3 text-sm" placeholder="Beiträge durchsuchen …" /></label><button class="focus-ring flex items-center justify-center gap-2 rounded-xl border border-[#dedfd8] bg-white px-4 py-2.5 text-xs font-semibold"><Filter :size="15" /> Filter</button></div>
      <div class="divide-y divide-[#ecece5]"><div v-for="item in filtered" :key="item.id" class="flex items-center gap-4 p-4 sm:px-6"><div class="grid h-12 w-12 place-items-center rounded-xl font-display font-extrabold" :style="{ background: item.color }">{{ item.title[0] }}</div><div class="min-w-0 flex-1"><div class="truncate text-sm font-semibold">{{ item.title }}</div><div class="mt-1 text-[11px] text-[#7b827d]">{{ item.type }} · {{ item.department }}</div></div><div class="hidden gap-1 sm:flex"><PlatformIcon v-for="platform in item.platforms" :key="platform" :platform="platform" /></div><StatusPill :status="item.status" /></div><div v-if="!filtered.length" class="p-12 text-center text-sm text-[#7b827d]">Keine Beiträge gefunden.</div></div>
    </div>
  </div>
</template>
