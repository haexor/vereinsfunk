<script setup lang="ts">
import { ArrowRight, ClipboardList, Plus, Trophy } from '@lucide/vue'
import { PlayerboardTrainingSchema, type PlayerboardTraining } from '@vereinsfunk/contracts'
import { playerboardErrorMessage } from '../utils/playerboardErrors'
import { placementBadgeClass, placementRowClass, type RankingListItem } from '../utils/playerboardRanking'

// Paket 052, PR 4: Saison der gewaehlten Mannschaft auf einen Blick -- eigener Platz (fuer
// Spieler mit verknuepftem Kader-Eintrag), die ganze Rangliste und die letzten Trainings. Ausfuehrlich
// auf /playerboard, kompakt als Kachel auf der Startseite.
const props = defineProps<{ compact?: boolean }>()

const api = useApiClient()
const { team, teamId, organizationId, organizationTimezone, canManage } = await usePlayerboardTeam()
const { loadSeasonFrom, loadRankingItems } = usePlayerboardRanking()

const items = ref<RankingListItem[]>([])
const trainings = ref<PlayerboardTraining[]>([])
const seasonFrom = ref<string | null>(null)
const loading = ref(false)
const errorMessage = ref('')

/** Laedt Saisonanfang, Rangliste der Saison und die letzten Trainings der gewaehlten Mannschaft. */
let latestRequest = 0
async function load() {
  const request = ++latestRequest
  errorMessage.value = ''
  items.value = []
  trainings.value = []
  seasonFrom.value = null
  if (!organizationId.value || !teamId.value) return
  const requestedOrganizationId = organizationId.value
  const requestedTeamId = teamId.value
  const requestedTimezone = organizationTimezone.value
  loading.value = true
  try {
    const from = await loadSeasonFrom(requestedOrganizationId, requestedTeamId, requestedTimezone)
    if (request !== latestRequest) return
    const [ranking, recent] = await Promise.all([
      loadRankingItems(requestedTeamId, from ? { from } : {}),
      api.request(
        `/v1/playerboard/teams/${requestedTeamId}/trainings`,
        {},
        PlayerboardTrainingSchema.array(),
      ),
    ])
    if (request !== latestRequest) return
    seasonFrom.value = from
    items.value = ranking.items
    trainings.value = recent.slice(0, props.compact ? 1 : 3)
  } catch (error) {
    if (request === latestRequest)
      errorMessage.value = playerboardErrorMessage(error, 'Die Saison konnte nicht geladen werden.')
  } finally {
    if (request === latestRequest) loading.value = false
  }
}
await load()
watch(teamId, () => {
  void load()
})

const self = computed(() => items.value.find((item) => item.highlight) ?? null)
const dateFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
/** Formatiert ein Datum YYYY-MM-DD ohne Zeitzonenverschiebung. */
function formatDate(value: string): string {
  return dateFormat.format(new Date(`${value}T00:00:00Z`))
}
const seasonFormat = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const seasonLabel = computed(() =>
  seasonFrom.value
    ? `Saison seit ${seasonFormat.format(new Date(`${seasonFrom.value}T00:00:00Z`))}`
    : 'Gesamte Zeit',
)
</script>

<template>
  <section class="card p-4 sm:p-5" :aria-label="compact ? 'PlayerBoard' : undefined">
    <div v-if="compact" class="mb-4 flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e4f1e7] text-forest"
          ><Trophy :size="17"
        /></span>
        <div class="min-w-0">
          <h2 class="font-display text-base font-bold tracking-[-.02em] text-ink">PlayerBoard</h2>
          <p class="truncate text-[11px] text-[#7a817d]">
            {{ team ? `${team.name} · ${seasonLabel}` : 'Mannschaft wählen' }}
          </p>
        </div>
      </div>
      <NuxtLink
        to="/playerboard"
        class="focus-ring inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-forest hover:bg-stone-100"
        >Öffnen <ArrowRight :size="13"
      /></NuxtLink>
    </div>
    <p v-else class="mb-4 text-xs font-semibold text-[#6c756f]">{{ seasonLabel }}</p>

    <p v-if="!team" class="text-sm text-[#6c756f]">Wähle in PlayerBoard eine Mannschaft.</p>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <p v-else-if="loading && items.length === 0" class="text-xs text-[#7b827d]">Wird geladen …</p>
    <div v-else class="grid gap-4" :class="compact ? '' : 'md:grid-cols-2'">
      <div
        v-if="self"
        class="flex items-center gap-3 rounded-xl bg-[#f2f9e4] p-3"
        data-testid="own-rank"
      >
        <span
          class="grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-extrabold"
          :class="placementBadgeClass(self.rank)"
          >{{ self.rank }}</span
        >
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-ink">Dein Platz</span>
          <span class="block text-xs text-[#6c756f]"
            >{{ self.total }} {{ self.total === 1 ? 'Punkt' : 'Punkte' }}</span
          >
        </span>
      </div>

      <div>
        <h3 class="mb-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#7b827d]">Rangliste</h3>
        <p v-if="items.length === 0" class="text-sm text-[#6c756f]">
          Noch keine Punkte aus abgeschlossenen Trainings.
        </p>
        <!-- Betreiberentscheidung 2026-10-08: immer alle Spieler, die Plaetze 1 bis 3 in Medaillenfarben. -->
        <ol v-else class="-mx-2 space-y-0.5">
          <li v-for="item in items" :key="item.key" class="flex items-center gap-2 rounded-lg px-2 py-1" :class="placementRowClass(item.rank)">
            <span
              class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold"
              :class="placementBadgeClass(item.rank)"
              >{{ item.rank }}</span
            >
            <span
              class="min-w-0 flex-1 truncate text-sm"
              :class="item.highlight ? 'font-bold text-forest' : 'text-ink'"
              >{{ item.label }}</span
            >
            <span class="text-sm font-bold tabular-nums text-ink">{{ item.total }}</span>
          </li>
        </ol>
        <NuxtLink
          to="/playerboard/rangliste"
          class="focus-ring mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg text-xs font-semibold text-forest"
          >Kategorien und Zeiträume <ArrowRight :size="13"
        /></NuxtLink>
      </div>

      <div :class="compact ? '' : 'md:col-span-2'">
        <h3 class="mb-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#7b827d]">
          {{ compact ? 'Letztes Training' : 'Letzte Trainings' }}
        </h3>
        <p v-if="trainings.length === 0" class="text-sm text-[#6c756f]">
          Noch kein Training erfasst.
        </p>
        <ul v-else class="divide-y divide-[#ecece5]">
          <li v-for="training in trainings" :key="training.id">
            <NuxtLink
              :to="`/playerboard/trainings/${training.id}`"
              class="focus-ring flex min-h-11 items-center gap-2 py-1 text-sm hover:text-forest"
            >
              <ClipboardList :size="15" class="shrink-0 text-[#9aa096]" />
              <span class="min-w-0 flex-1 truncate"
                >{{ formatDate(training.trainingDate)
                }}<template v-if="training.title"> · {{ training.title }}</template></span
              >
              <span
                v-if="training.status === 'draft'"
                class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"
                >Entwurf</span
              >
            </NuxtLink>
          </li>
        </ul>
        <NuxtLink
          v-if="canManage"
          to="/playerboard/trainings/neu"
          class="focus-ring mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-forest px-4 text-xs font-bold text-white"
        >
          <Plus :size="15" /> Training anlegen
        </NuxtLink>
      </div>
    </div>
  </section>
</template>
