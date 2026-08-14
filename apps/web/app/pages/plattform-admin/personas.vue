<script setup lang="ts">
import {
  CreatePlatformStylePersonaRequestSchema,
  GeneratedPostSchema,
  PlatformStylePersonaSchema,
  PreviewPlatformStylePersonaRequestSchema,
  StyleProfilePromptPreviewSchema,
  type GeneratedPost,
  type PlatformStylePersona,
  type StyleProfilePromptPreview,
} from '@vereinsfunk/contracts'
import { avoidRulesFromDraft, doRulesFromDraft, emptyStyleProfileDraft, previewErrorMessage, styleRulesFromDraft } from '../../utils/styleProfileDraft'

definePageMeta({ layout: 'admin' })

const api = useApiClient()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const personas = ref<PlatformStylePersona[]>([])

const draft = ref({ slug: '', ...emptyStyleProfileDraft() })
const formError = ref('')

function resetForm() {
  draft.value = { slug: '', ...emptyStyleProfileDraft() }
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    personas.value = await api.request('/v1/platform-style-personas', {}, PlatformStylePersonaSchema.array())
  } catch {
    errorMessage.value = 'Personas konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

async function createPersona() {
  if (!draft.value.slug.trim() || !draft.value.name.trim() || !draft.value.description.trim()) return
  saving.value = true
  formError.value = ''
  try {
    const body = CreatePlatformStylePersonaRequestSchema.parse({
      slug: draft.value.slug,
      name: draft.value.name,
      description: draft.value.description,
      styleRules: styleRulesFromDraft(draft.value),
      avoidRules: avoidRulesFromDraft(draft.value),
      doRules: doRulesFromDraft(draft.value),
    })
    await api.request('/v1/platform-style-personas', { method: 'POST', body })
    resetForm()
    previewResult.value = null
    promptPreviewResult.value = null
    await load()
  } catch {
    formError.value = 'Persona konnte nicht angelegt werden.'
  } finally {
    saving.value = false
  }
}

function previewRequestBody() {
  return PreviewPlatformStylePersonaRequestSchema.parse({
    name: draft.value.name,
    description: draft.value.description,
    styleRules: styleRulesFromDraft(draft.value),
    avoidRules: avoidRulesFromDraft(draft.value),
    doRules: doRulesFromDraft(draft.value),
    sampleInput: draft.value.sampleInput,
  })
}

const previewing = ref(false)
const previewResult = ref<GeneratedPost | null>(null)
const previewError = ref('')
const previewKey = ref(crypto.randomUUID())
watch(draft, () => { previewKey.value = crypto.randomUUID() }, { deep: true })

async function testPersona() {
  previewing.value = true
  previewError.value = ''
  try {
    previewResult.value = await api.request('/v1/platform-style-personas/preview', { method: 'POST', body: previewRequestBody(), headers: { 'idempotency-key': previewKey.value } }, GeneratedPostSchema)
    previewKey.value = crypto.randomUUID()
  } catch (error) {
    previewError.value = previewErrorMessage(error)
  } finally {
    previewing.value = false
  }
}

const promptPreviewing = ref(false)
const promptPreviewResult = ref<StyleProfilePromptPreview | null>(null)
const promptPreviewError = ref('')

async function showPrompt() {
  promptPreviewing.value = true
  promptPreviewError.value = ''
  try {
    promptPreviewResult.value = await api.request('/v1/platform-style-personas/prompt-preview', { method: 'POST', body: previewRequestBody() }, StyleProfilePromptPreviewSchema)
  } catch {
    promptPreviewError.value = 'Der System-Prompt konnte nicht angezeigt werden.'
  } finally {
    promptPreviewing.value = false
  }
}

async function toggleActive(persona: PlatformStylePersona) {
  saving.value = true
  errorMessage.value = ''
  try {
    await api.request(`/v1/platform-style-personas/${persona.id}`, { method: 'PATCH', body: { isActive: !persona.isActive } })
    await load()
  } catch {
    errorMessage.value = 'Status konnte nicht geändert werden.'
  } finally {
    saving.value = false
  }
}

async function removePersona(persona: PlatformStylePersona) {
  if (!confirm(`"${persona.name}" wirklich löschen? Bereits akzeptierte Textkandidaten bleiben davon unberührt.`)) return
  saving.value = true
  errorMessage.value = ''
  try {
    await api.request(`/v1/platform-style-personas/${persona.id}`, { method: 'DELETE' })
    await load()
  } catch {
    errorMessage.value = 'Persona konnte nicht entfernt werden.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Plattform-Administration</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Personas</h1>
      <p class="mt-2 text-sm text-[#727a75]">
        Kuratierte Stilprofile, die allen Vereinen in der Textwerkstatt zusätzlich zu den Basismodi und eigenen Vereinsprofilen zur Auswahl stehen. Inhaltliche Kuration realer Personen ist eine redaktionelle Entscheidung außerhalb dieser Oberfläche.
      </p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <template v-else>
      <section class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Persona anlegen</h2>
        <label class="mb-4 block text-xs font-semibold text-[#5c655f]">Slug
          <input
            v-model="draft.slug"
            type="text"
            required
            placeholder="z.B. kapitaen-klar"
            class="focus-ring mt-1 w-full max-w-sm rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal"
          />
        </label>
      </section>

      <StyleProfileEditorForm
        v-model:draft="draft"
        :saving="saving"
        :error="formError"
        :previewing="previewing"
        :preview-result="previewResult"
        :preview-error="previewError"
        :prompt-previewing="promptPreviewing"
        :prompt-preview-result="promptPreviewResult"
        :prompt-preview-error="promptPreviewError"
        submit-label="Anlegen"
        @save="createPersona"
        @preview="testPersona"
        @prompt-preview="showPrompt"
      />

      <section class="card overflow-x-auto p-6">
        <h2 class="mb-4 font-display text-base font-bold">Personas ({{ personas.length }})</h2>
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="text-[#7b827d]">
              <th class="pb-2 pr-4 font-semibold">Name</th>
              <th class="pb-2 pr-4 font-semibold">Slug</th>
              <th class="pb-2 pr-4 font-semibold">Beschreibung</th>
              <th class="pb-2 pr-4 font-semibold">Aktiv</th>
              <th class="pb-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="persona in personas" :key="persona.id" class="border-t border-[#e9ebe4]">
              <td class="py-2 pr-4 font-medium">{{ persona.name }}</td>
              <td class="py-2 pr-4">{{ persona.slug }}</td>
              <td class="py-2 pr-4">{{ persona.description }}</td>
              <td class="py-2 pr-4">
                <button
                  type="button"
                  class="focus-ring rounded-lg px-2 py-1 text-[11px] font-semibold"
                  :class="persona.isActive ? 'text-forest' : 'text-[#9aa096]'"
                  :disabled="saving"
                  @click="toggleActive(persona)"
                >
                  {{ persona.isActive ? 'Aktiv' : 'Inaktiv' }}
                </button>
              </td>
              <td class="py-2 text-right">
                <button
                  class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50"
                  :disabled="saving"
                  @click="removePersona(persona)"
                >
                  Entfernen
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!personas.length" class="py-4 text-center text-xs text-[#9aa096]">Noch keine Persona angelegt.</p>
      </section>
      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
    </template>
  </div>
</template>
