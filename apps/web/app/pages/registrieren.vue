<script setup lang="ts">
import { LoaderCircle, MailCheck } from '@lucide/vue'

definePageMeta({ layout: 'auth' })

const displayName = ref('')
const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')
const registered = ref(false)

async function submit() {
  errorMessage.value = ''
  loading.value = true
  try {
    const supabase = useSupabaseClient()
    const { error } = await supabase.auth.signUp({
      email: email.value,
      password: password.value,
      options: {
        data: { display_name: displayName.value },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
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
    <p class="mt-2 text-sm text-[#6c756f]">Wir haben eine Bestätigungsmail an {{ email }} gesendet. Bitte E-Mail bestätigen, um dich anzumelden.</p>
  </div>
  <form v-else class="grid gap-4" @submit.prevent="submit">
    <div>
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Verein bei Vereinsfunk anmelden.</h1>
      <p class="mt-1 text-sm text-[#6c756f]">Lege deinen persönlichen Zugang an.</p>
    </div>
    <label><span class="mb-2 block text-xs font-semibold">Anzeigename</span>
      <input v-model="displayName" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" />
    </label>
    <label><span class="mb-2 block text-xs font-semibold">E-Mail</span>
      <input v-model="email" type="email" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" />
    </label>
    <label><span class="mb-2 block text-xs font-semibold">Passwort</span>
      <input v-model="password" type="password" minlength="8" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" />
    </label>
    <p v-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <button type="submit" :disabled="loading" class="focus-ring flex items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
      <LoaderCircle v-if="loading" :size="16" class="animate-spin" /> Konto erstellen
    </button>
    <p class="text-center text-xs text-[#6c756f]">Schon registriert? <NuxtLink to="/anmelden" class="focus-ring font-semibold text-forest">Anmelden</NuxtLink></p>
  </form>
</template>
