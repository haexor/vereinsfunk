<script setup lang="ts">
import type { ImageStyleFilter, ImageStyleFrameStyle, ImageStyleFrameType, ImageStyleLogoPosition } from '@vereinsfunk/contracts'

const props = defineProps<{
  frameType: ImageStyleFrameType
  frameStyle: ImageStyleFrameStyle | null
  frameWidthPx: number | null
  frameCornerRadiusPx: number | null
  frameColorHex: string
  customFrameUrl: string
  logoEnabled: boolean
  logoUrl: string
  logoPosition: ImageStyleLogoPosition
  logoSizePercent: number | null
  logoMarginPercent: number | null
  filter: ImageStyleFilter
  primaryColor: string
  accentColor: string
}>()

// Rein kosmetische Annaeherung per CSS -- das echte Pixel-Rezept (Sharp-Compositing, parametrischer
// Rahmen, Duoton-Neueinfaerbung) entsteht serverseitig, siehe apps/api/src/imageStyle.ts. Die
// Rahmen-/Dummybild-Darstellung selbst kommt aus ImageStyleFramePreview.vue (auch von der
// Stil-Galerie in ImageStylePresetForm.vue genutzt); hier kommen nur Filter/Duoton/Logo/eigene
// Rahmengrafik als Overlays dazu.
const FILTER_CSS: Record<ImageStyleFilter, string> = {
  original: 'none',
  schwarz_weiss: 'grayscale(1)',
  kontrastreich: 'contrast(1.35) saturate(1.2)',
  warm: 'sepia(.35) saturate(1.15)',
  vereinsfarben_duoton: 'grayscale(1) contrast(1.1)',
}
const photoFilterCss = computed(() => FILTER_CSS[props.filter])
const duotoneOverlayStyle = computed(() => ({
  background: `linear-gradient(135deg, ${props.primaryColor}, ${props.accentColor})`,
  mixBlendMode: 'color' as const,
}))
const LOGO_POSITION_CLASSES: Record<ImageStyleLogoPosition, string> = {
  bottom_right: 'bottom-0 right-0',
  bottom_left: 'bottom-0 left-0',
  top_right: 'top-0 right-0',
  top_left: 'top-0 left-0',
  center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
}
const logoStyle = computed(() => ({
  width: `${props.logoSizePercent ?? 12}%`,
  margin: `${props.logoMarginPercent ?? 4}%`,
}))
</script>

<template>
  <section class="card p-6">
    <h2 class="font-display text-base font-bold">Live-Vorschau</h2>
    <p class="mt-1 text-[11px] text-[#9aa096]">Näherung per CSS — das endgültige Bild entsteht serverseitig (Rahmen/Logo/Filter-Rendering).</p>
    <ImageStyleFramePreview
      class="mt-4 rounded-2xl"
      :frame-style="frameType === 'parametric' ? frameStyle : null"
      :width-px="frameWidthPx ?? undefined"
      :corner-radius-px="frameCornerRadiusPx"
      :color-hex="frameColorHex"
      :photo-filter-css="photoFilterCss"
    >
      <div v-if="filter === 'vereinsfarben_duoton'" class="absolute inset-0" :style="duotoneOverlayStyle" />
      <img v-if="customFrameUrl" :src="customFrameUrl" alt="" class="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90" />
      <img v-if="logoEnabled && logoUrl" :src="logoUrl" alt="Logo" class="absolute rounded bg-white/80 object-contain p-1" :class="LOGO_POSITION_CLASSES[logoPosition]" :style="logoStyle" />
    </ImageStyleFramePreview>
  </section>
</template>
