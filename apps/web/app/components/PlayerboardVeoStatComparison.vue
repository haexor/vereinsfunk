<script setup lang="ts">
import type { PlayerboardVeoMatchAnalysis } from '@vereinsfunk/contracts'
import { comparisonRows, comparisonShares, type VeoComparisonRow } from '@vereinsfunk/domain'
import { comparisonLabel } from '../utils/playerboardVeoAnalysis'

// Spec 002, PR 2: Spielwerte wir/Gegner als gespiegelte Balken (Inventar §1a.2): Heimmannschaft
// links, der unterlegene Wert abgeschwaecht, Ballbesitz-Minuten mit der Zeit ohne Ballbesitz.
const props = defineProps<{
  analysis: Pick<PlayerboardVeoMatchAnalysis, 'teamStats' | 'passPossession' | 'periods' | 'isHome'>
  ownLabel: string
  opponentLabel: string
}>()

const period = ref<number | null>(null)
const rows = computed(() => comparisonRows(props.analysis.teamStats, props.analysis.passPossession, period.value))
// Ohne Angabe gilt die eigene Mannschaft wie bei Veo als Heimmannschaft.
const ownLeft = computed(() => props.analysis.isHome !== false)
const left = computed(() => (ownLeft.value ? { team: 'own' as const, label: props.ownLabel } : { team: 'opponent' as const, label: props.opponentLabel }))
const right = computed(() => (ownLeft.value ? { team: 'opponent' as const, label: props.opponentLabel } : { team: 'own' as const, label: props.ownLabel }))

function value(row: VeoComparisonRow, team: 'own' | 'opponent'): string {
  const number = team === 'own' ? row.own : row.opponent
  return row.unit === 'percent' ? `${number} %` : `${number}`
}
function bars(row: VeoComparisonRow) {
  const shares = comparisonShares(row)
  return ownLeft.value ? { left: shares.own, middle: shares.unassigned, right: shares.opponent } : { left: shares.opponent, middle: shares.unassigned, right: shares.own }
}
const teamColor = (team: 'own' | 'opponent') => (team === 'own' ? 'bg-forest' : 'bg-[#c9772f]')
</script>

<template>
  <div>
    <PlayerboardVeoPanelFilters v-model:period="period" :periods="analysis.periods" :own-label="ownLabel" :opponent-label="opponentLabel" :with-team="false" />
    <div class="mb-2 flex justify-between text-xs font-bold text-ink">
      <span class="flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full" :class="teamColor(left.team)" aria-hidden="true" />{{ left.label }}</span>
      <span class="flex items-center gap-1">{{ right.label }}<span class="h-2.5 w-2.5 rounded-full" :class="teamColor(right.team)" aria-hidden="true" /></span>
    </div>
    <table class="w-full text-sm">
      <caption class="sr-only">Spielwerte {{ left.label }} gegen {{ right.label }}</caption>
      <thead class="sr-only">
        <tr><th scope="col">{{ left.label }}</th><th scope="col">Wert</th><th scope="col">{{ right.label }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key" class="border-t border-[#eef0ea]">
          <td class="w-14 py-2 align-top font-semibold tabular-nums" :class="row.losing === left.team ? 'font-normal text-[#6c756f]' : 'text-ink'">{{ value(row, left.team) }}</td>
          <th scope="row" class="py-2 text-center font-normal">
            <span class="block text-xs text-[#5b625d]">{{ comparisonLabel(row.key) }}</span>
            <span class="mt-1 flex h-2 overflow-hidden rounded-full bg-[#eef0ea]" aria-hidden="true">
              <span :class="teamColor(left.team)" :style="{ width: `${bars(row).left}%` }" />
              <span class="bg-[#d5d9d2]" :style="{ width: `${bars(row).middle}%` }" />
              <span :class="teamColor(right.team)" :style="{ width: `${bars(row).right}%` }" />
            </span>
            <span v-if="row.unassigned" class="mt-1 block text-[11px] text-[#7b827d]">Nicht im Ballbesitz: {{ row.unassigned }} min</span>
          </th>
          <td class="w-14 py-2 text-right align-top font-semibold tabular-nums" :class="row.losing === right.team ? 'font-normal text-[#6c756f]' : 'text-ink'">{{ value(row, right.team) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="rows.length === 0" class="text-sm text-[#6c756f]">Veo hat zu diesem Spiel keine Spielwerte geliefert.</p>
  </div>
</template>
