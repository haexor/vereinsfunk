<script setup lang="ts">
import { playerMetricDefinition, seasonPlayerRows } from '@vereinsfunk/domain'
import type { PersonProfileVeoMatch } from '@vereinsfunk/contracts'
import { formatPlayerMetric } from '../utils/playerboardVeoPlayers'

// Saisonwerte einer Person im Profil. Die Rohwerte je Spiel werden mit derselben Domainlogik
// aggregiert wie die Veo-Saisonsicht: Summen, Maximum fuer Hoechstgeschwindigkeit und gewichtete
// Durchschnittsgeschwindigkeit.
const props = defineProps<{ matches: readonly PersonProfileVeoMatch[] }>()

const PROFILE_SECTIONS = [
  { label: 'Allgemein', metrics: ['matches', 'starts', 'captaincies', 'player_of_the_match', 'minutes_played', 'total_events'] },
  { label: 'Angriff', metrics: ['goals', 'assists', 'goal_involvements', 'conversion_rate', 'shots', 'total_attempts', 'dribbles'] },
  { label: 'Verteidigung', metrics: ['tackles', 'duels', 'interceptions', 'loose_ball_recoveries', 'recoveries'] },
  { label: 'Verteilung', metrics: ['passes', 'passes_successful', 'passes_unsuccessful', 'passes_success_rate'] },
  { label: 'Standardsituationen', metrics: ['corners', 'free_kicks', 'fouls', 'penalty_kicks', 'goal_kicks', 'throw_ins'] },
  { label: 'Torwartspiel', metrics: ['saves'] },
] as const
const PROFILE_PHYSICAL = ['distance_covered', 'average_speed', 'top_speed', 'sprints', 'high_intensity_runs'] as const

const values = computed(() => {
  const row = seasonPlayerRows(props.matches.map((match) => ({
    players: [{
      jerseyNumber: match.jerseyNumber,
      playerId: 'profile-player',
      personId: null,
      name: null,
      stats: match.stats,
    }],
  })))[0]
  return row?.values ?? {}
})

const sections = computed(() => PROFILE_SECTIONS.map((section) => ({
  label: section.label,
  rows: section.metrics
    .map((id) => ({ id, label: playerMetricDefinition(id)?.label ?? id, value: values.value[id] }))
    .filter((entry) => entry.value !== undefined),
})).filter((section) => section.rows.length > 0))

const physical = computed(() => PROFILE_PHYSICAL
  .map((id) => ({ id, label: playerMetricDefinition(id)?.label ?? id, value: values.value[id] }))
  .filter((entry) => entry.value !== undefined))
</script>

<template>
  <section class="mt-4 border-t border-[#eef0ea] pt-4" aria-label="Veo-Statistiken">
    <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">Veo-Statistiken</h3>
      <span v-if="matches.length" class="text-[11px] text-[#6c756f]">{{ matches.length }} {{ matches.length === 1 ? 'Spiel' : 'Spiele' }}</span>
    </div>
    <template v-if="matches.length && (sections.length || physical.length)">
      <dl class="grid grid-cols-2 gap-2">
        <div v-for="entry in physical" :key="entry.id" class="rounded-xl bg-[#f7f8f4] p-2.5">
          <dt class="text-[11px] text-[#5b625d]">{{ entry.label }}</dt>
          <dd class="font-display text-lg font-extrabold tabular-nums text-ink">{{ formatPlayerMetric(entry.id, entry.value) }}</dd>
        </div>
      </dl>
      <div v-for="section in sections" :key="section.label" class="mt-3">
        <h4 class="mb-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">{{ section.label }}</h4>
        <dl class="grid gap-1 text-xs sm:grid-cols-2">
          <div v-for="entry in section.rows" :key="entry.id" class="flex justify-between gap-2 border-b border-[#f0f1eb] py-1">
            <dt class="truncate text-[#5b625d]">{{ entry.label }}</dt>
            <dd class="shrink-0 font-semibold tabular-nums text-ink">{{ formatPlayerMetric(entry.id, entry.value) }}</dd>
          </div>
        </dl>
      </div>
    </template>
    <p v-else class="text-xs text-[#6c756f]">Für diesen Zeitraum liegen keine Veo-Spielerwerte vor.</p>
  </section>
</template>
