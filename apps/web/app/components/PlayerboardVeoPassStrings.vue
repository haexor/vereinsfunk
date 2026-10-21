<script setup lang="ts">
import type { PlayerboardVeoMatchAnalysis } from '@vereinsfunk/contracts'
import { PASS_STRING_AXIS_MAX, passStringSummary } from '@vereinsfunk/domain'

// Spec 002, PR 2: Passketten (Inventar §1a.6) -- Balken je Kettenlaenge 3-9 und "+10" auf fester
// Achse bis 20, dazu die Kacheln "3 bis 5", "6 oder mehr" und die laengste Kette.
const props = defineProps<{
  analysis: Pick<PlayerboardVeoMatchAnalysis, 'passPossession' | 'periods'>
  ownLabel: string
  opponentLabel: string
}>()

const period = ref<number | null>(null)
const team = ref<'own' | 'opponent'>('own')
const summary = computed(() => passStringSummary(props.analysis.passPossession, team.value, period.value))
const TICKS = [20, 16, 12, 8, 4, 0]
const lengthLabel = (length: number) => (length === 10 ? '+10' : `${length}`)
const barTitle = (length: number, count: number) => `${lengthLabel(length)} verbundene Pässe: ${count} Mal`
</script>

<template>
  <div>
    <PlayerboardVeoPanelFilters v-model:period="period" v-model:team="team" :periods="analysis.periods" :own-label="ownLabel" :opponent-label="opponentLabel" />
    <div class="mb-4 grid grid-cols-3 gap-2 text-xs text-[#5b625d]">
      <div class="rounded-xl border border-[#dfe0d9] bg-white px-3 py-2"><span class="block font-display text-xl font-extrabold text-ink">{{ summary.threeToFive }}</span>3 bis 5 Pässe</div>
      <div class="rounded-xl border border-[#dfe0d9] bg-white px-3 py-2"><span class="block font-display text-xl font-extrabold text-ink">{{ summary.sixOrMore }}</span>6 oder mehr Pässe</div>
      <div class="rounded-xl border border-[#dfe0d9] bg-white px-3 py-2"><span class="block font-display text-xl font-extrabold text-ink">{{ summary.longest ?? '?' }}</span>Längste Passkette</div>
    </div>
    <figure>
      <div class="flex gap-2">
        <div class="flex h-40 flex-col justify-between text-right text-[10px] tabular-nums text-[#7b827d]" aria-hidden="true">
          <span v-for="tick in TICKS" :key="tick">{{ tick }}</span>
        </div>
        <ol class="flex h-40 flex-1 items-end gap-1 border-b border-l border-[#dfe0d9] px-1" :aria-label="`Passketten nach Anzahl verbundener Pässe, ${team === 'own' ? ownLabel : opponentLabel}`">
          <li v-for="bar in summary.bars" :key="bar.length" class="flex h-full flex-1 items-end" :title="barTitle(bar.length, bar.count)">
            <span class="sr-only">{{ barTitle(bar.length, bar.count) }}</span>
            <span class="w-full rounded-t bg-forest" :style="{ height: `${Math.min(100, (bar.count / PASS_STRING_AXIS_MAX) * 100)}%` }" aria-hidden="true" />
          </li>
        </ol>
      </div>
      <div class="ml-6 flex gap-1 px-1 text-center text-[11px] tabular-nums text-[#5b625d]" aria-hidden="true">
        <span v-for="bar in summary.bars" :key="bar.length" class="flex-1">{{ lengthLabel(bar.length) }}</span>
      </div>
      <figcaption class="mt-1 text-center text-[11px] text-[#7b827d]">Verbundene Pässe</figcaption>
    </figure>
  </div>
</template>
