<script setup lang="ts">
import { LoaderCircle, MailCheck } from '@lucide/vue'

definePageMeta({ layout: 'auth' })

const email = ref('')
const loading = ref(false)
const sent = ref(false)

async function submit() {
  loading.value = true
  try {
    const supabase = useSupabaseClient()
    await supabase.auth.resetPasswordForEmail(email.value, {
      redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent('/passwort-neu')}`,
    })
  } finally {
    // Immer derselbe Hinweis, unabhaengig davon ob die E-Mail existiert.
    sent.value = true
    loading.value = false
  }
}
</script>

<template>
  <div v-if="sent" class="text-center">
    <MailCheck :size="28" class="mx-auto mb-3 text-forest" />
    <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">E-Mail unterwegs.</h1>
    <p class="mt-2 text-sm text-[#6c756f]">Falls ein Konto zu {{ email }} existiert, senden wir einen Link zum Zurücksetzen des Passworts.</p>
  </div>
  <form v-else class="grid gap-4" @submit.prevent="submit">
    <div>
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Passwort vergessen?</h1>
      <p class="mt-1 text-sm text-[#6c756f]">Wir senden dir einen Link zum Zurücksetzen.</p>
    </div>
    <label><span class="mb-2 block text-xs font-semibold">E-Mail</span>
      <input v-model="email" type="email" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" />
    </label>
    <button type="submit" :disabled="loading" class="focus-ring flex items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
      <LoaderCircle v-if="loading" :size="16" class="animate-spin" /> Link senden
    </button>
    <p class="text-center text-xs text-[#6c756f]"><NuxtLink to="/anmelden" class="focus-ring font-semibold text-forest">Zurück zur Anmeldung</NuxtLink></p>
  </form>
</template>
