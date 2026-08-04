<script setup lang="ts">
definePageMeta({ layout: 'auth' })

async function logout() {
  await signOut()
  await navigateTo('/anmelden')
}
</script>

<template>
  <div class="text-center">
    <h1 class="font-display text-xl font-extrabold tracking-[-.03em]">Noch kein Verein.</h1>
    <p class="mt-2 text-sm text-[#6c756f]">Dein Konto ist bestätigt, gehört aber noch zu keinem Verein. Das Anlegen eines Vereins folgt in einem späteren Schritt.</p>
    <button class="focus-ring mt-6 rounded-xl border border-[#dfe0d9] px-4 py-3 text-sm font-semibold" @click="logout">Abmelden</button>
  </div>
</template>
