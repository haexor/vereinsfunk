<script setup lang="ts">
import { PlayerboardPlayerSchema, type PlayerboardPlayer, type PlayerboardVeoMatch } from '@vereinsfunk/contracts'
import { playerboardErrorMessage } from '../../utils/playerboardErrors'
import { scoreLabel } from '../../utils/playerboardVeo'
import type { VeoCardMatch } from '../../components/PlayerboardVeoMatchCard.vue'
import type { VeoSeasonMatch } from '../../components/PlayerboardVeoSeason.vue'

// Paket 053, PR 3: Spiele mit Veo-Werten fuer alle, die die Kennzahlen der Mannschaft sehen
// (training.view oder stats_visibility). Trainer ordnen hier Rueckennummern dem Kader zu.
const api = useApiClient()
const { team, teamId, organizationId, organizationTimezone, canManage, permissionScope } = await usePlayerboardTeam()
const { loadSeasonFrom } = usePlayerboardRanking()
const { loadMatches } = usePlayerboardVeo()
const canManagePlayerboard = computed(() => (permissionScope.value ? useCan('playerboard.manage', permissionScope.value) : false))

const period = ref<'season' | 'all'>('season')
const seasonFrom = ref<string | null>(null)
const matches = ref<PlayerboardVeoMatch[]>([])
const roster = ref<PlayerboardPlayer[] | undefined>(undefined)
const selectedFixtureId = ref<string | null>(null)
const loading = ref(false)
const errorMessage = ref('')

/** Laedt Saisonanfang, Spiele des Zeitraums und fuer Trainer den Kader; spaete Antworten verfallen. */
let latestRequest = 0
async function load(keepSelection = false) {
  const request = ++latestRequest
  errorMessage.value = ''
  if (!teamId.value || !organizationId.value) {
    matches.value = []
    return
  }
  const requestedTeamId = teamId.value
  loading.value = true
  try {
    seasonFrom.value = await loadSeasonFrom(organizationId.value, requestedTeamId, organizationTimezone.value)
    const range = period.value === 'season' && seasonFrom.value ? { from: seasonFrom.value } : {}
    const [loaded, players] = await Promise.all([
      loadMatches(requestedTeamId, range),
      canManage.value ? api.request(`/v1/playerboard/teams/${requestedTeamId}/players`, {}, PlayerboardPlayerSchema.array()) : Promise.resolve(undefined),
    ])
    if (request !== latestRequest) return
    matches.value = loaded
    roster.value = players
    if (!keepSelection || !loaded.some((match) => match.fixtureId === selectedFixtureId.value)) selectedFixtureId.value = loaded[0]?.fixtureId ?? null
  } catch (error) {
    if (request === latestRequest) errorMessage.value = playerboardErrorMessage(error, 'Die Spiele konnten nicht geladen werden.')
  } finally {
    if (request === latestRequest) loading.value = false
  }
}
await load()
watch([teamId, period], () => { void load() })

// Saison: nur zugeordnete Nummern, damit jeder Spieler eine Zeile ueber alle Spiele hat.
const seasonMatches = computed<VeoSeasonMatch[]>(() => matches.value.map((match) => ({
  ownScore: match.ownScore,
  opponentScore: match.opponentScore,
  teamStats: match.teamStats,
  players: match.players.flatMap((player) => player.playerId && player.name
    ? [{ key: player.playerId, label: player.name, jerseyNumber: player.jerseyNumber, stats: player.stats }]
    : []),
})))
const selectedMatch = computed<VeoCardMatch | null>(() => {
  const match = matches.value.find((entry) => entry.fixtureId === selectedFixtureId.value)
  if (!match) return null
  return {
    ...match,
    players: match.players.map((player) => ({
      jerseyNumber: player.jerseyNumber,
      playerId: player.playerId,
      label: `#${player.jerseyNumber} ${player.name ?? '· nicht zugeordnet'}`,
      stats: player.stats,
    })),
  }
})
// Verschiedene offene Rueckennummern, nicht Eintraege: Nummer 12 in fuenf Spielen zaehlt einmal.
const unassignedCount = computed(() => new Set(matches.value.flatMap((match) => match.players.filter((player) => !player.playerId).map((player) => player.jerseyNumber))).size)

const optionDate = computed(() => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: organizationTimezone.value }))
/** Eintrag der Spielauswahl: Datum, Gegner, Ergebnis. */
function optionLabel(match: PlayerboardVeoMatch): string {
  return `${optionDate.value.format(new Date(match.kickoffAt))} · ${match.opponentName ?? 'unbekannt'} · ${scoreLabel(match)}`
}
const seasonFormat = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const inputClass = 'focus-ring h-11 rounded-xl border border-[#dfe0d9] bg-white px-3 text-sm text-ink'
</script>

<template>
  <div>
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="eyebrow mb-3">PlayerBoard</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">Spiele</h1>
      </div>
      <PlayerboardTeamPicker />
    </header>

    <PlayerboardTeamEmpty v-if="!team" />
    <template v-else>
      <div class="mb-5 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Zeitraum">
        <button
          v-for="item in [{ kind: 'season', label: 'Saison' }, { kind: 'all', label: 'Gesamt' }] as const"
          :key="item.kind"
          type="button"
          role="radio"
          :aria-checked="period === item.kind"
          class="focus-ring min-h-11 rounded-xl border px-4 text-xs font-semibold"
          :class="period === item.kind ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] bg-white text-ink'"
          @click="period = item.kind"
        >
          {{ item.label }}
        </button>
        <span v-if="period === 'season'" class="text-xs text-[#6c756f]">
          {{ seasonFrom ? `Seit ${seasonFormat.format(new Date(`${seasonFrom}T00:00:00Z`))}` : 'Kein Saisonbeginn festgelegt – es zählt die gesamte Zeit.' }}
        </span>
      </div>

      <p v-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
      <div v-else-if="!loading && matches.length === 0" class="card p-6 text-sm text-[#6c756f]">
        <p>Für diesen Zeitraum gibt es noch keine Spiele mit Veo-Werten.</p>
        <p v-if="canManagePlayerboard" class="mt-2">
          <NuxtLink to="/playerboard/veo" class="font-semibold text-forest underline">Veo verbinden oder abgleichen</NuxtLink>
        </p>
      </div>
      <div v-else :aria-busy="loading" :class="loading ? 'opacity-60' : ''" class="space-y-6">
        <section class="card p-5" aria-labelledby="veo-season-heading">
          <h2 id="veo-season-heading" class="mb-4 font-display text-base font-bold text-ink">{{ period === 'season' ? 'Saison' : 'Alle Spiele' }}</h2>
          <PlayerboardVeoSeason :matches="seasonMatches" />
          <p v-if="canManage && unassignedCount" class="mt-3 text-xs text-[#6c756f]">
            {{ unassignedCount }} {{ unassignedCount === 1 ? 'Rückennummer ist' : 'Rückennummern sind' }} in mindestens einem Spiel keinem Spieler zugeordnet; ihre Werte fehlen hier. Zuordnen kannst du sie im jeweiligen Spiel.
          </p>
        </section>

        <section aria-labelledby="veo-match-heading">
          <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 id="veo-match-heading" class="font-display text-base font-bold text-ink">Spiel</h2>
            <label class="grid w-full min-w-0 gap-1 text-xs font-semibold text-[#5b625d] sm:w-auto">
              <span class="sr-only">Spiel auswählen</span>
              <select v-model="selectedFixtureId" :class="[inputClass, 'w-full min-w-0']">
                <option v-for="match in matches" :key="match.fixtureId" :value="match.fixtureId">{{ optionLabel(match) }}</option>
              </select>
            </label>
          </div>
          <PlayerboardVeoMatchCard
            v-if="selectedMatch"
            :key="selectedMatch.fixtureId"
            :match="selectedMatch"
            :timezone="organizationTimezone"
            :roster="canManage ? roster : undefined"
            @assigned="load(true)"
          />
        </section>
      </div>
    </template>
  </div>
</template>
