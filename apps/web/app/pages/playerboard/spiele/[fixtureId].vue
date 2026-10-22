<script setup lang="ts">
import { UuidSchema, type PlayerboardVeoAnalysisPart, type PlayerboardVeoMatchAnalysis } from '@vereinsfunk/contracts'
import { ApiRequestError } from '../../../utils/apiClient'
import { playerboardErrorMessage } from '../../../utils/playerboardErrors'
import { matchOutcome, scoreLabel, statValues } from '../../../utils/playerboardVeo'
import { availabilityHint, isPartAvailable } from '../../../utils/playerboardVeoAnalysis'
import type { VeoPlayerTableRow } from '../../../components/PlayerboardVeoPlayerTable.vue'

// Spec 002, PR 2: Spielauswertung eines Veo-Spiels wie Veos Analyse-Seite -- Reiter Mannschaft,
// Spieler und Ereignisse. Jede Grafik erscheint nur, wenn Veo den Teil geliefert hat; sonst steht
// dort der Grund (FR-066). ?team= waehlt die Mannschaft, damit Links auch geteilt funktionieren.
const route = useRoute()
const { teams, team, teamId, organizationTimezone } = await usePlayerboardTeam()
const { loadAnalysis, loadTracks } = usePlayerboardVeoAnalysis()

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
const playerRows = computed<VeoPlayerTableRow[]>(() => (analysis.value?.players ?? []).map((player) => ({
  key: `${player.jerseyNumber}`,
  label: `#${player.jerseyNumber} ${player.name ?? '· nicht zugeordnet'}`,
  ...(player.personId ? { personId: player.personId } : {}),
  values: statValues(player.stats),
  muted: player.playerId === null,
})))

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
const tracksLoader = () => loadTracks(teamId.value!, fixtureId.value!)

// "So liest du ..." je Grafik (FR-004), nach Veos Erklaertexten.
const READ_ME = {
  stats: 'Die Balken zeigen, wie sich ein Wert zwischen beiden Mannschaften verteilt; die Heimmannschaft steht links. Der kleinere Wert ist abgeschwächt. Bei den Ballbesitz-Minuten steht in der Mitte die Zeit, in der keine Mannschaft den Ball hatte.',
  shots: 'Die Karte zeigt, wo die Abschlüsse beider Mannschaften waren; jede Mannschaft greift nach rechts an. Gefüllte Kreise sind Tore, Ringe Schüsse ohne Tor. Ein Klick öffnet die Stelle im Veo-Video.',
  passes: 'Die Passzonen zeigen, in welchem Drittel die angekommenen Pässe einer Mannschaft gespielt wurden – je kräftiger die Fläche, desto mehr Pässe.',
  possession: 'Die Ballbesitzzonen zeigen, in welchem Drittel eine Mannschaft den Ball hatte, durch Pässe und Dribblings.',
  passStrings: 'Passketten zählen, wie oft eine Mannschaft mehrere Pässe ohne Ballverlust aneinandergereiht hat. Viele kurze Ketten sprechen für direktes Spiel, lange für Spielkontrolle.',
  heatmap: 'Je röter die Fläche, desto mehr hielten sich die Feldspieler der Mannschaft dort auf – mit und ohne Ball. Mit den Schiebern wählst du einen Abschnitt der Halbzeit.',
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
        <PlayerboardVeoAnalysisSection title="Schusskarte" :read-me="READ_ME.shots" :hint="hint('shots')">
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
        <PlayerboardVeoAnalysisSection title="Heatmap" :read-me="READ_ME.heatmap" :hint="heatmapAvailable ? null : hint('tracking')">
          <PlayerboardVeoTeamHeatmap :analysis="analysis" :own-label="ownLabel" :opponent-label="opponentLabel" :load-tracks="tracksLoader" />
        </PlayerboardVeoAnalysisSection>
        <PlayerboardVeoAnalysisSection title="Spielverlauf" :read-me="READ_ME.momentum" :hint="hint('momentum')" class="lg:col-span-2">
          <PlayerboardVeoMomentum :analysis="analysis" :own-label="ownLabel" :opponent-label="opponentLabel" />
        </PlayerboardVeoAnalysisSection>
      </div>

      <div v-else-if="tab === 'players'" id="veo-analysis-panel-players" role="tabpanel" aria-labelledby="veo-analysis-tab-players">
        <PlayerboardVeoPlayerTable v-if="playerRows.length" :rows="playerRows" :caption="`Spielerwerte gegen ${opponentLabel}`" />
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
