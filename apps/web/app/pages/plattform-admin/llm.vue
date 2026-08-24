<script setup lang="ts">
import {
  CreateLlmProviderConfigurationRequestSchema,
  ListLlmProviderModelsRequestSchema,
  ListLlmProviderModelsResponseSchema,
  LlmProviderConfigurationSchema,
  SocialPlatformSchema,
  TextGenerationPlatformDefaultSchema,
  UpdateLlmProviderConfigurationRequestSchema,
  UpdateTextGenerationPlatformDefaultRequestSchema,
  UuidSchema,
  type LlmProviderConfigurationDto,
  type LlmProviderProtocol,
  type LlmTaskKind,
  type SocialPlatform,
  type TextGenerationPlatformDefault,
} from '@vereinsfunk/contracts'

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
const config = useRuntimeConfig()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const providers = ref<LlmProviderConfigurationDto[]>([])
const taskAssignmentSaving = reactive<Partial<Record<string, boolean>>>({})
const taskAssignmentError = ref('')

const platformDefaults = ref<TextGenerationPlatformDefault[]>([])
const platformDefaultsLoading = ref(true)
const platformDefaultDrafts = reactive<Partial<Record<SocialPlatform, number>>>({})
const platformDefaultSaving = reactive<Partial<Record<SocialPlatform, boolean>>>({})
const platformDefaultErrors = reactive<Partial<Record<SocialPlatform, string>>>({})

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

// Eine geladene Modell-Liste gehoert zu genau einer Basis-URL -- nach einem Wechsel waere sie
// stillschweigend falsch.
watch(() => newProvider.baseUrl, resetModelChoice)

function applyPreset() {
  const preset = visiblePresets.value.find((entry) => entry.label === newProvider.presetLabel)
  newProvider.baseUrl = preset?.baseUrl ?? ''
}

// Protokollwechsel: das bisherige Preset gehoert zum alten Protokoll und passt jetzt nicht mehr.
watch(() => newProvider.protocol, () => {
  newProvider.presetLabel = visiblePresets.value[0]?.label ?? ''
  applyPreset()
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

// Paket 050: welche konfigurierten Provider gerade fuer ihre Aufgabe genutzt werden, ist ausschliesslich
// is_active -- diese Karte gruppiert dieselbe Liste wie oben nur nach Aufgabe und bedient denselben
// PATCH-Endpunkt. Fuer text_generation bestimmt die Anzahl der hier aktivierten Provider zugleich die
// Anzahl der Textvorschlaege (siehe resolveTextGenerationProviderConfigurationIds, apps/api).
const providersByTaskKind = computed(() => {
  const grouped = new Map<LlmTaskKind, LlmProviderConfigurationDto[]>()
  for (const option of TASK_KIND_OPTIONS) grouped.set(option.value, [])
  for (const provider of providers.value) grouped.get(provider.taskKind)?.push(provider)
  return grouped
})

async function toggleProviderActive(provider: LlmProviderConfigurationDto) {
  taskAssignmentSaving[provider.id] = true
  taskAssignmentError.value = ''
  try {
    const headers = await useAuthHeader()
    const body = UpdateLlmProviderConfigurationRequestSchema.parse({ isActive: !provider.isActive })
    const response = await $fetch(`${config.public.apiBase}/v1/llm-providers/${provider.id}`, { method: 'PATCH', headers, body })
    const updated = LlmProviderConfigurationSchema.parse(response)
    const index = providers.value.findIndex((entry) => entry.id === provider.id)
    if (index >= 0) providers.value[index] = updated
  } catch {
    taskAssignmentError.value = 'Der Aktiv-Status konnte nicht geändert werden.'
  } finally {
    taskAssignmentSaving[provider.id] = false
  }
}

function platformDefaultUpdatedAt(platform: SocialPlatform): string {
  const row = platformDefaults.value.find((entry) => entry.platform === platform)
  return row ? new Date(row.updatedAt).toLocaleString('de-DE') : '–'
}

async function loadPlatformDefaults() {
  platformDefaultsLoading.value = true
  try {
    const headers = await useAuthHeader()
    const response = await $fetch(`${config.public.apiBase}/v1/text-generation-platform-defaults`, { headers })
    platformDefaults.value = TextGenerationPlatformDefaultSchema.array().parse(response)
    for (const row of platformDefaults.value) platformDefaultDrafts[row.platform] = row.maxCharacters
  } catch {
    errorMessage.value = 'Zeichengrenzen konnten nicht geladen werden.'
  } finally {
    platformDefaultsLoading.value = false
  }
}
await loadPlatformDefaults()

// Der 404-Fall (text_generation_platform_default_not_found) tritt nur auf, wenn eine spaetere
// Migration die Plattform-Menge erweitert, ohne die neue Zeile zu befuellen (siehe Plan 042,
// STOP conditions) -- die Zeile fehlt dann auch schon beim Laden, nicht erst beim Speichern.
async function savePlatformDefault(platform: SocialPlatform) {
  const draft = platformDefaultDrafts[platform]
  if (draft === undefined) return
  platformDefaultSaving[platform] = true
  platformDefaultErrors[platform] = ''
  try {
    const headers = await useAuthHeader()
    const body = UpdateTextGenerationPlatformDefaultRequestSchema.parse({ maxCharacters: draft })
    const response = await $fetch(`${config.public.apiBase}/v1/text-generation-platform-defaults/${platform}`, { method: 'PUT', headers, body })
    const updated = TextGenerationPlatformDefaultSchema.parse(response)
    const index = platformDefaults.value.findIndex((row) => row.platform === platform)
    if (index >= 0) platformDefaults.value[index] = updated
    else platformDefaults.value.push(updated)
    platformDefaultDrafts[platform] = updated.maxCharacters
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    platformDefaultErrors[platform] = code === 'text_generation_platform_default_not_found'
      ? 'Für diese Plattform ist keine Vorgabe angelegt.'
      : 'Zeichengrenze konnte nicht gespeichert werden.'
  } finally {
    platformDefaultSaving[platform] = false
  }
}

async function loadModels() {
  if (!canLoadModels.value) return
  modelsLoading.value = true
  modelsMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const response = editingProviderId.value && !newProvider.apiKey.trim()
      ? await $fetch(`${config.public.apiBase}/v1/llm-providers/${editingProviderId.value}/models`, { method: 'POST', headers })
      : await $fetch(`${config.public.apiBase}/v1/llm-providers/models`, {
        method: 'POST',
        headers,
        body: ListLlmProviderModelsRequestSchema.parse({ protocol: newProvider.protocol, baseUrl: newProvider.baseUrl, apiKey: newProvider.apiKey }),
      })
    availableModels.value = ListLlmProviderModelsResponseSchema.parse(response).models
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
    const headers = await useAuthHeader()
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
      await $fetch(`${config.public.apiBase}/v1/llm-providers/${editingProviderId.value}`, { method: 'PATCH', headers, body })
    } else {
      const body = CreateLlmProviderConfigurationRequestSchema.parse({ ...values, apiKey: newProvider.apiKey })
      await $fetch(`${config.public.apiBase}/v1/llm-providers`, { method: 'POST', headers, body })
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
            <Select v-model="newProvider.protocol">
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
              v-model="newProvider.baseUrl"
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
                  :disabled="saving"
                  @click="editProvider(provider)"
                >
                  Bearbeiten
                </button>
                <button
                  class="focus-ring ml-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50"
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

      <section class="card p-6">
        <h2 class="mb-1 font-display text-base font-bold">Aufgaben-Zuordnung</h2>
        <p class="mb-4 text-xs text-[#727a75]">
          Welche der oben konfigurierten Provider gerade für ihre Aufgabe genutzt werden. Für Textgenerierung bestimmt die Anzahl aktivierter Provider zugleich, wie viele Textvorschläge gleichzeitig entstehen.
        </p>
        <div v-for="option in TASK_KIND_OPTIONS" :key="option.value" class="mb-5 last:mb-0">
          <h3 class="mb-2 text-xs font-bold text-[#3c4238]">{{ option.label }}</h3>
          <p v-if="!providersByTaskKind.get(option.value)?.length" class="text-xs text-[#9aa096]">Noch kein Provider für diese Aufgabe konfiguriert.</p>
          <ul v-else class="space-y-1.5">
            <li v-for="provider in providersByTaskKind.get(option.value)" :key="provider.id" class="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                class="accent-forest"
                :checked="provider.isActive"
                :disabled="taskAssignmentSaving[provider.id]"
                @change="toggleProviderActive(provider)"
              />
              <span :class="provider.isActive ? 'font-semibold text-forest' : 'text-[#5c655f]'">{{ provider.label }}</span>
              <span class="text-[#9aa096]">({{ provider.model }})</span>
            </li>
          </ul>
        </div>
        <p v-if="taskAssignmentError" class="mt-2 text-[11px] font-normal text-amber-800">{{ taskAssignmentError }}</p>
      </section>

      <section class="card overflow-x-auto p-6">
        <h2 class="mb-1 font-display text-base font-bold">Plattform-Vorgaben</h2>
        <p class="mb-4 text-xs text-[#727a75]">
          Obergrenze für die Länge eines erzeugten Textes je Plattform, in Zeichen. 2.200 entspricht Instagrams Bildtext-Grenze.
        </p>
        <div v-if="platformDefaultsLoading" class="p-4 text-center text-xs text-[#7b827d]">Wird geladen …</div>
        <table v-else class="w-full text-left text-xs">
          <thead>
            <tr class="text-[#7b827d]">
              <th class="pb-2 pr-4 font-semibold">Plattform</th>
              <th class="pb-2 pr-4 font-semibold">Zeichengrenze</th>
              <th class="pb-2 pr-4 font-semibold">Aktualisiert am</th>
              <th class="pb-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="platform in SocialPlatformSchema.options" :key="platform" class="border-t border-[#e9ebe4]">
              <td class="py-2 pr-4 font-medium">{{ platformLabels[platform] }}</td>
              <td class="py-2 pr-4">
                <input
                  v-if="platformDefaultDrafts[platform] !== undefined"
                  v-model.number="platformDefaultDrafts[platform]"
                  type="number"
                  min="100"
                  max="10000"
                  step="1"
                  class="focus-ring w-28 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-xs font-normal"
                />
                <span v-else class="text-[#9aa096]">Für diese Plattform ist keine Vorgabe angelegt.</span>
              </td>
              <td class="py-2 pr-4 text-[#7b827d]">{{ platformDefaultUpdatedAt(platform) }}</td>
              <td class="py-2 text-right">
                <button
                  type="button"
                  class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60"
                  :disabled="platformDefaultSaving[platform] || platformDefaultDrafts[platform] === undefined"
                  @click="savePlatformDefault(platform)"
                >
                  {{ platformDefaultSaving[platform] ? 'Speichert …' : 'Speichern' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-for="platform in SocialPlatformSchema.options" :key="`error-${platform}`" v-show="platformDefaultErrors[platform]" class="mt-2 text-[11px] font-normal text-amber-800">
          {{ platformLabels[platform] }}: {{ platformDefaultErrors[platform] }}
        </p>
      </section>
      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
    </template>
  </div>
</template>
