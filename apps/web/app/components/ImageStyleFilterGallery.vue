<script setup lang="ts">
import type { ImageStyleFilter } from '@vereinsfunk/contracts'
import { useImageStyleFilterPreviewCache } from '../composables/useImageStyleFilterPreviewCache'

const props = defineProps<{
  organizationId: string
  departmentId: string | null
  teamId: string | null
}>()

const filter = defineModel<ImageStyleFilter>('filter', { required: true })
const api = useApiClient()
const { loading, loadError, previewByFilter, unavailableFilters, load } =
  useImageStyleFilterPreviewCache({ api })

const FILTER_OPTIONS: {
  value: ImageStyleFilter
  label: string
  description: string
  group: 'Basis' | 'G’MIC'
}[] = [
  { value: 'original', label: 'Original', description: 'Unbearbeitet', group: 'Basis' },
  { value: 'schwarz_weiss', label: 'Schwarz-Weiß', description: 'Klar & zeitlos', group: 'Basis' },
  { value: 'kontrastreich', label: 'Kontrast', description: 'Mehr Energie', group: 'Basis' },
  { value: 'warm', label: 'Warm', description: 'Sanfte Töne', group: 'Basis' },
  {
    value: 'vereinsfarben_duoton',
    label: 'Duoton',
    description: 'In Vereinsfarben',
    group: 'Basis',
  },
  { value: 'comic', label: 'Comic', description: 'Pop-Art & Raster', group: 'Basis' },
  { value: 'konfetti', label: 'Konfetti', description: 'Jubel aufs Bild', group: 'Basis' },
  { value: 'gmic_vintage', label: 'Vintage', description: 'Analogfoto', group: 'G’MIC' },
  { value: 'gmic_poster', label: 'Hope Poster', description: 'Schablonendruck', group: 'G’MIC' },
  { value: 'gmic_brushify', label: 'Brushify', description: 'Pinselstruktur', group: 'G’MIC' },
  { value: 'gmic_cartoon', label: 'Cartoon', description: 'Illustrierte Flächen', group: 'G’MIC' },
  {
    value: 'gmic_color_ellipses',
    label: 'Farbellipsen',
    description: 'Abstrakte Formen',
    group: 'G’MIC',
  },
  { value: 'gmic_cubism', label: 'Kubismus', description: 'Geometrische Flächen', group: 'G’MIC' },
  {
    value: 'gmic_ellipsionism',
    label: 'Ellipsionismus',
    description: 'Punktmalerei',
    group: 'G’MIC',
  },
  {
    value: 'gmic_fire_edges',
    label: 'Feuerkanten',
    description: 'Leuchtende Konturen',
    group: 'G’MIC',
  },
  {
    value: 'gmic_fractalize',
    label: 'Fraktal',
    description: 'Organische Struktur',
    group: 'G’MIC',
  },
  { value: 'gmic_glow', label: 'Glow', description: 'Weiches Leuchten', group: 'G’MIC' },
  { value: 'gmic_halftone', label: 'Halbton', description: 'Druckraster', group: 'G’MIC' },
  {
    value: 'gmic_hardsketchbw',
    label: 'Harte Skizze',
    description: 'Kräftiges Schwarzweiß',
    group: 'G’MIC',
  },
  { value: 'gmic_hearts', label: 'Herzen', description: 'Dekoratives Muster', group: 'G’MIC' },
  {
    value: 'gmic_houghsketchbw',
    label: 'Linien-Skizze',
    description: 'Technische Konturen',
    group: 'G’MIC',
  },
  {
    value: 'gmic_lightrays',
    label: 'Lichtstrahlen',
    description: 'Sonnenstrahlen',
    group: 'G’MIC',
  },
  { value: 'gmic_light_relief', label: 'Relief', description: 'Plastische Kanten', group: 'G’MIC' },
  { value: 'gmic_linify', label: 'Linien', description: 'Grafische Zeichnung', group: 'G’MIC' },
  { value: 'gmic_mosaic', label: 'Mosaik', description: 'Farbflächen', group: 'G’MIC' },
  { value: 'gmic_pencilbw', label: 'Bleistift', description: 'Feine Skizze', group: 'G’MIC' },
  { value: 'gmic_pixelsort', label: 'Pixelsort', description: 'Digitale Streifen', group: 'G’MIC' },
  { value: 'gmic_polaroid', label: 'Polaroid', description: 'Sofortbildlook', group: 'G’MIC' },
  { value: 'gmic_polygonize', label: 'Polygone', description: 'Facetten', group: 'G’MIC' },
  {
    value: 'gmic_poster_edges',
    label: 'Poster-Kanten',
    description: 'Grafische Ränder',
    group: 'G’MIC',
  },
  { value: 'gmic_rodilius', label: 'Rodilius', description: 'Fraktale Linien', group: 'G’MIC' },
  { value: 'gmic_sketchbw', label: 'Skizze', description: 'Handgezeichnet', group: 'G’MIC' },
  { value: 'gmic_sponge', label: 'Schwamm', description: 'Körnige Textur', group: 'G’MIC' },
  { value: 'gmic_stained_glass', label: 'Buntglas', description: 'Glasfragmente', group: 'G’MIC' },
  { value: 'gmic_stars', label: 'Sterne', description: 'Lichtpunkte', group: 'G’MIC' },
  { value: 'gmic_stencil', label: 'Schablone', description: 'Zweifarbige Flächen', group: 'G’MIC' },
  {
    value: 'gmic_stencilbw',
    label: 'Schablone SW',
    description: 'Harter Kontrast',
    group: 'G’MIC',
  },
  { value: 'gmic_tetris', label: 'Tetris', description: 'Blockmuster', group: 'G’MIC' },
  { value: 'gmic_warhol', label: 'Warhol', description: 'Pop-Art-Raster', group: 'G’MIC' },
  { value: 'gmic_weave', label: 'Gewebe', description: 'Geflochtene Struktur', group: 'G’MIC' },
  { value: 'gmic_whirls', label: 'Wirbel', description: 'Dynamische Drehung', group: 'G’MIC' },
]
const FILTER_GROUPS = ['Basis', 'G’MIC'] as const

async function loadPreviews() {
  await load({
    organizationId: props.organizationId,
    departmentId: props.departmentId,
    teamId: props.teamId,
  })
  if (unavailableFilters.value.has(filter.value)) filter.value = 'original'
}

watch(
  () => `${props.organizationId}:${props.departmentId ?? ''}:${props.teamId ?? ''}`,
  () => {
    void loadPreviews()
  },
  { immediate: true },
)
</script>

<template>
  <div :aria-busy="loading" class="space-y-5">
    <section v-for="group in FILTER_GROUPS" :key="group">
      <div class="mb-2 flex items-baseline justify-between gap-3">
        <h3 class="text-[11px] font-bold uppercase tracking-[.12em] text-[#5b625d]">{{ group }}</h3>
        <span v-if="group === 'G’MIC'" class="text-[10px] text-[#7a827b]"
          >Alle kuratierten Fotoeffekte</span
        >
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        <button
          v-for="option in FILTER_OPTIONS.filter((item) => item.group === group)"
          :key="option.value"
          type="button"
          :disabled="unavailableFilters.has(option.value)"
          class="focus-ring overflow-hidden rounded-lg p-1.5 text-left disabled:cursor-not-allowed disabled:opacity-55"
          :class="filter === option.value ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'"
          @click="filter = option.value"
        >
          <div class="relative aspect-[4/5] overflow-hidden rounded-md bg-[#dfe4dd]">
            <img
              v-if="previewByFilter[option.value]"
              :src="previewByFilter[option.value]"
              :alt="`${option.label}-Vorschau`"
              class="h-full w-full object-cover"
            />
            <span
              v-else-if="unavailableFilters.has(option.value)"
              class="flex h-full items-center justify-center px-2 text-center text-[9px] font-semibold leading-tight"
            >
              G’MIC ist hier nicht aktiviert
            </span>
            <span v-else class="flex h-full items-center justify-center text-[10px] text-[#7a827b]">
              {{ loading ? 'Lädt …' : 'Nicht verfügbar' }}
            </span>
          </div>
          <span class="mt-1 block text-center text-[10px] font-semibold">{{ option.label }}</span>
          <span
            class="block text-center text-[9px]"
            :class="filter === option.value ? 'text-white/75' : 'text-[#7a827b]'"
            >{{ option.description }}</span
          >
        </button>
      </div>
    </section>
  </div>
  <p v-if="loadError" class="mt-2 text-[11px] text-amber-800">
    Die echten Filtervorschauen konnten nicht geladen werden. Bitte erneut versuchen.
  </p>
  <p v-else-if="unavailableFilters.size" class="mt-2 text-[11px] text-[#7a817c]">
    G’MIC-Effekte werden auf dem Server gerendert und sind nur verfügbar, wenn die API mit G’MIC
    läuft.
  </p>
</template>
