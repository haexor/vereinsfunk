<script setup lang="ts">
import type { IntegrationSource } from '@vereinsfunk/contracts'
import type { MappingRow, MappingTarget } from './IntegrationMappingRowsEditor.vue'

defineProps<{
  source: IntegrationSource
  submitting: boolean
  error: string
  mappingTargetsFor: (departmentId: string | null) => MappingTarget[]
}>()

const form = defineModel<{ displayName: string; endpointUrl: string; lossThresholdPercent: string }>('form', { required: true })
const mappingRows = defineModel<MappingRow[]>('mappingRows', { required: true })

const emit = defineEmits<{ save: []; cancel: [] }>()
</script>

<template>
  <div class="mt-4 rounded-xl border border-[#e8e9e2] bg-[#f7f8f4] p-4">
    <p class="mb-3 text-xs font-semibold">Quelle bearbeiten</p>
    <div class="grid gap-3 sm:grid-cols-2">
      <label><span class="mb-1 block text-xs font-semibold">Anzeigename</span><input v-model="form.displayName" maxlength="160" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" /></label>
      <label v-if="source.transport === 'ical'"><span class="mb-1 block text-xs font-semibold">Kalender-Adresse</span><input v-model="form.endpointUrl" type="url" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Verlustschwelle (%)</span><input v-model="form.lossThresholdPercent" type="number" min="1" max="100" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" /></label>
    </div>
    <div class="mt-3"><p class="mb-2 text-xs font-semibold">Feldzuordnung</p>
      <IntegrationMappingRowsEditor v-model="mappingRows" :targets="mappingTargetsFor(source.departmentId)" />
    </div>
    <p v-if="error" class="mt-2 text-xs text-amber-800">{{ error }}</p>
    <div class="mt-3 flex gap-2"><button type="button" :disabled="submitting" class="focus-ring rounded-lg bg-forest px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60" @click="emit('save')">{{ submitting ? 'Wird gespeichert …' : 'Speichern' }}</button><button type="button" class="focus-ring text-xs text-[#8a9186]" @click="emit('cancel')">Abbrechen</button></div>
  </div>
</template>
