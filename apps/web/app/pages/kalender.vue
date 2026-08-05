<script setup lang="ts">
import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/vue'

const session = await useSession()
const scope = await useScope()
const activeOrganization = computed(() => session.value?.scopes.find((item) => item.organizationId === scope.value?.organizationId) ?? null)
const timezone = computed(() => activeOrganization.value?.organizationTimezone ?? 'Europe/Berlin')

function localDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

const monthOffset = ref(0)

const viewedMonth = computed(() => {
  const [year, month] = localDateKey(new Date(), timezone.value).split('-').map(Number) as [number, number]
  const base = new Date(Date.UTC(year, month - 1 + monthOffset.value, 1))
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() }
})
const monthLabel = computed(() => new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(Date.UTC(viewedMonth.value.year, viewedMonth.value.month, 1))))
const daysInMonth = computed(() => new Date(Date.UTC(viewedMonth.value.year, viewedMonth.value.month + 1, 0)).getUTCDate())
const leadingBlanks = computed(() => {
  const firstWeekday = new Date(Date.UTC(viewedMonth.value.year, viewedMonth.value.month, 1)).getUTCDay()
  return firstWeekday === 0 ? 6 : firstWeekday - 1
})

interface CalendarPost { id: string; scheduled_for: string }
const postsByDay = ref<Record<number, { id: string }[]>>({})
const loading = ref(true)

async function loadMonth() {
  if (import.meta.server) return
  loading.value = true
  const organizationId = scope.value?.organizationId
  if (!organizationId) { postsByDay.value = {}; loading.value = false; return }
  const departmentId = scope.value?.departmentId
  const supabase = useSupabaseClient()
  const { year, month } = viewedMonth.value
  const rangeStart = new Date(Date.UTC(year, month, 1) - 3 * 24 * 60 * 60 * 1000).toISOString()
  const rangeEnd = new Date(Date.UTC(year, month + 1, 1) + 3 * 24 * 60 * 60 * 1000).toISOString()

  let query = supabase
    .from('posts')
    .select('id, scheduled_for')
    .eq('organization_id', organizationId)
    .not('scheduled_for', 'is', null)
    .gte('scheduled_for', rangeStart)
    .lte('scheduled_for', rangeEnd)
  if (departmentId) query = query.eq('department_id', departmentId)

  const result = await query
  const byDay: Record<number, { id: string }[]> = {}
  for (const post of (result.data ?? []) as CalendarPost[]) {
    const [postYear, postMonth, postDay] = localDateKey(new Date(post.scheduled_for), timezone.value).split('-').map(Number)
    if (postYear === year && postMonth === month + 1 && postDay) {
      byDay[postDay] = [...(byDay[postDay] ?? []), { id: post.id }]
    }
  }
  postsByDay.value = byDay
  loading.value = false
}

watch(monthOffset, loadMonth)
await loadMonth()

const hasAnyPost = computed(() => Object.keys(postsByDay.value).length > 0)
</script>

<template>
  <div class="mx-auto max-w-[1280px] px-5 py-8 sm:px-10">
    <header class="mb-8 flex items-end justify-between">
      <div>
        <div class="eyebrow mb-3">Planung</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">{{ monthLabel }}</h1>
        <p class="mt-2 text-sm text-[#727a75]">Euer gemeinsamer Redaktionskalender.</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="focus-ring rounded-lg border border-[#dfe0d9] p-2" aria-label="Vorheriger Monat" @click="monthOffset--"><ChevronLeft :size="16" /></button>
        <CalendarDays class="text-forest" />
        <button class="focus-ring rounded-lg border border-[#dfe0d9] p-2" aria-label="Nächster Monat" @click="monthOffset++"><ChevronRight :size="16" /></button>
      </div>
    </header>
    <div class="card overflow-hidden">
      <div class="grid grid-cols-7 border-b border-[#e5e6df] bg-[#f5f5ef] text-center text-[10px] font-bold uppercase tracking-wider text-[#818782]">
        <div v-for="day in ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']" :key="day" class="p-3">{{ day }}</div>
      </div>
      <div v-if="!loading && !hasAnyPost" class="border-b border-[#e5e6df] bg-[#f9faf5] p-3 text-center text-[11px] text-[#7b827d]">
        Für diesen Monat sind noch keine Beiträge geplant.
      </div>
      <div class="grid grid-cols-7">
        <div v-for="blank in leadingBlanks" :key="`b${blank}`" class="min-h-24 border-b border-r border-[#e9eae3] bg-[#fafaf7] sm:min-h-32" />
        <div v-for="day in daysInMonth" :key="day" class="min-h-24 border-b border-r border-[#e9eae3] p-2 sm:min-h-32">
          <span class="text-xs font-semibold">{{ day }}</span>
          <div v-for="post in postsByDay[day] || []" :key="post.id" class="mt-2 rounded-lg bg-[#eef1e9] p-2 text-[9px] font-semibold text-forest">Beitrag geplant</div>
        </div>
      </div>
    </div>
  </div>
</template>
