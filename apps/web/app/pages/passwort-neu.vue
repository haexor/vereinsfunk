<script setup lang="ts">
// Paket 057: Passwoerter gibt es nicht mehr. Einladungsmails, die vor der Umstellung verschickt
// wurden, fuehren nach der Anmeldung noch hierher -- die Seite reicht direkt zum eigentlichen Ziel
// (meist die Einladung) weiter.
definePageMeta({ layout: 'auth' })

const route = useRoute()
// resolveSafeRedirect() prüft gegen die Browser-Origin und darf deshalb nicht während SSR laufen.
if (import.meta.client)
  await navigateTo(resolveSafeRedirect(route.query.redirect), { replace: true })
</script>

<template>
  <p class="text-center text-sm text-[#6c756f]">Weiterleitung …</p>
</template>
