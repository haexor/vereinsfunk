<script setup lang="ts">
import type { ImageStyleFrameStyle } from '@vereinsfunk/contracts'

const props = withDefaults(
  defineProps<{
    frameStyle: ImageStyleFrameStyle | null
    widthPx?: number
    cornerRadiusPx?: number | null
    colorHex?: string
    photoFilterCss?: string
    photoEffect?: 'comic' | 'konfetti'
  }>(),
  {
    widthPx: 8,
    colorHex: '#163a2c',
  },
)

// Rein kosmetische CSS-Naeherung (Rahmen/Filter entstehen serverseitig per Sharp, siehe
// apps/api/src/imageStyle.ts). Das bereitgestellte Mannschaftsfoto macht die Filterwirkung statt
// eines abstrakten Platzhalters sichtbar. Genutzt fuer die kleinen Rahmenstil-/Filter-Galerie-
// Kacheln in ImageStylePresetForm.vue -- die grosse Vorschau zeigt seit ImageStyleCanvasEditor.vue
// das echte, serverseitig gerenderte Ergebnis statt dieser Annaeherung.
const outerStyle = computed(() => ({
  borderRadius: props.cornerRadiusPx ? `${props.cornerRadiusPx}px` : undefined,
}))

const frameStyleObject = computed(() => {
  const w = props.widthPx
  const color = props.colorHex
  switch (props.frameStyle) {
    case 'solid':
      return { border: `${w}px solid ${color}` }
    case 'double':
      return { borderStyle: 'double', borderWidth: `${Math.max(w, 3) * 3}px`, borderColor: color }
    case 'bottom_bar':
      return {
        borderStyle: 'solid',
        borderWidth: `${w}px ${w}px ${w * 4}px ${w}px`,
        borderColor: color,
      }
    // Ignoriert bewusst colorHex, wie die serverseitige Rendering-Logik (applyFestlichFrameStyle).
    // Die floralen Ecken/Leisten liegen unten als SVG darüber; border-image bildet die geformte
    // Goldleiste nach, ohne die Vorschau zu einer zweiten Render-Implementierung zu machen.
    case 'festlich':
      return {
        borderStyle: 'solid',
        borderWidth: `${Math.max(w, 8)}px`,
        borderImage:
          'linear-gradient(135deg, #7a5c1e, #d4af37 20%, #fbe8a6 45%, #d4af37 65%, #7a5c1e) 1',
      }
    case 'corner_marks':
    case null:
      return {}
  }
})

function cornerMarkStyle(
  vertical: 'top' | 'bottom',
  horizontal: 'left' | 'right',
): Record<string, string> {
  const edge = `${props.widthPx}px solid ${props.colorHex}`
  return { [`border-${vertical}`]: edge, [`border-${horizontal}`]: edge }
}
</script>

<template>
  <div
    class="relative aspect-square w-full overflow-hidden bg-[#eef1ea]"
    :style="[outerStyle, frameStyleObject]"
  >
    <img
      src="/images/alejandro-stuardo-team-photo.jpg"
      alt=""
      aria-hidden="true"
      class="absolute inset-0 h-full w-full object-cover object-center"
      :style="photoFilterCss ? { filter: photoFilterCss } : undefined"
    />
    <div
      v-if="photoEffect === 'comic'"
      class="pointer-events-none absolute inset-0 opacity-25"
      style="
        background-image: radial-gradient(#10251e 1px, transparent 1.25px);
        background-size: 9px 9px;
      "
    />
    <svg
      v-if="photoEffect === 'konfetti'"
      viewBox="0 0 100 100"
      class="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <rect x="8" y="8" width="8" height="3" rx="1" fill="#ff375f" transform="rotate(24 8 8)" />
      <path d="M28 8 l6 2 l-3 7z" fill="#ffcc00" />
      <rect x="58" y="9" width="8" height="3" rx="1" fill="#0a84ff" transform="rotate(-38 58 9)" />
      <path d="M84 13 l7 2 l-4 7z" fill="#af52de" />
      <rect
        x="14"
        y="59"
        width="7"
        height="3"
        rx="1"
        fill="#34c759"
        transform="rotate(-24 14 59)"
      />
      <path d="M77 65 l7 2 l-4 7z" fill="#ff9f0a" />
      <rect x="47" y="82" width="7" height="3" rx="1" fill="#ff375f" transform="rotate(42 47 82)" />
    </svg>
    <template v-if="frameStyle === 'corner_marks'">
      <span class="absolute left-0 top-0 h-1/4 w-1/4" :style="cornerMarkStyle('top', 'left')" />
      <span class="absolute right-0 top-0 h-1/4 w-1/4" :style="cornerMarkStyle('top', 'right')" />
      <span
        class="absolute bottom-0 left-0 h-1/4 w-1/4"
        :style="cornerMarkStyle('bottom', 'left')"
      />
      <span
        class="absolute bottom-0 right-0 h-1/4 w-1/4"
        :style="cornerMarkStyle('bottom', 'right')"
      />
    </template>
    <svg
      v-if="frameStyle === 'festlich'"
      viewBox="0 0 100 100"
      class="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="preview-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#6a4a13" />
          <stop offset=".36" stop-color="#fff1ad" />
          <stop offset=".64" stop-color="#c79422" />
          <stop offset="1" stop-color="#6a4a13" />
        </linearGradient>
        <g id="filigree-corner" fill="none" stroke="#725418" stroke-linecap="round">
          <path d="M2 17 C3 7 9 3 18 2 C13 7 13 12 20 14 C27 16 28 7 23 5" stroke-width="1.4" />
          <path d="M4 11 C10 9 11 16 17 19 C22 22 27 18 26 13" stroke-width="1" />
          <path
            d="M7 5 C11 3 14 5 13 9 C10 11 6 9 7 5Z"
            fill="url(#preview-gold)"
            stroke-width=".7"
          />
          <path
            d="M15 12 C19 9 23 12 22 16 C18 18 14 16 15 12Z"
            fill="url(#preview-gold)"
            stroke-width=".7"
          />
          <circle cx="5" cy="5" r="2.25" fill="#fff2b5" stroke-width=".8" />
          <circle cx="5" cy="5" r=".65" fill="#7a5615" stroke="none" />
        </g>
      </defs>
      <g stroke="#725418" fill="none" stroke-width=".8" opacity=".9">
        <path d="M29 3 Q34 7 39 3 M61 3 Q66 7 71 3 M29 97 Q34 93 39 97 M61 97 Q66 93 71 97" />
      </g>
      <g fill="#fce9a2" stroke="#725418" stroke-width=".45">
        <circle cx="32" cy="4.5" r="1.1" />
        <circle cx="40" cy="4.5" r="1.1" />
        <circle cx="60" cy="4.5" r="1.1" />
        <circle cx="68" cy="4.5" r="1.1" />
        <circle cx="32" cy="95.5" r="1.1" />
        <circle cx="40" cy="95.5" r="1.1" />
        <circle cx="60" cy="95.5" r="1.1" />
        <circle cx="68" cy="95.5" r="1.1" />
      </g>
      <use href="#filigree-corner" />
      <use href="#filigree-corner" transform="translate(100 0) scale(-1 1)" />
      <use href="#filigree-corner" transform="translate(0 100) scale(1 -1)" />
      <use href="#filigree-corner" transform="translate(100 100) scale(-1 -1)" />
    </svg>
    <slot />
  </div>
</template>
