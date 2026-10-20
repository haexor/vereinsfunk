<script setup lang="ts">
import { CalendarDays } from '@lucide/vue'
import type { DashboardWeekDay } from '../utils/dashboardWeek'

// Redaktionsplan des Dashboards: die laufende Woche mit eingeplanten Beitraegen. Die Tage
// berechnet die Seite (buildDashboardWeek), damit sie mit den Kennzahlen aus einem Ladelauf stammen.
defineProps<{
  days: DashboardWeekDay[]
  timezone: string
  error: boolean
}>()
</script>

<template>
  <article class="card overflow-hidden">
    <div
      class="flex flex-col items-start gap-3 border-b border-[#e7e7df] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      <div class="min-w-0">
        <h2 class="font-display text-base font-bold tracking-[-.02em]">Redaktionsplan</h2>
        <p class="mt-0.5 text-[11px] text-[#7a817d]">Diese Woche, {{ timezone }}</p>
      </div>
      <NuxtLink
        to="/kalender"
        class="focus-ring inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-forest hover:bg-stone-100"
        >Zum Kalender <CalendarDays :size="13"
      /></NuxtLink>
    </div>
    <div v-if="error" class="p-8 text-center text-xs font-semibold text-red-700">
      Der Redaktionsplan konnte nicht geladen werden.
    </div>
    <div v-else class="overflow-x-auto">
      <div class="grid min-w-0 grid-cols-7 divide-x divide-[#ecece5] md:min-w-[620px]">
        <div
          v-for="day in days"
          :key="day.key"
          class="min-h-28 min-w-0 p-2 sm:min-h-32 sm:p-3"
        >
          <div class="mb-3 flex items-center justify-between">
            <span class="text-[10px] font-bold uppercase text-[#929792]">{{ day.label }}</span
            ><span
              class="grid h-6 w-6 place-items-center rounded-full text-xs font-semibold"
              :class="day.isToday ? 'bg-forest text-white' : 'text-ink'"
              >{{ day.dayNumber }}</span
            >
          </div>
          <div v-if="day.posts.length === 0" class="text-[10px] text-[#c4c8c1]">—</div>
          <div
            v-for="post in day.posts"
            :key="post.id"
            class="truncate rounded-lg bg-[#eef1e9] p-1 text-[10px] font-semibold leading-tight text-forest sm:p-2"
          >
            Beitrag geplant
          </div>
        </div>
      </div>
    </div>
  </article>
</template>
