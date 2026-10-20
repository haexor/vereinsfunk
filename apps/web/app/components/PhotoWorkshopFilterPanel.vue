<script setup lang="ts">
import type { ImageStyleFilter } from '@vereinsfunk/contracts'

defineProps<{
  filters: readonly { value: ImageStyleFilter; label: string }[]
  selectedFilter: ImageStyleFilter
  // Kachel "Original": der aktuelle Zuschnitt, bis er gerendert ist das Ausgangsbild.
  originalPreviewUrl: string
  filterThumbnailUrls: Partial<Record<ImageStyleFilter, string>>
  filterThumbnailStatuses: Partial<Record<ImageStyleFilter, 'loading' | 'unavailable'>>
  applyingFilter: boolean
  filterError: string
}>()
const emit = defineEmits<{ select: [filter: ImageStyleFilter] }>()
</script>

<template>
  <div class="space-y-4"><div><h3 class="text-sm font-bold">G’MIC-Filter</h3><p class="text-[11px] text-[#7a817c]">Die Kacheln werden nach und nach mit G’MIC auf deinen aktuellen Zuschnitt gerendert.</p></div><div class="flex flex-wrap gap-2"><button v-for="filter in filters" :key="filter.value" type="button" class="focus-ring w-28 shrink-0 overflow-hidden rounded-lg p-1.5 text-left" :class="selectedFilter === filter.value ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="emit('select', filter.value)"><img v-if="filter.value === 'original'" :src="originalPreviewUrl" alt="" aria-hidden="true" class="aspect-[4/3] w-full rounded object-cover" /><img v-else-if="filterThumbnailUrls[filter.value]" :src="filterThumbnailUrls[filter.value]" alt="" aria-hidden="true" class="aspect-[4/3] w-full rounded object-cover" /><span v-else-if="filterThumbnailStatuses[filter.value] === 'unavailable'" class="flex aspect-[4/3] items-center justify-center rounded bg-[#f5e9e7] px-2 text-center text-[10px] font-medium text-red-700">Nicht verfügbar</span><span v-else class="flex aspect-[4/3] items-center justify-center rounded bg-[#eef1ea] text-[10px] text-[#7a817c]">Lädt …</span><span class="mt-1 block truncate text-center text-[10px] font-semibold">{{ filter.label }}</span></button></div><p v-if="applyingFilter" class="text-xs text-[#7a817c]">G’MIC-Filter wird gerendert …</p><p v-if="filterError" class="text-xs text-red-700">{{ filterError }}</p></div>
</template>
