<script setup lang="ts">
import { localDateKey } from '../../utils/memberDates'
import { playerboardErrorMessage } from '../../utils/playerboardErrors'
import {
  rankingRange,
  type RankingListItem,
  type RankingPeriodKind,
} from '../../utils/playerboardRanking'

// Paket 052, PR 4: Rangliste der gewaehlten Mannschaft fuer Spieler und Trainer, mit Zeitraum
// (Saison, Monat, gesamt, frei). Gezaehlt werden nur abgeschlossene Trainings.
const { team, teamId, organizationId, organizationTimezone } = await usePlayerboardTeam()
const { loadSeasonFrom, loadRankingItems } = usePlayerboardRanking()

const period = ref<RankingPeriodKind>('season')
const month = ref(localDateKey(new Date(), organizationTimezone.value).slice(0, 7))
const customFrom = ref('')
const customTo = ref('')
const seasonFrom = ref<string | null>(null)
const items = ref<RankingListItem[]>([])
const loading = ref(false)
const errorMessage = ref('')
const seasonLoadError = ref(false)

const periods: { kind: RankingPeriodKind; label: string }[] = [
  { kind: 'season', label: 'Saison' },
  { kind: 'month', label: 'Monat' },
  { kind: 'all', label: 'Gesamt' },
  { kind: 'custom', label: 'Frei' },
]

/** Laedt den Saisonanfang, sobald die Mannschaft feststeht. */
async function loadSeason(): Promise<boolean> {
  seasonFrom.value = null
  seasonLoadError.value = false
  if (!organizationId.value || !teamId.value) return true
  const requestedOrganizationId = organizationId.value
  const requestedTeamId = teamId.value
  try {
    seasonFrom.value = await loadSeasonFrom(
      requestedOrganizationId,
      requestedTeamId,
      organizationTimezone.value,
    )
    return true
  } catch (error) {
    seasonLoadError.value = true
    errorMessage.value = playerboardErrorMessage(error, 'Die Saison konnte nicht geladen werden.')
    return false
  }
}

/** Laedt die Rangliste fuer Mannschaft und Zeitraum; spaete Antworten frueherer Anfragen verfallen. */
let latestRequest = 0
async function load() {
  const request = ++latestRequest
  errorMessage.value = ''
  if (!teamId.value) {
    items.value = []
    return
  }
  if (period.value === 'season' && seasonLoadError.value) return
  const requestedTeamId = teamId.value
  const requestedSeasonFrom = seasonFrom.value
  loading.value = true
  try {
    const range = rankingRange(period.value, {
      seasonFrom: requestedSeasonFrom,
      month: month.value,
      customFrom: customFrom.value,
      customTo: customTo.value,
    })
    const result = await loadRankingItems(requestedTeamId, range)
    if (request === latestRequest) items.value = result.items
  } catch (error) {
    if (request === latestRequest)
      errorMessage.value = playerboardErrorMessage(
        error,
        'Die Rangliste konnte nicht geladen werden.',
      )
  } finally {
    if (request === latestRequest) loading.value = false
  }
}
if (await loadSeason()) await load()
watch(teamId, async () => {
  if (await loadSeason()) await load()
})
watch([period, month, customFrom, customTo], () => {
  void load()
})

const seasonFormat = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const periodHint = computed(() => {
  if (period.value === 'season')
    return seasonFrom.value
      ? `Seit ${seasonFormat.format(new Date(`${seasonFrom.value}T00:00:00Z`))}`
      : 'Kein Saisonbeginn festgelegt – es zählt die gesamte Zeit.'
  return ''
})
const inputClass =
  'focus-ring h-11 rounded-xl border border-[#dfe0d9] bg-white px-3 text-sm text-ink'
</script>

<template>
  <div>
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="eyebrow mb-3">PlayerBoard</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">Rangliste</h1>
      </div>
      <PlayerboardTeamPicker />
    </header>

    <PlayerboardTeamEmpty v-if="!team" />
    <template v-else>
      <div class="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Zeitraum">
        <button
          v-for="item in periods"
          :key="item.kind"
          type="button"
          role="radio"
          :aria-checked="period === item.kind"
          class="focus-ring min-h-11 rounded-xl border px-4 text-xs font-semibold"
          :class="
            period === item.kind
              ? 'border-forest bg-[#e4f1e7] text-forest'
              : 'border-[#dfe0d9] bg-white text-ink'
          "
          @click="period = item.kind"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="mb-5 flex min-h-11 flex-wrap items-center gap-3 text-xs text-[#6c756f]">
        <span v-if="periodHint">{{ periodHint }}</span>
        <input
          v-if="period === 'month'"
          v-model="month"
          type="month"
          aria-label="Monat"
          :class="inputClass"
        />
        <template v-if="period === 'custom'">
          <label class="flex items-center gap-2"
            >von <input v-model="customFrom" type="date" :class="inputClass"
          /></label>
          <label class="flex items-center gap-2"
            >bis <input v-model="customTo" type="date" :class="inputClass"
          /></label>
        </template>
      </div>

      <p v-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
      <div v-else :aria-busy="loading" :class="loading ? 'opacity-60' : ''">
        <PlayerboardRankingList
          :items="items"
          empty-text="In diesem Zeitraum gibt es noch keine Punkte aus abgeschlossenen Trainings."
        />
      </div>
    </template>
  </div>
</template>
