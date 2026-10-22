<script setup lang="ts">
import type { PlayerboardVeoSeasonMatch } from '@vereinsfunk/contracts'
import { shotsFromEvents } from '@vereinsfunk/domain'
import { percentLabel, veoVideoLink } from '../utils/playerboardVeoAnalysis'

// Spec 002, PR 4: Schusskarte ueber die gefilterten Spiele (Inventar §1b.4). "Angriff" zeigt die
// eigenen Abschluesse (Spielrichtung nach rechts), "Verteidigung" die des Gegners, gespiegelt
// (Spielrichtung nach links). Wie Veo sind zuerst nur die Tore gewaehlt.
const props = defineProps<{ matches: readonly PlayerboardVeoSeasonMatch[]; ownLabel: string }>()

const side = ref<'attacking' | 'defending'>('attacking')
const show = ref<{ goals: boolean; shots: boolean }>({ goals: true, shots: false })

const allShots = computed(() => props.matches.flatMap((match) => shotsFromEvents(match.shots).map((shot) => ({ ...shot, match }))))
const shots = computed(() => allShots.value.filter((shot) => shot.team === (side.value === 'attacking' ? 'own' : 'opponent')))
const goals = computed(() => shots.value.filter((shot) => shot.goal).length)
const missed = computed(() => shots.value.length - goals.value)
const conversion = computed(() => (shots.value.length ? Math.round((goals.value / shots.value.length) * 100) : null))
const visible = computed(() => shots.value.filter((shot) => shot.x !== null && shot.y !== null && (shot.goal ? show.value.goals : show.value.shots)))
const missing = computed(() => shots.value.filter((shot) => shot.x === null || shot.y === null))
const mirror = (value: number) => (side.value === 'defending' ? 1 - value : value)

const dateLabel = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' })
const title = (shot: (typeof allShots.value)[number]) =>
  `${shot.goal ? 'Tor' : 'Schuss'} gegen ${shot.match.opponentName ?? 'unbekannt'} am ${dateLabel.format(new Date(shot.match.kickoffAt))}`
const chipClass = (active: boolean) => ['focus-ring min-h-11 rounded-xl border px-3 text-left text-xs', active ? 'border-forest bg-[#e4f1e7]' : 'border-[#dfe0d9] bg-white']
const label = computed(() => `Schusskarte ${side.value === 'attacking' ? props.ownLabel : 'Gegner'}: ${goals.value} Tore, ${missed.value} Schüsse ohne Tor`)
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap gap-2" role="group" aria-label="Seite">
      <button type="button" :class="chipClass(side === 'attacking')" :aria-pressed="side === 'attacking'" @click="side = 'attacking'">Angriff</button>
      <button type="button" :class="chipClass(side === 'defending')" :aria-pressed="side === 'defending'" @click="side = 'defending'">Verteidigung</button>
    </div>
    <div class="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <button type="button" :class="chipClass(show.goals)" :aria-pressed="show.goals" @click="show = { ...show, goals: !show.goals }">
        <span class="block font-display text-xl font-extrabold text-ink">{{ goals }}</span>Tore
      </button>
      <button type="button" :class="chipClass(show.shots)" :aria-pressed="show.shots" @click="show = { ...show, shots: !show.shots }">
        <span class="block font-display text-xl font-extrabold text-ink">{{ missed }}</span>Schüsse ohne Tor
      </button>
      <div class="rounded-xl border border-[#dfe0d9] bg-white px-3 py-2 text-xs"><span class="block font-display text-xl font-extrabold text-ink">{{ shots.length }}</span>Abschlüsse</div>
      <div class="rounded-xl border border-[#dfe0d9] bg-white px-3 py-2 text-xs"><span class="block font-display text-xl font-extrabold text-ink">{{ percentLabel(conversion) }}</span>Torquote</div>
    </div>
    <PlayerboardPitch :label="label" :direction="false">
      <template #default="{ px, py }">
        <a v-for="shot in visible" :key="`${shot.match.fixtureId}:${shot.id}`" :href="veoVideoLink(shot.match.veoUrl, shot.videoTimeMs) ?? undefined" target="_blank" rel="noopener">
          <title>{{ title(shot) }}</title>
          <circle v-if="shot.goal" :cx="px(mirror(shot.x!))" :cy="py(mirror(shot.y!))" r="3.4" fill="#ffd54a" stroke="#1b1b1b" stroke-width="0.8" />
          <circle v-else :cx="px(mirror(shot.x!))" :cy="py(mirror(shot.y!))" r="2.4" fill="none" stroke="#ffffff" stroke-width="1" />
        </a>
      </template>
    </PlayerboardPitch>
    <p class="mt-1 text-center text-[11px] text-[#6c756f]" aria-hidden="true">Spielrichtung {{ side === 'attacking' ? '→' : '←' }}</p>
    <p v-if="shots.length === 0" class="mt-2 text-sm text-[#6c756f]">Veo hat in diesen Spielen keine Abschlüsse erkannt.</p>
    <p v-else-if="missing.length" class="mt-2 text-xs text-[#6c756f]">{{ missing.length }} Abschlüsse ohne Ort sind nicht auf der Karte.</p>
  </div>
</template>
