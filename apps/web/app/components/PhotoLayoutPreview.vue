<script setup lang="ts">
import type { PhotoLayoutKind } from '@vereinsfunk/contracts'

const props = withDefaults(defineProps<{
  kind: PhotoLayoutKind
  dividerColorHex?: string
  dividerWidthPx?: number
}>(), {
  dividerColorHex: '#163a2c',
  dividerWidthPx: 6,
})

// Rein kosmetische CSS-Naeherung mit Platzhalterfarben statt echter Fotos -- das eigentliche
// Kompositionsergebnis entsteht serverseitig per Sharp (apps/api/src/photoLayout.ts). Dieselbe
// Rolle wie ImageStyleFramePreview.vue fuer Rahmenstile: Galerie-Kachel UND grosse Live-Vorschau
// nutzen dieselbe Komponente.
const TILE_COLORS = ['#8fae86', '#4f6e56', '#c7d6bf', '#a9c29c']
const gapStyle = computed(() => ({ gap: `${props.dividerWidthPx}px`, backgroundColor: props.dividerColorHex }))
</script>

<template>
  <div class="relative aspect-square w-full overflow-hidden bg-[#eef1ea]">
    <div v-if="kind === 'grid_2x2'" class="grid h-full w-full grid-cols-2 grid-rows-2" :style="gapStyle">
      <div v-for="index in 4" :key="index" :style="{ backgroundColor: TILE_COLORS[index - 1] }" />
    </div>
    <div v-else-if="kind === 'mixed_grid'" class="grid h-full w-full grid-cols-[3fr_2fr]" :style="gapStyle">
      <div :style="{ backgroundColor: TILE_COLORS[0] }" />
      <div class="grid grid-rows-2" :style="gapStyle">
        <div :style="{ backgroundColor: TILE_COLORS[1] }" />
        <div :style="{ backgroundColor: TILE_COLORS[2] }" />
      </div>
    </div>
    <svg v-else viewBox="0 0 100 100" preserveAspectRatio="none" class="absolute inset-0 h-full w-full">
      <polygon points="0,0 100,0 100,100" :fill="TILE_COLORS[0]" />
      <polygon points="0,0 0,100 100,100" :fill="TILE_COLORS[1]" />
      <line x1="0" y1="0" x2="100" y2="100" :stroke="dividerColorHex" :stroke-width="Math.max(dividerWidthPx / 4, 1)" />
    </svg>
  </div>
</template>
