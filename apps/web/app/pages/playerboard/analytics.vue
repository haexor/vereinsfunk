<script setup lang="ts">
import { PlayerboardVeoKeyMetricIdSchema, type PlayerboardVeoSeasonMatch, type PlayerboardVeoTeamViews } from '@vereinsfunk/contracts'
import { DEFAULT_KEY_METRICS, seasonThirdPercents } from '@vereinsfunk/domain'
import { playerboardErrorMessage } from '../../utils/playerboardErrors'
import { scoreLabel } from '../../utils/playerboardVeo'
import { filterFromQuery, filterToQuery, seasonFilter, type AnalyticsFilterState } from '../../utils/playerboardVeoAnalytics'

// Spec 002, PR 4: Veo Analytics -- Nachbau von Veos Analytics Studio, Reiter "Team stats"
// (Inventar §1b): Filter, Kennzahlen mit Verlauf, Schusskarte, Pass- und Ballbesitzzonen,
// Vergleichsradar. Sichtbar fuer alle, die die Kennzahlen der Mannschaft sehen (stats_visibility).
// Der Filter steht in der URL, damit sich eine Ansicht teilen laesst.
const route = useRoute()
const router = useRouter()
const { teams, team, teamId, organizationTimezone, canManage } = await usePlayerboardTeam()
const { loadSeason, loadViews, saveViews } = usePlayerboardVeoSeason()
const { loadMatches } = usePlayerboardVeo()

const filter = ref<AnalyticsFilterState>(filterFromQuery(route.query))
watch(filter, (value) => { void router.replace({ query: filterToQuery(value) }) }, { deep: true })
watch(() => route.query, (query) => {
  const next = filterFromQuery(query)
  if (JSON.stringify(filterToQuery(filter.value)) !== JSON.stringify(filterToQuery(next))) filter.value = next
}, { deep: true })

const matches = ref<PlayerboardVeoSeasonMatch[]>([])
const views = ref<PlayerboardVeoTeamViews>({ keyMetrics: [], radar: null })
const loading = ref(false)
const errorMessage = ref('')
const saveMessage = ref('')
const runs = useLatestRequest()
async function load() {
  const isLatest = runs.begin()
  errorMessage.value = ''
  if (!teamId.value) return
  loading.value = true
  try {
    const [loaded, loadedViews] = await Promise.all([loadSeason(teamId.value, seasonFilter(filter.value)), loadViews(teamId.value)])
    if (!isLatest()) return
    matches.value = loaded
    views.value = loadedViews
  } catch (error) {
    if (isLatest()) errorMessage.value = playerboardErrorMessage(error, 'Veo Analytics konnte nicht geladen werden.')
  } finally {
    if (isLatest()) loading.value = false
  }
}
await load()
watch([teamId, filter], () => { void load() }, { deep: true })
// Ein Mannschaftswechsel setzt den Filter zurueck wie bei Veo; eine Auswahl gehoert zur alten Mannschaft.
watch(teamId, () => { filter.value = filterFromQuery({}) })

// Spiele fuer die Auswahl: die letzten 50 der Mannschaft, erst wenn die Auswahl geoeffnet wird.
const selectionOptions = ref<{ fixtureId: string; label: string }[]>([])
const optionDate = computed(() => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: organizationTimezone.value }))
async function loadSelectionOptions() {
  if (!teamId.value || selectionOptions.value.length) return
  try {
    const latest = await loadSeason(teamId.value, { last: 50 })
    selectionOptions.value = latest.reverse().map((match) => ({
      fixtureId: match.fixtureId,
      label: `${optionDate.value.format(new Date(match.kickoffAt))} · ${match.opponentName ?? 'unbekannt'} · ${scoreLabel(match)}`,
    }))
  } catch (error) {
    errorMessage.value = playerboardErrorMessage(error, 'Die Spiele für die Auswahl konnten nicht geladen werden.')
  }
}
if (filter.value.mode === 'selection') void loadSelectionOptions()

const keyMetrics = computed(() => (views.value.keyMetrics.length ? views.value.keyMetrics : [...DEFAULT_KEY_METRICS]))
async function save(patch: Partial<PlayerboardVeoTeamViews>) {
  if (!teamId.value) return
  saveMessage.value = ''
  try {
    views.value = await saveViews(teamId.value, { ...views.value, ...patch })
    saveMessage.value = 'Gespeichert. Die Auswahl gilt für alle in der Mannschaft.'
  } catch (error) {
    saveMessage.value = playerboardErrorMessage(error, 'Die Auswahl konnte nicht gespeichert werden.')
  }
}

const ownLabel = computed(() => team.value?.name ?? 'Wir')
const comparisonTeams = ref<{ id: string; name: string }[]>([])
const comparisonRuns = useLatestRequest()
watch([teams, teamId], async ([availableTeams, selectedTeamId]) => {
  const isLatest = comparisonRuns.begin()
  if (!selectedTeamId) {
    comparisonTeams.value = []
    return
  }
  const candidates = availableTeams.filter((entry) => entry.id !== selectedTeamId)
  const visible = await Promise.all(candidates.map(async (candidate) => {
    try {
      // Der bestehende Endpunkt prueft Stats-Sicht serverseitig und liefert nur Mannschaften
      // mit einer verbundenen Veo-Historie. Namen aus dem Scope allein reichen dafuer nicht.
      const matches = await loadMatches(candidate.id, {})
      return matches.length > 0 ? { id: candidate.id, name: candidate.name } : null
    } catch {
      return null
    }
  }))
  if (isLatest()) comparisonTeams.value = visible.flatMap((candidate) => candidate ? [candidate] : [])
}, { deep: true, immediate: true })
const otherTeams = computed(() => comparisonTeams.value)
const withoutAnalysis = computed(() => matches.value.filter((match) => match.analyticsVersion !== '2').length)
const passThirds = computed(() => ({ own: seasonThirdPercents(matches.value, 'own', 'pass'), opponent: seasonThirdPercents(matches.value, 'opponent', 'pass') }))
const possessionThirds = computed(() => ({ own: seasonThirdPercents(matches.value, 'own', 'possession'), opponent: seasonThirdPercents(matches.value, 'opponent', 'possession') }))
const zoneTeam = ref<{ pass: 'own' | 'opponent'; possession: 'own' | 'opponent' }>({ pass: 'own', possession: 'own' })

const SECTIONS = [
  { id: 'analytics-key-metrics', label: 'Kennzahlen' },
  { id: 'analytics-shot-map', label: 'Schusskarte' },
  { id: 'analytics-passes', label: 'Passzonen' },
  { id: 'analytics-possession', label: 'Ballbesitzzonen' },
  { id: 'analytics-comparison', label: 'Vergleich' },
] as const
const READ_ME = {
  keyMetrics: 'Die Karten zeigen den Durchschnitt über die gefilterten Spiele. Das Diagramm zeigt, wie sich die gewählte Kennzahl von Spiel zu Spiel entwickelt; ein Balken führt zur Auswertung des Spiels. Sieht ein Wert falsch aus, prüfe in Veo, ob Seiten und Halbzeiten des Spiels stimmen.',
  shots: 'Angriff zeigt, von wo die eigene Mannschaft abgeschlossen hat, Verteidigung, von wo der Gegner abgeschlossen hat. Gefüllte Kreise sind Tore, Ringe Schüsse ohne Tor; ein Klick öffnet die Stelle im Veo-Video.',
  zones: 'Der Anteil je Drittel ist der Durchschnitt der Anteile in den einzelnen Spielen, wie bei Veo.',
  radar: 'Das Radar vergleicht sechs Kennzahlen mit einer anderen Mannschaft des Vereins oder mit einem anderen Zeitraum der eigenen Mannschaft. Jede Achse misst beide Seiten am größeren der beiden Werte.',
} as const
const toggleClass = (active: boolean) => ['focus-ring min-h-11 rounded-xl border px-3 text-xs font-semibold', active ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] bg-white text-ink']
</script>

<template>
  <div>
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="eyebrow mb-3">PlayerBoard</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">Veo Analytics</h1>
      </div>
      <PlayerboardTeamPicker />
    </header>

    <PlayerboardTeamEmpty v-if="!team" />
    <template v-else>
      <nav class="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Abschnitte">
        <a v-for="section in SECTIONS" :key="section.id" :href="`#${section.id}`" class="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-full border border-[#dfe0d9] bg-white px-4 text-xs font-semibold text-ink">{{ section.label }}</a>
      </nav>
      <PlayerboardVeoFilters v-model="filter" :options="selectionOptions" class="mb-3" @need-options="loadSelectionOptions" />
      <p class="mb-5 text-sm text-[#5b625d]" role="status">
        <template v-if="loading">Spiele werden geladen …</template>
        <template v-else>{{ matches.length }} {{ matches.length === 1 ? 'Spiel' : 'Spiele' }} gefiltert<template v-if="withoutAnalysis"> · {{ withoutAnalysis }} ohne vollständige Veo-Analyse, dort fehlen einige Werte</template></template>
      </p>
      <p v-if="errorMessage" class="mb-4 text-sm text-amber-800" role="alert">{{ errorMessage }}</p>
      <p v-if="saveMessage" class="mb-4 text-sm text-forest" role="status">{{ saveMessage }}</p>

      <div v-if="!loading && matches.length === 0 && !errorMessage" class="card p-6 text-sm text-[#6c756f]">
        Für diese Filter gibt es keine Spiele mit Veo-Aufnahme. Ändere die Filter oder gleiche Veo unter „Veo“ ab.
      </div>
      <div v-else class="grid gap-6" :aria-busy="loading">
        <PlayerboardVeoAnalysisSection :id="SECTIONS[0].id" title="Kennzahlen" :read-me="READ_ME.keyMetrics">
          <PlayerboardVeoKeyMetrics
            :matches="matches" :metrics="keyMetrics" :can-edit="canManage" :team-id="teamId!" :own-label="ownLabel" :timezone="organizationTimezone"
            @save="(ids) => save({ keyMetrics: PlayerboardVeoKeyMetricIdSchema.array().parse(ids) })"
          />
        </PlayerboardVeoAnalysisSection>
        <div class="grid gap-6 lg:grid-cols-2">
          <PlayerboardVeoAnalysisSection :id="SECTIONS[1].id" title="Schusskarte" :read-me="READ_ME.shots" class="lg:col-span-2">
            <PlayerboardVeoSeasonShotMap :matches="matches" :own-label="ownLabel" />
          </PlayerboardVeoAnalysisSection>
          <PlayerboardVeoAnalysisSection v-for="(zone, index) in ([['pass', passThirds, 'Passzonen'], ['possession', possessionThirds, 'Ballbesitzzonen']] as const)" :id="SECTIONS[2 + index]!.id" :key="zone[0]" :title="zone[2]" :read-me="READ_ME.zones">
            <div class="mb-3 flex gap-2" role="group" aria-label="Mannschaft">
              <button type="button" :class="toggleClass(zoneTeam[zone[0]] === 'own')" :aria-pressed="zoneTeam[zone[0]] === 'own'" @click="zoneTeam[zone[0]] = 'own'">{{ ownLabel }}</button>
              <button type="button" :class="toggleClass(zoneTeam[zone[0]] === 'opponent')" :aria-pressed="zoneTeam[zone[0]] === 'opponent'" @click="zoneTeam[zone[0]] = 'opponent'">Gegner</button>
            </div>
            <PlayerboardVeoThirdsPitch v-if="zone[1][zoneTeam[zone[0]]]" :percents="zone[1][zoneTeam[zone[0]]]!" :label="`${zone[2]} ${zoneTeam[zone[0]] === 'own' ? ownLabel : 'Gegner'}`" />
            <p v-else class="text-sm text-[#6c756f]">Veo hat in diesen Spielen keine {{ zone[0] === 'pass' ? 'Passorte' : 'Ballbesitzorte' }} erkannt.</p>
          </PlayerboardVeoAnalysisSection>
        </div>
        <PlayerboardVeoAnalysisSection :id="SECTIONS[4].id" title="Vergleich" :read-me="READ_ME.radar">
          <PlayerboardVeoRadar
            :team-id="teamId!" :own-label="ownLabel" :teams="otherTeams" :config="views.radar" :kinds="filter.mode === 'selection' ? [] : filter.kinds" :can-edit="canManage"
            @save="(radar) => save({ radar })"
          />
        </PlayerboardVeoAnalysisSection>
      </div>
    </template>
  </div>
</template>
