<script setup lang="ts">
import { LoaderCircle, MailCheck } from '@lucide/vue'

definePageMeta({ layout: 'auth' })

const route = useRoute()

const displayName = ref('')
const email = ref('')
const loading = ref(false)
const errorMessage = ref('')
const registered = ref(false)

/** Fordert einen Registrierungslink mit Anzeigenamen an und erhaelt das sichere Weiterleitungsziel. */
async function submit() {
  errorMessage.value = ''
  loading.value = true
  try {
    const supabase = useSupabaseClient()
    // Traegt einen Einladungslink (siehe /einladung) ueber die E-Mail-Bestaetigung hinweg
    // weiter -- auth/callback.vue leitet redirect bereits generisch weiter.
    const redirectTarget = resolveSafeRedirect(route.query.redirect)
    const emailRedirectTo = new URL('/auth/callback', window.location.origin)
    if (redirectTarget !== '/') emailRedirectTo.searchParams.set('redirect', redirectTarget)
    // Paket 057: ohne Passwort -- der Link in der Mail bestaetigt die Adresse und meldet an.
    const { error } = await supabase.auth.signInWithOtp({
      email: email.value.trim(),
      options: {
        shouldCreateUser: true,
        data: { display_name: displayName.value },
        emailRedirectTo: emailRedirectTo.toString(),
      },
    })
    if (error) throw error
    registered.value = true
  } catch {
    errorMessage.value = 'Registrierung nicht möglich. Bitte Angaben prüfen und erneut versuchen.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="registered" class="text-center">
    <MailCheck :size="28" class="mx-auto mb-3 text-forest" />
    <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Fast geschafft.</h1>
    <p class="mt-2 text-sm text-[#6c756f]">Wir haben dir einen Link an {{ email }} geschickt. Ein Klick darauf bestätigt die Adresse und meldet dich an – ein Passwort brauchst du nicht.</p>
  </div>
  <form v-else class="grid gap-4" @submit.prevent="submit">
    <div>
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Verein bei Vereinsfunk anmelden.</h1>
      <p class="mt-1 text-sm text-[#6c756f]">Lege deinen persönlichen Zugang an. Angemeldet wirst du künftig per Link in der E-Mail.</p>
    </div>
    <label><span class="mb-2 block text-xs font-semibold">Anzeigename</span>
      <input v-model="displayName" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" />
    </label>
    <label><span class="mb-2 block text-xs font-semibold">E-Mail</span>
      <input v-model="email" type="email" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" />
    </label>
    <p v-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <button type="submit" :disabled="loading" class="focus-ring flex items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
      <LoaderCircle v-if="loading" :size="16" class="animate-spin" /> Konto erstellen
    </button>
    <p class="text-center text-xs text-[#6c756f]">Schon registriert? <NuxtLink to="/anmelden" class="focus-ring font-semibold text-forest">Anmelden</NuxtLink></p>
  </form>
</template>
