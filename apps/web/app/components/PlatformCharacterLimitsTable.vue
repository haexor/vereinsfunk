<script setup lang="ts">
import {
  SocialPlatformSchema,
  TextGenerationPlatformDefaultSchema,
  UpdateTextGenerationPlatformDefaultRequestSchema,
  type SocialPlatform,
  type TextGenerationPlatformDefault,
} from '@vereinsfunk/contracts'
import { ApiRequestError } from '../utils/apiClient'

// Zeichengrenze je Plattform fuer erzeugte Texte (Plan 042); unabhaengig von den Providern oben auf
// der LLM-Seite, deshalb mit eigenem Laden und Speichern.
const api = useApiClient()

const platformDefaults = ref<TextGenerationPlatformDefault[]>([])
const loading = ref(true)
const loadError = ref('')
const drafts = reactive<Partial<Record<SocialPlatform, number>>>({})
const saving = reactive<Partial<Record<SocialPlatform, boolean>>>({})
const errors = reactive<Partial<Record<SocialPlatform, string>>>({})

function updatedAt(platform: SocialPlatform): string {
  const row = platformDefaults.value.find((entry) => entry.platform === platform)
  return row ? new Date(row.updatedAt).toLocaleString('de-DE') : '–'
}

async function load() {
  loading.value = true
  try {
    platformDefaults.value = await api.request('/v1/text-generation-platform-defaults', {}, TextGenerationPlatformDefaultSchema.array())
    for (const row of platformDefaults.value) drafts[row.platform] = row.maxCharacters
  } catch {
    loadError.value = 'Zeichengrenzen konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

// Der 404-Fall (text_generation_platform_default_not_found) tritt nur auf, wenn eine spaetere
// Migration die Plattform-Menge erweitert, ohne die neue Zeile zu befuellen (siehe Plan 042,
// STOP conditions) -- die Zeile fehlt dann auch schon beim Laden, nicht erst beim Speichern.
async function save(platform: SocialPlatform) {
  const draft = drafts[platform]
  if (draft === undefined) return
  saving[platform] = true
  errors[platform] = ''
  try {
    const body = UpdateTextGenerationPlatformDefaultRequestSchema.parse({ maxCharacters: draft })
    const updated = await api.request(`/v1/text-generation-platform-defaults/${platform}`, { method: 'PUT', body }, TextGenerationPlatformDefaultSchema)
    const index = platformDefaults.value.findIndex((row) => row.platform === platform)
    if (index >= 0) platformDefaults.value[index] = updated
    else platformDefaults.value.push(updated)
    drafts[platform] = updated.maxCharacters
  } catch (error) {
    const code = error instanceof ApiRequestError ? error.code : undefined
    errors[platform] = code === 'text_generation_platform_default_not_found'
      ? 'Für diese Plattform ist keine Vorgabe angelegt.'
      : 'Zeichengrenze konnte nicht gespeichert werden.'
  } finally {
    saving[platform] = false
  }
}
</script>

<template>
  <section class="card overflow-x-auto p-6">
    <h2 class="mb-1 font-display text-base font-bold">Plattform-Vorgaben</h2>
    <p class="mb-4 text-xs text-[#727a75]">
      Obergrenze für die Länge eines erzeugten Textes je Plattform, in Zeichen. 2.200 entspricht Instagrams Bildtext-Grenze.
    </p>
    <div v-if="loading" class="p-4 text-center text-xs text-[#7b827d]">Wird geladen …</div>
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
              v-if="drafts[platform] !== undefined"
              v-model.number="drafts[platform]"
              type="number"
              min="100"
              max="10000"
              step="1"
              class="focus-ring w-28 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-xs font-normal"
            />
            <span v-else class="text-[#9aa096]">Für diese Plattform ist keine Vorgabe angelegt.</span>
          </td>
          <td class="py-2 pr-4 text-[#7b827d]">{{ updatedAt(platform) }}</td>
          <td class="py-2 text-right">
            <button
              type="button"
              class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60"
              :disabled="saving[platform] || drafts[platform] === undefined"
              @click="save(platform)"
            >
              {{ saving[platform] ? 'Speichert …' : 'Speichern' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="loadError" class="mt-2 text-[11px] font-normal text-amber-800">{{ loadError }}</p>
    <p v-for="platform in SocialPlatformSchema.options" :key="`error-${platform}`" v-show="errors[platform]" class="mt-2 text-[11px] font-normal text-amber-800">
      {{ platformLabels[platform] }}: {{ errors[platform] }}
    </p>
  </section>
</template>
