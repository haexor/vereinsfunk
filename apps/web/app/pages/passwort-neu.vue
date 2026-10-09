<script setup lang="ts">
import { z } from 'zod'

// Paket 057: Passwoerter gibt es nicht mehr. Einladungsmails, die vor der Umstellung verschickt
// wurden, fuehren nach der Anmeldung noch hierher -- die Seite reicht direkt zum eigentlichen Ziel
// (meist die Einladung) weiter.
definePageMeta({ layout: 'auth' })

const route = useRoute()
const redirectQuery = z.string().optional().safeParse(route.query.redirect)
// resolveSafeRedirect() prüft gegen die Browser-Origin und darf deshalb nicht während SSR laufen.
if (import.meta.client)
  await navigateTo(resolveSafeRedirect(redirectQuery.success ? redirectQuery.data : undefined), {
    replace: true,
  })
</script>

<template>
  <p class="text-center text-sm text-[#6c756f]">Weiterleitung …</p>
</template>
