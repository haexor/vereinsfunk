<script setup lang="ts">
import {
  ImageStyleFilterPreviewsResponseSchema,
  type ImageStyleFilter,
} from '@vereinsfunk/contracts'

const props = defineProps<{
  organizationId: string
  departmentId: string | null
  teamId: string | null
}>()

const filter = defineModel<ImageStyleFilter>('filter', { required: true })
const api = useApiClient()

const FILTER_OPTIONS: { value: ImageStyleFilter; label: string; description: string }[] = [
  { value: 'original', label: 'Original', description: 'Unbearbeitet' },
  { value: 'schwarz_weiss', label: 'Schwarz-Weiß', description: 'Klar & zeitlos' },
  { value: 'kontrastreich', label: 'Kontrast', description: 'Mehr Energie' },
  { value: 'warm', label: 'Warm', description: 'Sanfte Töne' },
  { value: 'vereinsfarben_duoton', label: 'Duoton', description: 'In Vereinsfarben' },
  { value: 'comic', label: 'Comic', description: 'Pop-Art & Raster' },
  { value: 'konfetti', label: 'Konfetti', description: 'Jubel aufs Bild' },
  { value: 'gmic_vintage', label: 'Vintage', description: 'G’MIC · analog' },
  { value: 'gmic_poster', label: 'Poster', description: 'G’MIC · Schablone' },
]

const loading = ref(false)
const loadError = ref(false)
const unavailableFilters = ref<Set<ImageStyleFilter>>(new Set())
const previewByFilter = ref<Partial<Record<ImageStyleFilter, string>>>({})
let latestLoad = 0

function imageDataUrl(imageBase64: string): string {
  return `data:image/webp;base64,${imageBase64}`
}

async function loadPreviews() {
  const load = ++latestLoad
  previewByFilter.value = {}
  unavailableFilters.value = new Set<ImageStyleFilter>()
  if (!props.organizationId || import.meta.server) {
    loading.value = false
    loadError.value = false
    return
  }
  loading.value = true
  loadError.value = false
  try {
    const result = await api.request(
      '/v1/image-style-presets/filter-previews',
      {
        method: 'POST',
        body: {
          organizationId: props.organizationId,
          ...(props.departmentId ? { departmentId: props.departmentId } : {}),
          ...(props.teamId ? { teamId: props.teamId } : {}),
        },
      },
      ImageStyleFilterPreviewsResponseSchema,
    )
    if (load !== latestLoad) return
    previewByFilter.value = Object.fromEntries(
      result.previews.map((preview) => [preview.filter, imageDataUrl(preview.imageBase64)]),
    )
    unavailableFilters.value = new Set(result.unavailableFilters)
    if (unavailableFilters.value.has(filter.value)) filter.value = 'original'
  } catch {
    if (load !== latestLoad) return
    loadError.value = true
  } finally {
    if (load === latestLoad) loading.value = false
  }
}

watch(
  () => `${props.organizationId}:${props.departmentId ?? ''}:${props.teamId ?? ''}`,
  () => { void loadPreviews() },
  { immediate: true },
)
</script>

<template>
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" :aria-busy="loading">
    <button
      v-for="option in FILTER_OPTIONS"
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
        <span v-else-if="unavailableFilters.has(option.value)" class="flex h-full items-center justify-center px-2 text-center text-[9px] font-semibold leading-tight">
          G’MIC ist hier nicht aktiviert
        </span>
        <span v-else class="flex h-full items-center justify-center text-[10px] text-[#7a827b]">
          {{ loading ? 'Lädt …' : 'Nicht verfügbar' }}
        </span>
      </div>
      <span class="mt-1 block text-center text-[10px] font-semibold">{{ option.label }}</span>
      <span class="block text-center text-[9px]" :class="filter === option.value ? 'text-white/75' : 'text-[#7a827b]'">{{ option.description }}</span>
    </button>
  </div>
  <p v-if="loadError" class="mt-2 text-[11px] text-amber-800">
    Die echten Filtervorschauen konnten nicht geladen werden. Bitte erneut versuchen.
  </p>
  <p v-else-if="unavailableFilters.size" class="mt-2 text-[11px] text-[#7a817c]">
    Vintage und Poster werden mit G’MIC gerendert und sind nur verfügbar, wenn die API mit G’MIC läuft.
  </p>
</template>
