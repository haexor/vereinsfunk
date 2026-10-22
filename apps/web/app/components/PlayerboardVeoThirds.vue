<script setup lang="ts">
import type { PlayerboardVeoMatchAnalysis } from '@vereinsfunk/contracts'
import { thirdShares } from '@vereinsfunk/domain'

// Spec 002, PR 2: Pass- bzw. Ballbesitzzonen eines Spiels (Inventar §1a.4, §1a.5) mit Filtern fuer
// Mannschaft und Halbzeit; gezeichnet von PlayerboardVeoThirdsPitch.
const props = defineProps<{
  analysis: Pick<PlayerboardVeoMatchAnalysis, 'passPossession' | 'periods'>
  kind: 'pass' | 'possession'
  ownLabel: string
  opponentLabel: string
}>()

const period = ref<number | null>(null)
const team = ref<'own' | 'opponent'>('own')
const percents = computed(() => {
  const current = thirdShares(props.analysis.passPossession, team.value, period.value, props.kind)
  return current ? { defensive: Math.round(current.defensive * 100), middle: Math.round(current.middle * 100), attacking: Math.round(current.attacking * 100) } : null
})
const title = computed(() => (props.kind === 'pass' ? 'Passzonen' : 'Ballbesitzzonen'))
const label = computed(() => `${title.value} ${team.value === 'own' ? props.ownLabel : props.opponentLabel}`)
</script>

<template>
  <div>
    <PlayerboardVeoPanelFilters v-model:period="period" v-model:team="team" :periods="analysis.periods" :own-label="ownLabel" :opponent-label="opponentLabel" />
    <PlayerboardVeoThirdsPitch v-if="percents" :percents="percents" :label="label" />
    <p v-else class="text-sm text-[#6c756f]">Für diese Auswahl gibt es keine {{ kind === 'pass' ? 'Pässe' : 'Ballbesitzwerte' }}.</p>
  </div>
</template>
