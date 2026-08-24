<script setup lang="ts">
import { LlmProviderConfigurationSchema, PlatformSettingSchema, PlatformSettingValueSchemas, PublishingProviderConfigurationSchema, PublishingProviderSchema, UpdatePublishingProviderConfigurationRequestSchema, type LlmProviderConfigurationDto, type PublishingProvider, type PublishingProviderConfiguration } from '@vereinsfunk/contracts'

definePageMeta({ layout: 'admin' })

const config = useRuntimeConfig()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')

const maxOrganizationsPerOwner = ref(3)
const publishingEnabled = ref(false)
const agentLlmProviderConfigurationId = ref<string | null>(null)
const llmProviderConfigurations = ref<LlmProviderConfigurationDto[]>([])
const providerConfigurations = ref<PublishingProviderConfiguration[]>([])
const providerDraft = reactive({ provider: 'meta' as PublishingProvider, clientId: '', clientSecret: '', graphVersion: 'v21.0' })

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const [response, providerResponse, llmResponse] = await Promise.all([
      $fetch(`${config.public.apiBase}/v1/platform-settings`, { headers }),
      $fetch(`${config.public.apiBase}/v1/publishing-providers`, { headers }),
      $fetch(`${config.public.apiBase}/v1/llm-providers`, { headers }),
    ])
    const settings = PlatformSettingSchema.array().parse(response)
    const limitSetting = settings.find((setting) => setting.key === 'max_organizations_per_owner')
    const limitValue = PlatformSettingValueSchemas.max_organizations_per_owner.safeParse(limitSetting?.value)
    if (limitValue.success) maxOrganizationsPerOwner.value = limitValue.data
    const publishingSetting = settings.find((setting) => setting.key === 'publishing_enabled')
    const publishingValue = PlatformSettingValueSchemas.publishing_enabled.safeParse(publishingSetting?.value)
    if (publishingValue.success) publishingEnabled.value = publishingValue.data
    const agentLlmSetting = settings.find((setting) => setting.key === 'agent_llm_provider_configuration_id')
    const agentLlmValue = PlatformSettingValueSchemas.agent_llm_provider_configuration_id.safeParse(agentLlmSetting?.value)
    if (agentLlmValue.success) agentLlmProviderConfigurationId.value = agentLlmValue.data
    providerConfigurations.value = PublishingProviderConfigurationSchema.array().parse(providerResponse)
    llmProviderConfigurations.value = LlmProviderConfigurationSchema.array().parse(llmResponse)
  } catch {
    errorMessage.value = 'Einstellungen konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

function selectProvider(provider: PublishingProvider) {
  providerDraft.provider = PublishingProviderSchema.parse(provider)
  const current = providerConfigurations.value.find((entry) => entry.provider === provider)
  providerDraft.clientId = current?.clientId ?? ''
  providerDraft.clientSecret = ''
  providerDraft.graphVersion = current?.graphVersion ?? (provider === 'meta' ? 'v21.0' : '')
}

async function saveProviderConfiguration() {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const body = UpdatePublishingProviderConfigurationRequestSchema.parse({
      clientId: providerDraft.clientId,
      clientSecret: providerDraft.clientSecret,
      graphVersion: providerDraft.provider === 'meta' ? providerDraft.graphVersion : null,
    })
    await $fetch(`${config.public.apiBase}/v1/publishing-providers/${providerDraft.provider}`, { method: 'PUT', headers, body })
    providerDraft.clientSecret = ''
    await load()
  } catch {
    errorMessage.value = 'Provider-Zugangsdaten konnten nicht gespeichert werden.'
  } finally {
    saving.value = false
  }
}

async function savePublishingEnabled() {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const value = PlatformSettingValueSchemas.publishing_enabled.parse(publishingEnabled.value)
    await $fetch(`${config.public.apiBase}/v1/platform-settings/publishing_enabled`, {
      method: 'PUT', headers, body: { value },
    })
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode
    errorMessage.value = status === 409
      ? 'Aktivieren ist erst möglich, wenn das Deployment im Live-Modus läuft, mindestens ein Provider aktiv ist und dessen Zugangsdaten gespeichert sind.'
      : 'Publishing-Status konnte nicht gespeichert werden.'
    await load()
  } finally {
    saving.value = false
  }
}

const availableAgentLlmProviders = computed(() => llmProviderConfigurations.value.filter((provider) =>
  provider.protocol === 'openai' && provider.taskKind === 'text_generation' && provider.isActive && provider.hasSecret,
))

// Eine gespeicherte Auswahl kann zwischen zwei Seitenaufrufen geloescht oder deaktiviert worden
// sein -- das <Select> zeigt dann einfach keine Auswahl mehr, ohne dass sichtbar wird, dass der
// Assistent seither leise auf die Deployment-Standardkonfiguration zurueckfaellt.
const selectedAgentLlmProviderUnavailable = computed(() =>
  agentLlmProviderConfigurationId.value !== null
  && !availableAgentLlmProviders.value.some((provider) => provider.id === agentLlmProviderConfigurationId.value),
)

async function saveAgentLlmProvider() {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const value = PlatformSettingValueSchemas.agent_llm_provider_configuration_id.parse(agentLlmProviderConfigurationId.value)
    await $fetch(`${config.public.apiBase}/v1/platform-settings/agent_llm_provider_configuration_id`, {
      method: 'PUT', headers, body: { value },
    })
  } catch {
    errorMessage.value = 'Die Modellkonfiguration konnte nicht gespeichert werden.'
    await load()
  } finally {
    saving.value = false
  }
}
await load()

async function saveLimit() {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const value = PlatformSettingValueSchemas.max_organizations_per_owner.parse(maxOrganizationsPerOwner.value)
    await $fetch(`${config.public.apiBase}/v1/platform-settings/max_organizations_per_owner`, {
      method: 'PUT',
      headers,
      body: { value },
    })
  } catch {
    errorMessage.value = 'Limit konnte nicht gespeichert werden.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Plattform-Administration</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Einstellungen</h1>
      <p class="mt-2 text-sm text-[#727a75]">
        Globale Limits. Tarife, Preise und Beitragskontingente werden unter
        <NuxtLink to="/plattform-admin/tarife" class="underline hover:text-forest">Tarife</NuxtLink> verwaltet.
      </p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <template v-else>
      <section class="card p-6">
        <h2 class="mb-4 font-display text-base font-bold">Vereine pro Eigentümer-Konto</h2>
        <div class="flex items-center gap-3">
          <input
            v-model.number="maxOrganizationsPerOwner"
            type="number"
            min="1"
            max="1000"
            class="focus-ring w-24 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm"
          />
          <button class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60" :disabled="saving" @click="saveLimit">
            Speichern
          </button>
        </div>
      </section>
      <section class="card mt-6 p-6">
        <h2 class="font-display text-base font-bold">Vereinsassistent</h2>
        <p class="mt-2 text-sm text-[#727a75]">
          Wähle die aktive OpenAI-kompatible Text-Provider-Konfiguration für den Chat-Agenten. Zugangsdaten bleiben verschlüsselt auf dem Server. Ohne Auswahl verwendet der Assistent die Deployment-Standardkonfiguration.
        </p>
        <div class="mt-4 flex flex-wrap items-end gap-3">
          <label class="min-w-72 flex-1 text-xs font-semibold text-[#5c655f]">Bereitgestelltes LLM
            <Select v-model="agentLlmProviderConfigurationId">
              <SelectTrigger class="mt-1 px-4 py-2.5 text-sm font-normal"><SelectValue placeholder="Deployment-Standard" /></SelectTrigger>
              <SelectContent>
                <SelectItem :value="null">Deployment-Standard</SelectItem>
                <SelectItem v-for="provider in availableAgentLlmProviders" :key="provider.id" :value="provider.id">
                  {{ provider.label }} · {{ provider.model }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <button class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60" :disabled="saving" @click="saveAgentLlmProvider">
            Agenten-LLM speichern
          </button>
        </div>
        <p v-if="availableAgentLlmProviders.length === 0" class="mt-3 text-xs text-[#7a827c]">
          Noch keine aktive OpenAI-kompatible Text-Provider-Konfiguration mit Secret vorhanden. Lege sie unter „LLM-Provider“ an.
        </p>
        <p v-if="selectedAgentLlmProviderUnavailable" class="mt-3 text-xs text-amber-800">
          Die gespeicherte Auswahl wurde gelöscht oder deaktiviert. Der Assistent nutzt aktuell die Deployment-Standardkonfiguration.
        </p>
      </section>
      <section class="card mt-6 p-6">
        <h2 class="font-display text-base font-bold">Veröffentlichungen</h2>
        <p class="mt-2 text-sm text-[#727a75]">
          Deaktiviert verhindert sofort das Einplanen und Ausführen aller externen Veröffentlichungen. Bereits wartende Beiträge bleiben unverändert in der Warteschlange.
        </p>
        <label class="mt-4 flex items-center gap-3 text-sm font-semibold">
          <input v-model="publishingEnabled" type="checkbox" class="h-4 w-4" :disabled="saving" />
          Externe Veröffentlichungen aktivieren
        </label>
        <button class="focus-ring mt-4 rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60" :disabled="saving" @click="savePublishingEnabled">
          Publishing-Status speichern
        </button>
      </section>
      <section class="card mt-6 p-6">
        <h2 class="font-display text-base font-bold">Social-Media-Provider</h2>
        <p class="mt-2 text-sm text-[#727a75]">Client-ID und Secret werden verschlüsselt gespeichert. Das Secret wird nie wieder angezeigt. Meta ist derzeit der einzige Live-Adapter; LinkedIn und X lassen sich vorbereiten, aber noch nicht aktivieren.</p>
        <form class="mt-4 grid gap-3 sm:grid-cols-2" @submit.prevent="saveProviderConfiguration">
          <label class="text-xs font-semibold text-[#5c655f]">Provider
            <Select :model-value="providerDraft.provider" @update:model-value="(value: unknown) => { providerDraft.provider = value as PublishingProvider; selectProvider(value as PublishingProvider) }">
              <SelectTrigger class="mt-1 px-4 py-2.5 text-sm font-normal"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="meta">Meta (Instagram/Facebook)</SelectItem>
                <SelectItem value="linkedin">LinkedIn</SelectItem>
                <SelectItem value="twitter">X / Twitter</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label class="text-xs font-semibold text-[#5c655f]">Client-ID
            <input v-model="providerDraft.clientId" required class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
          </label>
          <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Client-Secret
            <input v-model="providerDraft.clientSecret" type="password" required placeholder="Bei jeder Änderung erneut eingeben" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
          </label>
          <label v-if="providerDraft.provider === 'meta'" class="text-xs font-semibold text-[#5c655f]">Graph-Version
            <input v-model="providerDraft.graphVersion" required class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
          </label>
          <div class="sm:col-span-2"><button class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60" :disabled="saving">Provider speichern</button></div>
        </form>
      </section>
      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
    </template>
  </div>
</template>
