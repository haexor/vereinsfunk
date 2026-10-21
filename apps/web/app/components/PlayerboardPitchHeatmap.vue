<script setup lang="ts">
import { HEATMAP_HEIGHT, HEATMAP_WIDTH, heatmapFocusThird, renderHeatmap } from '@vereinsfunk/domain'

// Spec 002, PR 2: Heatmap auf dem Spielfeld, gezeichnet nach Veos Rezept (packages/domain
// renderHeatmap) auf ein Canvas 400 x 200 unter den Feldlinien. Textersatz: Schwerpunkt-Drittel.
const props = defineProps<{ grid: Float32Array | null; label: string; width?: number; height?: number }>()

const CANVAS_WIDTH = 400
const CANVAS_HEIGHT = 200
const THIRD_LABELS = { defensive: 'Verteidigungsdrittel', middle: 'Mitteldrittel', attacking: 'Angriffsdrittel' } as const

const canvas = ref<HTMLCanvasElement | null>(null)
const description = computed(() => {
  if (!props.grid) return `${props.label}: keine Daten`
  const third = heatmapFocusThird(props.grid, props.width ?? HEATMAP_WIDTH)
  return third ? `${props.label}: Schwerpunkt im ${THIRD_LABELS[third]}` : `${props.label}: keine Daten`
})

function draw() {
  const context = canvas.value?.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  if (!props.grid) return
  const pixels = renderHeatmap(props.grid, props.width ?? HEATMAP_WIDTH, props.height ?? HEATMAP_HEIGHT, CANVAS_WIDTH, CANVAS_HEIGHT)
  context.putImageData(new ImageData(pixels, CANVAS_WIDTH, CANVAS_HEIGHT), 0, 0)
}
onMounted(draw)
watch(() => props.grid, draw)
</script>

<template>
  <PlayerboardPitch :label="description">
    <template #underlay>
      <canvas ref="canvas" :width="CANVAS_WIDTH" :height="CANVAS_HEIGHT" class="h-full w-full" aria-hidden="true" />
    </template>
  </PlayerboardPitch>
</template>
