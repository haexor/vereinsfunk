<script setup lang="ts">
import type { PlayerboardVeoMatchAnalysis, PlayerboardVeoMatchEvent } from '@vereinsfunk/contracts'
import { matchMinute } from '@vereinsfunk/domain'
import { eventTypeLabel, periodOptions, veoVideoLink } from '../utils/playerboardVeoAnalysis'

// Spec 002, PR 2: Spielereignisse beider Mannschaften (Inventar §1a.12) als Zeitleiste und Liste,
// filterbar nach Art, Mannschaft, Spieler und Halbzeit; jeder Eintrag fuehrt ins Veo-Video.
const props = defineProps<{
  analysis: Pick<PlayerboardVeoMatchAnalysis, 'events' | 'periods' | 'veoUrl'>
  ownLabel: string
  opponentLabel: string
  playerLabel: (team: 'own' | 'opponent', jerseyNumber: number | null) => string
}>()

const PAGE = 50
const type = ref('')
const team = ref<'' | 'own' | 'opponent'>('')
const jersey = ref('')
const period = ref<number | null>(null)
const shown = ref(PAGE)

const matching = (event: PlayerboardVeoMatchEvent, skip?: 'type') => (skip === 'type' || !type.value || event.eventType === type.value)
  && (!team.value || event.teamAssociation === team.value)
  && (!jersey.value || `${event.teamAssociation}:${event.jerseyNumber}` === jersey.value)
  && (period.value === null || event.periodNumber === period.value)
const filtered = computed(() => props.analysis.events.filter((event) => matching(event)))
watch([type, team, jersey, period], () => { shown.value = PAGE })

// Zahl je Art unter den uebrigen Filtern, wie Veos Filterliste.
const typeOptions = computed(() => {
  const counts = new Map<string, number>()
  for (const event of props.analysis.events) if (matching(event, 'type')) counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1)
  return [...counts].map(([value, count]) => ({ value, label: `${eventTypeLabel(value)} (${count})` })).sort((a, b) => a.label.localeCompare(b.label, 'de'))
})
const playerOptions = computed(() => {
  const keys = new Set(props.analysis.events.filter((event) => event.jerseyNumber !== null && (!team.value || event.teamAssociation === team.value))
    .map((event) => `${event.teamAssociation}:${event.jerseyNumber}`))
  return [...keys].map((key) => {
    const [side, number] = key.split(':') as ['own' | 'opponent', string]
    return { value: key, label: `${side === 'own' ? props.ownLabel : props.opponentLabel} ${props.playerLabel(side, Number(number))}`, side, number: Number(number) }
  }).sort((a, b) => a.side.localeCompare(b.side) || a.number - b.number)
})

const total = computed(() => props.analysis.periods.reduce((sum, entry) => sum + entry.endS - entry.startS, 0) || 1)
const elapsed = (event: PlayerboardVeoMatchEvent) => props.analysis.periods.filter((entry) => entry.number < event.periodNumber)
  .reduce((sum, entry) => sum + entry.endS - entry.startS, 0) + event.periodTimeMs / 1000
const minute = (event: PlayerboardVeoMatchEvent) => matchMinute(props.analysis.periods, event.periodNumber, event.periodTimeMs)
const describe = (event: PlayerboardVeoMatchEvent) => `${minute(event)}. Minute, ${event.teamAssociation === 'own' ? props.ownLabel : props.opponentLabel}: ${eventTypeLabel(event.eventType)}${event.jerseyNumber === null ? '' : ` ${props.playerLabel(event.teamAssociation, event.jerseyNumber)}`}`
const selectClass = 'focus-ring h-11 min-w-0 rounded-xl border border-[#dfe0d9] bg-white px-3 text-sm text-ink'
</script>

<template>
  <div>
    <div class="mb-3 grid gap-2 sm:grid-cols-4">
      <label class="grid gap-1 text-xs font-semibold text-[#5b625d]">Art
        <select v-model="type" :class="selectClass"><option value="">Alle</option><option v-for="option in typeOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
      </label>
      <label class="grid gap-1 text-xs font-semibold text-[#5b625d]">Mannschaft
        <select v-model="team" :class="selectClass"><option value="">Beide</option><option value="own">{{ ownLabel }}</option><option value="opponent">{{ opponentLabel }}</option></select>
      </label>
      <label class="grid gap-1 text-xs font-semibold text-[#5b625d]">Spieler
        <select v-model="jersey" :class="selectClass"><option value="">Alle</option><option v-for="option in playerOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
      </label>
      <label class="grid gap-1 text-xs font-semibold text-[#5b625d]">Halbzeit
        <select v-model="period" :class="selectClass"><option v-for="option in periodOptions(analysis.periods)" :key="option.value ?? 'all'" :value="option.value">{{ option.label }}</option></select>
      </label>
    </div>

    <svg viewBox="0 0 600 28" class="mb-3 h-7 w-full" preserveAspectRatio="none" role="img" :aria-label="`Zeitleiste mit ${filtered.length} Ereignissen`">
      <rect x="0" y="13" width="600" height="2" fill="#dfe0d9" />
      <rect v-for="event in filtered" :key="event.id" :x="(elapsed(event) / total) * 600 - 1" :y="event.teamAssociation === 'own' ? 3 : 15" width="2" height="10"
            :fill="event.teamAssociation === 'own' ? '#163a2c' : '#c9772f'" />
    </svg>
    <p class="mb-2 text-xs text-[#6c756f]">{{ filtered.length }} Ereignisse · oben {{ ownLabel }}, unten {{ opponentLabel }}</p>

    <ol class="divide-y divide-[#eef0ea]">
      <li v-for="event in filtered.slice(0, shown)" :key="event.id" class="flex items-center gap-3 py-2 text-sm">
        <span class="w-10 shrink-0 tabular-nums text-[#6c756f]">{{ minute(event) }}'</span>
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="event.teamAssociation === 'own' ? 'bg-forest' : 'bg-[#c9772f]'" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-ink">
          <span class="sr-only">{{ event.teamAssociation === 'own' ? ownLabel : opponentLabel }}: </span>{{ eventTypeLabel(event.eventType) }}
          <span v-if="event.jerseyNumber !== null" class="text-[#6c756f]"> · {{ playerLabel(event.teamAssociation, event.jerseyNumber) }}</span>
        </span>
        <a v-if="analysis.veoUrl" :href="veoVideoLink(analysis.veoUrl, event.videoTimeMs)!" target="_blank" rel="noopener"
           class="focus-ring inline-flex min-h-11 shrink-0 items-center text-xs font-semibold text-forest underline" :aria-label="`${describe(event)} im Veo-Video öffnen`">Video</a>
      </li>
    </ol>
    <button v-if="filtered.length > shown" type="button" class="focus-ring mt-2 min-h-11 rounded-xl border border-[#dfe0d9] bg-white px-4 text-sm font-semibold text-ink" @click="shown += PAGE">
      Weitere {{ Math.min(PAGE, filtered.length - shown) }} anzeigen
    </button>
    <p v-if="filtered.length === 0" class="text-sm text-[#6c756f]">Keine Ereignisse für diese Auswahl.</p>
  </div>
</template>
