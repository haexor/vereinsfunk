<script setup lang="ts">
import { CameraOff, Check, CloudOff, LoaderCircle, Minus, Plus, RotateCw } from '@lucide/vue'
import { PlayerboardPointEntrySchema, type PlayerboardCategory, type PlayerboardPlayer, type PlayerboardPointEntry } from '@vereinsfunk/contracts'
import { playerboardErrorMessage } from '../utils/playerboardErrors'
import { createPointSaveQueue, parsePointInput, pointKey, stepPoint, type PointKey, type PointSaveState } from '../utils/playerboardPoints'

// Paket 052, PR 3: Punkteeingabe am Platzrand (Plan: >= 44 px Touchziele, 360 px Breite). Statt
// der breiten Tabelle aus playerboard je Spieler eine Karte mit -/Wert/+ je Kategorie. Aenderungen
// sammeln sich kurz und gehen gemeinsam an PUT .../points (alles oder nichts); scheitert das
// Speichern, bleiben sie offen und lassen sich erneut senden.
const props = defineProps<{
  trainingId: string
  players: readonly PlayerboardPlayer[]
  categories: readonly PlayerboardCategory[]
  entries: readonly PlayerboardPointEntry[]
  canEdit: boolean
  // Kaderspieler ohne gueltige Einwilligung fuer oeffentliche Fotos (Hinweis am Namen).
  missingConsent?: ReadonlySet<string>
}>()

const api = useApiClient()
const values = reactive<Record<PointKey, number | null>>({})
const drafts = reactive<Record<PointKey, string>>({})
const invalid = reactive<Record<PointKey, boolean>>({})
const saveState = ref<PointSaveState>('idle')
const saveError = ref('')

watch(
  () => props.entries,
  (entries) => {
    for (const entry of entries) {
      const key = pointKey(entry.playerId, entry.categoryId)
      if (!(key in values)) values[key] = entry.value
    }
  },
  { immediate: true },
)

const queue = createPointSaveQueue({
  read: (key) => values[key] ?? null,
  save: async (changes) => {
    const entries = changes.map(({ key, value }) => {
      const [playerId, categoryId] = key.split(':') as [string, string]
      return { playerId, categoryId, value }
    })
    await api.request(`/v1/playerboard/trainings/${props.trainingId}/points`, { method: 'PUT', body: { entries } }, PlayerboardPointEntrySchema.array())
  },
  onState: (state, error) => {
    saveState.value = state
    saveError.value = state === 'error' ? playerboardErrorMessage(error, 'Die Werte konnten nicht gespeichert werden. Prüfe die Verbindung.') : ''
  },
})

function valueOf(playerId: string, categoryId: string): number | null {
  return values[pointKey(playerId, categoryId)] ?? null
}

function setValue(key: PointKey, value: number | null) {
  values[key] = value
  delete drafts[key]
  invalid[key] = false
  queue.change(key)
}

function step(player: PlayerboardPlayer, category: PlayerboardCategory, delta: number) {
  const key = pointKey(player.id, category.id)
  setValue(key, stepPoint(values[key] ?? null, delta, category.valueMin, category.valueMax))
}

function onInput(player: PlayerboardPlayer, category: PlayerboardCategory, raw: string) {
  const key = pointKey(player.id, category.id)
  drafts[key] = raw
  const parsed = parsePointInput(raw, category.valueMin, category.valueMax)
  if (!parsed.ok) {
    invalid[key] = true
    return
  }
  if (parsed.value === (values[key] ?? null)) {
    invalid[key] = false
    return
  }
  setValue(key, parsed.value)
}

function displayValue(player: PlayerboardPlayer, category: PlayerboardCategory): string {
  const key = pointKey(player.id, category.id)
  if (key in drafts) return drafts[key]!
  const value = values[key]
  return value === null || value === undefined ? '' : String(value)
}

function totalOf(player: PlayerboardPlayer): number {
  return props.categories.reduce((sum, category) => sum + (valueOf(player.id, category.id) ?? 0), 0)
}

function jersey(player: PlayerboardPlayer): string {
  return player.jerseyNumber === null ? '–' : String(player.jerseyNumber)
}

// Beim Verlassen der Seite noch offene Werte senden; scheitert das, nachfragen statt still zu verwerfen.
onBeforeRouteLeave(async () => {
  if (!queue.hasUnsaved()) return true
  await queue.flush()
  if (!queue.hasUnsaved()) return true
  return window.confirm('Nicht alle Werte sind gespeichert. Seite trotzdem verlassen?')
})
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!queue.hasUnsaved()) return
  event.preventDefault()
  void queue.flush()
}
onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload))
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', warnBeforeUnload)
  void queue.flush().finally(() => queue.dispose())
})
</script>

<template>
  <section aria-labelledby="points-heading">
    <div class="sticky top-16 z-10 -mx-1 mb-3 flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl bg-oat/95 px-1 py-2 backdrop-blur lg:top-0">
      <h2 id="points-heading" class="font-display text-lg font-bold text-ink">Punkte</h2>
      <p v-if="canEdit" class="flex items-center gap-1.5 text-xs font-semibold" role="status" aria-live="polite">
        <template v-if="saveState === 'saving'"><LoaderCircle :size="14" class="animate-spin text-[#6c756f]" /><span class="text-[#6c756f]">Wird gespeichert …</span></template>
        <template v-else-if="saveState === 'pending'"><span class="text-[#6c756f]">Änderungen werden gleich gespeichert</span></template>
        <template v-else-if="saveState === 'saved'"><Check :size="14" class="text-forest" /><span class="text-forest">Alle Werte gespeichert</span></template>
        <template v-else-if="saveState === 'error'">
          <CloudOff :size="14" class="text-amber-700" /><span class="text-amber-800">{{ saveError }}</span>
          <button type="button" class="focus-ring ml-1 inline-flex min-h-11 items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 text-amber-900" @click="queue.flush()">
            <RotateCw :size="14" /> Erneut senden
          </button>
        </template>
      </p>
    </div>

    <p v-if="categories.length === 0" class="card p-5 text-sm text-[#6c756f]">
      Für diese Mannschaft gilt noch keine Kategorie. Lege unter „Kategorien“ eine an, zum Beispiel „Einsatz“ oder „Technik“.
    </p>
    <p v-else-if="players.length === 0" class="card p-5 text-sm text-[#6c756f]">Im Kader steht noch kein aktiver Spieler.</p>

    <ul v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <li v-for="player in players" :key="player.id" class="card p-3 sm:p-4" :data-testid="`points-${player.id}`">
        <div class="mb-2 flex items-center gap-2">
          <span class="grid h-9 min-w-9 shrink-0 place-items-center rounded-lg bg-[#eef1ea] px-1 text-xs font-bold text-forest">{{ jersey(player) }}</span>
          <span class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{{ player.firstName }} {{ player.lastName }}</span>
          <span v-if="missingConsent?.has(player.id)" class="text-amber-700" title="Keine Einwilligung für öffentliche Fotos">
            <CameraOff :size="16" aria-hidden="true" /><span class="sr-only">Keine Einwilligung für öffentliche Fotos</span>
          </span>
          <span class="shrink-0 rounded-full bg-[#e4f1e7] px-2 py-0.5 text-xs font-bold text-forest" :aria-label="`Summe ${totalOf(player)}`">Σ {{ totalOf(player) }}</span>
        </div>

        <div class="divide-y divide-[#ecece5]">
        <div v-for="category in categories" :key="category.id" class="flex items-center gap-2 py-1.5">
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-medium text-ink">{{ category.name }}</span>
            <span class="block text-[10px] text-[#9aa096]">{{ category.valueMin }}–{{ category.valueMax }}</span>
          </span>
          <template v-if="canEdit">
            <button
              type="button"
              class="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#dfe0d9] bg-white text-ink active:bg-[#eef1ea] disabled:opacity-40"
              :disabled="valueOf(player.id, category.id) === category.valueMin"
              :aria-label="`${player.firstName} ${player.lastName}, ${category.name} verringern`"
              @click="step(player, category, -1)"
            >
              <Minus :size="18" />
            </button>
            <input
              :value="displayValue(player, category)"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :aria-label="`${player.firstName} ${player.lastName}, ${category.name}`"
              :aria-invalid="invalid[pointKey(player.id, category.id)] === true"
              class="focus-ring h-11 w-14 shrink-0 rounded-xl border bg-white text-center text-base font-bold text-ink"
              :class="invalid[pointKey(player.id, category.id)] ? 'border-amber-500 bg-amber-50' : 'border-[#dfe0d9]'"
              @input="onInput(player, category, ($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#dfe0d9] bg-white text-ink active:bg-[#eef1ea] disabled:opacity-40"
              :disabled="valueOf(player.id, category.id) === category.valueMax"
              :aria-label="`${player.firstName} ${player.lastName}, ${category.name} erhöhen`"
              @click="step(player, category, 1)"
            >
              <Plus :size="18" />
            </button>
          </template>
          <span v-else class="w-12 text-right text-sm font-bold text-ink">{{ valueOf(player.id, category.id) ?? '–' }}</span>
        </div>
        </div>
      </li>
    </ul>
  </section>
</template>
