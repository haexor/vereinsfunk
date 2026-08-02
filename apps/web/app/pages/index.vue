<script setup lang="ts">
import { ArrowRight, CalendarDays, Check, Clock3, FileText, MoreHorizontal, Plus, Sparkles, TrendingUp, Users } from '@lucide/vue'

const { drafts, department } = useDemoData()
const firstName = 'Lena'

const stats = [
  { label: 'Veröffentlicht', value: '18', detail: 'diesen Monat', icon: Check, trend: '+12 %', color: 'bg-emerald-100 text-emerald-700' },
  { label: 'In Vorbereitung', value: '7', detail: 'Beiträge', icon: FileText, trend: '', color: 'bg-sky-100 text-sky-700' },
  { label: 'Offene Freigaben', value: '2', detail: 'warten auf dich', icon: Clock3, trend: '', color: 'bg-amber-100 text-amber-700' },
  { label: 'Reichweite', value: '24,8k', detail: 'letzte 30 Tage', icon: TrendingUp, trend: '+18 %', color: 'bg-violet-100 text-violet-700' },
]

const week = [
  { day: 'Mo', date: 3, items: [] },
  { day: 'Di', date: 4, items: [{ color: '#ff8a73', text: 'Trainerin' }] },
  { day: 'Mi', date: 5, items: [] },
  { day: 'Do', date: 6, items: [{ color: '#bbec51', text: 'Derbysieg' }] },
  { day: 'Fr', date: 7, items: [] },
  { day: 'Sa', date: 8, items: [{ color: '#7dd3fc', text: 'Heimspiel' }] },
  { day: 'So', date: 9, items: [] },
]
</script>

<template>
  <div class="mx-auto max-w-[1480px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9 xl:px-12">
    <header class="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        <div class="eyebrow mb-3">{{ department }} · Sonntag, 2. August</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink sm:text-[38px]">Guten Morgen, {{ firstName }}.</h1>
        <p class="mt-2 text-sm text-[#6c756f]">Was möchtest du heute für euren Verein bewegen?</p>
      </div>
      <NuxtLink to="/erstellen" class="focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#1d4b39]">
        <Plus :size="17" /> Neuer Beitrag
      </NuxtLink>
    </header>

    <section class="mb-7 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Kennzahlen">
      <article v-for="stat in stats" :key="stat.label" class="card p-4 sm:p-5">
        <div class="mb-5 flex items-start justify-between">
          <span class="grid h-9 w-9 place-items-center rounded-xl" :class="stat.color"><component :is="stat.icon" :size="17" /></span>
          <span v-if="stat.trend" class="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{{ stat.trend }}</span>
        </div>
        <div class="font-display text-2xl font-extrabold tracking-[-.04em] sm:text-[29px]">{{ stat.value }}</div>
        <div class="mt-1 text-[11px] text-[#7a817d]"><span class="font-semibold text-ink">{{ stat.label }}</span><span class="hidden sm:inline"> · {{ stat.detail }}</span></div>
      </article>
    </section>

    <section class="grid gap-7 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,.75fr)]">
      <div class="space-y-7">
        <article class="card overflow-hidden">
          <div class="flex items-center justify-between border-b border-[#e7e7df] px-5 py-4 sm:px-6">
            <div><h2 class="font-display text-base font-bold tracking-[-.02em]">Aktuelle Beiträge</h2><p class="mt-0.5 text-[11px] text-[#7a817d]">Eure nächsten Inhalte auf einen Blick</p></div>
            <NuxtLink to="/beitraege" class="focus-ring flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-forest hover:bg-stone-100">Alle ansehen <ArrowRight :size="13" /></NuxtLink>
          </div>
          <div class="divide-y divide-[#ecece5]">
            <div v-for="item in drafts" :key="item.id" class="group flex items-center gap-3 px-4 py-3.5 transition hover:bg-white sm:gap-4 sm:px-6">
              <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-base font-extrabold text-ink" :style="{ background: item.color }">{{ item.title.charAt(0) }}</div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13px] font-semibold text-ink">{{ item.title }}</div>
                <div class="mt-1 flex items-center gap-2 text-[10px] text-[#838984]"><span>{{ item.type }}</span><span>·</span><span>{{ item.department }}</span></div>
              </div>
              <div class="hidden items-center gap-1 sm:flex"><PlatformIcon v-for="platform in item.platforms" :key="platform" :platform="platform" /></div>
              <StatusPill :status="item.status" />
              <div class="hidden w-24 text-right text-[10px] text-[#747b76] md:block"><div class="font-medium text-ink">{{ item.date }}</div><div v-if="item.time">{{ item.time }} Uhr</div></div>
              <button class="focus-ring rounded-lg p-1.5 text-[#9ca19d] opacity-50 hover:bg-stone-100 hover:text-ink group-hover:opacity-100" aria-label="Weitere Aktionen"><MoreHorizontal :size="17" /></button>
            </div>
          </div>
        </article>

        <article class="card overflow-hidden">
          <div class="flex items-center justify-between border-b border-[#e7e7df] px-5 py-4 sm:px-6">
            <div><h2 class="font-display text-base font-bold tracking-[-.02em]">Redaktionsplan</h2><p class="mt-0.5 text-[11px] text-[#7a817d]">3.–9. August 2026</p></div>
            <NuxtLink to="/kalender" class="focus-ring flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-forest hover:bg-stone-100">Zum Kalender <CalendarDays :size="13" /></NuxtLink>
          </div>
          <div class="grid min-w-[620px] grid-cols-7 divide-x divide-[#ecece5] overflow-x-auto">
            <div v-for="day in week" :key="day.day" class="min-h-32 p-3">
              <div class="mb-3 flex items-center justify-between"><span class="text-[10px] font-bold uppercase text-[#929792]">{{ day.day }}</span><span class="grid h-6 w-6 place-items-center rounded-full text-xs font-semibold" :class="day.date === 6 ? 'bg-forest text-white' : 'text-ink'">{{ day.date }}</span></div>
              <div v-for="event in day.items" :key="event.text" class="rounded-lg p-2 text-[10px] font-semibold leading-tight text-ink" :style="{ backgroundColor: event.color }">{{ event.text }}</div>
            </div>
          </div>
        </article>
      </div>

      <aside class="space-y-7">
        <article class="relative overflow-hidden rounded-[22px] bg-forest p-6 text-white shadow-sm">
          <div class="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-lime/10" />
          <div class="relative">
            <span class="mb-5 grid h-10 w-10 place-items-center rounded-xl bg-lime text-forest"><Sparkles :size="19" /></span>
            <p class="eyebrow !text-white/45">Idee für diese Woche</p>
            <h2 class="mt-3 font-display text-xl font-extrabold leading-tight tracking-[-.035em]">Zeigt die Menschen hinter eurem Verein.</h2>
            <p class="mt-3 text-xs leading-relaxed text-white/60">Ein kurzer Blick hinter die Kulissen schafft Nähe und gibt Ehrenamtlichen die Bühne, die sie verdienen.</p>
            <NuxtLink to="/erstellen?type=people" class="focus-ring mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-forest transition hover:bg-lime">Idee verwenden <ArrowRight :size="13" /></NuxtLink>
          </div>
        </article>

        <article class="card p-5">
          <div class="mb-5 flex items-center justify-between"><div><h2 class="font-display text-sm font-bold">Euer Monat</h2><p class="mt-0.5 text-[10px] text-[#858b86]">August · Zielerreichung</p></div><span class="grid h-8 w-8 place-items-center rounded-xl bg-violet-100 text-violet-700"><Users :size="15" /></span></div>
          <div class="space-y-4">
            <div><div class="mb-1.5 flex justify-between text-[11px]"><span>Beiträge</span><strong>18 / 24</strong></div><div class="h-2 overflow-hidden rounded-full bg-[#ecece6]"><div class="h-full w-3/4 rounded-full bg-forest" /></div></div>
            <div><div class="mb-1.5 flex justify-between text-[11px]"><span>Abteilungen aktiv</span><strong>3 / 4</strong></div><div class="h-2 overflow-hidden rounded-full bg-[#ecece6]"><div class="h-full w-3/4 rounded-full bg-lime" /></div></div>
          </div>
          <p class="mt-5 rounded-xl bg-[#f3f4ee] p-3 text-[10px] leading-relaxed text-[#707771]"><strong class="text-ink">Fast geschafft:</strong> Noch 6 Beiträge bis zu eurem Monatsziel.</p>
        </article>
      </aside>
    </section>
  </div>
</template>
