<script setup lang="ts">
type MappingRow = { column: string; field: string }
type MappingTarget = { value: string; label: string }

defineProps<{
  form: { transport: 'file' | 'ical'; providerKey: string; displayName: string; departmentId: string; endpointUrl: string; lossThresholdPercent: string }
  mappingRows: MappingRow[]
  departments: ReadonlyArray<{ id: string; name: string }>
  canManageOrgWide: boolean
  submitting: boolean
  error: string
  mappingTargetsFor: (departmentId: string | null) => MappingTarget[]
}>()

const emit = defineEmits<{ submit: []; addRow: []; removeRow: [index: number] }>()
</script>

<template>
  <section class="card mb-6 p-6">
    <h2 class="mb-4 font-display text-base font-bold">Quelle einrichten</h2>
    <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="emit('submit')">
      <label><span class="mb-1 block text-xs font-semibold">Transport</span><select v-model="form.transport" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm"><option value="file">Datei (CSV/XLSX)</option><option value="ical">Kalender-Feed (iCal)</option></select></label>
      <label><span class="mb-1 block text-xs font-semibold">Anbieterkennung</span><input v-model="form.providerKey" required maxlength="80" placeholder="z. B. csv" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" /></label>
      <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Anzeigename</span><input v-model="form.displayName" required maxlength="160" placeholder="z. B. Mitgliederexport Verbandssoftware" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Bereich</span><select v-model="form.departmentId" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm"><option v-if="canManageOrgWide" value="">Vereinsweit</option><option v-for="department in departments" :key="department.id" :value="department.id">{{ department.name }}</option></select></label>
      <label v-if="form.transport === 'ical'"><span class="mb-1 block text-xs font-semibold">Kalender-Adresse</span><input v-model="form.endpointUrl" type="url" required placeholder="https://…" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Verlustschwelle (%)</span><input v-model="form.lossThresholdPercent" type="number" min="1" max="100" placeholder="30" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" /></label>
      <div class="sm:col-span-2"><p class="mb-2 text-xs font-semibold">Feldzuordnung</p><p class="mb-2 text-[11px] text-[#7b827d]">Welche Spalte der Datei entspricht welchem internen Feld? Wird gespeichert, damit der nächste Import ohne erneutes Zuordnen läuft.</p>
        <div v-for="(row, index) in mappingRows" :key="index" class="mb-2 flex flex-wrap items-center gap-2"><input v-model="row.column" placeholder="Spalte in der Datei" class="focus-ring w-44 rounded-lg border border-[#dfe0d9] p-2 text-xs" /><span class="text-xs text-[#9aa096]">→</span><select v-model="row.field" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-xs"><option value="">Internes Feld wählen …</option><option v-for="target in mappingTargetsFor(form.departmentId || null)" :key="target.value" :value="target.value">{{ target.label }}</option></select><button type="button" class="focus-ring text-xs text-[#8a9186] hover:text-amber-800" @click="emit('removeRow', index)">Entfernen</button></div>
        <button type="button" class="focus-ring text-xs font-semibold text-forest" @click="emit('addRow')">+ Zeile hinzufügen</button>
      </div>
      <div class="sm:col-span-2"><p v-if="error" class="mb-2 text-xs text-amber-800">{{ error }}</p><button type="submit" :disabled="submitting" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">{{ submitting ? 'Wird angelegt …' : 'Quelle anlegen' }}</button></div>
    </form>
  </section>
</template>
