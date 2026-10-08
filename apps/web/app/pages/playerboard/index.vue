<script setup lang="ts">
// Paket 052, PR 4: Einstieg in PlayerBoard fuer Spieler und Trainer -- die laufende Saison der
// gewaehlten Mannschaft.
const { team } = await usePlayerboardTeam()
</script>

<template>
  <div>
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="eyebrow mb-3">PlayerBoard</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">{{ team?.name ?? 'Übersicht' }}</h1>
      </div>
      <PlayerboardTeamPicker />
    </header>
    <PlayerboardTeamEmpty v-if="!team" />
    <PlayerboardSeasonSummary v-else />
  </div>
</template>
