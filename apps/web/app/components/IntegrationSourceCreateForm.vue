<script setup lang="ts">
import type { MappingRow, MappingTarget } from './IntegrationMappingRowsEditor.vue'

defineProps<{
  departments: ReadonlyArray<{ id: string; name: string }>
  canManageOrgWide: boolean
  submitting: boolean
  error: string
  mappingTargetsFor: (departmentId: string | null) => MappingTarget[]
}>()

const form = defineModel<{ transport: 'file' | 'ical'; providerKey: string; displayName: string; departmentId: string; endpointUrl: string; lossThresholdPercent: string }>('form', { required: true })
const mappingRows = defineModel<MappingRow[]>('mappingRows', { required: true })

const emit = defineEmits<{ submit: [] }>()

const departmentIdModel = computed({
  get: () => form.value.departmentId || '__none__',
  set: (v: string) => { form.value.departmentId = v === '__none__' ? '' : v },
})
</script>

<template>
  <section class="card mb-6 p-6">
    <h2 class="mb-4 font-display text-base font-bold">Quelle einrichten</h2>
    <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="emit('submit')">
      <label><span class="mb-1 block text-xs font-semibold">Transport</span><Select v-model="form.transport"><SelectTrigger class="rounded-xl p-2.5 text-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="file">Datei (CSV/XLSX)</SelectItem><SelectItem value="ical">Kalender-Feed (iCal)</SelectItem></SelectContent></Select></label>
      <label><span class="mb-1 block text-xs font-semibold">Anbieterkennung</span><input v-model="form.providerKey" required maxlength="80" placeholder="z. B. csv" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" /></label>
      <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Anzeigename</span><input v-model="form.displayName" required maxlength="160" placeholder="z. B. Mitgliederexport Verbandssoftware" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Bereich</span><Select v-model="departmentIdModel"><SelectTrigger class="rounded-xl p-2.5 text-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-if="canManageOrgWide" value="__none__">Vereinsweit</SelectItem><SelectItem v-for="department in departments" :key="department.id" :value="department.id">{{ department.name }}</SelectItem></SelectContent></Select></label>
      <label v-if="form.transport === 'ical'"><span class="mb-1 block text-xs font-semibold">Kalender-Adresse</span><input v-model="form.endpointUrl" type="url" required placeholder="https://…" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Verlustschwelle (%)</span><input v-model="form.lossThresholdPercent" type="number" min="1" max="100" placeholder="30" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" /></label>
      <div class="sm:col-span-2"><p class="mb-2 text-xs font-semibold">Feldzuordnung</p><p class="mb-2 text-[11px] text-[#7b827d]">Welche Spalte der Datei entspricht welchem internen Feld? Wird gespeichert, damit der nächste Import ohne erneutes Zuordnen läuft.</p>
        <IntegrationMappingRowsEditor v-model="mappingRows" :targets="mappingTargetsFor(form.departmentId || null)" />
      </div>
      <div class="sm:col-span-2"><p v-if="error" class="mb-2 text-xs text-amber-800">{{ error }}</p><button type="submit" :disabled="submitting" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">{{ submitting ? 'Wird angelegt …' : 'Quelle anlegen' }}</button></div>
    </form>
  </section>
</template>
