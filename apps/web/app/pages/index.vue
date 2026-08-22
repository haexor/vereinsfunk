<script setup lang="ts">
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, FileText, Palette, Plus, ShieldCheck, X } from '@lucide/vue'
import { ContentSuggestionsResponseSchema, type ContentSuggestion } from '@vereinsfunk/contracts'

const config = useRuntimeConfig()
const session = await useSession()
const scope = await useScope()

const activeOrganization = computed(() => session.value?.scopes.find((item) => item.organizationId === scope.value?.organizationId) ?? null)
const department = computed(() => activeOrganization.value?.departments.find((item) => item.id === scope.value?.departmentId)?.name ?? activeOrganization.value?.organizationName ?? '')
const firstName = computed(() => session.value?.displayName.split(/\s+/)[0] ?? '')
const timezone = computed(() => activeOrganization.value?.organizationTimezone ?? 'Europe/Berlin')
const todayLabel = computed(() => new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone.value }).format(new Date()))

interface WeekDay { key: string; label: string; dayNumber: number; isToday: boolean; posts: { id: string }[] }
interface DashboardPost { id: string; status: string; scheduled_for: string | null }

const loadingDashboard = ref(true)
const dashboardError = ref(false)
const stats = ref<{ published: number; openApprovals: number; scheduledNext7Days: number } | null>(null)
const weekDays = ref<WeekDay[]>([])
const nextSteps = ref<{ key: string; label: string; href: string }[]>([])
const suggestions = ref<ContentSuggestion[]>([])
const suggestionsLoaded = ref(false)

function localDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function buildWeek(timeZone: string, posts: readonly DashboardPost[]): WeekDay[] {
  const todayKey = localDateKey(new Date(), timeZone)
  const monday = new Date(`${todayKey}T00:00:00Z`)
  const weekday = monday.getUTCDay()
  monday.setUTCDate(monday.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday))

  const labels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
  const days: WeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday)
    day.setUTCDate(day.getUTCDate() + index)
    const key = localDateKey(day, 'UTC')
    return { key, label: labels[index] ?? '', dayNumber: day.getUTCDate(), isToday: key === todayKey, posts: [] }
  })
  for (const post of posts) {
    if (!post.scheduled_for) continue
    const key = localDateKey(new Date(post.scheduled_for), timeZone)
    days.find((day) => day.key === key)?.posts.push({ id: post.id })
  }
  return days
}

async function loadDashboard() {
  if (import.meta.server) return
  const organizationId = scope.value?.organizationId
  if (!organizationId) { loadingDashboard.value = false; return }
  const departmentId = scope.value?.departmentId
  const supabase = useSupabaseClient()

  let postsQuery = supabase.from('posts').select('id, status, scheduled_for').eq('organization_id', organizationId)
  if (departmentId) postsQuery = postsQuery.eq('department_id', departmentId)

  const [postsResult, approvalsResult, brandResult, profileResult] = await Promise.all([
    postsQuery,
    supabase.from('approval_requests').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).is('invalidated_at', null),
    supabase.from('organization_brand_profiles').select('logo_asset_id').eq('organization_id', organizationId).maybeSingle(),
    supabase.from('organization_profiles').select('responsible_person_profile_id').eq('organization_id', organizationId).maybeSingle(),
  ])

  if (postsResult.error || approvalsResult.error) {
    dashboardError.value = true
    loadingDashboard.value = false
    return
  }

  const posts = (postsResult.data ?? []) as DashboardPost[]
  const now = Date.now()
  const in7Days = now + 7 * 24 * 60 * 60 * 1000
  stats.value = {
    published: posts.filter((post) => post.status === 'published').length,
    openApprovals: approvalsResult.count ?? 0,
    scheduledNext7Days: posts.filter((post) => {
      if (!post.scheduled_for) return false
      const time = new Date(post.scheduled_for).getTime()
      return time >= now && time <= in7Days
    }).length,
  }
  weekDays.value = buildWeek(timezone.value, posts)

  const onboarding = await $fetch<{ completedSteps: string[] }>(`${config.public.apiBase}/v1/onboarding`, {
    headers: await useAuthHeader(),
    query: { organizationId },
  }).catch(() => ({ completedSteps: [] as string[] }))

  const steps: { key: string; label: string; href: string }[] = []
  if (!brandResult.data?.logo_asset_id && !onboarding.completedSteps.includes('branding')) {
    steps.push({ key: 'branding', label: 'Logo und Farben festlegen', href: '/marke' })
  }
  if (!profileResult.data?.responsible_person_profile_id && !onboarding.completedSteps.includes('responsible_person')) {
    steps.push({ key: 'responsible_person', label: 'Verantwortliche Ansprechperson bestätigen', href: '/onboarding' })
  }
  nextSteps.value = steps
  loadingDashboard.value = false
}

function suggestionHref(item: ContentSuggestion) {
  if (item.fixtureId) return `/erstellen?fixtureId=${item.fixtureId}`
  if (item.clubEventId) return `/erstellen?clubEventId=${item.clubEventId}`
  return '/erstellen'
}

function occursLabel(iso: string | undefined) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', timeZone: timezone.value }).format(new Date(iso))
}

async function dismissSuggestion(item: ContentSuggestion) {
  const endpoint = item.kind === 'fixture_announcement' ? `/v1/fixtures/${item.fixtureId}/dismiss-announcement`
    : item.kind === 'fixture_result' ? `/v1/fixtures/${item.fixtureId}/dismiss-result`
    : item.kind === 'event_invitation' ? `/v1/club-events/${item.clubEventId}/dismiss-invitation`
    : null
  if (!endpoint) return
  try {
    await $fetch(`${config.public.apiBase}${endpoint}`, { method: 'POST', headers: await useAuthHeader() })
    suggestions.value = suggestions.value.filter((suggestion) => suggestion !== item)
  } catch (error) {
    console.error(error)
  }
}

async function loadSuggestions() {
  if (import.meta.server) return
  const organizationId = scope.value?.organizationId
  const departmentId = scope.value?.departmentId
  if (!organizationId || !departmentId || !useCan('post.create', { organizationId, departmentId })) return
  try {
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/departments/${departmentId}/content-suggestions`, { headers: await useAuthHeader() })
    suggestions.value = ContentSuggestionsResponseSchema.parse(response).suggestions
    suggestionsLoaded.value = true
  } catch {
    // Anlassvorschlaege sind ein Zusatz, kein Kern-Dashboard-Datum -- ein Ausfall bleibt hier
    // unsichtbar statt das Dashboard mit einer Fehlermeldung zu stoeren.
  }
}

await Promise.all([loadDashboard(), loadSuggestions()])
</script>

<template>
  <div>
    <header class="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        <div class="eyebrow mb-3">{{ department }} · {{ todayLabel }}</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink sm:text-[38px]">Guten Tag, {{ firstName }}.</h1>
        <p class="mt-2 text-sm text-[#6c756f]">Was möchtest du heute für euren Verein bewegen?</p>
      </div>
      <NuxtLink to="/erstellen" class="focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white shadow-xs transition hover:-translate-y-0.5 hover:bg-[#1d4b39]">
        <Plus :size="17" /> Neuer Beitrag
      </NuxtLink>
    </header>

    <section v-if="dashboardError" class="card mb-7 p-5 text-sm font-semibold text-red-700">
      Die Kennzahlen konnten nicht geladen werden. Bitte lade die Seite neu.
    </section>
    <section v-else-if="!loadingDashboard && stats" class="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Kennzahlen">
      <article class="card p-4 sm:p-5">
        <div class="mb-5 flex items-start justify-between"><span class="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><CheckCircle2 :size="17" /></span></div>
        <div class="font-display text-2xl font-extrabold tracking-[-.04em] sm:text-[29px]">{{ stats.published }}</div>
        <div class="mt-1 text-[11px] text-[#7a817d]"><span class="font-semibold text-ink">Veröffentlicht</span></div>
      </article>
      <article class="card p-4 sm:p-5">
        <div class="mb-5 flex items-start justify-between"><span class="grid h-9 w-9 place-items-center rounded-xl bg-amber-100 text-amber-700"><Clock3 :size="17" /></span></div>
        <div class="font-display text-2xl font-extrabold tracking-[-.04em] sm:text-[29px]">{{ stats.openApprovals }}</div>
        <div class="mt-1 text-[11px] text-[#7a817d]"><span class="font-semibold text-ink">Offene Freigaben</span></div>
      </article>
      <article class="card p-4 sm:p-5">
        <div class="mb-5 flex items-start justify-between"><span class="grid h-9 w-9 place-items-center rounded-xl bg-sky-100 text-sky-700"><FileText :size="17" /></span></div>
        <div class="font-display text-2xl font-extrabold tracking-[-.04em] sm:text-[29px]">{{ stats.scheduledNext7Days }}</div>
        <div class="mt-1 text-[11px] text-[#7a817d]"><span class="font-semibold text-ink">Geplant, nächste 7 Tage</span></div>
      </article>
    </section>

    <section class="grid gap-7 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,.75fr)]">
      <div class="space-y-7">
        <article class="card overflow-hidden">
          <div class="flex flex-col items-start gap-3 border-b border-[#e7e7df] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div class="min-w-0"><h2 class="font-display text-base font-bold tracking-[-.02em]">Aktuelle Beiträge</h2><p class="mt-0.5 text-[11px] text-[#7a817d]">Eure nächsten Inhalte auf einen Blick</p></div>
            <NuxtLink to="/beitraege" class="focus-ring inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-forest hover:bg-stone-100">Alle ansehen <ArrowRight :size="13" /></NuxtLink>
          </div>
          <div class="break-words p-8 text-center text-xs text-[#7b827d]">Es liegen noch keine Beiträge vor. Diese Liste befüllt sich, sobald echte Beiträge erstellt werden.</div>
        </article>

        <article class="card overflow-hidden">
          <div class="flex flex-col items-start gap-3 border-b border-[#e7e7df] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div class="min-w-0"><h2 class="font-display text-base font-bold tracking-[-.02em]">Redaktionsplan</h2><p class="mt-0.5 text-[11px] text-[#7a817d]">Diese Woche, {{ timezone }}</p></div>
            <NuxtLink to="/kalender" class="focus-ring inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-forest hover:bg-stone-100">Zum Kalender <CalendarDays :size="13" /></NuxtLink>
          </div>
          <div v-if="dashboardError" class="p-8 text-center text-xs font-semibold text-red-700">Der Redaktionsplan konnte nicht geladen werden.</div>
          <div v-else class="overflow-x-auto">
            <div class="grid min-w-0 grid-cols-7 divide-x divide-[#ecece5] md:min-w-[620px]">
              <div v-for="day in weekDays" :key="day.key" class="min-h-28 min-w-0 p-2 sm:min-h-32 sm:p-3">
                <div class="mb-3 flex items-center justify-between"><span class="text-[10px] font-bold uppercase text-[#929792]">{{ day.label }}</span><span class="grid h-6 w-6 place-items-center rounded-full text-xs font-semibold" :class="day.isToday ? 'bg-forest text-white' : 'text-ink'">{{ day.dayNumber }}</span></div>
                <div v-if="day.posts.length === 0" class="text-[10px] text-[#c4c8c1]">—</div>
                <div v-for="post in day.posts" :key="post.id" class="truncate rounded-lg bg-[#eef1e9] p-1 text-[10px] font-semibold leading-tight text-forest sm:p-2">Beitrag geplant</div>
              </div>
            </div>
          </div>
        </article>
      </div>

      <aside class="space-y-7">
        <article v-if="nextSteps.length > 0" class="card p-5">
          <div class="mb-4 flex items-center justify-between"><h2 class="font-display text-sm font-bold">Nächste Schritte</h2><span class="grid h-8 w-8 place-items-center rounded-xl bg-violet-100 text-violet-700"><ShieldCheck :size="15" /></span></div>
          <ul class="space-y-2">
            <li v-for="item in nextSteps" :key="item.key">
              <NuxtLink :to="item.href" class="focus-ring flex min-w-0 items-center justify-between gap-2 rounded-xl border border-[#e6e7e0] p-3 text-xs font-semibold text-ink hover:bg-stone-50">
                <span class="flex min-w-0 items-center gap-2"><Palette v-if="item.key === 'branding'" :size="14" class="shrink-0 text-forest" /><ShieldCheck v-else :size="14" class="shrink-0 text-forest" /><span>{{ item.label }}</span></span>
                <ArrowRight :size="13" class="shrink-0 text-[#9aa196]" />
              </NuxtLink>
            </li>
          </ul>
        </article>
        <article v-else-if="!loadingDashboard" class="card p-5 text-center">
          <CheckCircle2 :size="22" class="mx-auto mb-2 text-forest" />
          <p class="text-xs font-semibold">Startklar. Alle Einrichtungsschritte sind erledigt.</p>
        </article>
        <article v-if="suggestionsLoaded && suggestions.length > 0" class="card p-5">
          <div class="mb-4 flex items-center justify-between"><h2 class="font-display text-sm font-bold">Anlassvorschläge</h2><span class="grid h-8 w-8 place-items-center rounded-xl bg-sky-100 text-sky-700"><CalendarDays :size="15" /></span></div>
          <ul class="space-y-2">
            <li v-for="item in suggestions" :key="`${item.kind}-${item.fixtureId ?? item.clubEventId ?? item.label}`" class="flex items-center gap-2 rounded-xl border border-[#e6e7e0] p-3">
              <NuxtLink :to="suggestionHref(item)" class="focus-ring min-w-0 flex-1">
                <span class="block truncate text-xs font-semibold text-ink">{{ item.label }}</span>
                <span v-if="item.occursAt" class="block text-[10px] text-[#9aa196]">{{ occursLabel(item.occursAt) }}</span>
              </NuxtLink>
              <button v-if="item.fixtureId || item.clubEventId" class="focus-ring rounded-lg p-1.5 text-[#9aa196] hover:text-red-600" aria-label="Vorschlag verwerfen" @click="dismissSuggestion(item)"><X :size="14" /></button>
            </li>
          </ul>
        </article>
        <article v-else-if="suggestionsLoaded" class="card p-5 text-center text-xs text-[#7b827d]">Keine offenen Anlässe.</article>
      </aside>
    </section>
  </div>
</template>
