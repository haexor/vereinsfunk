<script setup lang="ts">
import { Users } from '@lucide/vue'

// Paket 052, PR 3: Hinweis, solange keine Mannschaft gewaehlt ist (oder es im Arbeitsbereich
// keine gibt).
const { teams } = await usePlayerboardTeam()
</script>

<template>
  <section class="card p-8 text-center">
    <span class="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-[#eef1ea] text-forest"><Users :size="20" /></span>
    <p v-if="teams.length === 0" class="text-sm text-[#6c756f]">
      In diesem Arbeitsbereich gibt es keine Mannschaft, auf die du Zugriff hast. Wähle links eine andere Abteilung oder lege unter „Struktur“ eine Mannschaft an.
    </p>
    <p v-else class="text-sm text-[#6c756f]">Wähle oben eine Mannschaft.</p>
  </section>
</template>
