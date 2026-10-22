<script setup lang="ts">
import {
  PlayerboardPlayerSchema,
  PlayerboardVeoKeyMetricIdSchema,
  type PlayerboardPlayer,
  type PlayerboardVeoPlayerSeasonMatch,
  type PlayerboardVeoSeasonMatch,
  type PlayerboardVeoTeamHeatmap,
  type PlayerboardVeoTeamViews,
} from '@vereinsfunk/contracts'
import { DEFAULT_KEY_METRICS, DEFAULT_SEASON_PLAYER_COLUMNS, seasonPlayerKey, seasonPlayerRows, seasonThirdPercents } from '@vereinsfunk/domain'
import { playerboardErrorMessage } from '../../utils/playerboardErrors'
import { scoreLabel } from '../../utils/playerboardVeo'
import { filterFromQuery, filterToQuery, seasonFilter, type AnalyticsFilterState } from '../../utils/playerboardVeoAnalytics'
import { playerRowName, seasonShotsByPlayer, seasonTableRows } from '../../utils/playerboardVeoPlayers'

// Spec 002, PR 4: Veo Analytics -- Nachbau von Veos Analytics Studio, Reiter "Team stats"
// (Inventar §1b): Filter, Kennzahlen mit Verlauf, Schusskarte, Pass- und Ballbesitzzonen,
// Vergleichsradar. Sichtbar fuer alle, die die Kennzahlen der Mannschaft sehen (stats_visibility).
// Der Filter steht in der URL, damit sich eine Ansicht teilen laesst.
// PR 5: Reiter "Spieler" wie Veos "Player stats" (Inventar §2.1): Ranglisten, Spielertabelle,
// Spieler-Schusskarte, Positions-Heatmap, Spielervergleich und Spielerkarte; ?ansicht=spieler.
const route = useRoute()
const router = useRouter()
const { teams, team, teamId, organizationTimezone, canManage } = await usePlayerboardTeam()
const { loadSeason, loadPlayerSeason, loadTeamHeatmaps, loadViews, saveViews } = usePlayerboardVeoSeason()
const { loadMatches } = usePlayerboardVeo()
const api = useApiClient()

type View = 'team' | 'players'
const viewFromQuery = (query: Record<string, unknown>): View => (query.ansicht === 'spieler' ? 'players' : 'team')
const view = ref<View>(viewFromQuery(route.query))
const filter = ref<AnalyticsFilterState>(filterFromQuery(route.query))
watch([filter, view], ([value, current]) => {
  void router.replace({ query: { ...filterToQuery(value), ...(current === 'players' ? { ansicht: 'spieler' } : {}) } })
}, { deep: true })
watch(() => route.query, (query) => {
  const next = filterFromQuery(query)
  if (JSON.stringify(filterToQuery(filter.value)) !== JSON.stringify(filterToQuery(next))) filter.value = next
  if (view.value !== viewFromQuery(query)) view.value = viewFromQuery(query)
}, { deep: true })

const matches = ref<PlayerboardVeoSeasonMatch[]>([])
const teamHeatmaps = ref<PlayerboardVeoTeamHeatmap[] | null>(null)
const teamHeatmapsFailed = ref(false)
// Namen fuer die Spielerlisten der Karten, je seasonPlayerKey; zuletzt getragene Nummer gewinnt.
const playerNames = computed(() => new Map((teamHeatmaps.value ?? []).flatMap((heatmap) => (heatmap.name ? [[seasonPlayerKey(heatmap), heatmap.name] as const] : []))))
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
    const [loaded, loadedViews, loadedHeatmaps] = await Promise.all([
      loadSeason(teamId.value, seasonFilter(filter.value)),
      loadViews(teamId.value),
      // Die Heatmap ist ein Zusatz; ohne sie bleibt die Seite vollstaendig.
      loadTeamHeatmaps(teamId.value, seasonFilter(filter.value)).catch(() => null),
    ])
    if (!isLatest()) return
    matches.value = loaded
    views.value = loadedViews
    teamHeatmaps.value = loadedHeatmaps
    teamHeatmapsFailed.value = loadedHeatmaps === null
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

// --- Reiter Spieler ---------------------------------------------------------------------------------
const playerMatches = ref<PlayerboardVeoPlayerSeasonMatch[]>([])
const roster = ref<PlayerboardPlayer[]>([])
const playersLoading = ref(false)
const playersError = ref('')
const playerRuns = useLatestRequest()
async function loadPlayers() {
  const isLatest = playerRuns.begin()
  playersError.value = ''
  if (!teamId.value || view.value !== 'players') return
  playersLoading.value = true
  const requested = teamId.value
  try {
    const [loaded, players] = await Promise.all([
      loadPlayerSeason(requested, seasonFilter(filter.value)),
      // Position und eigene Zeile; ohne Kader bleiben die Werte vollstaendig.
      api.request(`/v1/playerboard/teams/${requested}/players`, {}, PlayerboardPlayerSchema.array()).catch(() => [] as PlayerboardPlayer[]),
    ])
    if (!isLatest()) return
    playerMatches.value = loaded
    roster.value = players
  } catch (error) {
    if (isLatest()) playersError.value = playerboardErrorMessage(error, 'Die Spielerwerte konnten nicht geladen werden.')
  } finally {
    if (isLatest()) playersLoading.value = false
  }
}
void loadPlayers()
watch([teamId, filter, view], () => { void loadPlayers() }, { deep: true })

const playerRows = computed(() => seasonTableRows(seasonPlayerRows(playerMatches.value), roster.value))
const shotsByPlayer = computed(() => seasonShotsByPlayer(matches.value, organizationTimezone.value))
const { heatmapOf } = usePlayerboardVeoPlayerHeatmaps(teamId, computed(() => seasonFilter(filter.value)))
const selectedPlayerKey = ref<string | null>(null)
const selectedPlayer = computed(() => playerRows.value.find((row) => row.key === selectedPlayerKey.value) ?? null)
watch([teamId, filter], () => { selectedPlayerKey.value = null }, { deep: true })
const sourceLabel = computed(() => `${playerMatches.value.length} ${playerMatches.value.length === 1 ? 'Spiel' : 'Spiele'} gefiltert`)

const PLAYER_SECTIONS = [
  { id: 'analytics-leaderboards', label: 'Ranglisten' },
  { id: 'analytics-stats-table', label: 'Spielertabelle' },
  { id: 'analytics-player-shot-map', label: 'Schusskarte' },
  { id: 'analytics-position-heatmap', label: 'Heatmap' },
  { id: 'analytics-player-comparison', label: 'Spielervergleich' },
] as const
const PLAYER_READ_ME = {
  leaderboards: 'Die Ranglisten zeigen die besten fünf Spieler über die gefilterten Spiele. Veo erkennt die Werte automatisch und ordnet sie über die Rückennummer zu; was du in Veo korrigierst, erscheint hier auch.',
  table: 'Die Tabelle zeigt die Summen jedes Spielers über die gefilterten Spiele; die Höchstgeschwindigkeit ist der beste Wert, die Ø-Geschwindigkeit nach Spielzeit gewichtet. Sortiere mit einem Klick auf den Spaltenkopf; ein Klick auf einen Spieler öffnet seine Karte.',
  shots: 'Die Karte zeigt, wo ein Spieler abgeschlossen hat; seine Mannschaft greift nach rechts an. Gefüllte Kreise sind Tore, Ringe Schüsse ohne Tor; ein Klick öffnet die Stelle im Veo-Video.',
  heatmap: 'Je röter die Fläche, desto mehr hielt sich der Spieler dort auf. Jedes Spiel ist so gedreht, dass die Mannschaft nach rechts angreift; Spiele mit mehr Spielzeit zählen stärker.',
  comparison: 'Wähle zwei Spieler, um ihre Werte über die gefilterten Spiele nebeneinander zu sehen. Der höhere Wert ist hervorgehoben.',
} as const

const SECTIONS = [
  { id: 'analytics-key-metrics', label: 'Kennzahlen' },
  { id: 'analytics-shot-map', label: 'Schusskarte' },
  { id: 'analytics-heatmap', label: 'Heatmap' },
  { id: 'analytics-passes', label: 'Passzonen' },
  { id: 'analytics-possession', label: 'Ballbesitzzonen' },
  { id: 'analytics-comparison', label: 'Vergleich' },
] as const
const READ_ME = {
  keyMetrics: 'Die Karten zeigen den Durchschnitt über die gefilterten Spiele. Das Diagramm zeigt, wie sich die gewählte Kennzahl von Spiel zu Spiel entwickelt; ein Balken führt zur Auswertung des Spiels. Sieht ein Wert falsch aus, prüfe in Veo, ob Seiten und Halbzeiten des Spiels stimmen.',
  shots: 'Angriff zeigt, von wo die eigene Mannschaft abgeschlossen hat, Verteidigung, von wo der Gegner abgeschlossen hat. Gefüllte Kreise sind Tore, Ringe Schüsse ohne Tor; ein Klick öffnet die Stelle im Veo-Video. Beim Angriff wählst du links einen Spieler.',
  heatmap: 'Je röter die Fläche, desto mehr hielten sich die Spieler dort auf. Jedes Spiel ist so gedreht, dass die Mannschaft nach rechts angreift; Spieler mit mehr Spielzeit zählen stärker. Links wählst du einen einzelnen Spieler.',
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
      <div class="mb-4 flex gap-2" role="group" aria-label="Ansicht">
        <button type="button" :class="toggleClass(view === 'team')" class="px-5 text-sm" :aria-pressed="view === 'team'" @click="view = 'team'">Mannschaft</button>
        <button type="button" :class="toggleClass(view === 'players')" class="px-5 text-sm" :aria-pressed="view === 'players'" @click="view = 'players'">Spieler</button>
      </div>
      <nav class="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Abschnitte">
        <a v-for="section in (view === 'team' ? SECTIONS : PLAYER_SECTIONS)" :key="section.id" :href="`#${section.id}`" class="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-full border border-[#dfe0d9] bg-white px-4 text-xs font-semibold text-ink">{{ section.label }}</a>
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
      <div v-else-if="view === 'team'" class="grid gap-6" :aria-busy="loading">
        <PlayerboardVeoAnalysisSection :id="SECTIONS[0].id" title="Kennzahlen" :read-me="READ_ME.keyMetrics">
          <PlayerboardVeoKeyMetrics
            :matches="matches" :metrics="keyMetrics" :can-edit="canManage" :team-id="teamId!" :own-label="ownLabel" :timezone="organizationTimezone"
            @save="(ids) => save({ keyMetrics: PlayerboardVeoKeyMetricIdSchema.array().parse(ids) })"
          />
        </PlayerboardVeoAnalysisSection>
        <div class="grid gap-6 lg:grid-cols-2">
          <PlayerboardVeoAnalysisSection :id="SECTIONS[1].id" title="Schusskarte" :read-me="READ_ME.shots" class="lg:col-span-2">
            <PlayerboardVeoSeasonShotMap :matches="matches" :own-label="ownLabel" :player-names="playerNames" />
          </PlayerboardVeoAnalysisSection>
          <PlayerboardVeoAnalysisSection :id="SECTIONS[2].id" title="Heatmap" :read-me="READ_ME.heatmap" class="lg:col-span-2">
            <p v-if="teamHeatmapsFailed" class="text-sm text-amber-800" role="alert">Die Heatmap konnte nicht geladen werden.</p>
            <PlayerboardVeoSeasonTeamHeatmap v-else-if="teamHeatmaps" :heatmaps="teamHeatmaps" :own-label="ownLabel" />
          </PlayerboardVeoAnalysisSection>
          <PlayerboardVeoAnalysisSection v-for="(zone, index) in ([['pass', passThirds, 'Passzonen'], ['possession', possessionThirds, 'Ballbesitzzonen']] as const)" :id="SECTIONS[3 + index]!.id" :key="zone[0]" :title="zone[2]" :read-me="READ_ME.zones">
            <div class="mb-3 flex gap-2" role="group" aria-label="Mannschaft">
              <button type="button" :class="toggleClass(zoneTeam[zone[0]] === 'own')" :aria-pressed="zoneTeam[zone[0]] === 'own'" @click="zoneTeam[zone[0]] = 'own'">{{ ownLabel }}</button>
              <button type="button" :class="toggleClass(zoneTeam[zone[0]] === 'opponent')" :aria-pressed="zoneTeam[zone[0]] === 'opponent'" @click="zoneTeam[zone[0]] = 'opponent'">Gegner</button>
            </div>
            <PlayerboardVeoThirdsPitch v-if="zone[1][zoneTeam[zone[0]]]" :percents="zone[1][zoneTeam[zone[0]]]!" :label="`${zone[2]} ${zoneTeam[zone[0]] === 'own' ? ownLabel : 'Gegner'}`" />
            <p v-else class="text-sm text-[#6c756f]">Veo hat in diesen Spielen keine {{ zone[0] === 'pass' ? 'Passorte' : 'Ballbesitzorte' }} erkannt.</p>
          </PlayerboardVeoAnalysisSection>
        </div>
        <PlayerboardVeoAnalysisSection :id="SECTIONS[5].id" title="Vergleich" :read-me="READ_ME.radar">
          <PlayerboardVeoRadar
            :team-id="teamId!" :own-label="ownLabel" :teams="otherTeams" :config="views.radar" :kinds="filter.mode === 'selection' ? [] : filter.kinds" :can-edit="canManage"
            @save="(radar) => save({ radar })"
          />
        </PlayerboardVeoAnalysisSection>
      </div>
      <div v-else :aria-busy="playersLoading">
        <p v-if="playersLoading" class="mb-4 text-sm text-[#5b625d]" role="status">Spielerwerte werden geladen …</p>
        <p v-if="playersError" class="mb-4 text-sm text-amber-800" role="alert">{{ playersError }}</p>
        <div v-if="!playersLoading && playerRows.length === 0 && !playersError" class="card p-6 text-sm text-[#6c756f]">
          Veo hat in diesen Spielen keine Spielerwerte erkannt.
        </div>
        <div v-else-if="playerRows.length" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div class="grid min-w-0 gap-6">
            <PlayerboardVeoAnalysisSection :id="PLAYER_SECTIONS[0].id" title="Ranglisten" :read-me="PLAYER_READ_ME.leaderboards">
              <PlayerboardVeoLeaderboards :rows="playerRows" @select="(row) => { selectedPlayerKey = row.key }" />
            </PlayerboardVeoAnalysisSection>
            <PlayerboardVeoAnalysisSection :id="PLAYER_SECTIONS[1].id" title="Spielertabelle" :read-me="PLAYER_READ_ME.table">
              <PlayerboardVeoPlayerStatsTable
                :rows="playerRows" :caption="`Spielerwerte ${ownLabel}, ${sourceLabel}`" storage-key="vereinsfunk.veo.season-columns"
                :default-columns="DEFAULT_SEASON_PLAYER_COLUMNS" :selected-key="selectedPlayerKey" @select="(row) => { selectedPlayerKey = row.key }"
              />
            </PlayerboardVeoAnalysisSection>
            <PlayerboardVeoAnalysisSection :id="PLAYER_SECTIONS[2].id" title="Spieler-Schusskarte" :read-me="PLAYER_READ_ME.shots">
              <PlayerboardVeoPlayersShotMap :rows="playerRows" :shots-by-player="shotsByPlayer" />
            </PlayerboardVeoAnalysisSection>
            <PlayerboardVeoAnalysisSection :id="PLAYER_SECTIONS[3].id" title="Positions-Heatmap" :read-me="PLAYER_READ_ME.heatmap">
              <PlayerboardVeoPlayersHeatmap :rows="playerRows" :heatmap-of="heatmapOf" />
            </PlayerboardVeoAnalysisSection>
            <PlayerboardVeoAnalysisSection :id="PLAYER_SECTIONS[4].id" title="Spielervergleich" :read-me="PLAYER_READ_ME.comparison">
              <PlayerboardVeoPlayerComparison :team-id="teamId!" :rows="playerRows" :shots-by-player="shotsByPlayer" :heatmap-of="heatmapOf" />
            </PlayerboardVeoAnalysisSection>
          </div>
          <!-- Spielerkarte: auf dem Handy als Blatt von unten, ab lg als Seitenleiste. -->
          <div v-if="selectedPlayer" class="fixed inset-0 z-30 bg-black/30 lg:hidden" aria-hidden="true" @click="selectedPlayerKey = null" />
          <div
            v-if="selectedPlayer"
            class="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,.18)] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:rounded-2xl lg:shadow-none"
          >
            <PlayerboardVeoPlayerCard :row="selectedPlayer" :source-label="sourceLabel" @close="selectedPlayerKey = null">
              <template #maps>
                <div class="grid gap-5">
                  <section>
                    <h4 class="mb-2 text-sm font-bold text-ink">Heatmap</h4>
                    <PlayerboardVeoPlayerSeasonHeatmap :player="selectedPlayer" :heatmap-of="heatmapOf" :label="`Heatmap ${playerRowName(selectedPlayer)}`" />
                  </section>
                  <section>
                    <h4 class="mb-2 text-sm font-bold text-ink">Schusskarte</h4>
                    <PlayerboardVeoPlayerShotMap :shots="shotsByPlayer.get(selectedPlayer.key) ?? []" :label="`Schusskarte ${playerRowName(selectedPlayer)}`" />
                  </section>
                </div>
              </template>
            </PlayerboardVeoPlayerCard>
          </div>
          <p v-else class="hidden rounded-2xl border border-dashed border-[#dfe0d9] p-4 text-sm text-[#6c756f] lg:block">Wähle einen Spieler, um seine Karte zu sehen.</p>
        </div>
      </div>
    </template>
  </div>
</template>
