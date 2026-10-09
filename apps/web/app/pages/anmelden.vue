<script setup lang="ts">
import { LoaderCircle, MailCheck } from '@lucide/vue'
import { z } from 'zod'

// Paket 057: Anmeldung per Link in der E-Mail statt Passwort (wie playerboard). Ob es zur Adresse
// ein Konto gibt, verraet die Seite nicht -- sie bestaetigt immer gleich; nur das Mail-Limit von
// Supabase Auth wird eigens gemeldet.
definePageMeta({ layout: 'auth' })

const route = useRoute()
const email = ref('')
const loading = ref(false)
const sent = ref(false)
const errorMessage = ref('')
const LoginInputSchema = z.object({ email: z.string().trim().pipe(z.email()) })

/** Schickt einen Anmeldelink; der Link fuehrt ueber /auth/callback zum urspruenglichen Ziel. */
async function submit() {
  errorMessage.value = ''
  loading.value = true
  try {
    const supabase = useSupabaseClient()
    const input = LoginInputSchema.parse({ email: email.value })
    const emailRedirectTo = new URL('/auth/callback', window.location.origin)
    const redirectQuery = z.string().optional().safeParse(route.query.redirect)
    const redirectTarget = resolveSafeRedirect(
      redirectQuery.success ? redirectQuery.data : undefined,
    )
    if (redirectTarget !== '/') emailRedirectTo.searchParams.set('redirect', redirectTarget)
    const { error } = await supabase.auth.signInWithOtp({
      email: input.email,
      options: { shouldCreateUser: false, emailRedirectTo: emailRedirectTo.toString() },
    })
    if (error?.status === 429) {
      errorMessage.value =
        'Gerade wurden zu viele Anmeldelinks verschickt. Bitte versuche es in ein paar Minuten erneut.'
      return
    }
    if (error) throw error
    sent.value = true
  } catch {
    errorMessage.value = 'Der Anmeldelink konnte nicht verschickt werden. Bitte versuche es erneut.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="sent" class="text-center">
    <MailCheck :size="28" class="mx-auto mb-3 text-forest" />
    <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Schau in dein Postfach.</h1>
    <p class="mt-2 text-sm text-[#6c756f]">
      Wenn es zu {{ email }} ein Konto gibt, ist ein Anmeldelink unterwegs. Er gilt eine Stunde und
      nur einmal.
    </p>
    <button
      type="button"
      class="focus-ring mt-4 min-h-11 text-xs font-semibold text-forest"
      @click="sent = false"
    >
      Andere Adresse verwenden
    </button>
  </div>
  <form v-else class="grid gap-4" @submit.prevent="submit">
    <div>
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Willkommen zurück.</h1>
      <p class="mt-1 text-sm text-[#6c756f]">
        Wir schicken dir einen Anmeldelink per E-Mail – kein Passwort nötig.
      </p>
    </div>
    <label
      ><span class="mb-2 block text-xs font-semibold">E-Mail</span>
      <input
        v-model="email"
        type="email"
        autocomplete="email"
        required
        class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm"
      />
    </label>
    <p v-if="errorMessage" class="text-sm text-amber-800" role="alert">{{ errorMessage }}</p>
    <button
      type="submit"
      :disabled="loading"
      class="focus-ring flex items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
    >
      <LoaderCircle v-if="loading" :size="16" class="animate-spin" /> Anmeldelink schicken
    </button>
    <p class="text-center text-xs text-[#6c756f]">
      Noch kein Konto?
      <NuxtLink to="/registrieren" class="focus-ring font-semibold text-forest"
        >Konto erstellen</NuxtLink
      >
    </p>
  </form>
</template>
