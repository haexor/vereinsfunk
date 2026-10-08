<script setup lang="ts">
import type { PlayerboardPlayer, PlayerboardVeoTeamStat } from '@vereinsfunk/contracts'
import { playerboardErrorMessage } from '../utils/playerboardErrors'
import { categoryLabel, formatStatValue, matchOutcome, scoreLabel, statLabel, statValues, teamStatsByCategory } from '../utils/playerboardVeo'
import type { VeoPlayerTableRow } from './PlayerboardVeoPlayerTable.vue'

// Paket 053, PR 3: ein Spiel mit Veo-Werten. Mannschaftswerte eigene/gegnerische Seite, darunter
// die Spieler. Mit Kader (Trainer) laesst sich je Rueckennummer der Spieler waehlen; die Wahl gilt
// als manuell und uebersteht jeden weiteren Abgleich.
export interface VeoCardPlayer {
  jerseyNumber: number
  label: string
  playerId?: string | null
  stats: readonly { statType: string; category: string; value: number }[]
}
export interface VeoCardMatch {
  fixtureId?: string
  kickoffAt: string
  opponentName: string | null
  isHome: boolean | null
  ownScore: number | null
  opponentScore: number | null
  teamStats: readonly PlayerboardVeoTeamStat[]
  players: readonly VeoCardPlayer[]
}

const props = defineProps<{ match: VeoCardMatch; timezone: string; roster?: PlayerboardPlayer[] }>()
const emit = defineEmits<{ assigned: [] }>()

const { assign } = usePlayerboardVeo()
const applyToOthers = ref(true)
const savingJersey = ref<number | null>(null)
const message = ref('')
const errorMessage = ref('')

const dateLabel = computed(() => new Intl.DateTimeFormat('de-DE', {
  weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: props.timezone,
}).format(new Date(props.match.kickoffAt)))
const outcome = computed(() => matchOutcome(props.match))
const categories = computed(() => teamStatsByCategory(props.match.teamStats))
const rows = computed<VeoPlayerTableRow[]>(() => props.match.players.map((player) => ({
  key: `${player.jerseyNumber}`,
  label: player.label,
  values: statValues(player.stats),
  muted: player.playerId === null,
})))
// Zeilenschluessel = Rueckennummer; daraus die aktuelle Zuordnung fuer die Auswahl.
const assignedPlayer = computed(() => new Map(props.match.players.map((player) => [`${player.jerseyNumber}`, player.playerId ?? null])))
const canAssign = computed(() => Boolean(props.roster && props.match.fixtureId))
const rosterOptions = computed(() => (props.roster ?? [])
  .filter((player) => player.active)
  .map((player) => ({ id: player.id, label: `${player.jerseyNumber !== null ? `#${player.jerseyNumber} ` : ''}${player.firstName} ${player.lastName}` })))

/** Speichert die Wahl fuer eine Rueckennummer und meldet, wie viele Spiele sich geaendert haben. */
async function choose(jerseyNumber: number, value: string) {
  if (!props.match.fixtureId) return
  savingJersey.value = jerseyNumber
  message.value = ''
  errorMessage.value = ''
  try {
    const playerId = value || null
    const result = await assign({ fixtureId: props.match.fixtureId, jerseyNumber, playerId, applyToUnassigned: applyToOthers.value && playerId !== null })
    message.value = result.changed > 1 ? `Gespeichert, in ${result.changed} Spielen übernommen.` : 'Gespeichert.'
    emit('assigned')
  } catch (error) {
    errorMessage.value = playerboardErrorMessage(error, 'Die Zuordnung konnte nicht gespeichert werden.')
  } finally {
    savingJersey.value = null
  }
}
</script>

<template>
  <article class="card p-5">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs text-[#6c756f]">{{ dateLabel }}<template v-if="match.isHome !== null"> · {{ match.isHome ? 'Heim' : 'Auswärts' }}</template></p>
        <h2 class="mt-1 font-display text-xl font-extrabold tracking-[-.03em] text-ink">gegen {{ match.opponentName ?? 'unbekannt' }}</h2>
      </div>
      <p
        class="rounded-xl px-3 py-1 font-display text-2xl font-extrabold tabular-nums"
        :class="outcome === 'win' ? 'bg-[#e4f1e7] text-forest' : outcome === 'loss' ? 'bg-[#fbeee6] text-[#9a3b12]' : 'bg-[#eef1ea] text-ink'"
        :aria-label="`Ergebnis ${scoreLabel(match)}`"
      >
        {{ scoreLabel(match) }}
      </p>
    </header>

    <section v-if="categories.length" class="mt-5" aria-label="Mannschaftswerte">
      <div class="mb-1 grid grid-cols-[1fr_4rem_4rem] gap-2 text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">
        <span>Mannschaft</span><span class="text-right">Wir</span><span class="text-right">Gegner</span>
      </div>
      <div v-for="group in categories" :key="group.category" class="border-t border-[#eef0ea] py-2">
        <p class="mb-1 text-[11px] font-semibold text-[#5b625d]">{{ categoryLabel(group.category) }}</p>
        <div v-for="row in group.rows" :key="row.statType" class="grid grid-cols-[1fr_4rem_4rem] gap-2 text-sm">
          <span class="text-ink">{{ statLabel(row.statType) }}</span>
          <span class="text-right font-semibold tabular-nums text-ink">{{ row.own === null ? '–' : formatStatValue(row.statType, row.own) }}</span>
          <span class="text-right tabular-nums text-[#6c756f]">{{ row.opponent === null ? '–' : formatStatValue(row.statType, row.opponent) }}</span>
        </div>
      </div>
    </section>
    <p v-else class="mt-4 text-sm text-[#6c756f]">Veo hat zu diesem Spiel keine Mannschaftswerte geliefert.</p>

    <section v-if="rows.length" class="mt-5" aria-label="Spielerwerte">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">Spieler</h3>
        <label v-if="canAssign" class="flex min-h-11 items-center gap-2 text-xs text-[#5b625d]">
          <input v-model="applyToOthers" type="checkbox" class="h-4 w-4 accent-forest" />
          Neue Zuordnung auch in anderen Spielen übernehmen, in denen die Nummer noch offen ist
        </label>
      </div>
      <PlayerboardVeoPlayerTable :rows="rows" :caption="`Spielerwerte gegen ${match.opponentName ?? 'unbekannt'}`">
        <template v-if="canAssign" #label="{ row }">
          <label class="flex items-center gap-2">
            <span class="w-8 tabular-nums text-[#7b827d]">#{{ row.key }}</span>
            <span class="sr-only">Spieler für Rückennummer {{ row.key }}</span>
            <select
              class="focus-ring h-9 max-w-48 rounded-lg border border-[#dfe0d9] bg-white px-2 text-xs font-normal text-ink"
              :value="assignedPlayer.get(row.key) ?? ''"
              :disabled="savingJersey !== null"
              @change="choose(Number(row.key), ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Nicht zugeordnet</option>
              <option v-for="option in rosterOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
            </select>
          </label>
        </template>
      </PlayerboardVeoPlayerTable>
      <p v-if="message" class="mt-2 text-xs text-forest" role="status">{{ message }}</p>
      <p v-if="errorMessage" class="mt-2 text-xs text-amber-800" role="alert">{{ errorMessage }}</p>
    </section>
  </article>
</template>
