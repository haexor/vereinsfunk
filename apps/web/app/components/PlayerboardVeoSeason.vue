<script setup lang="ts">
import type { PlayerboardVeoTeamStat } from '@vereinsfunk/contracts'
import { formatStatValue, ownTeamTotals, playerSeasonRows, seasonRecord, statLabel, type PlayerStatRowInput } from '../utils/playerboardVeo'

// Paket 053, PR 3: Saison aus Veo-Sicht -- Bilanz, Tore, ausgewaehlte Mannschaftswerte und die
// Werte je Spieler. Intern mit Namen (nur zugeordnete Nummern), oeffentlich mit "#7 M. K.".
export interface VeoSeasonMatch {
  ownScore: number | null
  opponentScore: number | null
  teamStats: readonly PlayerboardVeoTeamStat[]
  players: readonly PlayerStatRowInput[]
}

const props = defineProps<{ matches: VeoSeasonMatch[]; compact?: boolean }>()

// Die Mannschaftswerte, die auf einen Blick etwas ueber die Saison sagen.
const KEY_TEAM_STATS = ['football_shots_total', 'football_corner_total', 'football_save_total', 'football_foul_total']

const record = computed(() => seasonRecord(props.matches))
const teamTotals = computed(() => ownTeamTotals(props.matches).filter((entry) => KEY_TEAM_STATS.includes(entry.statType)))
const players = computed(() => playerSeasonRows(props.matches))

</script>

<template>
  <div class="space-y-4">
    <dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="rounded-2xl bg-[#f7f8f4] p-3">
        <dt class="text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">Bilanz</dt>
        <dd class="mt-1 font-display text-lg font-extrabold text-ink">{{ record.wins }}–{{ record.draws }}–{{ record.losses }}</dd>
        <dd class="text-[11px] text-[#6c756f]">{{ record.games }} {{ record.games === 1 ? 'Spiel' : 'Spiele' }} · S–U–N</dd>
      </div>
      <div class="rounded-2xl bg-[#f7f8f4] p-3">
        <dt class="text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">Tore</dt>
        <dd class="mt-1 font-display text-lg font-extrabold text-ink">{{ record.goalsFor }}:{{ record.goalsAgainst }}</dd>
        <dd class="text-[11px] text-[#6c756f]">eigene : gegnerische</dd>
      </div>
      <div v-for="entry in compact ? [] : teamTotals.slice(0, 2)" :key="entry.statType" class="rounded-2xl bg-[#f7f8f4] p-3">
        <dt class="text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">{{ statLabel(entry.statType) }}</dt>
        <dd class="mt-1 font-display text-lg font-extrabold text-ink">{{ formatStatValue(entry.statType, entry.value) }}</dd>
        <dd class="text-[11px] text-[#6c756f]">in der Saison</dd>
      </div>
    </dl>
    <PlayerboardVeoPlayerTable :rows="players" caption="Veo-Werte je Spieler in der Saison" show-games />
  </div>
</template>
