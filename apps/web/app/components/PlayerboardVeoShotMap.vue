<script setup lang="ts">
import type { PlayerboardVeoMatchAnalysis } from '@vereinsfunk/contracts'
import { matchMinute, shotsFromEvents, shotSummary, type VeoShot } from '@vereinsfunk/domain'
import { percentLabel, veoVideoLink } from '../utils/playerboardVeoAnalysis'

// Spec 002, PR 2: Schusskarte beider Mannschaften (Inventar §1a.7). Jede Mannschaft greift nach
// rechts an. Tor = gefuellter grosser Kreis, Schuss ohne Tor = Ring (FR-067). Jeder Marker oeffnet
// das Veo-Video 3 s vor dem Abschluss in einem neuen Tab (R-11). Bei der eigenen Mannschaft links die
// Spieler mit Abschluessen wie Veos "Shots by player" (Inventar §3.8).
const props = defineProps<{
  analysis: Pick<PlayerboardVeoMatchAnalysis, 'events' | 'periods' | 'veoUrl'>
  ownLabel: string
  opponentLabel: string
  playerLabel: (team: 'own' | 'opponent', jerseyNumber: number | null) => string
}>()

const period = ref<number | null>(null)
const team = ref<'own' | 'opponent'>('own')
const focus = ref<'all' | 'goals' | 'shots'>('all')

const allShots = computed(() => shotsFromEvents(props.analysis.events))
const player = ref<string | null>(null)
watch(team, () => { player.value = null })
const playerOptions = computed(() => {
  const counts = new Map<number, number>()
  for (const shot of allShots.value) {
    if (shot.team !== 'own' || shot.jerseyNumber === null || (period.value !== null && shot.periodNumber !== period.value)) continue
    counts.set(shot.jerseyNumber, (counts.get(shot.jerseyNumber) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([jersey, count]) => ({ key: String(jersey), name: props.playerLabel('own', jersey), score: count }))
})
const shots = computed(() => allShots.value.filter((shot) => shot.team === team.value
  && (period.value === null || shot.periodNumber === period.value)
  && (team.value !== 'own' || player.value === null || String(shot.jerseyNumber) === player.value)))
const summary = computed(() => shotSummary(shots.value))
const located = computed(() => shots.value.filter((shot) => shot.x !== null && shot.y !== null))
const missing = computed(() => shots.value.filter((shot) => shot.x === null || shot.y === null))

const minute = (shot: VeoShot) => matchMinute(props.analysis.periods, shot.periodNumber, shot.periodTimeMs)
const title = (shot: VeoShot) => `${shot.goal ? 'Tor' : 'Schuss'} ${props.playerLabel(shot.team, shot.jerseyNumber)}, ${minute(shot)}. Minute`
const dimmed = (shot: VeoShot) => (focus.value === 'goals' && !shot.goal) || (focus.value === 'shots' && shot.goal)
const toggle = (value: 'goals' | 'shots') => { focus.value = focus.value === value ? 'all' : value }
const chipClass = (active: boolean) => ['focus-ring min-h-11 rounded-xl border px-3 text-left', active ? 'border-forest bg-[#e4f1e7]' : 'border-[#dfe0d9] bg-white']
const selectedName = computed(() => playerOptions.value.find((option) => option.key === player.value)?.name ?? null)
const label = computed(() => `Schusskarte ${team.value === 'own' ? selectedName.value ?? props.ownLabel : props.opponentLabel}: ${summary.value.goals} Tore, ${summary.value.shots} Schüsse ohne Tor, ${summary.value.total} Abschlüsse`)
</script>

<template>
  <div>
    <PlayerboardVeoPanelFilters v-model:period="period" v-model:team="team" :periods="analysis.periods" :own-label="ownLabel" :opponent-label="opponentLabel" />
    <PlayerboardVeoMapPlayers v-model="player" :enabled="team === 'own' && playerOptions.length > 0" :options="playerOptions" label="Abschlüsse nach Spieler">
      <div class="mb-3 grid grid-cols-3 gap-2 text-xs">
        <button type="button" :class="chipClass(focus === 'goals')" :aria-pressed="focus === 'goals'" @click="toggle('goals')">
          <span class="block font-display text-xl font-extrabold text-ink">{{ summary.goals }}</span>Tore
        </button>
        <button type="button" :class="chipClass(focus === 'shots')" :aria-pressed="focus === 'shots'" @click="toggle('shots')">
          <span class="block font-display text-xl font-extrabold text-ink">{{ summary.shots }}</span>Schüsse ohne Tor
        </button>
        <div class="rounded-xl border border-[#dfe0d9] bg-white px-3 py-2">
          <span class="block font-display text-xl font-extrabold text-ink">{{ summary.total }}</span>Abschlüsse
        </div>
      </div>

      <PlayerboardPitch :label="label">
        <template #default="{ px, py }">
          <a
            v-for="shot in located"
            :key="shot.id"
            :href="veoVideoLink(analysis.veoUrl, shot.videoTimeMs) ?? undefined"
            target="_blank"
            rel="noopener"
            :opacity="dimmed(shot) ? 0.25 : 1"
          >
            <title>{{ title(shot) }}<template v-if="analysis.veoUrl"> – im Veo-Video öffnen</template></title>
            <circle v-if="shot.goal" :cx="px(shot.x!)" :cy="py(shot.y!)" r="3.4" fill="#ffd54a" stroke="#1b1b1b" stroke-width="0.8" />
            <circle v-else :cx="px(shot.x!)" :cy="py(shot.y!)" r="2.4" fill="none" stroke="#ffffff" stroke-width="1" />
          </a>
        </template>
      </PlayerboardPitch>
      <p class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5b625d]" aria-hidden="true">
        <span class="flex items-center gap-1"><span class="h-3 w-3 rounded-full border border-black bg-[#ffd54a]" />Tor</span>
        <span class="flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full border-2 border-[#9aa19c]" />Schuss ohne Tor</span>
      </p>

      <ul class="mt-3 space-y-1 text-sm text-ink">
        <li>{{ percentLabel(summary.conversionRate) }} Torquote</li>
        <li>Torquote im Strafraum: {{ percentLabel(summary.insideBoxConversionRate) }}, außerhalb: {{ percentLabel(summary.outsideBoxConversionRate) }}</li>
        <li>{{ percentLabel(summary.insideBoxShare) }} der Abschlüsse im Strafraum, {{ percentLabel(summary.outsideBoxShare) }} außerhalb</li>
      </ul>
    </PlayerboardVeoMapPlayers>
    <div v-if="missing.length" class="mt-3">
      <p class="text-xs font-semibold text-[#5b625d]">Abschlüsse ohne Ort</p>
      <ul class="mt-1 flex flex-wrap gap-2">
        <li v-for="shot in missing" :key="shot.id">
          <a
            v-if="analysis.veoUrl"
            :href="veoVideoLink(analysis.veoUrl, shot.videoTimeMs)!"
            target="_blank"
            rel="noopener"
            class="focus-ring inline-flex min-h-11 items-center rounded-xl border border-[#dfe0d9] bg-white px-3 text-xs text-ink"
          >{{ title(shot) }}</a>
          <span v-else class="inline-flex min-h-11 items-center rounded-xl border border-[#dfe0d9] bg-white px-3 text-xs text-ink">{{ title(shot) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
