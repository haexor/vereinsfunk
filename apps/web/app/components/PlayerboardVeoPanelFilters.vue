<script setup lang="ts">
import type { PlayerboardVeoPeriod } from '@vereinsfunk/contracts'
import { periodOptions } from '../utils/playerboardVeoAnalysis'

// Spec 002, PR 2: Filter einer Grafik wie in Veo -- jede Grafik merkt sich Mannschaft und
// Halbzeit fuer sich (Inventar §1a.1).
const props = withDefaults(defineProps<{
  periods: readonly PlayerboardVeoPeriod[]
  ownLabel: string
  opponentLabel: string
  withTeam?: boolean
  withFullMatch?: boolean
}>(), { withTeam: true, withFullMatch: true })
const period = defineModel<number | null>('period', { required: true })
const team = defineModel<'own' | 'opponent'>('team', { default: 'own' })

const options = computed(() => periodOptions(props.periods, props.withFullMatch))
const selectId = useId()
const buttonClass = (active: boolean) => [
  'focus-ring min-h-11 rounded-xl border px-3 text-xs font-semibold',
  active ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] bg-white text-ink',
]
</script>

<template>
  <div class="mb-3 flex flex-wrap items-center gap-2">
    <div v-if="props.withTeam" class="flex gap-2" role="group" aria-label="Mannschaft">
      <button type="button" :class="buttonClass(team === 'own')" :aria-pressed="team === 'own'" @click="team = 'own'">{{ props.ownLabel }}</button>
      <button type="button" :class="buttonClass(team === 'opponent')" :aria-pressed="team === 'opponent'" @click="team = 'opponent'">{{ props.opponentLabel }}</button>
    </div>
    <label :for="selectId" class="sr-only">Halbzeit auswählen</label>
    <select :id="selectId" v-model="period" class="focus-ring h-11 min-w-0 rounded-xl border border-[#dfe0d9] bg-white px-3 text-sm text-ink">
      <option v-for="option in options" :key="option.value ?? 'all'" :value="option.value">{{ option.label }}</option>
    </select>
  </div>
</template>
