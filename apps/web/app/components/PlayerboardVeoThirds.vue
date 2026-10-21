<script setup lang="ts">
import type { PlayerboardVeoMatchAnalysis } from '@vereinsfunk/contracts'
import { thirdShares } from '@vereinsfunk/domain'

// Spec 002, PR 2: Pass- bzw. Ballbesitzzonen (Inventar §1a.4, §1a.5): das Feld in drei Drittel
// aus Sicht der gewaehlten Mannschaft, je Drittel der Anteil in ganzen Prozent; das staerkste
// Drittel am kraeftigsten. Die Rangstufe steht auch als Text (FR-067).
const props = defineProps<{
  analysis: Pick<PlayerboardVeoMatchAnalysis, 'passPossession' | 'periods'>
  kind: 'pass' | 'possession'
  ownLabel: string
  opponentLabel: string
}>()

const period = ref<number | null>(null)
const team = ref<'own' | 'opponent'>('own')
const THIRDS = [
  { key: 'defensive', label: 'Verteidigung' },
  { key: 'middle', label: 'Mitte' },
  { key: 'attacking', label: 'Angriff' },
] as const
const RANK_FILL = ['rgba(255,213,74,.75)', 'rgba(255,213,74,.45)', 'rgba(255,213,74,.2)']

const shares = computed(() => thirdShares(props.analysis.passPossession, team.value, period.value, props.kind))
const zones = computed(() => {
  const current = shares.value
  if (!current) return []
  const ranked = [...THIRDS].sort((a, b) => current[b.key] - current[a.key])
  return THIRDS.map((third, index) => ({ ...third, index, percent: Math.round(current[third.key] * 100), rank: ranked.findIndex((entry) => entry.key === third.key) }))
})
const title = computed(() => (props.kind === 'pass' ? 'Passzonen' : 'Ballbesitzzonen'))
const label = computed(() => `${title.value} ${team.value === 'own' ? props.ownLabel : props.opponentLabel}: ${zones.value.map((zone) => `${zone.label} ${zone.percent} %`).join(', ')}`)
</script>

<template>
  <div>
    <PlayerboardVeoPanelFilters v-model:period="period" v-model:team="team" :periods="analysis.periods" :own-label="ownLabel" :opponent-label="opponentLabel" />
    <template v-if="zones.length">
      <PlayerboardPitch :label="label" thirds>
        <template #default>
          <g v-for="zone in zones" :key="zone.key">
            <rect :x="zone.index * 78" y="0" width="78" height="150" :fill="RANK_FILL[zone.rank]" />
            <circle :cx="zone.index * 78 + 39" cy="75" r="17" fill="#ffffff" />
            <text :x="zone.index * 78 + 39" y="80" text-anchor="middle" font-size="13" font-weight="700" fill="#163a2c">{{ zone.percent }}%</text>
          </g>
        </template>
      </PlayerboardPitch>
      <div class="mt-1 grid grid-cols-3 text-center text-[11px] font-semibold text-[#5b625d]" aria-hidden="true">
        <span v-for="zone in zones" :key="zone.key">{{ zone.label }}</span>
      </div>
    </template>
    <p v-else class="text-sm text-[#6c756f]">Für diese Auswahl gibt es keine {{ kind === 'pass' ? 'Pässe' : 'Ballbesitzwerte' }}.</p>
  </div>
</template>
