<script setup lang="ts">
import type { PlayerboardVeoSeasonMatch } from '@vereinsfunk/contracts'
import { keyMetricDefinition, matchKeyMetrics, matchResult, progressionTicks, seasonKeyMetrics } from '@vereinsfunk/domain'
import { scoreLabel } from '../utils/playerboardVeo'
import { formatKeyMetric, keyMetricCaption } from '../utils/playerboardVeoAnalytics'

// Spec 002, PR 4: Kennzahlen wie Veos Analytics Studio (Inventar §1b.3): Karten mit dem
// Saisondurchschnitt, darunter der Verlauf der gewaehlten Kennzahl als Balken je Spiel. Ein Balken
// zeigt Gegner, Datum, Ergebnis und fuehrt zur Spielauswertung. Trainer waehlen bis zu 4 Kennzahlen.
const props = defineProps<{
  matches: readonly PlayerboardVeoSeasonMatch[]
  metrics: readonly string[]
  canEdit: boolean
  teamId: string
  ownLabel: string
  timezone: string
}>()
const emit = defineEmits<{ save: [ids: string[]] }>()

const season = computed(() => seasonKeyMetrics(props.matches))
const active = ref(props.metrics[0] ?? null)
watch(() => props.metrics, (metrics) => { if (!active.value || !metrics.includes(active.value)) active.value = metrics[0] ?? null })
const editing = ref(false)
const selectedFixture = ref<string | null>(null)

const RESULT_LETTER = { win: 'S', draw: 'U', loss: 'N' } as const
const RESULT_HEIGHT = { win: 1, draw: 0.5, loss: 0 } as const
const dayLabel = computed(() => new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', timeZone: props.timezone }))
const fullDate = computed(() => new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: props.timezone }))

const bars = computed(() => {
  const id = active.value
  if (!id) return { ticks: [] as number[], items: [] as { match: PlayerboardVeoSeasonMatch; value: number | null; height: number; label: string }[] }
  if (id === 'win_ratio') {
    return {
      ticks: [],
      items: props.matches.map((match) => {
        const result = matchResult(match)
        return { match, value: null, height: result ? RESULT_HEIGHT[result] * 100 : 0, label: result ? RESULT_LETTER[result] : '–' }
      }),
    }
  }
  const values = props.matches.map((match) => matchKeyMetrics(match)[id] ?? null)
  const ticks = progressionTicks(Math.max(0, ...values.map((value) => value ?? 0)))
  const top = ticks.at(-1) || 1
  return {
    ticks: [...ticks].reverse(),
    items: props.matches.map((match, index) => {
      const value = values[index] ?? null
      return { match, value, height: value === null ? 0 : (value / top) * 100, label: formatKeyMetric(id, value === null ? null : Math.round(value * 10) / 10) }
    }),
  }
})
const selected = computed(() => props.matches.find((match) => match.fixtureId === selectedFixture.value) ?? null)
const chartCaption = computed(() => active.value
  ? `${keyMetricDefinition(active.value)?.label ?? active.value} von ${props.ownLabel} in ${props.matches.length} ${props.matches.length === 1 ? 'Spiel' : 'Spielen'}`
  : '')
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-[#5b625d]">Tippe eine Kennzahl an, um ihren Verlauf zu sehen.</p>
      <button v-if="canEdit" type="button" class="focus-ring min-h-11 rounded-xl border border-[#dfe0d9] bg-white px-4 text-sm font-semibold text-ink" @click="editing = true">Kennzahlen bearbeiten</button>
    </div>
    <p v-if="metrics.length === 0" class="text-sm text-[#6c756f]">Der Trainer hat noch keine Kennzahlen gewählt.</p>
    <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <button
        v-for="id in metrics" :key="id" type="button"
        class="focus-ring min-h-11 rounded-xl border p-3 text-left"
        :class="active === id ? 'border-forest bg-[#e4f1e7]' : 'border-[#dfe0d9] bg-white'"
        :aria-pressed="active === id" @click="active = id"
      >
        <span class="block text-xs font-semibold text-[#5b625d]">{{ keyMetricDefinition(id)?.label ?? id }}</span>
        <span class="mt-1 block font-display text-2xl font-extrabold text-ink">{{ formatKeyMetric(id, season.get(id)?.value ?? null) }}</span>
        <span class="mt-1 block text-[11px] text-[#7b827d]">{{ season.get(id) ? keyMetricCaption(season.get(id)!, matches.length) : '' }}</span>
      </button>
    </div>

    <figure v-if="active && matches.length" class="mt-5">
      <figcaption class="mb-2 text-xs font-semibold text-[#5b625d]">{{ chartCaption }}</figcaption>
      <div class="flex gap-2">
        <div v-if="bars.ticks.length" class="flex h-56 flex-col justify-between text-right text-[10px] tabular-nums text-[#7b827d]" aria-hidden="true">
          <span v-for="tick in bars.ticks" :key="tick">{{ tick.toLocaleString('de-DE') }}</span>
        </div>
        <ol class="flex h-56 min-w-0 flex-1 items-end gap-1 overflow-x-auto border-b border-l border-[#dfe0d9] px-1">
          <li v-for="item in bars.items" :key="item.match.fixtureId" class="flex h-full min-w-6 flex-1 flex-col justify-end">
            <button
              type="button" class="focus-ring flex h-full w-full flex-col items-center justify-end"
              :aria-pressed="selectedFixture === item.match.fixtureId"
              :aria-label="`${fullDate.format(new Date(item.match.kickoffAt))} gegen ${item.match.opponentName ?? 'unbekannt'}: ${item.label}`"
              @click="selectedFixture = selectedFixture === item.match.fixtureId ? null : item.match.fixtureId"
            >
              <span class="mb-1 text-[10px] font-semibold tabular-nums text-ink" aria-hidden="true">{{ item.label }}</span>
              <span
                class="w-full rounded-t"
                :class="[selectedFixture === item.match.fixtureId ? 'bg-[#c9772f]' : 'bg-forest', item.height === 0 ? 'min-h-[2px]' : '']"
                :style="{ height: `${item.height}%` }" aria-hidden="true"
              />
            </button>
          </li>
        </ol>
      </div>
      <div class="ml-6 flex gap-1 overflow-hidden px-1 text-center text-[10px] text-[#7b827d]" aria-hidden="true">
        <span v-for="item in bars.items" :key="item.match.fixtureId" class="min-w-6 flex-1 truncate">{{ dayLabel.format(new Date(item.match.kickoffAt)) }}</span>
      </div>
      <p v-if="matches.length < 3" class="mt-2 text-xs text-[#6c756f]">Für einen aussagekräftigen Verlauf braucht es mehr Spiele mit Veo-Aufnahme.</p>
    </figure>

    <div v-if="selected" class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#dfe0d9] bg-white p-3 text-sm" role="status">
      <span>
        <span class="font-semibold text-ink">gegen {{ selected.opponentName ?? 'unbekannt' }}</span>
        <span class="text-[#6c756f]"> · {{ fullDate.format(new Date(selected.kickoffAt)) }} · {{ scoreLabel(selected) }}</span>
      </span>
      <NuxtLink :to="`/playerboard/spiele/${selected.fixtureId}?team=${teamId}`" class="focus-ring inline-flex min-h-11 items-center font-semibold text-forest underline">Spielauswertung öffnen</NuxtLink>
    </div>

    <PlayerboardVeoMetricPicker
      v-if="editing" title="Kennzahlen bearbeiten"
      description="Wähle bis zu vier Kennzahlen, die zur Spielweise der Mannschaft passen."
      :selected="metrics" :min="0" :max="4"
      @apply="(ids) => { emit('save', ids); editing = false }" @close="editing = false"
    />
  </div>
</template>
