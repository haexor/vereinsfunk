<script setup lang="ts">
import {
  CreateLlmProviderConfigurationRequestSchema,
  ListLlmProviderModelsRequestSchema,
  ListLlmProviderModelsResponseSchema,
  LlmProviderConfigurationSchema,
  UpdateLlmProviderConfigurationRequestSchema,
  UuidSchema,
  type LlmProviderConfigurationDto,
  type LlmProviderProtocol,
  type LlmTaskKind,
} from '@vereinsfunk/contracts'
import { ApiRequestError } from '../../utils/apiClient'

definePageMeta({ layout: 'admin' })

// Bekannte Endpunkte je Protokoll. Die Liste belegt nur die Basis-URL vor; Modelle kommen nicht
// von hier, sondern vom Anbieter selbst (siehe loadModels) -- eine gepflegte Modell-Liste waere
// mit jedem Anbieter-Release veraltet. Eine eigene Proxy-Instanz hat keine feste Adresse und
// laeuft deshalb ueber "Eigene URL …".
// Reihenfolge ist bedeutsam: der erste Eintrag ist die Vorauswahl und muss zum Standardprotokoll
// unten passen.
const PROVIDER_PRESETS = [
  { label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { label: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { label: 'Mistral', protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1' },
  { label: 'Groq', protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  { label: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
] as const

// Beide Protokolle haben einen Adapter im Worker. Bei den Aufgabenarten stehen die
// unimplementierten trotzdem im Auswahlfeld -- gesperrt, damit sichtbar ist, dass es diese Achse
// gibt, ohne dass sich jemand einen Fehlschlag einhandelt.
const PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI-kompatibel', available: true },
  { value: 'anthropic', label: 'Anthropic (nativ)', available: true },
] as const
const TASK_KIND_OPTIONS = [
  { value: 'text_generation', label: 'Textgenerierung', available: true },
  // Paket 048: seit dem Vision-Adapter im Worker aktivierbar (siehe IMPLEMENTED_LLM_TASK_KINDS in
  // apps/api). Ohne einen so angelegten Provider findet die Markenerkennung aus der Vereins-
  // Homepage keinen und scheitert mit 'no_vision_provider_configured'.
  { value: 'vision_analysis', label: 'Bildanalyse (Markenerkennung)', available: true },
  { value: 'image_generation', label: 'Bildgenerierung', available: false },
  { value: 'video_generation', label: 'Videogenerierung', available: false },
] as const
const api = useApiClient()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const providers = ref<LlmProviderConfigurationDto[]>([])

const availableModels = ref<string[]>([])
const modelsLoading = ref(false)
const modelsMessage = ref('')
const useCustomModel = ref(false)
const editingProviderId = ref<string | null>(null)
const isEditing = computed(() => editingProviderId.value !== null)

const newProvider = reactive({
  label: '',
  protocol: 'openai' as LlmProviderProtocol,
  taskKind: 'text_generation' as LlmTaskKind,
  presetLabel: PROVIDER_PRESETS[0].label as string,
  baseUrl: PROVIDER_PRESETS[0].baseUrl as string,
  model: '',
  apiKey: '',
  isActive: true,
})

const usesPreset = computed(() => newProvider.presetLabel !== '')
// Protokoll, Anbieter und Basis-URL setzen ihre Folgefelder nur zurueck, wenn die Person sie
// aendert (Setter statt Watcher): editProvider() fuellt alle Felder auf einmal, ein Watcher liefe
// danach trotzdem los, leerte das gespeicherte Modell und ersetzte eine eigene Proxy-URL durch das
// erste Preset des Protokolls.
const protocolModel = computed({
  get: () => newProvider.protocol,
  set: (value: LlmProviderProtocol) => {
    newProvider.protocol = value
    // Das bisherige Preset gehoert zum alten Protokoll und passt jetzt nicht mehr.
    newProvider.presetLabel = visiblePresets.value[0]?.label ?? ''
    applyPreset()
  },
})
const baseUrlModel = computed({
  get: () => newProvider.baseUrl,
  set: (value: string) => {
    if (value === newProvider.baseUrl) return
    newProvider.baseUrl = value
    // Eine geladene Modell-Liste gehoert zu genau einer Basis-URL -- nach einem Wechsel waere sie
    // stillschweigend falsch.
    resetModelChoice()
  },
})
const presetLabelModel = computed({
  get: () => newProvider.presetLabel || '__none__',
  set: (value: string) => {
    newProvider.presetLabel = value === '__none__' ? '' : value
    applyPreset()
  },
})
const showModelSelect = computed(() => availableModels.value.length > 0 && !useCustomModel.value)
const modelSelectGroups = computed(() => [{
  label: 'Verfügbare Modelle',
  items: availableModels.value.map((model) => ({ value: model, label: model })),
}])
// Beim Bearbeiten verwendet der Server den dort verschluesselt gespeicherten Schluessel. Fuer
// neue Provider (oder wenn ein neuer Schluessel eingegeben wurde) bleibt der explizite Abruf mit
// dem aktuellen Formularwert erhalten, damit die Modellliste sofort zur neuen Eingabe passt.
const canLoadModels = computed(() => isEditing.value || (newProvider.baseUrl.trim().length > 0 && newProvider.apiKey.trim().length > 0))
// Ein Preset gehoert zu genau einem Protokoll -- ein OpenAI-Endpunkt unter "Anthropic (nativ)"
// waere eine Konfiguration, die erst im Worker auffliegt.
const visiblePresets = computed(() => PROVIDER_PRESETS.filter((preset) => preset.protocol === newProvider.protocol))

function resetModelChoice() {
  availableModels.value = []
  useCustomModel.value = false
  modelsMessage.value = ''
  newProvider.model = ''
}

function resetProviderForm() {
  editingProviderId.value = null
  newProvider.label = ''
  newProvider.protocol = PROVIDER_PRESETS[0].protocol
  newProvider.taskKind = 'text_generation'
  newProvider.presetLabel = PROVIDER_PRESETS[0].label
  newProvider.baseUrl = PROVIDER_PRESETS[0].baseUrl
  newProvider.model = ''
  newProvider.apiKey = ''
  newProvider.isActive = true
  resetModelChoice()
}

function editProvider(provider: LlmProviderConfigurationDto) {
  editingProviderId.value = provider.id
  newProvider.label = provider.label
  newProvider.protocol = provider.protocol
  newProvider.taskKind = provider.taskKind
  const preset = PROVIDER_PRESETS.find((entry) => entry.protocol === provider.protocol && entry.baseUrl === provider.baseUrl)
  newProvider.presetLabel = preset?.label ?? ''
  newProvider.baseUrl = provider.baseUrl
  newProvider.model = provider.model
  newProvider.apiKey = ''
  newProvider.isActive = provider.isActive
  resetModelChoice()
  newProvider.model = provider.model
  useCustomModel.value = true
  errorMessage.value = ''
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function applyPreset() {
  const preset = visiblePresets.value.find((entry) => entry.label === newProvider.presetLabel)
  baseUrlModel.value = preset?.baseUrl ?? ''
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    providers.value = await api.request('/v1/llm-providers', {}, LlmProviderConfigurationSchema.array())
  } catch {
    errorMessage.value = 'LLM-Provider konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

// Die Aufgaben-Zuordnung gruppiert dieselbe Liste nach Aufgabe (LlmTaskAssignmentCard).
const taskAssignmentGroups = computed(() => TASK_KIND_OPTIONS.map((option) => ({
  taskKind: option.value,
  label: option.label,
  providers: providers.value.filter((provider) => provider.taskKind === option.value),
})))

function replaceProvider(updated: LlmProviderConfigurationDto) {
  const index = providers.value.findIndex((entry) => entry.id === updated.id)
  if (index >= 0) providers.value[index] = updated
}

async function loadModels() {
  if (!canLoadModels.value) return
  modelsLoading.value = true
  modelsMessage.value = ''
  try {
    const response = editingProviderId.value && !newProvider.apiKey.trim()
      ? await api.request(`/v1/llm-providers/${editingProviderId.value}/models`, { method: 'POST' }, ListLlmProviderModelsResponseSchema)
      : await api.request('/v1/llm-providers/models', {
        method: 'POST',
        body: ListLlmProviderModelsRequestSchema.parse({ protocol: newProvider.protocol, baseUrl: newProvider.baseUrl, apiKey: newProvider.apiKey }),
      }, ListLlmProviderModelsResponseSchema)
    availableModels.value = response.models
    useCustomModel.value = false
    if (!availableModels.value.includes(newProvider.model)) newProvider.model = availableModels.value[0] ?? ''
  } catch {
    // Nicht jeder Anbieter kennt /models. Das Formular faellt dann auf die freie Eingabe zurueck,
    // statt das Anlegen zu blockieren.
    availableModels.value = []
    useCustomModel.value = true
    modelsMessage.value = 'Modelle konnten nicht abgerufen werden. Bitte den Modellnamen eintragen.'
  } finally {
    modelsLoading.value = false
  }
}

async function saveProvider() {
  if (!newProvider.label.trim() || !newProvider.baseUrl.trim() || !newProvider.model.trim() || (!isEditing.value && !newProvider.apiKey.trim())) return
  saving.value = true
  errorMessage.value = ''
  try {
    const values = {
      label: newProvider.label,
      protocol: newProvider.protocol,
      baseUrl: newProvider.baseUrl,
      model: newProvider.model,
      taskKind: newProvider.taskKind,
      isActive: newProvider.isActive,
    }
    if (editingProviderId.value) {
      const body = UpdateLlmProviderConfigurationRequestSchema.parse({ ...values, apiKey: newProvider.apiKey.trim() || undefined })
      await api.request(`/v1/llm-providers/${editingProviderId.value}`, { method: 'PATCH', body })
    } else {
      const body = CreateLlmProviderConfigurationRequestSchema.parse({ ...values, apiKey: newProvider.apiKey })
      await api.request('/v1/llm-providers', { method: 'POST', body })
    }
    resetProviderForm()
    await load()
  } catch {
    errorMessage.value = isEditing.value ? 'Provider konnte nicht gespeichert werden.' : 'Provider konnte nicht angelegt werden.'
  } finally {
    saving.value = false
  }
}

async function removeProvider(id: string) {
  saving.value = true
  errorMessage.value = ''
  try {
    const providerId = UuidSchema.parse(id)
    await api.request(`/v1/llm-providers/${providerId}`, { method: 'DELETE' })
    await load()
  } catch (error) {
    // Bereits erzeugte Texte verweisen auf den Provider (on delete restrict); abschalten geht immer.
    errorMessage.value = error instanceof ApiRequestError && error.code === 'llm_provider_in_use'
      ? 'Dieser Provider wurde schon für Texte verwendet und kann deshalb nicht gelöscht werden. Deaktiviere ihn stattdessen.'
      : 'Provider konnte nicht entfernt werden.'
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
        Routing für die ausschließlich asynchrone Textgenerierung. Ein hinterlegter Schlüssel wird nie wieder im Klartext angezeigt; nur der abgesicherte Server nutzt ihn für die Modellauswahl.
      </p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <template v-else>
      <section class="card mb-6 p-6">
        <div class="mb-4 flex items-center justify-between gap-3">
          <h2 class="font-display text-base font-bold">{{ isEditing ? 'Provider bearbeiten' : 'Provider hinzufügen' }}</h2>
          <button v-if="isEditing" type="button" class="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold text-[#5c655f] hover:bg-[#f4f5f1]" @click="resetProviderForm">Abbrechen</button>
        </div>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="saveProvider">
          <input
            v-model="newProvider.label"
            type="text"
            required
            placeholder="Bezeichnung, z.B. Claude via haex-claude-proxy"
            class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm sm:col-span-2"
          />

          <label class="text-xs font-semibold text-[#5c655f]">Protokoll
            <Select v-model="protocolModel">
              <SelectTrigger class="mt-1 px-4 py-2.5 text-sm font-normal"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in PROTOCOL_OPTIONS" :key="option.value" :value="option.value" :disabled="!option.available">
                  {{ option.available ? option.label : `${option.label} · noch nicht verfügbar` }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label class="text-xs font-semibold text-[#5c655f]">Aufgabe
            <Select v-model="newProvider.taskKind">
              <SelectTrigger class="mt-1 px-4 py-2.5 text-sm font-normal"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in TASK_KIND_OPTIONS" :key="option.value" :value="option.value" :disabled="!option.available">
                  {{ option.available ? option.label : `${option.label} · noch nicht verfügbar` }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Anbieter
            <Select v-model="presetLabelModel">
              <SelectTrigger class="mt-1 px-4 py-2.5 text-sm font-normal"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="preset in visiblePresets" :key="preset.label" :value="preset.label">{{ preset.label }}</SelectItem>
                <SelectItem value="__none__">Eigene URL …</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Basis-URL
            <input
              v-model="baseUrlModel"
              type="url"
              required
              :disabled="usesPreset"
              placeholder="https://mein-proxy.example/v1"
              class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal disabled:bg-[#f4f5f1] disabled:text-[#7b827d]"
            />
          </label>

          <input
            v-model="newProvider.apiKey"
            type="password"
            :required="!isEditing"
            :placeholder="isEditing ? 'Leer lassen, um den hinterlegten Schlüssel zu behalten' : 'API-Key / Bearer-Token'"
            class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm sm:col-span-2"
          />
          <p v-if="isEditing" class="-mt-1 text-[11px] text-[#727a75] sm:col-span-2">Der hinterlegte Schlüssel kann aus Sicherheitsgründen nicht angezeigt werden.</p>

          <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Modell
            <div class="mt-1 flex gap-2">
              <SearchableSelect
                v-if="showModelSelect"
                v-model="newProvider.model"
                :groups="modelSelectGroups"
                placeholder="Modell auswählen …"
                class="min-w-0 flex-1"
              />
              <input
                v-else
                v-model="newProvider.model"
                type="text"
                required
                placeholder="Modell, z.B. claude-opus-5"
                class="focus-ring w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal"
              />
              <button
                type="button"
                class="focus-ring shrink-0 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-xs font-bold disabled:opacity-60"
                :disabled="!canLoadModels || modelsLoading"
                @click="loadModels"
              >
                {{ modelsLoading ? 'Lädt …' : 'Modelle laden' }}
              </button>
            </div>
            <button
              v-if="showModelSelect"
              type="button"
              class="focus-ring mt-1 rounded-lg text-[11px] font-semibold text-[#7b827d] underline"
              @click="useCustomModel = true"
            >
              Modellnamen selbst eingeben
            </button>
            <p v-if="modelsMessage" class="mt-1 text-[11px] font-normal text-amber-800">{{ modelsMessage }}</p>
            <p v-else-if="!showModelSelect" class="mt-1 text-[11px] font-normal text-[#9aa096]">{{ isEditing ? 'Modelle des hinterlegten Providers laden.' : 'Basis-URL und Schlüssel eintragen, dann Modelle laden.' }}</p>
          </label>

          <label class="flex items-center gap-2 text-xs font-semibold text-[#5c655f] sm:col-span-2">
            <input v-model="newProvider.isActive" type="checkbox" class="accent-forest" /> Aktiv
          </label>
          <button
            type="submit"
            class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60 sm:col-span-2"
            :disabled="saving"
          >
            {{ isEditing ? 'Änderungen speichern' : 'Anlegen' }}
          </button>
        </form>
      </section>

      <LlmProviderTable :providers="providers" :busy="saving" @edit="editProvider" @remove="removeProvider" />
      <LlmTaskAssignmentCard :groups="taskAssignmentGroups" @updated="replaceProvider" />
      <PlatformCharacterLimitsTable />
      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
    </template>
  </div>
</template>
