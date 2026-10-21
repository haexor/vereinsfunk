<script setup lang="ts">
// Spec 002, PR 2: Spielfeld der Veo-Grafiken, Masse wie Veos Schusskarte (234 x 150, Inventar
// §1a.7). Markierungen kommen ueber den Slot in normierten Koordinaten: x laengs, die Mannschaft
// greift nach rechts an; y quer, y = 1 oben -- wie die Zeilen der Veo-Matrizen.
// ponytail: nur das volle Feld mit Drittel-Linien; Halbfeld, Querformat und weitere Zonen folgen
// mit Spielerkarte und Spielbericht (tasks.md T033).
const props = withDefaults(defineProps<{ label: string; thirds?: boolean; direction?: boolean }>(), { thirds: false, direction: true })

const WIDTH = 234
const HEIGHT = 150
// Strafraum und Torraum aus Veos Schusskarte; Rest in Metern auf 105 x 68 umgerechnet.
const BOX_DEPTH = 35.868
const BOX_TOP = 31.4706
const BOX_BOTTOM = 118.529
const GOAL_AREA_DEPTH = 12.26
const GOAL_AREA_TOP = 54.8
const GOAL_AREA_BOTTOM = 95.2
const CIRCLE_RADIUS = 20.2
const SPOT = 24.5

const px = (x: number) => Math.min(1, Math.max(0, x)) * WIDTH
const py = (y: number) => (1 - Math.min(1, Math.max(0, y))) * HEIGHT
defineSlots<{ default?: (props: { px: typeof px; py: typeof py }) => unknown; underlay?: () => unknown }>()
const titleId = useId()
</script>

<template>
  <figure class="relative w-full">
    <div class="relative w-full overflow-hidden rounded-xl bg-[#1f4d36]" :style="{ aspectRatio: `${WIDTH} / ${HEIGHT}` }">
      <div class="absolute inset-0"><slot name="underlay" /></div>
      <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" class="absolute inset-0 h-full w-full" role="img" :aria-labelledby="titleId">
        <title :id="titleId">{{ props.label }}</title>
        <g fill="none" stroke="rgba(255,255,255,.55)" stroke-width="0.8">
          <rect x="0.4" y="0.4" :width="WIDTH - 0.8" :height="HEIGHT - 0.8" />
          <line :x1="WIDTH / 2" y1="0" :x2="WIDTH / 2" :y2="HEIGHT" />
          <circle :cx="WIDTH / 2" :cy="HEIGHT / 2" :r="CIRCLE_RADIUS" />
          <rect x="0" :y="BOX_TOP" :width="BOX_DEPTH" :height="BOX_BOTTOM - BOX_TOP" />
          <rect :x="WIDTH - BOX_DEPTH" :y="BOX_TOP" :width="BOX_DEPTH" :height="BOX_BOTTOM - BOX_TOP" />
          <rect x="0" :y="GOAL_AREA_TOP" :width="GOAL_AREA_DEPTH" :height="GOAL_AREA_BOTTOM - GOAL_AREA_TOP" />
          <rect :x="WIDTH - GOAL_AREA_DEPTH" :y="GOAL_AREA_TOP" :width="GOAL_AREA_DEPTH" :height="GOAL_AREA_BOTTOM - GOAL_AREA_TOP" />
        </g>
        <g fill="rgba(255,255,255,.55)">
          <circle :cx="WIDTH / 2" :cy="HEIGHT / 2" r="1" />
          <circle :cx="SPOT" :cy="HEIGHT / 2" r="0.9" />
          <circle :cx="WIDTH - SPOT" :cy="HEIGHT / 2" r="0.9" />
        </g>
        <g v-if="props.thirds" stroke="rgba(255,255,255,.45)" stroke-width="0.8" stroke-dasharray="3 3">
          <line :x1="WIDTH / 3" y1="0" :x2="WIDTH / 3" :y2="HEIGHT" />
          <line :x1="(WIDTH * 2) / 3" y1="0" :x2="(WIDTH * 2) / 3" :y2="HEIGHT" />
        </g>
        <slot :px="px" :py="py" />
      </svg>
    </div>
    <figcaption v-if="props.direction" class="mt-1 text-center text-[11px] text-[#6c756f]" aria-hidden="true">Spielrichtung →</figcaption>
  </figure>
</template>
