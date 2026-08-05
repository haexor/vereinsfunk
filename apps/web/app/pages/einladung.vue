<script setup lang="ts">
import { AlertTriangle, CheckCircle2, LoaderCircle } from '@lucide/vue'
import { AcceptInvitationResponseSchema } from '@vereinsfunk/contracts'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const config = useRuntimeConfig()
const session = await useSession()

const token = typeof route.query.token === 'string' ? route.query.token : ''
const currentPath = route.fullPath
const status = ref<'checking' | 'not-logged-in' | 'accepting' | 'accepted' | 'error'>('checking')
const errorMessage = ref('')

async function acceptInvitation() {
  status.value = 'accepting'
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/invitations/accept`, {
      method: 'POST',
      headers,
      body: { token },
    })
    AcceptInvitationResponseSchema.parse(response)
    await refreshSession()
    status.value = 'accepted'
  } catch (error) {
    status.value = 'error'
    const code = (error as { data?: { error?: string } })?.data?.error
    errorMessage.value =
      code === 'invitation_email_mismatch'
        ? 'Diese Einladung wurde an eine andere E-Mail-Adresse geschickt als die, mit der du angemeldet bist.'
        : 'Der Einladungslink ist ungültig, abgelaufen oder wurde bereits verwendet.'
  }
}

if (import.meta.client) {
  if (!token) {
    status.value = 'error'
    errorMessage.value = 'Der Einladungslink ist unvollständig.'
  } else if (session.value) {
    await acceptInvitation()
  } else {
    status.value = 'not-logged-in'
  }
}
</script>

<template>
  <div class="text-center">
    <template v-if="status === 'checking' || status === 'accepting'">
      <LoaderCircle :size="24" class="mx-auto mb-3 animate-spin text-forest" />
      <p class="text-sm text-[#6c756f]">Einladung wird geprüft …</p>
    </template>

    <template v-else-if="status === 'not-logged-in'">
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Einladung annehmen</h1>
      <p class="mt-2 text-sm text-[#6c756f]">Melde dich an oder erstelle ein Konto, um die Einladung anzunehmen.</p>
      <div class="mt-5 grid gap-2">
        <NuxtLink :to="{ path: '/registrieren', query: { redirect: currentPath } }" class="focus-ring rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white">
          Konto erstellen
        </NuxtLink>
        <NuxtLink :to="{ path: '/anmelden', query: { redirect: currentPath } }" class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-3 text-sm font-semibold">
          Anmelden
        </NuxtLink>
      </div>
    </template>

    <template v-else-if="status === 'accepted'">
      <CheckCircle2 :size="28" class="mx-auto mb-3 text-forest" />
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Willkommen im Verein.</h1>
      <p class="mt-2 text-sm text-[#6c756f]">Die Einladung wurde angenommen.</p>
      <NuxtLink to="/" class="focus-ring mt-5 inline-block rounded-xl bg-forest px-4 py-3 text-sm font-bold text-white">Zum Dashboard</NuxtLink>
    </template>

    <template v-else>
      <AlertTriangle :size="24" class="mx-auto mb-3 text-amber-700" />
      <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Einladung nicht gültig</h1>
      <p class="mt-2 text-sm text-amber-800">{{ errorMessage }}</p>
      <NuxtLink to="/" class="focus-ring mt-5 inline-block font-semibold text-forest">Zum Dashboard</NuxtLink>
    </template>
  </div>
</template>
