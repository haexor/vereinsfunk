<script setup lang="ts">
import { ArrowLeft, ChevronDown } from '@lucide/vue'
import { PersonProfileSchema, type PersonProfile, type PersonProfilePeriod } from '@vereinsfunk/contracts'
import { ApiRequestError } from '../../utils/apiClient'
import { playerboardErrorMessage } from '../../utils/playerboardErrors'

// Profil einer Person auf Vereinsebene: Name, Mannschaften mit Trikot und Position, Punkte. Das
// Profil gehoert der Verzeichnisperson, nicht einer Mannschaft -- wer in mehreren Mannschaften
// spielt, hat genau diese eine Seite. Was jemand sieht, entscheidet die API (Sicht auf die
// Kennzahlen der Mannschaft oder Verzeichnisrecht); eine unbekannte und eine nicht sichtbare
// Person sehen hier gleich aus.
const route = useRoute()
const router = useRouter()
const api = useApiClient()
const { organizationTimezone } = await useActiveScope()
const personId = computed(() => String(route.params.id))

const profile = ref<PersonProfile | null>(null)
const notFound = ref(false)
const loadError = ref('')
// Laufende Saison (Saisonbeginn je Mannschaft) oder gesamte Zeit, wie in der Rangliste.
const period = ref<PersonProfilePeriod>('season')
const periods: readonly { value: PersonProfilePeriod; label: string }[] = [
  { value: 'season', label: 'Laufende Saison' },
  { value: 'all', label: 'Gesamte Zeit' },
]
const expandedTeamId = ref<string | null>(null)

const { ready } = useScopedLoad(() => `${personId.value}:${period.value}`, async (_key, isLatest) => {
  notFound.value = false
  loadError.value = ''
  try {
    const result = await api.request(`/v1/people/${personId.value}/profile`, { query: { period: period.value } }, PersonProfileSchema)
    if (isLatest()) profile.value = result
  } catch (error) {
    if (!isLatest()) return
    if (error instanceof ApiRequestError && error.code === 'not_found') notFound.value = true
    else loadError.value = playerboardErrorMessage(error, 'Das Profil konnte nicht geladen werden.')
  }
})
await ready
// Beim Zeitraumwechsel bleibt das alte Profil stehen, bis das neue da ist; bei einer anderen Person
// verschwindet es sofort, damit nie Name und Punkte verschiedener Personen zusammen erscheinen.
watch(personId, () => { profile.value = null; expandedTeamId.value = null })

const statusLabel = computed(() => {
  if (profile.value?.status === 'inactive') return 'Inaktiv'
  if (profile.value?.status === 'left') return 'Ausgetreten'
  return null
})

/** Zurueck dahin, woher man kam (Training, Rangliste, Kader); ohne Verlauf zur Startseite. */
function back() {
  if (window.history.length > 1) router.back()
  else void navigateTo('/')
}

function jersey(number: number | null): string {
  return number === null ? '–' : String(number)
}

function toggleTeam(teamId: string) {
  expandedTeamId.value = expandedTeamId.value === teamId ? null : teamId
}
</script>

<template>
  <div>
    <button type="button" class="focus-ring mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg text-xs font-semibold text-[#6c756f]" @click="back">
      <ArrowLeft :size="15" /> Zurück
    </button>

    <p v-if="notFound" class="card p-6 text-sm text-[#435047]">Diese Person gibt es nicht, oder du darfst sie nicht sehen.</p>
    <p v-else-if="loadError" class="card p-6 text-sm text-amber-800">{{ loadError }}</p>
    <template v-else-if="profile">
      <header class="mb-6">
        <div class="eyebrow mb-3">Profil</div>
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="font-display text-2xl font-extrabold tracking-[-.04em] text-ink sm:text-3xl">{{ profile.firstName }} {{ profile.lastName }}</h1>
          <span v-if="statusLabel" class="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-800">{{ statusLabel }}</span>
        </div>
      </header>

      <section aria-labelledby="teams-heading">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="teams-heading" class="font-display text-lg font-bold text-ink">Mannschaften</h2>
          <div class="inline-flex rounded-xl border border-[#dfe0d9] bg-white p-1" role="group" aria-label="Zeitraum der Punkte">
            <button
              v-for="option in periods"
              :key="option.value"
              type="button"
              class="focus-ring min-h-11 rounded-lg px-3 text-xs font-semibold"
              :class="period === option.value ? 'bg-forest text-white' : 'text-ink'"
              :aria-pressed="period === option.value"
              @click="period = option.value"
            >{{ option.label }}</button>
          </div>
        </div>
        <p v-if="profile.teams.length === 0" class="card p-5 text-sm text-[#6c756f]">Keine Mannschaft, deren Werte du sehen darfst.</p>
        <ul v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <li v-for="team in profile.teams" :key="team.teamId" class="card p-4" :data-testid="`profile-team-${team.teamId}`">
            <div class="flex items-center gap-3">
              <span class="grid h-10 min-w-10 shrink-0 place-items-center rounded-xl bg-[#eef1ea] px-1 text-sm font-bold text-forest" :aria-label="`Trikot ${jersey(team.jerseyNumber)}`">{{ jersey(team.jerseyNumber) }}</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold text-ink">{{ team.teamName }}<span v-if="team.isSelf" class="ml-2 rounded-full bg-forest px-2 py-0.5 text-[10px] font-bold text-white">Du</span></span>
                <span class="block truncate text-xs text-[#6c756f]">{{ [team.position, team.active ? null : 'inaktiv'].filter(Boolean).join(' · ') || 'Keine Position' }}</span>
              </span>
              <span class="shrink-0 text-right">
                <span class="block font-display text-lg font-extrabold tabular-nums text-ink">{{ team.total }}</span>
                <span class="block text-[10px] text-[#6c756f]">{{ team.rank === null ? 'ohne Platz' : `Platz ${team.rank}` }}</span>
              </span>
            </div>
            <p v-if="team.total === 0 && team.categories.length === 0" class="mt-3 text-xs text-[#6c756f]">Noch keine Punkte in diesem Zeitraum.</p>
            <template v-else-if="team.categories.length > 0">
              <button
                type="button"
                class="focus-ring mt-3 inline-flex min-h-11 items-center gap-1 rounded-lg text-xs font-semibold text-[#5b625d]"
                :aria-expanded="expandedTeamId === team.teamId"
                @click="toggleTeam(team.teamId)"
              >
                Punkte je Kategorie
                <ChevronDown :size="14" class="transition" :class="expandedTeamId === team.teamId ? 'rotate-180' : ''" aria-hidden="true" />
              </button>
              <dl v-if="expandedTeamId === team.teamId" class="mt-1 grid gap-1 text-xs">
                <div v-for="category in team.categories" :key="category.name" class="flex justify-between gap-2">
                  <dt class="truncate text-[#6c756f]">{{ category.name }}</dt>
                  <dd class="font-semibold tabular-nums text-ink">{{ category.points }}</dd>
                </div>
              </dl>
            </template>
            <PlayerboardPersonVeoStats :team="team" :person-name="`${profile.firstName} ${profile.lastName}`" :period="period" :timezone="organizationTimezone" />
          </li>
        </ul>
      </section>

      <!-- Nur Trainer der Mannschaft bekommen diese Felder von der API; bei allen anderen fehlen sie. -->
      <section v-if="profile.email !== undefined" class="mt-8" aria-labelledby="management-heading">
        <h2 id="management-heading" class="mb-3 font-display text-lg font-bold text-ink">Verwaltung</h2>
        <dl class="card grid gap-2 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-xs text-[#6c756f]">E-Mail</dt>
            <dd class="font-semibold text-ink">{{ profile.email ?? 'keine E-Mail hinterlegt' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-[#6c756f]">Konto</dt>
            <dd class="font-semibold text-ink">{{ profile.hasAccount ? 'Konto verbunden' : 'Noch kein Konto' }}</dd>
          </div>
        </dl>
      </section>
    </template>
  </div>
</template>
