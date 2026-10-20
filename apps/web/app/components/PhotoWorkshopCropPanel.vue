<script setup lang="ts">
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from '@lucide/vue'

defineProps<{ aspectRatio: number | undefined; cropDimensionsLabel: string }>()
const emit = defineEmits<{ selectAspectRatio: [value: number | undefined]; rotate: [angle: number]; flip: [horizontal: boolean, vertical: boolean] }>()

const ASPECT_RATIOS: { label: string; value: number | undefined }[] = [
  { label: 'Frei', value: undefined },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
]
</script>

<template>
  <div class="space-y-3"><div><h3 class="text-sm font-bold">Zuschnitt</h3><p class="text-[11px] text-[#7a817c]">Ziehe den Bildausschnitt direkt in der Vorschau. Aktueller Ausschnitt: {{ cropDimensionsLabel }}.</p></div><div class="flex flex-wrap items-center gap-2"><button v-for="option in ASPECT_RATIOS" :key="option.label" type="button" class="focus-ring rounded-lg px-3 py-2 text-xs font-semibold" :class="aspectRatio === option.value ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="emit('selectAspectRatio', option.value)">{{ option.label }}</button><span class="hidden h-7 border-l border-[#dfe0d9] sm:block" /><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Nach links drehen" title="Nach links drehen" @click="emit('rotate', -90)"><RotateCcw :size="17" /></button><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Nach rechts drehen" title="Nach rechts drehen" @click="emit('rotate', 90)"><RotateCw :size="17" /></button><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Horizontal spiegeln" title="Horizontal spiegeln" @click="emit('flip', true, false)"><FlipHorizontal2 :size="17" /></button><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Vertikal spiegeln" title="Vertikal spiegeln" @click="emit('flip', false, true)"><FlipVertical2 :size="17" /></button></div></div>
</template>
