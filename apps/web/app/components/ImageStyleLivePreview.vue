<script setup lang="ts">
import type { ImageStyleFilter, ImageStyleLogoPosition } from '@vereinsfunk/contracts'

const props = defineProps<{
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
// Rahmen, Duoton-Neueinfaerbung) entsteht erst in Plan 045, PR 2. Diese Vorschau zeigt nur, in
// welche Richtung ein Preset wirkt, nicht das spaetere Ergebnis exakt.
const FILTER_CSS: Record<ImageStyleFilter, string> = {
  original: 'none',
  schwarz_weiss: 'grayscale(1)',
  kontrastreich: 'contrast(1.35) saturate(1.2)',
  warm: 'sepia(.35) saturate(1.15)',
  vereinsfarben_duoton: 'grayscale(1) contrast(1.1)',
}

const photoStyle = computed(() => ({ filter: FILTER_CSS[props.filter] }))
const duotoneOverlayStyle = computed(() => ({
  background: `linear-gradient(135deg, ${props.primaryColor}, ${props.accentColor})`,
  mixBlendMode: 'color' as const,
}))
const frameStyle = computed(() => ({
  border: props.frameWidthPx ? `${props.frameWidthPx}px solid ${props.frameColorHex}` : undefined,
  borderRadius: props.frameCornerRadiusPx ? `${props.frameCornerRadiusPx}px` : undefined,
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
    <div class="relative mt-4 aspect-square overflow-hidden rounded-2xl" :style="frameStyle">
      <div class="relative h-full w-full overflow-hidden bg-gradient-to-br from-[#8fae86] to-[#4f6e56]" :style="photoStyle">
        <div v-if="filter === 'vereinsfarben_duoton'" class="absolute inset-0" :style="duotoneOverlayStyle" />
        <img v-if="customFrameUrl" :src="customFrameUrl" alt="" class="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90" />
      </div>
      <img v-if="logoEnabled && logoUrl" :src="logoUrl" alt="Logo" class="absolute rounded bg-white/80 object-contain p-1" :class="LOGO_POSITION_CLASSES[logoPosition]" :style="logoStyle" />
    </div>
  </section>
</template>
