<script setup lang="ts">
defineProps<{
  draft: { rawMediaDays: number; derivativeEnabled: boolean; derivativeDays: number; auditEventDays: number; consentEvidenceYears: number; statusEventDays: number }
  saving: boolean
  error: string
}>()
const emit = defineEmits<{ save: [] }>()
</script>

<template>
  <section class="card mb-6 p-6">
    <h2 class="mb-1 font-display text-base font-bold">Aufbewahrungsfristen</h2>
    <p class="mb-4 text-[11px] text-[#7b827d]">Diese Fristen setzt der Löschlauf durch — nicht der Vorsatz, sie einzuhalten.</p>
    <div class="grid gap-4 sm:grid-cols-2">
      <label><span class="mb-1 block text-xs font-semibold">Rohmedien (Tage)</span><input v-model.number="draft.rawMediaDays" type="number" min="7" max="730" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /><span class="mt-1 block text-[10px] text-[#9aa096]">7 bis 730 Tage.</span></label>
      <label><span class="mb-1 block text-xs font-semibold">Audit-Ereignisse (Tage)</span><input v-model.number="draft.auditEventDays" type="number" min="365" max="3650" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /><span class="mt-1 block text-[10px] text-[#9aa096]">365 bis 3650 Tage. Ereignisse zu Einwilligungen, Widerrufen und Elternkontakten sind ausgenommen und folgen der Nachweisfrist rechts.</span></label>
      <label><span class="mb-1 block text-xs font-semibold">Nachweisfrist für Einwilligungen (Jahre)</span><input v-model.number="draft.consentEvidenceYears" type="number" min="1" max="30" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /><span class="mt-1 block text-[10px] text-[#9aa096]">1 bis 30 Jahre, gerechnet ab Ende der Gültigkeit einer Einwilligung.</span></label>
      <label><span class="mb-1 block text-xs font-semibold">Statushistorie für die Auswertung (Tage)</span><input v-model.number="draft.statusEventDays" type="number" min="90" max="3650" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /><span class="mt-1 block text-[10px] text-[#9aa096]">90 bis 3650 Tage. Erfasst, wann ein Beitrag welchen Status durchlaufen hat — Grundlage für Durchlaufzeiten in der Auswertung.</span></label>
      <div><label class="flex items-center gap-2"><input v-model="draft.derivativeEnabled" type="checkbox" /> <span class="text-xs font-semibold">Abgeleitete Medien automatisch löschen</span></label><input v-if="draft.derivativeEnabled" v-model.number="draft.derivativeDays" type="number" min="30" max="3650" class="focus-ring mt-2 w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /><span class="mt-1 block text-[10px] text-[#9aa096]">Standardmäßig deaktiviert: Zuschnitte und Re-Encodes werden in veröffentlichten Beiträgen weiterverwendet und sollen nicht versehentlich verschwinden. Nur Rohmedien haben eine Pflichtfrist, weil sie die sensibleren Originale sind — ob abgeleitete Medien überhaupt automatisch gelöscht werden, ist eine bewusste Vereinsentscheidung (30 bis 3650 Tage, falls aktiviert).</span></div>
    </div>
    <p v-if="error" class="mt-3 text-xs text-amber-800">{{ error }}</p>
    <button type="button" :disabled="saving" class="focus-ring mt-4 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="emit('save')">{{ saving ? 'Wird gespeichert …' : 'Speichern' }}</button>
  </section>
</template>
