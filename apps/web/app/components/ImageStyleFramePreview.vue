<script setup lang="ts">
import type { ImageStyleFrameStyle } from '@vereinsfunk/contracts'

const props = withDefaults(defineProps<{
  frameStyle: ImageStyleFrameStyle | null
  widthPx?: number
  cornerRadiusPx?: number | null
  colorHex?: string
  photoFilterCss?: string
}>(), {
  widthPx: 8,
  colorHex: '#163a2c',
})

// Rein kosmetische CSS-Naeherung, wie schon die bisherige Live-Vorschau (Rahmen/Filter entstehen
// serverseitig per Sharp, siehe apps/api/src/imageStyle.ts) -- hier zusaetzlich mit einem
// Dummy-/Symbolbild statt eines abstrakten Farbverlaufs, damit ein Rahmen ueberhaupt an einem
// Foto-aehnlichen Motiv erkennbar ist. Wird fuer die grosse Live-Vorschau (ImageStyleLivePreview.vue,
// frameStyle darf dort null sein -- kein/eigener Rahmen braucht keine CSS-Umrandung) UND die kleinen
// Stil-Galerie-Kacheln in ImageStylePresetForm.vue genutzt.
const outerStyle = computed(() => ({ borderRadius: props.cornerRadiusPx ? `${props.cornerRadiusPx}px` : undefined }))

const frameStyleObject = computed(() => {
  const w = props.widthPx
  const color = props.colorHex
  switch (props.frameStyle) {
    case 'solid':
      return { border: `${w}px solid ${color}` }
    case 'double':
      return { borderStyle: 'double', borderWidth: `${Math.max(w, 3) * 3}px`, borderColor: color }
    case 'bottom_bar':
      return { borderStyle: 'solid', borderWidth: `${w}px ${w}px ${w * 4}px ${w}px`, borderColor: color }
    case 'corner_marks':
    case null:
      return {}
  }
})

function cornerMarkStyle(vertical: 'top' | 'bottom', horizontal: 'left' | 'right'): Record<string, string> {
  const edge = `${props.widthPx}px solid ${props.colorHex}`
  return { [`border-${vertical}`]: edge, [`border-${horizontal}`]: edge }
}
</script>

<template>
  <div class="relative aspect-square w-full overflow-hidden bg-[#eef1ea]" :style="[outerStyle, frameStyleObject]">
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" class="absolute inset-0 h-full w-full" :style="photoFilterCss ? { filter: photoFilterCss } : undefined">
      <rect width="100" height="100" fill="#dfe6da" />
      <circle cx="72" cy="24" r="10" fill="#f4e9b8" />
      <path d="M0 74 L26 46 L44 60 L64 36 L100 70 L100 100 L0 100 Z" fill="#8fae86" />
      <path d="M0 86 L20 68 L40 80 L58 62 L100 86 L100 100 L0 100 Z" fill="#4f6e56" />
    </svg>
    <template v-if="frameStyle === 'corner_marks'">
      <span class="absolute left-0 top-0 h-1/4 w-1/4" :style="cornerMarkStyle('top', 'left')" />
      <span class="absolute right-0 top-0 h-1/4 w-1/4" :style="cornerMarkStyle('top', 'right')" />
      <span class="absolute bottom-0 left-0 h-1/4 w-1/4" :style="cornerMarkStyle('bottom', 'left')" />
      <span class="absolute bottom-0 right-0 h-1/4 w-1/4" :style="cornerMarkStyle('bottom', 'right')" />
    </template>
    <slot />
  </div>
</template>
