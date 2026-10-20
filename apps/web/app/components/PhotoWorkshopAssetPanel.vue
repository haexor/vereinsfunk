<script setup lang="ts">
import type { BrandAssetCard } from '../composables/usePhotoWorkshopAssets'

const props = defineProps<{ kind: 'frame' | 'logo'; assets: readonly BrandAssetCard[]; selectedId: string | null; loading: boolean }>()
const emit = defineEmits<{ select: [assetId: string | null] }>()

const COPY = {
  frame: {
    title: 'Rahmen', description: 'Wähle einen Rahmen aus euren hinterlegten Marken-Assets.', loading: 'Rahmen werden geladen …',
    none: 'Ohne Rahmen', noneCaption: 'Keiner', empty: 'Es sind noch keine Rahmen hinterlegt.',
    imageClass: 'aspect-[4/3] w-full rounded object-fill',
  },
  logo: {
    title: 'Logo', description: 'Logo wählen und an einer Ecke der Vorschau platzieren.', loading: 'Logos werden geladen …',
    none: 'Ohne Logo', noneCaption: 'Keines', empty: 'Es sind noch keine Logos hinterlegt.',
    imageClass: 'aspect-[4/3] w-full rounded bg-[#dfe4dd] object-contain p-1',
  },
} as const
const copy = computed(() => COPY[props.kind])
</script>

<template>
  <div class="space-y-3"><div><h3 class="text-sm font-bold">{{ copy.title }}</h3><p class="text-[11px] text-[#7a817c]">{{ copy.description }}</p></div><p v-if="loading" class="text-xs text-[#7a817c]">{{ copy.loading }}</p><div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6"><button type="button" class="focus-ring rounded-lg p-2 text-left text-xs font-semibold" :class="selectedId === null ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="emit('select', null)"><span class="flex aspect-[4/3] items-center justify-center rounded border border-dashed border-current">{{ copy.none }}</span><span class="mt-1 block text-center">{{ copy.noneCaption }}</span></button><button v-for="asset in assets" :key="asset.id" type="button" class="focus-ring overflow-hidden rounded-lg p-1.5 text-left text-xs font-semibold" :class="selectedId === asset.id ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="emit('select', asset.id)"><img :src="asset.signedUrl" :alt="`${asset.name} auswählen`" :class="copy.imageClass" /><span class="mt-1 block truncate text-center">{{ asset.name }}</span></button></div><slot /><p v-if="!loading && !assets.length" class="text-xs text-[#7a817c]">{{ copy.empty }}</p></div>
</template>
