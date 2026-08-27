<script setup lang="ts">
import { CreateVisionProviderComparisonRunRequestSchema, VisionProviderComparisonRunSchema, type VisionProviderComparisonRun } from '@vereinsfunk/contracts'

definePageMeta({ layout: 'admin' })

const config = useRuntimeConfig()
const runs = ref<VisionProviderComparisonRun[]>([])
const loading = ref(true)
const errorMessage = ref('')

const websiteUrl = ref('')
const submitting = ref(false)
const submitError = ref('')

let pollTimer: ReturnType<typeof setTimeout> | undefined

async function loadRuns() {
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch(`${config.public.apiBase}/v1/vision-provider-comparisons`, { headers })
    runs.value = VisionProviderComparisonRunSchema.array().parse(response)
  } catch {
    errorMessage.value = 'Vergleichsläufe konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await loadRuns()

// Ein Cron-Poll im Worker (nicht workflow_outbox) startet einen Lauf erst innerhalb der naechsten
// Minute (siehe createVisionProviderComparisonScanWorkflow) -- die Seite pollt deshalb, statt auf
// eine sofortige Antwort zu warten.
function hasUnfinishedRun(): boolean {
  return runs.value.some((run) => run.status === 'pending' || run.status === 'running')
}

function ensurePolling() {
  // Diese Seite laedt ihre Laeufe per Top-Level-await, das laeuft auch waehrend SSR -- ohne den
  // client-Guard wuerde der Timer serverseitig gestartet, obwohl onUnmounted() dort nie feuert.
  if (!import.meta.client || pollTimer || !hasUnfinishedRun()) return
  pollTimer = setTimeout(async function poll() {
    await loadRuns()
    // Erst nach Abschluss des laufenden Requests neu planen statt per setInterval parallel
    // loszuschicken -- sonst koennten Antworten in falscher Reihenfolge eintreffen.
    pollTimer = hasUnfinishedRun() ? setTimeout(poll, 4000) : undefined
  }, 4000)
}
ensurePolling()
onUnmounted(() => { if (pollTimer) clearTimeout(pollTimer) })

async function submitRun() {
  if (!websiteUrl.value.trim()) return
  submitting.value = true
  submitError.value = ''
  try {
    const headers = await useAuthHeader()
    const body = CreateVisionProviderComparisonRunRequestSchema.parse({ websiteUrl: websiteUrl.value.trim() })
    await $fetch(`${config.public.apiBase}/v1/vision-provider-comparisons`, { method: 'POST', headers, body })
    websiteUrl.value = ''
    await loadRuns()
    ensurePolling()
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    submitError.value = code === 'website_url_not_allowed'
      ? 'Diese Adresse darf nicht abgerufen werden.'
      : 'Vergleichslauf konnte nicht gestartet werden.'
  } finally {
    submitting.value = false
  }
}

const STATUS_LABELS: Record<VisionProviderComparisonRun['status'], string> = {
  pending: 'Wartet …', running: 'Läuft …', succeeded: 'Fertig', failed: 'Fehlgeschlagen',
}
const SWATCH_FIELDS = [
  { key: 'primaryColor', label: 'Primär' },
  { key: 'accentColor', label: 'Akzent' },
  { key: 'backgroundColor', label: 'Hintergrund' },
  { key: 'textColor', label: 'Text' },
  { key: 'onPrimaryColor', label: 'Auf Primär' },
] as const
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Plattform-Administration</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Vision-Vergleich</h1>
      <p class="mt-2 text-sm text-[#727a75]">
        Eine Test-URL gegen alle aktuell aktiven Vision-Provider laufen lassen und die Farb-/Font-Vorschläge nebeneinander vergleichen -- Grundlage für die Entscheidung, welche Modelle für die echte Markenerkennung aktiv bleiben.
      </p>
    </header>

    <section class="card mb-6 p-6">
      <h2 class="mb-4 font-display text-base font-bold">Neuen Vergleich starten</h2>
      <form class="flex flex-wrap items-start gap-3" @submit.prevent="submitRun">
        <input
          v-model="websiteUrl"
          type="url"
          required
          placeholder="https://www.mein-verein.example"
          class="focus-ring min-w-64 flex-1 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm"
        />
        <button
          type="submit"
          class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60"
          :disabled="submitting"
        >
          {{ submitting ? 'Startet …' : 'Vergleich starten' }}
        </button>
      </form>
      <p v-if="submitError" class="mt-2 text-[11px] font-normal text-amber-800">{{ submitError }}</p>
    </section>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <template v-else>
      <section v-for="run in runs" :key="run.id" class="card mb-4 p-6">
        <div class="mb-3 flex items-center justify-between gap-3">
          <span class="text-sm font-semibold">{{ run.websiteUrl }}</span>
          <span
            class="rounded-full px-2.5 py-1 text-[11px] font-bold"
            :class="run.status === 'succeeded' ? 'bg-[#eaf3ec] text-forest' : run.status === 'failed' ? 'bg-amber-50 text-amber-800' : 'bg-[#f4f5f1] text-[#7b827d]'"
          >
            {{ STATUS_LABELS[run.status] }}
          </span>
        </div>

        <p v-if="run.status === 'failed'" class="text-xs text-amber-800">{{ run.errorReason }}</p>

        <template v-if="run.status === 'succeeded'">
          <p class="mb-3 text-[11px] text-[#7b827d]">
            Erkannte Schrift: {{ run.detectedFontFamily ?? '–' }}
            <img v-if="run.logoCandidate" :src="run.logoCandidate.signedUrl" alt="Logo-Kandidat" class="ml-2 inline-block h-6 w-auto align-middle" />
          </p>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="entry in run.results" :key="entry.providerConfigurationId" class="rounded-xl border border-[#e9ebe4] p-3">
              <div class="mb-2 text-xs font-bold">{{ entry.providerLabel }}</div>
              <p v-if="entry.status === 'failed'" class="text-[11px] text-amber-800">{{ entry.errorReason }}</p>
              <template v-else>
                <div class="mb-2 flex gap-1.5">
                  <span
                    v-for="field in SWATCH_FIELDS"
                    :key="field.key"
                    :title="`${field.label}: ${entry[field.key]}`"
                    class="h-6 w-6 rounded-full border border-[#e9ebe4]"
                    :style="{ backgroundColor: entry[field.key] }"
                  />
                </div>
                <p class="text-[11px] text-[#7b827d]">Font-Paar: {{ entry.suggestedFontPairingKey ?? '–' }}</p>
              </template>
            </div>
          </div>
        </template>
      </section>
      <p v-if="!runs.length" class="py-8 text-center text-xs text-[#9aa096]">Noch kein Vergleichslauf gestartet.</p>
      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
    </template>
  </div>
</template>
