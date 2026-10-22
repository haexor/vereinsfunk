<script setup lang="ts">
import { PlayerboardPlayerSchema, UuidSchema, type PlayerboardPlayer, type PlayerboardVeoAnalysisPart, type PlayerboardVeoMatchAnalysis, type PlayerboardVeoMatchTracks } from '@vereinsfunk/contracts'
import { DEFAULT_MATCH_PLAYER_COLUMNS } from '@vereinsfunk/domain'
import { ApiRequestError } from '../../../utils/apiClient'
import { playerboardErrorMessage } from '../../../utils/playerboardErrors'
import { matchOutcome, scoreLabel } from '../../../utils/playerboardVeo'
import { availabilityHint, isPartAvailable, periodOptions } from '../../../utils/playerboardVeoAnalysis'
import { matchPlayerRows, playerRowName, type VeoPlayerRow } from '../../../utils/playerboardVeoPlayers'

// Spec 002, PR 2: Spielauswertung eines Veo-Spiels wie Veos Analyse-Seite -- Reiter Mannschaft,
// Spieler und Ereignisse. Jede Grafik erscheint nur, wenn Veo den Teil geliefert hat; sonst steht
// dort der Grund (FR-066). ?team= waehlt die Mannschaft, damit Links auch geteilt funktionieren.
const route = useRoute()
const { teams, team, teamId, organizationTimezone } = await usePlayerboardTeam()
const { loadAnalysis, loadTracks } = usePlayerboardVeoAnalysis()
const api = useApiClient()

const fixtureId = computed(() => UuidSchema.safeParse(route.params.fixtureId).data ?? null)
const requestedTeam = UuidSchema.safeParse(route.query.team).data
if (requestedTeam && teams.value.some((entry) => entry.id === requestedTeam)) teamId.value = requestedTeam

const analysis = ref<PlayerboardVeoMatchAnalysis | null>(null)
const notFound = ref(false)
const errorMessage = ref('')
const loadRuns = useLatestRequest()
async function load() {
  const isLatest = loadRuns.begin()
  analysis.value = null
  notFound.value = false
  errorMessage.value = ''
  if (!teamId.value || !fixtureId.value) {
    notFound.value = Boolean(teamId.value)
    return
  }
  try {
    const loaded = await loadAnalysis(teamId.value, fixtureId.value)
    if (isLatest()) analysis.value = loaded
  } catch (error) {
    if (!isLatest()) return
    if (error instanceof ApiRequestError && error.statusCode === 404) notFound.value = true
    else errorMessage.value = playerboardErrorMessage(error, 'Die Spielauswertung konnte nicht geladen werden.')
  }
}
await load()
watch([teamId, fixtureId], () => { void load() })

// Kader fuer Position und eigene Zeile in der Spielertabelle. Ohne Kader (Fehler, fehlendes Recht)
// zeigt die Tabelle die Werte trotzdem, die Spielerkarte nimmt dann Veos Rueckfall-Kacheln.
const roster = ref<PlayerboardPlayer[]>([])
async function loadRoster() {
  roster.value = []
  if (!teamId.value) return
  const requested = teamId.value
  try {
    const loaded = await api.request(`/v1/playerboard/teams/${requested}/players`, {}, PlayerboardPlayerSchema.array())
    if (requested === teamId.value) roster.value = loaded
  } catch {
    // Nur Zusatzangaben; die Auswertung bleibt vollstaendig.
  }
}
void loadRoster()
watch(teamId, () => { void loadRoster() })

type Tab = 'team' | 'players' | 'events'
const tabs: { id: Tab; label: string }[] = [{ id: 'team', label: 'Mannschaft' }, { id: 'players', label: 'Spieler' }, { id: 'events', label: 'Ereignisse' }]
const tab = ref<Tab>('team')
function onTabKeydown(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]!
  tab.value = next.id
  nextTick(() => document.getElementById(`veo-analysis-tab-${next.id}`)?.focus())
}

const ownLabel = computed(() => team.value?.name ?? 'Wir')
const opponentLabel = computed(() => analysis.value?.opponentName ?? 'Gegner')
const playersByJersey = computed(() => new Map((analysis.value?.players ?? []).map((player) => [player.jerseyNumber, player])))
/** "#7 Ada Arnold" fuer eigene, zugeordnete Spieler; sonst nur die Nummer. Gegner nie mit Namen. */
function playerLabel(side: 'own' | 'opponent', jerseyNumber: number | null): string {
  if (jerseyNumber === null) return 'ohne Nummer'
  const name = side === 'own' ? playersByJersey.value.get(jerseyNumber)?.name : null
  return name ? `#${jerseyNumber} ${name}` : `#${jerseyNumber}`
}
// Spielertabelle und Spielerkarte (Inventar §2.2, §2.3); die Halbzeitwahl gilt fuer beide.
const playerPeriod = ref<number | null>(null)
const playerRows = computed(() => matchPlayerRows(analysis.value?.players ?? [], roster.value, playerPeriod.value))
const selectedKey = ref<string | null>(null)
const selectedRow = computed<VeoPlayerRow | null>(() => playerRows.value.find((row) => row.key === selectedKey.value) ?? null)
watch(analysis, () => { selectedKey.value = null; playerPeriod.value = null })
const playerPeriodLabel = computed(() => periodOptions(analysis.value?.periods ?? []).find((option) => option.value === playerPeriod.value)?.label ?? 'Ganzes Spiel')

const hint = (part: PlayerboardVeoAnalysisPart) => (analysis.value ? availabilityHint(analysis.value.availability, part) : null)
const available = (part: PlayerboardVeoAnalysisPart) => Boolean(analysis.value && isPartAvailable(analysis.value.availability, part))
const heatmapAvailable = computed(() => available('tracking') || available('heatmaps'))
const statusNote = computed(() => {
  const status = analysis.value?.analysisStatus
  if (status === 'none') return 'Für dieses Spiel liegt noch keine Veo-Analyse vor. Der nächste Abgleich holt sie; bis dahin siehst du die Spielwerte.'
  if (status === 'pending') return 'Veo wertet dieses Spiel noch aus oder es fehlen Seiten und Halbzeiten. Der nächste Abgleich holt den Rest.'
  if (status === 'unavailable') return 'Veo liefert für dieses Spiel keine Analyse.'
  return ''
})
const dateLabel = computed(() => (analysis.value ? new Intl.DateTimeFormat('de-DE', {
  weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: organizationTimezone.value,
}).format(new Date(analysis.value.kickoffAt)) : ''))
const outcome = computed(() => (analysis.value ? matchOutcome(analysis.value) : null))
// Positionsdaten einmal je Spiel laden; Heatmap der Mannschaft und Spielerkarte teilen sie.
let tracksRequest: { key: string; promise: Promise<PlayerboardVeoMatchTracks> } | null = null
const tracksLoader = () => {
  const key = `${teamId.value}:${fixtureId.value}`
  if (tracksRequest?.key !== key) {
    const promise = loadTracks(teamId.value!, fixtureId.value!)
    promise.catch(() => { if (tracksRequest?.promise === promise) tracksRequest = null })
    tracksRequest = { key, promise }
  }
  return tracksRequest.promise
}

// "So liest du ..." je Grafik (FR-004), nach Veos Erklaertexten.
const READ_ME = {
  stats: 'Die Balken zeigen, wie sich ein Wert zwischen beiden Mannschaften verteilt; die Heimmannschaft steht links. Der kleinere Wert ist abgeschwächt. Bei den Ballbesitz-Minuten steht in der Mitte die Zeit, in der keine Mannschaft den Ball hatte.',
  shots: 'Die Karte zeigt, wo die Abschlüsse beider Mannschaften waren; jede Mannschaft greift nach rechts an. Gefüllte Kreise sind Tore, Ringe Schüsse ohne Tor. Ein Klick öffnet die Stelle im Veo-Video. Links wählst du einen Spieler der eigenen Mannschaft.',
  passes: 'Die Passzonen zeigen, in welchem Drittel die angekommenen Pässe einer Mannschaft gespielt wurden – je kräftiger die Fläche, desto mehr Pässe.',
  possession: 'Die Ballbesitzzonen zeigen, in welchem Drittel eine Mannschaft den Ball hatte, durch Pässe und Dribblings.',
  passStrings: 'Passketten zählen, wie oft eine Mannschaft mehrere Pässe ohne Ballverlust aneinandergereiht hat. Viele kurze Ketten sprechen für direktes Spiel, lange für Spielkontrolle.',
  heatmap: 'Je röter die Fläche, desto mehr hielten sich die Feldspieler der Mannschaft dort auf – mit und ohne Ball. Mit den Schiebern wählst du einen Abschnitt der Halbzeit, links einen einzelnen Spieler der eigenen Mannschaft.',
  players: 'Die Tabelle zeigt die Werte, die Veo den Rückennummern zugeordnet hat. Sortiere mit einem Klick auf den Spaltenkopf; ein Klick auf einen Spieler öffnet seine Karte mit Heatmap und Schusskarte. Graue Zeilen sind Nummern, die noch keinem Spieler zugeordnet sind.',
  momentum: 'Ausschläge nach oben zeigen Druck der Heimmannschaft in der gegnerischen Hälfte, nach unten Druck der Gastmannschaft. Je höher der Ausschlag, desto näher war das Geschehen am Tor. Veo rechnet das aus Positionen und Laufwegen.',
} as const
</script>

<template>
  <div>
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div class="min-w-0">
        <NuxtLink to="/playerboard/spiele" class="focus-ring inline-flex min-h-11 items-center text-sm font-semibold text-forest">← Spiele</NuxtLink>
        <div class="eyebrow mb-3">PlayerBoard · Spielauswertung</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">gegen {{ analysis?.opponentName ?? 'unbekannt' }}</h1>
        <p v-if="analysis" class="mt-1 text-sm text-[#6c756f]">{{ dateLabel }}<template v-if="analysis.isHome !== null"> · {{ analysis.isHome ? 'Heim' : 'Auswärts' }}</template></p>
      </div>
      <PlayerboardTeamPicker />
    </header>

    <PlayerboardTeamEmpty v-if="!team" />
    <div v-else-if="notFound" class="card p-6 text-sm text-[#6c756f]">
      <p>Dieses Spiel gibt es für {{ ownLabel }} nicht, oder du darfst seine Auswertung nicht sehen.</p>
      <NuxtLink to="/playerboard/spiele" class="mt-2 inline-flex min-h-11 items-center font-semibold text-forest underline">Zu den Spielen</NuxtLink>
    </div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800" role="alert">{{ errorMessage }}</p>
    <template v-else-if="analysis">
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <p
          class="rounded-xl px-3 py-1 font-display text-2xl font-extrabold tabular-nums"
          :class="outcome === 'win' ? 'bg-[#e4f1e7] text-forest' : outcome === 'loss' ? 'bg-[#fbeee6] text-[#9a3b12]' : 'bg-[#eef1ea] text-ink'"
          :aria-label="`Ergebnis ${scoreLabel(analysis)}`"
        >{{ scoreLabel(analysis) }}</p>
        <a v-if="analysis.veoUrl" :href="analysis.veoUrl" target="_blank" rel="noopener" class="focus-ring inline-flex min-h-11 items-center rounded-xl border border-[#dfe0d9] bg-white px-4 text-sm font-semibold text-ink">In Veo öffnen ↗</a>
      </div>
      <p v-if="statusNote" class="mb-4 rounded-xl bg-[#f7f8f4] p-3 text-sm text-[#5b625d]">{{ statusNote }}</p>

      <div class="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Ansicht">
        <button
          v-for="(entry, index) in tabs"
          :id="`veo-analysis-tab-${entry.id}`"
          :key="entry.id"
          type="button"
          role="tab"
          :aria-selected="tab === entry.id"
          :aria-controls="`veo-analysis-panel-${entry.id}`"
          :tabindex="tab === entry.id ? 0 : -1"
          class="focus-ring min-h-11 rounded-xl border px-4 text-sm"
          :class="tab === entry.id ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] bg-white text-ink'"
          @click="tab = entry.id"
          @keydown="onTabKeydown($event, index)"
        >{{ entry.label }}</button>
      </div>

      <div v-if="tab === 'team'" id="veo-analysis-panel-team" role="tabpanel" aria-labelledby="veo-analysis-tab-team" class="grid gap-6 lg:grid-cols-2">
        <PlayerboardVeoAnalysisSection title="Spielwerte" :read-me="READ_ME.stats">
          <PlayerboardVeoStatComparison :analysis="analysis" :own-label="ownLabel" :opponent-label="opponentLabel" />
        </PlayerboardVeoAnalysisSection>
        <PlayerboardVeoAnalysisSection title="Schusskarte" :read-me="READ_ME.shots" :hint="hint('shots')" class="lg:col-span-2">
          <PlayerboardVeoShotMap :analysis="analysis" :own-label="ownLabel" :opponent-label="opponentLabel" :player-label="playerLabel" />
        </PlayerboardVeoAnalysisSection>
        <PlayerboardVeoAnalysisSection title="Passzonen" :read-me="READ_ME.passes" :hint="hint('passes')">
          <PlayerboardVeoThirds :analysis="analysis" kind="pass" :own-label="ownLabel" :opponent-label="opponentLabel" />
        </PlayerboardVeoAnalysisSection>
        <PlayerboardVeoAnalysisSection title="Ballbesitzzonen" :read-me="READ_ME.possession" :hint="hint('possession')">
          <PlayerboardVeoThirds :analysis="analysis" kind="possession" :own-label="ownLabel" :opponent-label="opponentLabel" />
        </PlayerboardVeoAnalysisSection>
        <PlayerboardVeoAnalysisSection title="Passketten" :read-me="READ_ME.passStrings" :hint="hint('passStrings')">
          <PlayerboardVeoPassStrings :analysis="analysis" :own-label="ownLabel" :opponent-label="opponentLabel" />
        </PlayerboardVeoAnalysisSection>
        <PlayerboardVeoAnalysisSection title="Heatmap" :read-me="READ_ME.heatmap" :hint="heatmapAvailable ? null : hint('tracking')" class="lg:col-span-2">
          <PlayerboardVeoTeamHeatmap :analysis="analysis" :own-label="ownLabel" :opponent-label="opponentLabel" :load-tracks="tracksLoader" :player-label="playerLabel" />
        </PlayerboardVeoAnalysisSection>
        <PlayerboardVeoAnalysisSection title="Spielverlauf" :read-me="READ_ME.momentum" :hint="hint('momentum')" class="lg:col-span-2">
          <PlayerboardVeoMomentum :analysis="analysis" :own-label="ownLabel" :opponent-label="opponentLabel" />
        </PlayerboardVeoAnalysisSection>
      </div>

      <div v-else-if="tab === 'players'" id="veo-analysis-panel-players" role="tabpanel" aria-labelledby="veo-analysis-tab-players">
        <template v-if="analysis.players.length">
          <PlayerboardVeoPanelFilters v-model:period="playerPeriod" :periods="analysis.periods" :own-label="ownLabel" :opponent-label="opponentLabel" :with-team="false" />
          <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <PlayerboardVeoAnalysisSection title="Spielerwerte" :read-me="READ_ME.players">
              <PlayerboardVeoPlayerStatsTable
                :rows="playerRows" :caption="`Spielerwerte gegen ${opponentLabel}, ${playerPeriodLabel}`" storage-key="vereinsfunk.veo.match-columns"
                :default-columns="DEFAULT_MATCH_PLAYER_COLUMNS" :selected-key="selectedKey" @select="(row) => { selectedKey = row.key }"
              />
            </PlayerboardVeoAnalysisSection>
            <!-- Auf dem Handy als Blatt von unten ueber der Tabelle, ab lg als Seitenleiste. -->
            <div v-if="selectedRow" class="fixed inset-0 z-30 bg-black/30 lg:hidden" aria-hidden="true" @click="selectedKey = null" />
            <div
              v-if="selectedRow"
              class="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,.18)] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:rounded-2xl lg:shadow-none"
            >
              <PlayerboardVeoPlayerCard :row="selectedRow" :source-label="`gegen ${opponentLabel} · ${playerPeriodLabel}`" @close="selectedKey = null">
                <template #maps>
                  <PlayerboardVeoPlayerMatchMaps
                    v-if="selectedRow.jerseyNumber !== null" :key="selectedRow.key" :analysis="analysis" :jersey-number="selectedRow.jerseyNumber"
                    :player-label="playerRowName(selectedRow)" :load-tracks="tracksLoader"
                  />
                </template>
              </PlayerboardVeoPlayerCard>
            </div>
            <p v-else class="hidden rounded-2xl border border-dashed border-[#dfe0d9] p-4 text-sm text-[#6c756f] lg:block">Wähle einen Spieler, um seine Karte zu sehen.</p>
          </div>
        </template>
        <p v-else class="text-sm text-[#6c756f]">Veo hat zu diesem Spiel keine Spielerwerte geliefert.</p>
      </div>

      <div v-else id="veo-analysis-panel-events" role="tabpanel" aria-labelledby="veo-analysis-tab-events">
        <PlayerboardVeoAnalysisSection title="Ereignisse" :hint="hint('events')">
          <PlayerboardVeoEvents :analysis="analysis" :own-label="ownLabel" :opponent-label="opponentLabel" :player-label="playerLabel" />
        </PlayerboardVeoAnalysisSection>
      </div>
    </template>
  </div>
</template>
