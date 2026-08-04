<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')

async function submit() {
  errorMessage.value = ''
  loading.value = true
  try {
    const supabase = useSupabaseClient()
    const { error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
    if (error) throw error
    await navigateTo(resolveSafeRedirect(route.query.redirect))
  } catch {
    errorMessage.value = 'Anmeldung nicht möglich. Bitte E-Mail und Passwort prüfen.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form class="grid gap-4" @submit.prevent="submit">
    <div>
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Willkommen zurück.</h1>
      <p class="mt-1 text-sm text-[#6c756f]">Melde dich bei eurem Vereinsfunk-Konto an.</p>
    </div>
    <label><span class="mb-2 block text-xs font-semibold">E-Mail</span>
      <input v-model="email" type="email" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" />
    </label>
    <label><span class="mb-2 block text-xs font-semibold">Passwort</span>
      <input v-model="password" type="password" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" />
    </label>
    <p v-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <button type="submit" :disabled="loading" class="focus-ring flex items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
      <LoaderCircle v-if="loading" :size="16" class="animate-spin" /> Anmelden
    </button>
    <div class="flex items-center justify-between text-xs text-[#6c756f]">
      <NuxtLink to="/passwort-vergessen" class="focus-ring font-semibold text-forest">Passwort vergessen?</NuxtLink>
      <NuxtLink to="/registrieren" class="focus-ring font-semibold text-forest">Konto erstellen</NuxtLink>
    </div>
  </form>
</template>
