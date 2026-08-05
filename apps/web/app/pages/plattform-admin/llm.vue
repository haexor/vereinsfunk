<script setup lang="ts">
import {
  CreateLlmProviderConfigurationRequestSchema,
  LlmProviderConfigurationSchema,
  UpdateLlmProviderConfigurationRequestSchema,
  UuidSchema,
  type LlmProviderConfigurationDto,
} from '@vereinsfunk/contracts'

definePageMeta({ layout: 'admin' })

const config = useRuntimeConfig()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const providers = ref<LlmProviderConfigurationDto[]>([])

const newProvider = reactive({
  label: '',
  protocol: 'anthropic' as 'anthropic' | 'openai',
  baseUrl: '',
  model: '',
  apiKey: '',
})

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch(`${config.public.apiBase}/v1/llm-providers`, { headers })
    providers.value = LlmProviderConfigurationSchema.array().parse(response)
  } catch {
    errorMessage.value = 'LLM-Provider konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

async function createProvider() {
  if (!newProvider.label.trim() || !newProvider.baseUrl.trim() || !newProvider.model.trim() || !newProvider.apiKey.trim()) return
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const body = CreateLlmProviderConfigurationRequestSchema.parse({
      label: newProvider.label,
      protocol: newProvider.protocol,
      baseUrl: newProvider.baseUrl,
      model: newProvider.model,
      apiKey: newProvider.apiKey,
    })
    await $fetch(`${config.public.apiBase}/v1/llm-providers`, { method: 'POST', headers, body })
    newProvider.label = ''
    newProvider.baseUrl = ''
    newProvider.model = ''
    newProvider.apiKey = ''
    await load()
  } catch {
    errorMessage.value = 'Provider konnte nicht angelegt werden.'
  } finally {
    saving.value = false
  }
}

async function toggleActive(provider: LlmProviderConfigurationDto) {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const id = UuidSchema.parse(provider.id)
    const body = UpdateLlmProviderConfigurationRequestSchema.parse({ isActive: !provider.isActive })
    await $fetch(`${config.public.apiBase}/v1/llm-providers/${id}`, { method: 'PATCH', headers, body })
    await load()
  } catch {
    errorMessage.value = 'Status konnte nicht geändert werden.'
  } finally {
    saving.value = false
  }
}

async function removeProvider(id: string) {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const providerId = UuidSchema.parse(id)
    await $fetch(`${config.public.apiBase}/v1/llm-providers/${providerId}`, { method: 'DELETE', headers })
    await load()
  } catch {
    errorMessage.value = 'Provider konnte nicht entfernt werden.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Plattform-Administration</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">LLM-Provider</h1>
      <p class="mt-2 text-sm text-[#727a75]">
        Modelle, Accounts und API-Keys für die Texterstellung. Ein hinterlegter Schlüssel wird nie wieder im Klartext angezeigt.
      </p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <template v-else>
      <section class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Provider hinzufügen</h2>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="createProvider">
          <input
            v-model="newProvider.label"
            type="text"
            required
            placeholder="Bezeichnung, z.B. Claude via haex-claude-proxy"
            class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm sm:col-span-2"
          />
          <select v-model="newProvider.protocol" class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm">
            <option value="anthropic">Anthropic-kompatibel</option>
            <option value="openai">OpenAI-kompatibel</option>
          </select>
          <input
            v-model="newProvider.model"
            type="text"
            required
            placeholder="Modell, z.B. claude-opus-5"
            class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm"
          />
          <input
            v-model="newProvider.baseUrl"
            type="url"
            required
            placeholder="Basis-URL"
            class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm sm:col-span-2"
          />
          <input
            v-model="newProvider.apiKey"
            type="password"
            required
            placeholder="API-Key / Bearer-Token"
            class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm sm:col-span-2"
          />
          <button
            type="submit"
            class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60 sm:col-span-2"
            :disabled="saving"
          >
            Anlegen
          </button>
        </form>
      </section>

      <section class="card overflow-x-auto p-6">
        <h2 class="mb-4 font-display text-base font-bold">Konfigurierte Provider</h2>
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="text-[#7b827d]">
              <th class="pb-2 pr-4 font-semibold">Bezeichnung</th>
              <th class="pb-2 pr-4 font-semibold">Protokoll</th>
              <th class="pb-2 pr-4 font-semibold">Modell</th>
              <th class="pb-2 pr-4 font-semibold">Zweck</th>
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
              <td class="py-2 pr-4">{{ provider.purpose }}</td>
              <td class="py-2 pr-4">{{ provider.hasSecret ? 'hinterlegt' : 'fehlt' }}</td>
              <td class="py-2 pr-4">
                <button
                  class="focus-ring rounded-lg px-2 py-1 text-[11px] font-semibold"
                  :class="provider.isActive ? 'text-forest' : 'text-[#9aa096]'"
                  @click="toggleActive(provider)"
                >
                  {{ provider.isActive ? 'Aktiv' : 'Inaktiv' }}
                </button>
              </td>
              <td class="py-2 text-right">
                <button
                  class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50"
                  :disabled="saving"
                  @click="removeProvider(provider.id)"
                >
                  Entfernen
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!providers.length" class="py-4 text-center text-xs text-[#9aa096]">Noch kein Provider konfiguriert.</p>
      </section>
      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
    </template>
  </div>
</template>
