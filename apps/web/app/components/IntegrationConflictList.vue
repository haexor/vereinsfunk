<script setup lang="ts">
import type { IntegrationSyncConflict } from '@vereinsfunk/contracts'

defineProps<{
  conflicts: IntegrationSyncConflict[]
  labels: Record<string, string>
  busyId: string | null
}>()

const emit = defineEmits<{
  resolve: [conflict: IntegrationSyncConflict, resolution: 'keep_current' | 'take_incoming' | 'ignore_permanently']
}>()
</script>

<template>
  <div class="space-y-2">
    <div v-for="conflict in conflicts" :key="conflict.id" class="rounded-lg border border-[#e8e9e2] p-2.5">
      <p class="font-semibold">{{ conflict.label }} · {{ labels[conflict.kind] ?? conflict.kind }}</p>
      <p class="mt-1 text-[#7b827d]">Feld: {{ conflict.field }}</p>
      <div class="mt-1 grid gap-1 sm:grid-cols-2">
        <p>Aktuell: {{ conflict.currentValue ?? '–' }}</p>
        <p>Eingehend: {{ conflict.incomingValue ?? '–' }}</p>
      </div>
      <div v-if="conflict.resolution === 'pending'" class="mt-2 flex flex-wrap gap-2">
        <button type="button" :disabled="busyId === conflict.id" class="focus-ring rounded-lg border border-[#dfe0d9] px-2.5 py-1.5 text-[10px] font-semibold" @click="emit('resolve', conflict, 'take_incoming')">Übernehmen</button>
        <button type="button" :disabled="busyId === conflict.id" class="focus-ring rounded-lg border border-[#dfe0d9] px-2.5 py-1.5 text-[10px] font-semibold" @click="emit('resolve', conflict, 'keep_current')">Behalten</button>
        <button type="button" :disabled="busyId === conflict.id" class="focus-ring rounded-lg border border-[#dfe0d9] px-2.5 py-1.5 text-[10px] font-semibold text-amber-800" @click="emit('resolve', conflict, 'ignore_permanently')">Dauerhaft ignorieren</button>
      </div>
      <p v-else class="mt-2 text-[10px] text-[#9aa096]">Entschieden: {{ labels[conflict.resolution] }}</p>
    </div>
  </div>
</template>
