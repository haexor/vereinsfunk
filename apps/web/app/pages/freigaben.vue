<script setup lang="ts">
import { Check, MessageSquareText, ShieldCheck } from '@lucide/vue'
const approvals = [
  { title: 'Derbysieg der Ersten', department: 'Fußball', author: 'Jonas Weber', flag: 'Keine Warnungen', image: 'DREI PUNKTE. EIN TEAM.', color: '#caff4a' },
  { title: 'Jugendturnier am Samstag', department: 'Handball', author: 'Mia Kern', flag: 'Minderjährige · Einwilligung geprüft', image: 'UNSER NACHWUCHS. UNSERE ZUKUNFT.', color: '#ffd1c7' },
]
const approved = ref<string[]>([])
</script>

<template>
  <div class="mx-auto max-w-[1180px] px-5 py-8 sm:px-10"><header class="mb-8"><div class="eyebrow mb-3">Qualitätssicherung</div><h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Offene Freigaben</h1><p class="mt-2 text-sm text-[#727a75]">Prüfe Fakten, Gestaltung und Einwilligungen vor der Veröffentlichung.</p></header>
    <div class="grid gap-6 lg:grid-cols-2"><article v-for="item in approvals" :key="item.title" class="card overflow-hidden"><div class="relative flex aspect-[16/9] items-end overflow-hidden p-6" :style="{ background: item.color }"><div class="absolute -right-12 -top-16 h-56 w-56 rounded-full border-[35px] border-ink/10" /><div class="relative max-w-[85%] font-display text-3xl font-extrabold leading-[.96] tracking-[-.05em] text-ink">{{ item.image }}</div></div><div class="p-5"><div class="flex items-start justify-between gap-4"><div><h2 class="font-display text-base font-bold">{{ item.title }}</h2><p class="mt-1 text-[11px] text-[#7b827d]">{{ item.department }} · von {{ item.author }}</p></div><span v-if="approved.includes(item.title)" class="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold text-emerald-800">Freigegeben</span></div><div class="my-4 flex items-center gap-2 rounded-xl bg-[#f1f4ed] p-3 text-[10px] font-medium text-[#58635b]"><ShieldCheck :size="15" class="text-emerald-700" /> {{ item.flag }}</div><div class="flex gap-2"><button class="focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#dfe0d9] px-3 py-2.5 text-xs font-semibold"><MessageSquareText :size="14" /> Änderung</button><button class="focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl bg-forest px-3 py-2.5 text-xs font-bold text-white disabled:bg-emerald-700" :disabled="approved.includes(item.title)" @click="approved.push(item.title)"><Check :size="14" /> {{ approved.includes(item.title) ? 'Erledigt' : 'Freigeben' }}</button></div></div></article></div>
  </div>
</template>
