<script setup lang="ts">
import type { ImageStyleFilter } from '@vereinsfunk/contracts'
import { useImageStyleFilterPreviewCache } from '../composables/useImageStyleFilterPreviewCache'
import { IMAGE_STYLE_FILTER_OPTIONS } from '../utils/imageStyleFilterCatalog'

const props = defineProps<{
  organizationId: string
  departmentId: string | null
  teamId: string | null
}>()

const filter = defineModel<ImageStyleFilter>('filter', { required: true })
const api = useApiClient()
const { loading, loadError, previewByFilter, unavailableFilters, load } =
  useImageStyleFilterPreviewCache({ api })

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
          v-for="option in IMAGE_STYLE_FILTER_OPTIONS.filter((item) => item.group === group)"
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
