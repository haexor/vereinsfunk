<script setup lang="ts">
import {
  CreatePlatformStylePersonaRequestSchema,
  PlatformStylePersonaSchema,
  UpdatePlatformStylePersonaRequestSchema,
  UuidSchema,
  type PlatformStylePersona,
} from '@vereinsfunk/contracts'

definePageMeta({ layout: 'admin' })

const SENTENCE_LENGTH_OPTIONS = [
  { value: 'short', label: 'Kurz' },
  { value: 'mixed', label: 'Gemischt' },
  { value: 'long', label: 'Lang' },
] as const
const HUMOUR_OPTIONS = [
  { value: 'none', label: 'Kein Humor' },
  { value: 'light', label: 'Leichter Humor' },
] as const
const FORMALITY_OPTIONS = [
  { value: 'casual', label: 'Locker' },
  { value: 'balanced', label: 'Ausgewogen' },
  { value: 'formal', label: 'Formell' },
] as const
const PERSPECTIVE_OPTIONS = [
  { value: 'we', label: 'Wir' },
  { value: 'club', label: 'Der Verein' },
  { value: 'you', label: 'Du/Sie' },
] as const

const config = useRuntimeConfig()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const personas = ref<PlatformStylePersona[]>([])

const newPersona = reactive({
  slug: '',
  name: '',
  description: '',
  sentenceLength: 'short' as 'short' | 'mixed' | 'long',
  energy: 3,
  humour: 'none' as 'none' | 'light',
  formality: 'balanced' as 'casual' | 'balanced' | 'formal',
  perspective: 'we' as 'we' | 'club' | 'you',
  bannedPhrasesText: '',
  additionalInstructions: '',
  avoidRulesText: '',
})

function resetForm() {
  newPersona.slug = ''
  newPersona.name = ''
  newPersona.description = ''
  newPersona.sentenceLength = 'short'
  newPersona.energy = 3
  newPersona.humour = 'none'
  newPersona.formality = 'balanced'
  newPersona.perspective = 'we'
  newPersona.bannedPhrasesText = ''
  newPersona.additionalInstructions = ''
  newPersona.avoidRulesText = ''
}

function linesToList(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch(`${config.public.apiBase}/v1/platform-style-personas`, { headers })
    personas.value = PlatformStylePersonaSchema.array().parse(response)
  } catch {
    errorMessage.value = 'Personas konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

async function createPersona() {
  if (!newPersona.slug.trim() || !newPersona.name.trim() || !newPersona.description.trim()) return
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const body = CreatePlatformStylePersonaRequestSchema.parse({
      slug: newPersona.slug,
      name: newPersona.name,
      description: newPersona.description,
      styleRules: {
        sentenceLength: newPersona.sentenceLength,
        energy: newPersona.energy,
        humour: newPersona.humour,
        formality: newPersona.formality,
        perspective: newPersona.perspective,
        bannedPhrases: linesToList(newPersona.bannedPhrasesText),
        additionalInstructions: newPersona.additionalInstructions,
      },
      avoidRules: linesToList(newPersona.avoidRulesText),
    })
    await $fetch(`${config.public.apiBase}/v1/platform-style-personas`, { method: 'POST', headers, body })
    resetForm()
    await load()
  } catch {
    errorMessage.value = 'Persona konnte nicht angelegt werden.'
  } finally {
    saving.value = false
  }
}

async function toggleActive(persona: PlatformStylePersona) {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const id = UuidSchema.parse(persona.id)
    const body = UpdatePlatformStylePersonaRequestSchema.parse({ isActive: !persona.isActive })
    await $fetch(`${config.public.apiBase}/v1/platform-style-personas/${id}`, { method: 'PATCH', headers, body })
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
    const headers = await useAuthHeader()
    const id = UuidSchema.parse(persona.id)
    await $fetch(`${config.public.apiBase}/v1/platform-style-personas/${id}`, { method: 'DELETE', headers })
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
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="createPersona">
          <input
            v-model="newPersona.slug"
            type="text"
            required
            placeholder="Slug, z.B. kapitaen-klar"
            class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm"
          />
          <input
            v-model="newPersona.name"
            type="text"
            required
            placeholder="Name, z.B. Kapitän Klar"
            class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm"
          />
          <textarea
            v-model="newPersona.description"
            required
            rows="2"
            placeholder="Kurzbeschreibung für die Auswahl in der Textwerkstatt"
            class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm sm:col-span-2"
          />

          <label class="text-xs font-semibold text-[#5c655f]">Satzlänge
            <select v-model="newPersona.sentenceLength" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal">
              <option v-for="option in SENTENCE_LENGTH_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label class="text-xs font-semibold text-[#5c655f]">Energie (1–5)
            <input v-model.number="newPersona.energy" type="number" min="1" max="5" step="1" required class="mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
          </label>
          <label class="text-xs font-semibold text-[#5c655f]">Humor
            <select v-model="newPersona.humour" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal">
              <option v-for="option in HUMOUR_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label class="text-xs font-semibold text-[#5c655f]">Formalität
            <select v-model="newPersona.formality" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal">
              <option v-for="option in FORMALITY_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Perspektive
            <select v-model="newPersona.perspective" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal">
              <option v-for="option in PERSPECTIVE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>

          <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Verbotene Formulierungen (eine je Zeile)
            <textarea v-model="newPersona.bannedPhrasesText" rows="3" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
          </label>
          <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Zusätzliche Anweisung (max. 1000 Zeichen, niedrig priorisiert)
            <textarea v-model="newPersona.additionalInstructions" rows="3" maxlength="1000" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
            <p class="mt-1 text-[11px] font-normal text-[#9aa096]">{{ newPersona.additionalInstructions.length }}/1000 Zeichen</p>
          </label>
          <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Zu vermeiden (eine je Zeile)
            <textarea v-model="newPersona.avoidRulesText" rows="3" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
          </label>

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
                  class="focus-ring rounded-lg px-2 py-1 text-[11px] font-semibold"
                  :class="persona.isActive ? 'text-forest' : 'text-[#9aa096]'"
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
