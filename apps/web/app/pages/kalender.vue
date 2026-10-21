<script setup lang="ts">
import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/vue'
import { localDateKey } from '../utils/memberDates'

const { organizationId: activeOrganizationId, departmentId: activeDepartmentId, organizationTimezone: timezone } = await useActiveScope()
// Paket 051, PR 3: der Kalender gehoert zum Rahmen (Spiele, Veranstaltungen). Geplante Beitraege
// und der Sprung zur Beitragserstellung gehoeren zu social_media und erscheinen nur, wenn es wirkt.
const { isEnabled: isModuleEnabled, canUseAtActiveScope } = await useScopeModules()
const socialMediaActive = computed(() => isModuleEnabled('social_media'))
// Paket 055: Erstell-Links nur mit dem Recht, Beitraege anzulegen.
const canCreatePost = computed(() => socialMediaActive.value && canUseAtActiveScope('post.create'))
const monthOffset = ref(0)

const viewedMonth = computed(() => {
  const [year, month] = localDateKey(new Date(), timezone.value).split('-').map(Number) as [
    number,
    number,
  ]
  const base = new Date(Date.UTC(year, month - 1 + monthOffset.value, 1))
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() }
})
const monthLabel = computed(() =>
  new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(viewedMonth.value.year, viewedMonth.value.month, 1)),
  ),
)
const daysInMonth = computed(() =>
  new Date(Date.UTC(viewedMonth.value.year, viewedMonth.value.month + 1, 0)).getUTCDate(),
)
const leadingBlanks = computed(() => {
  const firstWeekday = new Date(
    Date.UTC(viewedMonth.value.year, viewedMonth.value.month, 1),
  ).getUTCDay()
  return firstWeekday === 0 ? 6 : firstWeekday - 1
})

interface CalendarPost {
  id: string
  scheduled_for: string
}
interface CalendarFixture {
  id: string
  opponent_name: string | null
  kickoff_at: string
  kickoff_time_confirmed: boolean
}
interface CalendarClubEvent {
  id: string
  title: string
  starts_at: string
}
interface CalendarFixtureDay {
  id: string
  opponentName: string | null
  kickoffTimeConfirmed: boolean
  hasSubmission: boolean
}
interface CalendarEventDay {
  id: string
  title: string
  hasSubmission: boolean
}
const postsByDay = ref<Record<number, { id: string }[]>>({})
const fixturesByDay = ref<Record<number, CalendarFixtureDay[]>>({})
const eventsByDay = ref<Record<number, CalendarEventDay[]>>({})
const loading = ref(true)
const loadError = ref(false)

function resetCalendar() {
  postsByDay.value = {}
  fixturesByDay.value = {}
  eventsByDay.value = {}
}

function fixtureTitle(fixture: CalendarFixtureDay) {
  const parts: string[] = []
  if (!fixture.kickoffTimeConfirmed) parts.push('Anstoßzeit unbestätigt')
  if (canCreatePost.value && !fixture.hasSubmission) parts.push('Kein Beitrag – zur Erstellung')
  return parts.join(' · ') || undefined
}

// Klickt die Nutzerin schnell mehrfach auf einen Monatswechsel, koennen die Antworten in anderer
// Reihenfolge eintreffen -- nur der jeweils zuletzt gestartete Lauf (isLatest) darf noch in
// postsByDay/fixturesByDay/eventsByDay oder loadError schreiben.
async function loadMonth(isLatest: () => boolean) {
  if (import.meta.server) return
  loading.value = true
  loadError.value = false
  const organizationId = activeOrganizationId.value
  if (!organizationId) {
    resetCalendar()
    loading.value = false
    return
  }
  const departmentId = activeDepartmentId.value
  const supabase = useSupabaseClient()
  const { year, month } = viewedMonth.value
  const rangeStart = new Date(Date.UTC(year, month, 1) - 3 * 24 * 60 * 60 * 1000).toISOString()
  const rangeEnd = new Date(Date.UTC(year, month + 1, 1) + 3 * 24 * 60 * 60 * 1000).toISOString()

  let postsQuery = supabase
    .from('posts')
    .select('id, scheduled_for')
    .eq('organization_id', organizationId)
    .not('scheduled_for', 'is', null)
    .gte('scheduled_for', rangeStart)
    .lte('scheduled_for', rangeEnd)
  if (departmentId) postsQuery = postsQuery.eq('department_id', departmentId)

  let fixturesQuery = supabase
    .from('fixtures')
    .select('id, opponent_name, kickoff_at, kickoff_time_confirmed')
    .eq('organization_id', organizationId)
    .not('kickoff_at', 'is', null)
    .gte('kickoff_at', rangeStart)
    .lte('kickoff_at', rangeEnd)
  if (departmentId) fixturesQuery = fixturesQuery.eq('department_id', departmentId)

  // department_id ist bei Veranstaltungen nullable (vereinsweite Termine) -- eq() würde sie bei
  // aktiver Abteilung ausblenden, deshalb or() mit is-null statt eq().
  let eventsQuery = supabase
    .from('club_events')
    .select('id, title, starts_at')
    .eq('organization_id', organizationId)
    .gte('starts_at', rangeStart)
    .lte('starts_at', rangeEnd)
  if (departmentId)
    eventsQuery = eventsQuery.or(`department_id.eq.${departmentId},department_id.is.null`)

  const [postsResult, fixturesResult, eventsResult] = await Promise.all([
    postsQuery,
    fixturesQuery,
    eventsQuery,
  ])
  if (!isLatest()) return
  if (postsResult.error || fixturesResult.error || eventsResult.error) {
    resetCalendar()
    loadError.value = true
    loading.value = false
    return
  }

  const fixtures = (fixturesResult.data ?? []) as CalendarFixture[]
  const events = (eventsResult.data ?? []) as CalendarClubEvent[]
  // Ein Termin hat einen Beitrag, sobald einer daran haengt: aus /v1/submissions oder aus der
  // Textwerkstatt (eine Sitzung mit uebernommenem Kandidaten, also mit post_id).
  async function idsWithSubmission(column: 'fixture_id' | 'club_event_id', ids: string[]): Promise<Set<string> | null> {
    if (!ids.length) return new Set()
    const [submissions, sessions] = await Promise.all([
      supabase.from('submissions').select(column).eq('organization_id', organizationId).in(column, ids),
      supabase.from('composition_sessions').select(column).eq('organization_id', organizationId).not('post_id', 'is', null).in(column, ids),
    ])
    if (submissions.error || sessions.error) return null
    return new Set([...(submissions.data ?? []), ...(sessions.data ?? [])].map((row) => (row as Record<string, string>)[column]!))
  }
  const [fixtureIdsWithSubmission, eventIdsWithSubmission] = await Promise.all([
    idsWithSubmission('fixture_id', fixtures.map((fixture) => fixture.id)),
    idsWithSubmission('club_event_id', events.map((event) => event.id)),
  ])
  if (!isLatest()) return
  if (!fixtureIdsWithSubmission || !eventIdsWithSubmission) {
    resetCalendar()
    loadError.value = true
    loading.value = false
    return
  }

  const posts: Record<number, { id: string }[]> = {}
  for (const post of (postsResult.data ?? []) as CalendarPost[]) {
    const [postYear, postMonth, postDay] = localDateKey(
      new Date(post.scheduled_for),
      timezone.value,
    )
      .split('-')
      .map(Number)
    if (postYear === year && postMonth === month + 1 && postDay) {
      posts[postDay] = [...(posts[postDay] ?? []), { id: post.id }]
    }
  }
  postsByDay.value = posts

  const fixtureDays: Record<number, CalendarFixtureDay[]> = {}
  for (const fixture of fixtures) {
    const [fixtureYear, fixtureMonth, fixtureDay] = localDateKey(
      new Date(fixture.kickoff_at),
      timezone.value,
    )
      .split('-')
      .map(Number)
    if (fixtureYear === year && fixtureMonth === month + 1 && fixtureDay) {
      fixtureDays[fixtureDay] = [
        ...(fixtureDays[fixtureDay] ?? []),
        {
          id: fixture.id,
          opponentName: fixture.opponent_name,
          kickoffTimeConfirmed: fixture.kickoff_time_confirmed,
          hasSubmission: fixtureIdsWithSubmission.has(fixture.id),
        },
      ]
    }
  }
  fixturesByDay.value = fixtureDays

  const eventDays: Record<number, CalendarEventDay[]> = {}
  for (const event of events) {
    const [eventYear, eventMonth, eventDay] = localDateKey(
      new Date(event.starts_at),
      timezone.value,
    )
      .split('-')
      .map(Number)
    if (eventYear === year && eventMonth === month + 1 && eventDay) {
      eventDays[eventDay] = [...(eventDays[eventDay] ?? []), { id: event.id, title: event.title, hasSubmission: eventIdsWithSubmission.has(event.id) }]
    }
  }
  eventsByDay.value = eventDays

  loading.value = false
}

const { ready } = useScopedLoad(
  () => `${activeOrganizationId.value}:${activeDepartmentId.value}:${monthOffset.value}`,
  (_key, isLatest) => loadMonth(isLatest),
)
await ready

const hasAnyItem = computed(
  () =>
    Object.keys(postsByDay.value).length > 0 ||
    Object.keys(fixturesByDay.value).length > 0 ||
    Object.keys(eventsByDay.value).length > 0,
)
</script>

<template>
  <div>
    <header class="mb-8 flex items-end justify-between">
      <div>
        <div class="eyebrow mb-3">Planung</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">{{ monthLabel }}</h1>
        <p class="mt-2 text-sm text-[#727a75]">Euer gemeinsamer Redaktionskalender.</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="focus-ring rounded-lg border border-[#dfe0d9] p-2"
          aria-label="Vorheriger Monat"
          @click="monthOffset--"
        >
          <ChevronLeft :size="16" />
        </button>
        <CalendarDays class="text-forest" />
        <button
          class="focus-ring rounded-lg border border-[#dfe0d9] p-2"
          aria-label="Nächster Monat"
          @click="monthOffset++"
        >
          <ChevronRight :size="16" />
        </button>
      </div>
    </header>
    <div class="card overflow-hidden">
      <div
        class="grid grid-cols-7 border-b border-[#e5e6df] bg-[#f5f5ef] text-center text-[10px] font-bold uppercase tracking-wider text-[#818782]"
      >
        <div v-for="day in ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']" :key="day" class="p-3">
          {{ day }}
        </div>
      </div>
      <div
        v-if="loadError"
        class="border-b border-[#e5e6df] bg-[#f9faf5] p-3 text-center text-[11px] font-semibold text-red-700"
      >
        Die Daten für diesen Monat konnten nicht geladen werden.
      </div>
      <div
        v-else-if="!loading && !hasAnyItem"
        class="border-b border-[#e5e6df] bg-[#f9faf5] p-3 text-center text-[11px] text-[#7b827d]"
      >
        Für diesen Monat sind noch keine Beiträge, Spiele oder Veranstaltungen geplant.
      </div>
      <div class="grid grid-cols-7">
        <div
          v-for="blank in leadingBlanks"
          :key="`b${blank}`"
          class="min-h-24 border-b border-r border-[#e9eae3] bg-[#fafaf7] sm:min-h-32"
        />
        <div
          v-for="day in daysInMonth"
          :key="day"
          class="min-h-24 border-b border-r border-[#e9eae3] p-2 sm:min-h-32"
        >
          <span class="text-xs font-semibold">{{ day }}</span>
          <div
            v-for="post in socialMediaActive ? postsByDay[day] || [] : []"
            :key="post.id"
            class="mt-2 rounded-lg bg-[#eef1e9] p-2 text-[9px] font-semibold text-forest"
          >
            Beitrag geplant
          </div>
          <div v-for="fixture in fixturesByDay[day] || []" :key="fixture.id">
            <NuxtLink
              v-if="canCreatePost && !fixture.hasSubmission"
              :to="`/erstellen?fixtureId=${fixture.id}`"
              :title="fixtureTitle(fixture)"
              class="focus-ring mt-2 block rounded-lg border border-dashed border-sky-400 bg-sky-50 p-2 text-[9px] font-semibold text-sky-700"
              >{{ fixture.kickoffTimeConfirmed ? '' : '~'
              }}{{ fixture.opponentName ?? 'Spiel' }}</NuxtLink
            >
            <div
              v-else
              :title="fixtureTitle(fixture)"
              class="mt-2 rounded-lg bg-sky-100 p-2 text-[9px] font-semibold text-sky-700"
            >
              {{ fixture.kickoffTimeConfirmed ? '' : '~' }}{{ fixture.opponentName ?? 'Spiel' }}
            </div>
          </div>
          <div v-for="event in eventsByDay[day] || []" :key="event.id">
            <NuxtLink
              v-if="canCreatePost && !event.hasSubmission"
              :to="`/erstellen?clubEventId=${event.id}`"
              title="Kein Beitrag – zur Erstellung"
              class="focus-ring mt-2 block truncate rounded-lg border border-dashed border-amber-400 bg-amber-50 p-2 text-[9px] font-semibold text-amber-700"
              >{{ event.title }}</NuxtLink
            >
            <div
              v-else
              class="mt-2 truncate rounded-lg bg-amber-100 p-2 text-[9px] font-semibold text-amber-700"
            >
              {{ event.title }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
