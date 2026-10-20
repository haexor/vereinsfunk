<script setup lang="ts">
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  Clock3,
  FileText,
  Palette,
  Plus,
  ShieldCheck,
} from '@lucide/vue'
import { OnboardingStateSchema, type OnboardingStep } from '@vereinsfunk/contracts'
import type { PostStatus } from '@vereinsfunk/domain'
import { buildDashboardWeek, type DashboardWeekDay } from '../utils/dashboardWeek'

const api = useApiClient()
const session = await useSession()
const {
  organizationId: activeOrganizationId,
  departmentId: activeDepartmentId,
  organization: activeOrganization,
  organizationTimezone: timezone,
} = await useActiveScope()
// Paket 051, PR 3: Kennzahlen, Beitragsliste, Redaktionsplan und Anlassvorschlaege gehoeren zum
// Modul social_media. Eine modulübergreifende Kachel-API gibt es bewusst nicht; PlayerBoard haengt
// in Paket 052 seine eigene Kachel hier direkt ein.
const {
  isEnabled: isModuleEnabled,
  availability: moduleAvailability,
  canUseAtActiveScope,
  explanation: moduleExplanation,
} = await useScopeModules()
const socialMediaActive = computed(() => isModuleEnabled('social_media'))
// Paket 055: ohne Social-Media-Recht (z. B. Spieler) gibt es hier weder Kacheln noch den Hinweis
// "nicht aktiviert" -- das Modul betrifft die Person schlicht nicht.
const socialMediaRelevant = computed(() => moduleAvailability('social_media') !== 'no_access')
const canCreatePost = computed(() => socialMediaActive.value && canUseAtActiveScope('post.create'))
// Die Ebene, auf der Social Media fuer diese Person abgewaehlt ist (z. B. ihre Mannschaft).
const socialMediaBlockedIn = computed(
  () => moduleExplanation('social_media').explanation?.name ?? department.value,
)
// Paket 052, PR 4: die PlayerBoard-Kachel nur, wenn es im Arbeitsbereich eine Mannschaft gibt --
// ein Verein ohne Mannschaften soll keine leere Kachel sehen.
const { teams: playerboardTeams } = await usePlayerboardTeam()
const playerboardActive = computed(
  () => isModuleEnabled('playerboard') && playerboardTeams.value.length > 0,
)

const department = computed(
  () =>
    activeOrganization.value?.departments.find((item) => item.id === activeDepartmentId.value)
      ?.name ??
    activeOrganization.value?.organizationName ??
    '',
)
const firstName = computed(() => session.value?.displayName.split(/\s+/)[0] ?? '')
const todayLabel = computed(() =>
  new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone.value,
  }).format(new Date()),
)

interface DashboardPost {
  id: string
  status: PostStatus
  scheduled_for: string | null
  created_at: string
}
// So viele der zuletzt angelegten Beitraege zeigt die Karte "Aktuelle Beitraege"; alle weiteren
// stehen in /beitraege.
const RECENT_POSTS_LIMIT = 5

const loadingDashboard = ref(true)
const dashboardError = ref(false)
const stats = ref<{ published: number; openApprovals: number; scheduledNext7Days: number } | null>(
  null,
)
const weekDays = ref<DashboardWeekDay[]>([])
const recentPosts = ref<DashboardPost[]>([])
const nextSteps = ref<{ key: string; label: string; href: string }[]>([])

async function loadDashboard(isLatest: () => boolean) {
  if (import.meta.server) return
  stats.value = null
  weekDays.value = []
  recentPosts.value = []
  nextSteps.value = []
  dashboardError.value = false
  loadingDashboard.value = true
  const organizationId = activeOrganizationId.value
  // Paket 055: Kennzahlen, Beitraege und Einrichtungsschritte gehoeren zu Social Media.
  if (!organizationId || !socialMediaActive.value) {
    loadingDashboard.value = false
    return
  }
  const departmentId = activeDepartmentId.value
  const supabase = useSupabaseClient()

  let postsQuery = supabase
    .from('posts')
    .select('id, status, scheduled_for, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
  if (departmentId) postsQuery = postsQuery.eq('department_id', departmentId)

  const [postsResult, brandResult, profileResult] = await Promise.all([
    postsQuery,
    supabase
      .from('organization_brand_profiles')
      .select('logo_asset_id')
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabase
      .from('organization_profiles')
      .select('responsible_person_profile_id')
      .eq('organization_id', organizationId)
      .maybeSingle(),
  ])
  if (!isLatest()) return

  if (postsResult.error) {
    dashboardError.value = true
    loadingDashboard.value = false
    return
  }

  const posts = (postsResult.data ?? []) as DashboardPost[]
  const now = Date.now()
  const in7Days = now + 7 * 24 * 60 * 60 * 1000
  stats.value = {
    published: posts.filter((post) => post.status === 'published').length,
    // approval_requests kennt keinen Status und keine Abteilung: gezaehlt wurden dort auch laengst
    // entschiedene Anfragen des ganzen Vereins. Offen ist, was im gewaehlten Bereich auf eine
    // Freigabe wartet.
    openApprovals: posts.filter((post) => post.status === 'awaiting_approval').length,
    scheduledNext7Days: posts.filter((post) => {
      if (!post.scheduled_for) return false
      const time = new Date(post.scheduled_for).getTime()
      return time >= now && time <= in7Days
    }).length,
  }
  weekDays.value = buildDashboardWeek(timezone.value, posts)
  recentPosts.value = posts.slice(0, RECENT_POSTS_LIMIT)

  const onboarding = await api
    .request('/v1/onboarding', { query: { organizationId } }, OnboardingStateSchema)
    .catch(() => ({ completedSteps: [] as OnboardingStep[] }))
  if (!isLatest()) return

  const steps: { key: string; label: string; href: string }[] = []
  if (!brandResult.data?.logo_asset_id && !onboarding.completedSteps.includes('branding')) {
    steps.push({ key: 'branding', label: 'Logo und Farben festlegen', href: '/marke' })
  }
  if (
    !profileResult.data?.responsible_person_profile_id &&
    !onboarding.completedSteps.includes('responsible_person')
  ) {
    steps.push({
      key: 'responsible_person',
      label: 'Verantwortliche Ansprechperson bestätigen',
      href: '/onboarding',
    })
  }
  nextSteps.value = steps
  loadingDashboard.value = false
}

function shortDateLabel(iso: string) {
  return new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'short',
    timeZone: timezone.value,
  }).format(new Date(iso))
}

// Die Sidebar wechselt Verein/Abteilung ohne Remount dieser Seite: nur der zuletzt gestartete Lauf
// darf Kennzahlen und Listen schreiben, sonst stuenden Daten des vorigen Bereichs unter dem neuen.
// socialMediaActive gehoert zum Schluessel: nach einem Vereinswechsel laedt useScopeModules die
// Module neu, das Modul wird also womoeglich erst danach als aktiv erkannt.
const { ready } = useScopedLoad(
  () => `${activeOrganizationId.value}:${activeDepartmentId.value}:${socialMediaActive.value}`,
  (_key, isLatest) => loadDashboard(isLatest),
)
await ready
</script>

<template>
  <div>
    <header class="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        <div class="eyebrow mb-3">{{ department }} · {{ todayLabel }}</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink sm:text-[38px]">
          Guten Tag, {{ firstName }}.
        </h1>
        <p class="mt-2 text-sm text-[#6c756f]">Was möchtest du heute für euren Verein bewegen?</p>
      </div>
      <NuxtLink
        v-if="canCreatePost"
        to="/erstellen"
        class="focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white shadow-xs transition hover:-translate-y-0.5 hover:bg-[#1d4b39]"
      >
        <Plus :size="17" /> Neuer Beitrag
      </NuxtLink>
    </header>

    <div v-if="playerboardActive" class="mb-7">
      <PlayerboardSeasonSummary compact />
    </div>

    <section
      v-if="socialMediaActive && dashboardError"
      class="card mb-7 p-5 text-sm font-semibold text-red-700"
    >
      Die Kennzahlen konnten nicht geladen werden. Bitte lade die Seite neu.
    </section>
    <section
      v-else-if="socialMediaActive && !loadingDashboard && stats"
      class="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-3"
      aria-label="Kennzahlen"
    >
      <KpiCard
        :value="stats.published"
        label="Veröffentlicht"
        :icon="CheckCircle2"
        icon-class="bg-emerald-100 text-emerald-700"
      />
      <KpiCard
        :value="stats.openApprovals"
        label="Offene Freigaben"
        :icon="Clock3"
        icon-class="bg-amber-100 text-amber-700"
      />
      <KpiCard
        :value="stats.scheduledNext7Days"
        label="Geplant, nächste 7 Tage"
        :icon="FileText"
        icon-class="bg-sky-100 text-sky-700"
      />
    </section>

    <section
      v-if="socialMediaRelevant"
      class="grid gap-7 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,.75fr)]"
    >
      <div v-if="!socialMediaActive" class="space-y-7">
        <article class="card p-8 text-center">
          <Blocks :size="22" class="mx-auto mb-2 text-forest" />
          <p class="text-sm font-semibold text-ink">
            In {{ socialMediaBlockedIn }} ist Social Media nicht aktiviert.
          </p>
          <p class="mt-1 text-xs text-[#7b827d]">
            Beiträge, Freigaben und Redaktionsplan erscheinen hier, sobald das Modul aktiv ist.
            Welche Module zur Verfügung stehen, legt die Vereins- oder Abteilungsverwaltung fest.
          </p>
          <NuxtLink
            to="/einstellungen/module"
            class="focus-ring mt-4 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-forest hover:bg-stone-100"
            >Module ansehen <ArrowRight :size="13"
          /></NuxtLink>
        </article>
      </div>
      <div v-else class="space-y-7">
        <article class="card overflow-hidden">
          <div
            class="flex flex-col items-start gap-3 border-b border-[#e7e7df] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
          >
            <div class="min-w-0">
              <h2 class="font-display text-base font-bold tracking-[-.02em]">Aktuelle Beiträge</h2>
              <p class="mt-0.5 text-[11px] text-[#7a817d]">
                Eure zuletzt angelegten Inhalte auf einen Blick
              </p>
            </div>
            <NuxtLink
              to="/beitraege"
              class="focus-ring inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-forest hover:bg-stone-100"
              >Alle ansehen <ArrowRight :size="13"
            /></NuxtLink>
          </div>
          <div v-if="dashboardError" class="p-8 text-center text-xs font-semibold text-red-700">
            Die Beiträge konnten nicht geladen werden.
          </div>
          <ul v-else-if="recentPosts.length > 0" class="divide-y divide-[#ecece5]">
            <li
              v-for="post in recentPosts"
              :key="post.id"
              class="flex items-center justify-between gap-3 px-5 py-3 text-xs sm:px-6"
            >
              <span class="font-semibold capitalize text-ink">{{
                post.status.replaceAll('_', ' ')
              }}</span>
              <span class="shrink-0 text-[#7b827d]">{{ shortDateLabel(post.created_at) }}</span>
            </li>
          </ul>
          <div
            v-else-if="!loadingDashboard"
            class="break-words p-8 text-center text-xs text-[#7b827d]"
          >
            Es liegen noch keine Beiträge vor.
          </div>
        </article>

        <DashboardWeekPlan :days="weekDays" :timezone="timezone" :error="dashboardError" />
      </div>

      <aside class="space-y-7">
        <article v-if="nextSteps.length > 0" class="card p-5">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="font-display text-sm font-bold">Nächste Schritte</h2>
            <span class="grid h-8 w-8 place-items-center rounded-xl bg-violet-100 text-violet-700"
              ><ShieldCheck :size="15"
            /></span>
          </div>
          <ul class="space-y-2">
            <li v-for="item in nextSteps" :key="item.key">
              <NuxtLink
                :to="item.href"
                class="focus-ring flex min-w-0 items-center justify-between gap-2 rounded-xl border border-[#e6e7e0] p-3 text-xs font-semibold text-ink hover:bg-stone-50"
              >
                <span class="flex min-w-0 items-center gap-2"
                  ><Palette
                    v-if="item.key === 'branding'"
                    :size="14"
                    class="shrink-0 text-forest"
                  /><ShieldCheck v-else :size="14" class="shrink-0 text-forest" /><span>{{
                    item.label
                  }}</span></span
                >
                <ArrowRight :size="13" class="shrink-0 text-[#9aa196]" />
              </NuxtLink>
            </li>
          </ul>
        </article>
        <article v-else-if="socialMediaActive && !loadingDashboard" class="card p-5 text-center">
          <CheckCircle2 :size="22" class="mx-auto mb-2 text-forest" />
          <p class="text-xs font-semibold">Startklar. Alle Einrichtungsschritte sind erledigt.</p>
        </article>
        <ContentSuggestionList
          v-if="socialMediaActive"
          :organization-id="activeOrganizationId"
          :department-id="activeDepartmentId"
          :timezone="timezone"
        />
      </aside>
    </section>
  </div>
</template>
