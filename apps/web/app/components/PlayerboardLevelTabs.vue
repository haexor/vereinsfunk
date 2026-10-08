<script setup lang="ts">
import type { ScopeLevel } from '@vereinsfunk/contracts'
import type { PlayerboardLevel } from '../composables/usePlayerboardTeam'

// Paket 052, PR 3: Ebenenwahl fuer Kategorien und Einstellungen (Verein / Abteilung / Mannschaft).
defineProps<{ levels: readonly PlayerboardLevel[] }>()
const model = defineModel<ScopeLevel>({ required: true })
</script>

<template>
  <div class="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Ebene">
    <button
      v-for="level in levels"
      :key="level.scope"
      type="button"
      role="tab"
      :aria-selected="model === level.scope"
      class="focus-ring min-h-11 rounded-xl border px-4 text-left text-xs"
      :class="model === level.scope ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] bg-white text-ink'"
      @click="model = level.scope"
    >
      <span class="block text-[10px] font-bold uppercase tracking-[.1em] opacity-70">{{ level.label }}</span>
      <span class="block font-semibold">{{ level.name }}</span>
    </button>
  </div>
</template>
