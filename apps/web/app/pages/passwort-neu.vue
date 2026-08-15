<script setup lang="ts">
import { Check, LoaderCircle } from '@lucide/vue'

definePageMeta({ layout: 'auth' })

const password = ref('')
const loading = ref(false)
const errorMessage = ref('')
const done = ref(false)
const route = useRoute()
const redirectTarget = computed(() => resolveSafeRedirect(route.query.redirect))

async function submit() {
  errorMessage.value = ''
  loading.value = true
  try {
    const supabase = useSupabaseClient()
    const { error } = await supabase.auth.updateUser({ password: password.value })
    if (error) throw error
    done.value = true
  } catch {
    errorMessage.value = 'Passwort konnte nicht gesetzt werden. Bitte den Link erneut über „Passwort vergessen“ anfordern.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="done" class="text-center">
    <Check :size="28" class="mx-auto mb-3 text-forest" />
    <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Passwort geändert.</h1>
    <NuxtLink :to="redirectTarget" class="focus-ring mt-4 inline-flex rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white">Weiter</NuxtLink>
  </div>
  <form v-else class="grid gap-4" @submit.prevent="submit">
    <div>
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Neues Passwort setzen.</h1>
    </div>
    <label><span class="mb-2 block text-xs font-semibold">Neues Passwort</span>
      <input v-model="password" type="password" minlength="8" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-3 text-sm" />
    </label>
    <p v-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <button type="submit" :disabled="loading" class="focus-ring flex items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
      <LoaderCircle v-if="loading" :size="16" class="animate-spin" /> Passwort speichern
    </button>
  </form>
</template>
