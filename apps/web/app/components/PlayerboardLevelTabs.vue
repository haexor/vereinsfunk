<script setup lang="ts">
import type { ScopeLevel } from '@vereinsfunk/contracts'
import type { PlayerboardLevel } from '../composables/usePlayerboardTeam'

// Paket 052, PR 3: Ebenenwahl fuer Kategorien und Einstellungen (Verein / Abteilung / Mannschaft).
const props = defineProps<{ levels: readonly PlayerboardLevel[] }>()
const model = defineModel<ScopeLevel>({ required: true })

function onKeydown(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  if (props.levels.length === 0) return
  event.preventDefault()
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? props.levels.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + props.levels.length) % props.levels.length
  const next = props.levels[nextIndex]
  if (!next) return
  model.value = next.scope
  nextTick(() => document.getElementById(`playerboard-level-tab-${next.scope}`)?.focus())
}
</script>

<template>
  <div class="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Ebene">
    <button
      v-for="(level, index) in props.levels"
      :key="level.scope"
      type="button"
      role="tab"
      :id="`playerboard-level-tab-${level.scope}`"
      :aria-selected="model === level.scope"
      :aria-controls="`playerboard-level-panel-${level.scope}`"
      :tabindex="model === level.scope ? 0 : -1"
      class="focus-ring min-h-11 rounded-xl border px-4 text-left text-xs"
      :class="model === level.scope ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] bg-white text-ink'"
      @click="model = level.scope"
      @keydown="onKeydown($event, index)"
    >
      <span class="block text-[10px] font-bold uppercase tracking-[.1em] opacity-70">{{ level.label }}</span>
      <span class="block font-semibold">{{ level.name }}</span>
    </button>
  </div>
</template>
