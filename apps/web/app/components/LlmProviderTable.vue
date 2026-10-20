<script setup lang="ts">
import type { LlmProviderConfigurationDto } from '@vereinsfunk/contracts'

// Liste der konfigurierten LLM-Provider; Bearbeiten und Entfernen fuehrt die Seite aus.
defineProps<{ providers: readonly LlmProviderConfigurationDto[]; busy: boolean }>()
const emit = defineEmits<{ edit: [provider: LlmProviderConfigurationDto]; remove: [providerId: string] }>()
</script>

<template>
  <section class="card overflow-x-auto p-6">
    <h2 class="mb-4 font-display text-base font-bold">Konfigurierte Provider</h2>
    <table class="w-full text-left text-xs">
      <thead>
        <tr class="text-[#7b827d]">
          <th class="pb-2 pr-4 font-semibold">Bezeichnung</th>
          <th class="pb-2 pr-4 font-semibold">Protokoll</th>
          <th class="pb-2 pr-4 font-semibold">Modell</th>
          <th class="pb-2 pr-4 font-semibold">Aufgabe</th>
          <th class="pb-2 pr-4 font-semibold">Schlüssel</th>
          <th class="pb-2 pr-4 font-semibold">Aktiv</th>
          <th class="pb-2 font-semibold" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="provider in providers" :key="provider.id" class="border-t border-[#e9ebe4]">
          <td class="py-2 pr-4 font-medium">{{ provider.label }}</td>
          <td class="py-2 pr-4">{{ provider.protocol }}</td>
          <td class="py-2 pr-4">{{ provider.model }}</td>
          <td class="py-2 pr-4">{{ provider.taskKind }}</td>
          <td class="py-2 pr-4">{{ provider.hasSecret ? 'hinterlegt' : 'fehlt' }}</td>
          <td class="py-2 pr-4">
            <span :class="provider.isActive ? 'font-semibold text-forest' : 'text-[#9aa096]'">{{ provider.isActive ? 'Aktiv' : 'Inaktiv' }}</span>
          </td>
          <td class="py-2 text-right">
            <button
              type="button"
              class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold text-forest hover:bg-[#f1f6f2]"
              :disabled="busy"
              @click="emit('edit', provider)"
            >
              Bearbeiten
            </button>
            <button
              class="focus-ring ml-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50"
              :disabled="busy"
              @click="emit('remove', provider.id)"
            >
              Entfernen
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!providers.length" class="py-4 text-center text-xs text-[#9aa096]">Noch kein Provider konfiguriert.</p>
  </section>
</template>
