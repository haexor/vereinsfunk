<script setup lang="ts">
import { AlertTriangle, CheckCircle2, LoaderCircle, XCircle } from '@lucide/vue'
import { PublicConsentRequestViewSchema } from '@vereinsfunk/contracts'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const config = useRuntimeConfig()
const token = typeof route.params.token === 'string' ? route.params.token : ''

const status = ref<'loading' | 'ready' | 'not-found' | 'submitting' | 'granted' | 'declined' | 'error'>('loading')
const view = ref<ReturnType<typeof PublicConsentRequestViewSchema.parse> | null>(null)
const revocationUrl = ref('')

const scopeDescription = computed(() => {
  if (!view.value) return []
  const scope = view.value.requestedScope
  const purposeLabels: Record<string, string> = { social_media: 'Social Media', website: 'Vereinswebsite', print: 'Printmaterial', internal: 'interne Nutzung' }
  const lines = [
    `Zweck: ${scope.purposes.map((purpose) => purposeLabels[purpose] ?? purpose).join(', ')}`,
    `Plattformen: ${scope.platforms === null ? 'alle vom Verein genutzten' : scope.platforms.join(', ')}`,
    `Medienart: ${scope.mediaKinds.map((kind) => (kind === 'photo' ? 'Foto' : 'Video')).join(', ')}`,
    scope.namingAllowed ? 'Namentliche Nennung ist erlaubt.' : 'Namentliche Nennung ist nicht erlaubt.',
  ]
  return lines
})

async function load() {
  if (!token) { status.value = 'not-found'; return }
  try {
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/consent-requests/by-token/${token}`)
    view.value = PublicConsentRequestViewSchema.parse(response)
    status.value = 'ready'
  } catch {
    status.value = 'not-found'
  }
}

async function respond(decision: 'granted' | 'declined') {
  status.value = 'submitting'
  try {
    const response = await $fetch<{ status: string; revocationUrl?: string }>(
      `${config.public.apiBase}/v1/consent-requests/by-token/${token}/respond`,
      { method: 'POST', body: { decision } },
    )
    if (response.status === 'granted') {
      revocationUrl.value = response.revocationUrl ?? ''
      status.value = 'granted'
    } else {
      status.value = 'declined'
    }
  } catch {
    status.value = 'error'
  }
}

if (import.meta.client) await load()
</script>

<template>
  <div class="text-center">
    <template v-if="status === 'loading'">
      <LoaderCircle :size="24" class="mx-auto mb-3 animate-spin text-forest" />
      <p class="text-sm text-[#6c756f]">Anfrage wird geladen …</p>
    </template>

    <template v-else-if="status === 'not-found'">
      <AlertTriangle :size="24" class="mx-auto mb-3 text-amber-700" />
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Anfrage nicht verfügbar</h1>
      <p class="mt-2 text-sm text-amber-800">Dieser Link ist ungültig, abgelaufen oder wurde bereits beantwortet.</p>
    </template>

    <template v-else-if="status === 'error'">
      <AlertTriangle :size="24" class="mx-auto mb-3 text-amber-700" />
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Etwas ist schiefgelaufen</h1>
      <p class="mt-2 text-sm text-amber-800">Bitte versuche es später erneut.</p>
    </template>

    <template v-else-if="status === 'granted'">
      <CheckCircle2 :size="28" class="mx-auto mb-3 text-forest" />
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Vielen Dank.</h1>
      <p class="mt-2 text-sm text-[#6c756f]">Die Einwilligung wurde erteilt.</p>
      <div v-if="revocationUrl" class="mt-5 rounded-xl bg-[#f4f5ef] p-4 text-left text-xs text-[#6c756f]">
        <p class="font-semibold text-ink">Jederzeit widerrufbar</p>
        <p class="mt-1">Diesen Link aufbewahren, um die Einwilligung später zurückzuziehen:</p>
        <a :href="revocationUrl" class="mt-2 block break-all font-semibold text-forest">{{ revocationUrl }}</a>
      </div>
    </template>

    <template v-else-if="status === 'declined'">
      <XCircle :size="28" class="mx-auto mb-3 text-[#6c756f]" />
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Verstanden.</h1>
      <p class="mt-2 text-sm text-[#6c756f]">Die Einwilligung wurde nicht erteilt.</p>
    </template>

    <template v-else-if="view">
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Einwilligung zur Veröffentlichung</h1>
      <p class="mt-2 text-sm text-[#6c756f]">{{ view.organizationName }} bittet um deine Einwilligung für {{ view.personLabel }}.</p>

      <div class="mt-5 max-h-64 overflow-y-auto rounded-xl border border-[#dfe0d9] p-4 text-left text-sm text-ink">
        <p class="whitespace-pre-line">{{ view.consentText }}</p>
      </div>

      <div class="mt-4 rounded-xl bg-[#f4f5ef] p-4 text-left text-sm">
        <p class="font-semibold text-ink">Konkreter Umfang dieser Anfrage</p>
        <ul class="mt-2 space-y-1 text-[#6c756f]">
          <li v-for="line in scopeDescription" :key="line">{{ line }}</li>
        </ul>
      </div>

      <p class="mt-4 text-xs text-[#8a9089]">
        Ein E-Mail-Link belegt nicht deine Identität als Erziehungsberechtigte oder Erziehungsberechtigter. Diese Einwilligung ist freiwillig und jederzeit für die Zukunft widerrufbar.
      </p>

      <div class="mt-6 grid gap-2">
        <button type="button" class="focus-ring rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white" :disabled="status === 'submitting'" @click="respond('granted')">
          Zustimmen
        </button>
        <button type="button" class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-3 text-sm font-semibold" :disabled="status === 'submitting'" @click="respond('declined')">
          Ablehnen
        </button>
      </div>
    </template>
  </div>
</template>
