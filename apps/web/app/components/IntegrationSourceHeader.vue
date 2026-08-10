<script setup lang="ts">
import type { IntegrationSource } from '@vereinsfunk/contracts'

defineProps<{
  source: IntegrationSource
  busy: boolean
  transportLabels: Record<string, string>
  domainLabels: Record<string, string>
  runStatusLabels: Record<string, string>
  scopeLabel: (departmentId: string | null) => string
}>()

const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <p class="font-display text-base font-bold">{{ source.displayName }}</p>
      <p class="mt-1 text-[11px] text-[#9aa096]">{{ transportLabels[source.transport] ?? source.transport }} · {{ scopeLabel(source.departmentId) }} · {{ source.enabledDomains.map((domain) => domainLabels[domain] ?? domain).join(', ') }}</p>
      <p class="mt-1 text-[11px] text-[#9aa096]"><span v-if="source.lastSyncAt">Letzter Lauf: {{ new Date(source.lastSyncAt).toLocaleString('de-DE') }} · {{ runStatusLabels[source.lastSyncStatus ?? ''] ?? source.lastSyncStatus }}</span><span v-else>Noch nicht synchronisiert.</span></p>
    </div>
    <label class="flex shrink-0 items-center gap-2 text-xs font-semibold">
      <input type="checkbox" :checked="source.enabled" :disabled="busy" @change="emit('toggle')" /> Aktiv
    </label>
  </div>
</template>
