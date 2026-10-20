<script setup lang="ts">
import type { IntegrationSource } from '@vereinsfunk/contracts'

const props = defineProps<{
  source: IntegrationSource
  busy: boolean
  transportLabels: Record<string, string>
  domainLabels: Record<string, string>
  runStatusLabels: Record<string, string>
  scopeLabel: (departmentId: string | null) => string
}>()

const emit = defineEmits<{ toggle: [] }>()

// Der Haken folgt allein source.enabled: der Browser setzt ihn beim Klick sofort um, schlaegt das
// Speichern fehl, aendert sich source.enabled aber nicht -- Vue patcht dann nichts und der Haken
// zeigte einen Zustand, den die Quelle nicht hat. Erst die gespeicherte Quelle setzt ihn neu.
function onToggle(event: Event) {
  ;(event.target as HTMLInputElement).checked = props.source.enabled
  emit('toggle')
}
</script>

<template>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <p class="font-display text-base font-bold">{{ source.displayName }}</p>
      <p class="mt-1 text-[11px] text-[#9aa096]">{{ transportLabels[source.transport] ?? source.transport }} · {{ scopeLabel(source.departmentId) }} · {{ source.enabledDomains.map((domain) => domainLabels[domain] ?? domain).join(', ') }}</p>
      <p class="mt-1 text-[11px] text-[#9aa096]"><span v-if="source.lastSyncAt">Letzter Lauf: {{ new Date(source.lastSyncAt).toLocaleString('de-DE') }} · {{ runStatusLabels[source.lastSyncStatus ?? ''] ?? source.lastSyncStatus }}</span><span v-else>Noch nicht synchronisiert.</span></p>
    </div>
    <label class="flex shrink-0 items-center gap-2 text-xs font-semibold">
      <input type="checkbox" :checked="source.enabled" :disabled="busy" @change="onToggle" /> Aktiv
    </label>
  </div>
</template>
