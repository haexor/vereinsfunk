<script setup lang="ts">
import { AlertTriangle, CheckCircle2, LoaderCircle } from '@lucide/vue'
import { PublicConsentRevocationViewSchema } from '@vereinsfunk/contracts'

definePageMeta({ layout: 'auth' })

// Oeffentliche Token-Seite: kein Suchmaschinen-Index (Plan 015, Abschnitt 3). Der X-Robots-Tag
// der API gilt nur fuer die JSON-Antwort, nicht fuer diese Seite (gefunden im Code-Review).
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

const route = useRoute()
const config = useRuntimeConfig()
const token = typeof route.params.token === 'string' ? route.params.token : ''
const encodedToken = encodeURIComponent(token)

const status = ref<'loading' | 'ready' | 'already-revoked' | 'not-found' | 'confirming' | 'revoked' | 'error'>('loading')
const view = ref<ReturnType<typeof PublicConsentRevocationViewSchema.parse> | null>(null)

async function load() {
  if (!token) { status.value = 'not-found'; return }
  try {
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/consents/by-revocation-token/${encodedToken}`)
    view.value = PublicConsentRevocationViewSchema.parse(response)
    status.value = view.value.status === 'already_revoked' ? 'already-revoked' : 'ready'
  } catch (error) {
    // Nur ein 404 bedeutet "Token unbekannt/abgelaufen/bereits verwendet". Ein Transportfehler
    // oder ein 429 darf einen gueltigen Widerrufslink nicht als ungueltig darstellen (gefunden im
    // Code-Review).
    status.value = (error as { statusCode?: number })?.statusCode === 404 ? 'not-found' : 'error'
  }
}

async function confirmRevoke() {
  status.value = 'confirming'
  try {
    await $fetch(`${config.public.apiBase}/v1/consents/by-revocation-token/${encodedToken}`, { method: 'POST' })
    status.value = 'revoked'
  } catch {
    status.value = 'error'
  }
}

if (import.meta.client) await load()
</script>

<template>
  <div class="text-center">
    <template v-if="status === 'loading' || status === 'confirming'">
      <LoaderCircle :size="24" class="mx-auto mb-3 animate-spin text-forest" />
      <p class="text-sm text-[#6c756f]">Wird geladen …</p>
    </template>

    <template v-else-if="status === 'not-found'">
      <AlertTriangle :size="24" class="mx-auto mb-3 text-amber-700" />
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Link nicht gültig</h1>
      <p class="mt-2 text-sm text-amber-800">Dieser Widerrufslink ist unbekannt oder wurde bereits verwendet.</p>
    </template>

    <template v-else-if="status === 'error'">
      <AlertTriangle :size="24" class="mx-auto mb-3 text-amber-700" />
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Etwas ist schiefgelaufen</h1>
      <p class="mt-2 text-sm text-amber-800">Bitte versuche es später erneut.</p>
    </template>

    <template v-else-if="status === 'already-revoked' || status === 'revoked'">
      <CheckCircle2 :size="28" class="mx-auto mb-3 text-forest" />
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Einwilligung widerrufen.</h1>
      <p class="mt-2 text-sm text-[#6c756f]">
        Die Einwilligung für {{ view?.personLabel }} bei {{ view?.organizationName }} gilt für neue Verwendung nicht mehr.
      </p>
    </template>

    <template v-else-if="view">
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Einwilligung widerrufen?</h1>
      <p class="mt-2 text-sm text-[#6c756f]">
        Du widerrufst die Einwilligung für {{ view.personLabel }} bei {{ view.organizationName }}. Der Widerruf wirkt sofort für neue Verwendung, ändert aber nichts an bereits davor veröffentlichten Beiträgen.
      </p>
      <button type="button" class="focus-ring mt-6 rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white" @click="confirmRevoke">
        Widerruf bestätigen
      </button>
    </template>
  </div>
</template>
