<script setup lang="ts">
import {
  LlmProviderConfigurationSchema,
  UpdateLlmProviderConfigurationRequestSchema,
  type LlmProviderConfigurationDto,
} from '@vereinsfunk/contracts'

// Paket 050: welche konfigurierten Provider gerade fuer ihre Aufgabe genutzt werden, ist ausschliesslich
// is_active -- diese Karte gruppiert dieselbe Liste wie die Provider-Tabelle nur nach Aufgabe und bedient
// denselben PATCH-Endpunkt. Fuer text_generation bestimmt die Anzahl der hier aktivierten Provider zugleich
// die Anzahl der Textvorschlaege (siehe resolveTextGenerationProviderConfigurationIds, apps/api).
defineProps<{
  groups: readonly { taskKind: string; label: string; providers: readonly LlmProviderConfigurationDto[] }[]
}>()
const emit = defineEmits<{ updated: [provider: LlmProviderConfigurationDto] }>()

const api = useApiClient()
const saving = reactive<Partial<Record<string, boolean>>>({})
const error = ref('')

async function toggleActive(provider: LlmProviderConfigurationDto) {
  saving[provider.id] = true
  error.value = ''
  try {
    const body = UpdateLlmProviderConfigurationRequestSchema.parse({ isActive: !provider.isActive })
    emit('updated', await api.request(`/v1/llm-providers/${provider.id}`, { method: 'PATCH', body }, LlmProviderConfigurationSchema))
  } catch {
    error.value = 'Der Aktiv-Status konnte nicht geändert werden.'
  } finally {
    saving[provider.id] = false
  }
}
</script>

<template>
  <section class="card p-6">
    <h2 class="mb-1 font-display text-base font-bold">Aufgaben-Zuordnung</h2>
    <p class="mb-4 text-xs text-[#727a75]">
      Welche der oben konfigurierten Provider gerade für ihre Aufgabe genutzt werden. Für Textgenerierung bestimmt die Anzahl aktivierter Provider zugleich, wie viele Textvorschläge gleichzeitig entstehen.
    </p>
    <div v-for="group in groups" :key="group.taskKind" class="mb-5 last:mb-0">
      <h3 class="mb-2 text-xs font-bold text-[#3c4238]">{{ group.label }}</h3>
      <p v-if="!group.providers.length" class="text-xs text-[#9aa096]">Noch kein Provider für diese Aufgabe konfiguriert.</p>
      <ul v-else class="space-y-1.5">
        <li v-for="provider in group.providers" :key="provider.id" class="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            class="accent-forest"
            :checked="provider.isActive"
            :disabled="saving[provider.id]"
            @change="toggleActive(provider)"
          />
          <span :class="provider.isActive ? 'font-semibold text-forest' : 'text-[#5c655f]'">{{ provider.label }}</span>
          <span class="text-[#9aa096]">({{ provider.model }})</span>
        </li>
      </ul>
    </div>
    <p v-if="error" class="mt-2 text-[11px] font-normal text-amber-800">{{ error }}</p>
  </section>
</template>
