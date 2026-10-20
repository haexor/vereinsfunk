<script setup lang="ts">
import { Lock, Unlock } from '@lucide/vue'
import { MAX_OUTPUT_DIMENSION } from '../utils/imageOutputDimensions'

defineProps<{ outputWidth: number; outputHeight: number; keepAspectRatio: boolean; outputDimensionsLabel: string }>()
// editStart/editEnd klammern das Tippen in ein Feld zu einem Verlaufsschritt.
const emit = defineEmits<{ editStart: []; editEnd: []; updateWidth: [value: string]; updateHeight: [value: string]; toggleAspectRatioLock: [] }>()
</script>

<template>
  <div class="flex flex-wrap items-end gap-3"><div class="mr-2"><h3 class="text-sm font-bold">Bildgröße</h3><p class="text-[11px] text-[#7a817c]">Ausgabe: {{ outputDimensionsLabel }}. Das Bild wird beim Speichern skaliert.</p></div><label class="grid gap-1 text-xs font-semibold">Breite<input :value="outputWidth" class="w-28 rounded-lg border border-[#dfe0d9] px-2 py-2 text-sm" type="number" min="1" :max="MAX_OUTPUT_DIMENSION" @focus="emit('editStart')" @blur="emit('editEnd')" @input="emit('updateWidth', ($event.target as HTMLInputElement).value)" /></label><span class="mb-2 text-[#7a817c]">×</span><label class="grid gap-1 text-xs font-semibold">Höhe<input :value="outputHeight" class="w-28 rounded-lg border border-[#dfe0d9] px-2 py-2 text-sm" type="number" min="1" :max="MAX_OUTPUT_DIMENSION" @focus="emit('editStart')" @blur="emit('editEnd')" @input="emit('updateHeight', ($event.target as HTMLInputElement).value)" /></label><button type="button" class="focus-ring mb-0.5 inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[#52606d] hover:bg-[#f4f6f2]" :aria-pressed="keepAspectRatio" @click="emit('toggleAspectRatioLock')"><Lock v-if="keepAspectRatio" :size="15" /><Unlock v-else :size="15" /> Verhältnis {{ keepAspectRatio ? 'fix' : 'frei' }}</button><span class="pb-2 text-[11px] text-[#7a817c]">px</span></div>
</template>
