<script setup lang="ts">
import { PLAYER_CARD_PHYSICAL, PLAYER_CARD_SECTIONS, playerFocusTiles, playerMetricDefinition } from '@vereinsfunk/domain'
import { formatPlayerMetric, playerRowName, playerRowSubtitle, type VeoPlayerRow } from '../utils/playerboardVeoPlayers'

// Spec 002, PR 3: Spielerkarte wie Veos "player focus card" (Inventar §2.3): Kopf mit Name, Nummer
// und Position, Reiter Uebersicht (vier Kacheln nach Position), Werte, Physis und Karten. Die Karten
// liefert der Aufrufer (Spiel: Heatmap je Halbzeit; Saison: ueber alle Spiele).
const props = defineProps<{ row: VeoPlayerRow; sourceLabel: string }>()
const emit = defineEmits<{ close: [] }>()
defineSlots<{ maps?: () => unknown }>()

type Tab = 'overview' | 'stats' | 'physical' | 'maps'
const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'stats', label: 'Werte' },
  { id: 'physical', label: 'Physis' },
  { id: 'maps', label: 'Karten' },
]
const tab = ref<Tab>('overview')
const baseId = useId()
function onTabKeydown(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]!
  tab.value = next.id
  nextTick(() => document.getElementById(`${baseId}-tab-${next.id}`)?.focus())
}

const heading = ref<HTMLElement | null>(null)
watch(() => props.row.key, () => nextTick(() => heading.value?.focus()))
onMounted(() => heading.value?.focus())

const tiles = computed(() => playerFocusTiles(props.row.position).map((id) => {
  const value = props.row.values[id]
  // Veo zeigt bei angekommenen Paessen "x/Paesse".
  const passes = props.row.values.passes
  const display = id === 'passes_successful' && value !== undefined && passes !== undefined ? `${formatPlayerMetric(id, value)}/${formatPlayerMetric('passes', passes)}` : formatPlayerMetric(id, value)
  return { id, label: playerMetricDefinition(id)?.label ?? id, display, missing: value === undefined }
}))
const sections = computed(() => PLAYER_CARD_SECTIONS.map((section) => ({
  label: section.label,
  rows: section.metrics.map((id) => ({ id, label: playerMetricDefinition(id)?.label ?? id, value: props.row.values[id] })),
})))
const physical = computed(() => PLAYER_CARD_PHYSICAL.map((id) => ({ id, label: playerMetricDefinition(id)?.label ?? id, value: props.row.values[id] })))
const hasPhysical = computed(() => physical.value.some((entry) => entry.value !== undefined))
</script>

<template>
  <section class="card p-4" :aria-labelledby="`${baseId}-name`" @keydown.esc="emit('close')">
    <header class="mb-3 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-[11px] text-[#6c756f]">{{ sourceLabel }}</p>
        <h3 :id="`${baseId}-name`" ref="heading" tabindex="-1" class="font-display text-xl font-extrabold text-ink outline-none">{{ playerRowName(row) }}</h3>
        <p v-if="playerRowSubtitle(row)" class="text-xs text-[#5b625d]">{{ playerRowSubtitle(row) }}</p>
        <PersonLink v-if="row.personId" :person-id="row.personId" class="text-sm font-semibold text-forest">Profil öffnen</PersonLink>
      </div>
      <button type="button" class="focus-ring min-h-11 min-w-11 rounded-xl border border-[#dfe0d9] bg-white text-sm font-semibold" aria-label="Spielerkarte schließen" @click="emit('close')">✕</button>
    </header>
    <p v-if="!row.playerId" class="mb-3 rounded-xl bg-[#fbf3e6] p-3 text-xs text-[#7a4d12]">
      Unbekannter Spieler: Diese Rückennummer ist noch keinem Spieler zugeordnet. Trainer ordnen sie unter „Veo“ zu.
    </p>

    <div class="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Spielerkarte">
      <button
        v-for="(entry, index) in tabs" :id="`${baseId}-tab-${entry.id}`" :key="entry.id" type="button" role="tab"
        :aria-selected="tab === entry.id" :aria-controls="`${baseId}-panel`" :tabindex="tab === entry.id ? 0 : -1"
        class="focus-ring min-h-11 rounded-xl border px-3 text-xs font-semibold"
        :class="tab === entry.id ? 'border-forest bg-[#e4f1e7] text-forest' : 'border-[#dfe0d9] bg-white text-ink'"
        @click="tab = entry.id" @keydown="onTabKeydown($event, index)"
      >{{ entry.label }}</button>
    </div>

    <div :id="`${baseId}-panel`" role="tabpanel" :aria-labelledby="`${baseId}-tab-${tab}`">
      <dl v-if="tab === 'overview'" class="grid grid-cols-2 gap-2">
        <div v-for="tile in tiles" :key="tile.id" class="rounded-xl bg-[#f7f8f4] p-3">
          <dt class="text-xs text-[#5b625d]">{{ tile.label }}</dt>
          <dd class="font-display text-2xl font-extrabold tabular-nums" :class="tile.missing ? 'text-[#9aa19c]' : 'text-ink'" :title="tile.missing ? 'Kein Wert vorhanden' : undefined">{{ tile.display }}</dd>
        </div>
      </dl>
      <div v-else-if="tab === 'stats'" class="grid gap-3">
        <section v-for="section in sections" :key="section.label">
          <h4 class="mb-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#7b827d]">{{ section.label }}</h4>
          <dl class="divide-y divide-[#eef0ea] text-sm">
            <div v-for="entry in section.rows" :key="entry.id" class="flex justify-between gap-2 py-1.5">
              <dt class="text-[#5b625d]">{{ entry.label }}</dt>
              <dd class="tabular-nums" :class="entry.value ? 'font-semibold text-ink' : 'text-[#9aa19c]'">{{ formatPlayerMetric(entry.id, entry.value) }}</dd>
            </div>
          </dl>
        </section>
      </div>
      <template v-else-if="tab === 'physical'">
        <dl v-if="hasPhysical" class="grid grid-cols-2 gap-2">
          <div v-for="entry in physical" :key="entry.id" class="rounded-xl bg-[#f7f8f4] p-3">
            <dt class="text-xs text-[#5b625d]">{{ entry.label }}</dt>
            <dd class="font-display text-xl font-extrabold tabular-nums text-ink">{{ formatPlayerMetric(entry.id, entry.value) }}</dd>
          </div>
        </dl>
        <p v-else class="text-sm text-[#6c756f]">Veo hat für diesen Spieler keine Laufwerte erfasst.</p>
      </template>
      <div v-else>
        <slot name="maps" />
      </div>
    </div>
  </section>
</template>
