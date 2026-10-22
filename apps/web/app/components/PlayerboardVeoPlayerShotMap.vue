<script setup lang="ts">
import { percentLabel } from '../utils/playerboardVeoAnalysis'
import type { PlayerShotMarker } from '../utils/playerboardVeoPlayers'

// Spec 002, PR 3: Schusskarte eines Spielers im Halbfeld wie Veos Spielerkarte (Inventar §2.3
// "Maps"): Tore gefuellt, Schuesse ohne Tor als Ring; darunter Tore, Schuesse, Abschluesse und
// Torquote. Ein Klick oeffnet die Stelle im Veo-Video. Abschluesse ohne Ort zaehlen mit.
const props = withDefaults(defineProps<{ shots: readonly PlayerShotMarker[]; label: string; withSummary?: boolean }>(), { withSummary: true })

const goals = computed(() => props.shots.filter((shot) => shot.goal).length)
const conversion = computed(() => (props.shots.length ? Math.round((goals.value / props.shots.length) * 100) : null))
const located = computed(() => props.shots.filter((shot) => shot.x !== null && shot.y !== null))
const missing = computed(() => props.shots.length - located.value.length)
const summary = computed(() => [
  { label: 'Tore', value: String(goals.value) },
  { label: 'Schüsse', value: String(props.shots.length - goals.value) },
  { label: 'Abschlüsse', value: String(props.shots.length) },
  { label: 'Torquote', value: percentLabel(conversion.value) },
])
</script>

<template>
  <div>
    <PlayerboardPitch half :label="`${label}: ${goals} Tore, ${shots.length - goals} Schüsse ohne Tor`">
      <template #default="{ px, py }">
        <a v-for="shot in located" :key="shot.key" :href="shot.href ?? undefined" target="_blank" rel="noopener">
          <title>{{ shot.title }}</title>
          <circle v-if="shot.goal" :cx="px(shot.x!)" :cy="py(shot.y!)" r="3.4" fill="#ffd54a" stroke="#1b1b1b" stroke-width="0.8" />
          <circle v-else :cx="px(shot.x!)" :cy="py(shot.y!)" r="2.4" fill="none" stroke="#ffffff" stroke-width="1" />
        </a>
      </template>
    </PlayerboardPitch>
    <dl v-if="withSummary" class="mt-3 grid grid-cols-4 gap-2 text-center">
      <div v-for="entry in summary" :key="entry.label" class="rounded-xl bg-[#f7f8f4] px-1 py-2">
        <dt class="text-[10px] text-[#5b625d]">{{ entry.label }}</dt>
        <dd class="font-display text-lg font-extrabold tabular-nums text-ink">{{ entry.value }}</dd>
      </div>
    </dl>
    <p v-if="shots.length === 0" class="mt-2 text-sm text-[#6c756f]">Veo hat keine Tore oder Schüsse erkannt.</p>
    <p v-else-if="missing" class="mt-2 text-xs text-[#6c756f]">{{ missing }} {{ missing === 1 ? 'Abschluss' : 'Abschlüsse' }} ohne Ort {{ missing === 1 ? 'ist' : 'sind' }} nicht auf der Karte.</p>
  </div>
</template>
