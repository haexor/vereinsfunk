<script setup lang="ts">
import type { IntegrationSyncRun } from '@vereinsfunk/contracts'

defineProps<{
  loading: boolean
  runs: IntegrationSyncRun[]
  statusLabels: Record<string, string>
}>()
</script>

<template>
  <div class="mt-4 rounded-xl border border-[#e8e9e2] bg-[#f7f8f4] p-4 text-xs">
    <p class="mb-2 font-semibold">Verlauf der Läufe</p>
    <p v-if="loading" class="text-[#7b827d]">Wird geladen …</p>
    <div v-else-if="!runs.length" class="text-[#9aa096]">Noch kein Lauf vorhanden.</div>
    <div v-else class="space-y-2">
      <div v-for="run in runs" :key="run.id" class="rounded-lg border border-[#e8e9e2] p-2.5">
        <p class="font-semibold">{{ run.mode === 'dry_run' ? 'Trockenlauf' : 'Übernahme' }} · {{ statusLabels[run.status] ?? run.status }}</p>
        <p class="mt-1 text-[#7b827d]">{{ run.createdCount }} neu, {{ run.updatedCount }} geändert, {{ run.retiredCount }} stillgelegt, {{ run.skippedCount }} übersprungen, {{ run.conflictCount }} Konflikte</p>
        <p v-if="run.errorClass" class="mt-1 text-amber-800">Fehlerklasse: {{ run.errorClass }}</p>
        <p class="mt-1 text-[#9aa096]">Gestartet: {{ new Date(run.startedAt).toLocaleString('de-DE') }} · {{ run.finishedAt ? `beendet: ${new Date(run.finishedAt).toLocaleString('de-DE')}` : 'läuft noch' }}</p>
      </div>
    </div>
  </div>
</template>
