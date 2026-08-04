<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const errorMessage = ref('')

onMounted(async () => {
  const supabase = useSupabaseClient()
  const redirectTarget = resolveSafeRedirect(route.query.redirect)

  // detectSessionInUrl verarbeitet das Hash-Fragment asynchron im Hintergrund; ein einmaliger
  // onAuthStateChange-Listener kann das Ereignis verpassen, falls es vor dem Abonnieren feuert.
  // Deshalb kurz pollen statt auf ein einzelnes Ereignis zu warten.
  for (let attempt = 0; attempt < 25; attempt++) {
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      // Harte Navigation statt navigateTo(): loescht das Hash-Fragment mit den Tokens
      // aus der Adressleiste und erzwingt einen frischen Middleware-Durchlauf.
      window.location.assign(redirectTarget)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  errorMessage.value = 'Der Link ist ungültig oder abgelaufen.'
})
</script>

<template>
  <div class="text-center">
    <p v-if="!errorMessage" class="text-sm text-[#6c756f]">Bestätigung wird verarbeitet …</p>
    <template v-else>
      <p class="text-sm text-amber-800">{{ errorMessage }}</p>
      <NuxtLink to="/anmelden" class="focus-ring mt-4 inline-block font-semibold text-forest">Zur Anmeldung</NuxtLink>
    </template>
  </div>
</template>
