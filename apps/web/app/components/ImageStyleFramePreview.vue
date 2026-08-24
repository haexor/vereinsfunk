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

// Rein kosmetische CSS-Naeherung, wie schon die bisherige Live-Vorschau (Rahmen/Filter entstehen
// serverseitig per Sharp, siehe apps/api/src/imageStyle.ts). Das bereitgestellte Mannschaftsfoto
// macht die Filterwirkung statt eines abstrakten Platzhalters sichtbar. Es wird fuer die grosse
// Live-Vorschau (ImageStyleLivePreview.vue, frameStyle darf dort null sein -- kein/eigener Rahmen
// braucht keine CSS-Umrandung) UND die kleinen Stil-Galerie-Kacheln in ImageStylePresetForm.vue
// genutzt.
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
        borderWidth: `${w}px`,
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
      <g fill="none" stroke="#725418" stroke-width="1.2">
        <path d="M2 18 Q8 7 18 2 M82 2 Q92 7 98 18 M2 82 Q8 93 18 98 M82 98 Q92 93 98 82" />
      </g>
      <g fill="#fff0aa" stroke="#725418" stroke-width=".75">
        <circle cx="8" cy="8" r="3" />
        <circle cx="92" cy="8" r="3" />
        <circle cx="8" cy="92" r="3" />
        <circle cx="92" cy="92" r="3" />
      </g>
      <g fill="#d4af37">
        <path d="M12 12 l4 1 l-2 5z M88 12 l-4 1 l2 5z M12 88 l4 -1 l-2 -5z M88 88 l-4 -1 l2 -5z" />
      </g>
    </svg>
    <slot />
  </div>
</template>
