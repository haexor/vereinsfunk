<script setup lang="ts">
import { PlayerboardVeoKeyMetricIdSchema, type PlayerboardVeoSeasonMatch, type PlayerboardVeoTeamViews } from '@vereinsfunk/contracts'
import { DEFAULT_RADAR_METRICS, defaultRadarRanges, keyMetricDefinition, matchResult, radarAxes, seasonKeyMetrics } from '@vereinsfunk/domain'
import { playerboardErrorMessage } from '../utils/playerboardErrors'
import { formatKeyMetric } from '../utils/playerboardVeoAnalytics'

// Spec 002, PR 4: Vergleichsradar wie Veo (Inventar §1b.8): sechs Kennzahlen, die eigene
// Mannschaft gegen eine andere Mannschaft des Vereins oder gegen einen anderen Zeitraum. Jede Achse
// ist auf den groesseren der beiden Werte normiert. Die Spielarten des Filters gelten, Anzahl und
// Auswahl nicht. Trainer speichern Kennzahlen, Vergleichsmannschaft und Zeitraeume fuer alle.
type Radar = NonNullable<PlayerboardVeoTeamViews['radar']>
const props = defineProps<{
  teamId: string
  ownLabel: string
  teams: readonly { id: string; name: string }[]
  config: Radar | null
  kinds: readonly string[]
  canEdit: boolean
}>()
const emit = defineEmits<{ save: [radar: Radar] }>()

const { loadSeason } = usePlayerboardVeoSeason()
const settings = ref<Radar>(props.config ?? { metrics: [...DEFAULT_RADAR_METRICS], comparingTeamId: null, ...defaultRadarRanges(new Date()) })
watch(() => props.config, (config) => { if (config) settings.value = config })
const editing = ref(false)

const own = ref<PlayerboardVeoSeasonMatch[] | null>(null)
const comparing = ref<PlayerboardVeoSeasonMatch[] | null>(null)
const errorMessage = ref('')
const runs = useLatestRequest()
async function load() {
  const isLatest = runs.begin()
  errorMessage.value = ''
  const kinds = props.kinds.length ? { kinds: props.kinds } : {}
  const range = (value: readonly [string, string]) => ({ from: value[0], to: value[1], ...kinds })
  try {
    const [ownMatches, comparingMatches] = await Promise.all([
      loadSeason(props.teamId, range(settings.value.ownRange)),
      loadSeason(settings.value.comparingTeamId ?? props.teamId, range(settings.value.comparingRange)),
    ])
    if (!isLatest()) return
    own.value = ownMatches
    comparing.value = comparingMatches
  } catch (error) {
    if (isLatest()) errorMessage.value = playerboardErrorMessage(error, 'Die Werte für den Vergleich konnten nicht geladen werden.')
  }
}
onMounted(load)
watch([settings, () => props.kinds, () => props.teamId], () => { void load() }, { deep: true })

function change(patch: Partial<Radar>) {
  settings.value = { ...settings.value, ...patch }
  if (props.canEdit) emit('save', settings.value)
}
function setRange(which: 'ownRange' | 'comparingRange', index: 0 | 1, value: string) {
  if (!value) return
  const next: [string, string] = [...settings.value[which]]
  next[index] = value
  if (next[0] <= next[1]) change({ [which]: next })
}

const comparingLabel = computed(() => (settings.value.comparingTeamId
  ? props.teams.find((team) => team.id === settings.value.comparingTeamId)?.name ?? 'Vergleich'
  : `${props.ownLabel} (Vergleichszeitraum)`))
const axes = computed(() => radarAxes(settings.value.metrics, seasonKeyMetrics(own.value ?? []), comparing.value ? seasonKeyMetrics(comparing.value) : null))

const WIDTH = 600
const HEIGHT = 510
const CX = WIDTH / 2
const CY = HEIGHT / 2
// Veo nutzt 0,375 der Hoehe; etwas kleiner, damit die groessere Beschriftung auch auf 360 px lesbar bleibt.
const RADIUS = 0.32 * HEIGHT
const point = (index: number, radius: number) => {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, axes.value.length)
  return [CX + Math.cos(angle) * radius * RADIUS, CY + Math.sin(angle) * radius * RADIUS] as const
}
const polygon = (radii: readonly number[]) => radii.map((radius, index) => point(index, radius).join(',')).join(' ')
const grid = computed(() => [0.25, 0.5, 0.75, 1].map((level) => polygon(axes.value.map(() => level))))
const results = (matches: readonly PlayerboardVeoSeasonMatch[] | null) => (matches ?? []).flatMap((match) => matchResult(match) ?? []).slice(-5)
const RESULT_LETTER = { win: 'S', draw: 'U', loss: 'N' } as const
const inputClass = 'focus-ring h-11 min-w-0 rounded-xl border border-[#dfe0d9] bg-white px-2 text-sm text-ink'
</script>

<template>
  <div>
    <div class="mb-4 grid gap-3 md:grid-cols-2">
      <div class="rounded-xl border border-[#dfe0d9] bg-white p-3">
        <p class="flex items-center gap-2 text-sm font-semibold text-ink"><span class="h-3 w-3 rounded-full bg-forest" aria-hidden="true" />{{ ownLabel }}</p>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <label class="grid gap-1 text-xs text-[#5b625d]">Von<input type="date" :class="inputClass" :value="settings.ownRange[0]" @change="setRange('ownRange', 0, ($event.target as HTMLInputElement).value)" /></label>
          <label class="grid gap-1 text-xs text-[#5b625d]">Bis<input type="date" :class="inputClass" :value="settings.ownRange[1]" @change="setRange('ownRange', 1, ($event.target as HTMLInputElement).value)" /></label>
        </div>
        <p class="mt-2 text-xs text-[#5b625d]">Ergebnisse: <template v-if="results(own).length">{{ results(own).map((result) => RESULT_LETTER[result]).join(' ') }}</template><template v-else>keine Spiele im Zeitraum</template></p>
      </div>
      <div class="rounded-xl border border-[#dfe0d9] bg-white p-3">
        <label class="grid gap-1 text-sm font-semibold text-ink">
          <span class="flex items-center gap-2"><span class="h-3 w-3 rounded-full bg-[#c9772f]" aria-hidden="true" />Vergleich mit</span>
          <select :class="inputClass" :value="settings.comparingTeamId ?? ''" @change="change({ comparingTeamId: ($event.target as HTMLSelectElement).value || null })">
            <option value="">Keine (Zeitraumvergleich)</option>
            <option v-for="team in teams" :key="team.id" :value="team.id">{{ team.name }}</option>
          </select>
        </label>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <label class="grid gap-1 text-xs text-[#5b625d]">Von<input type="date" :class="inputClass" :value="settings.comparingRange[0]" @change="setRange('comparingRange', 0, ($event.target as HTMLInputElement).value)" /></label>
          <label class="grid gap-1 text-xs text-[#5b625d]">Bis<input type="date" :class="inputClass" :value="settings.comparingRange[1]" @change="setRange('comparingRange', 1, ($event.target as HTMLInputElement).value)" /></label>
        </div>
        <p class="mt-2 text-xs text-[#5b625d]">Ergebnisse: <template v-if="results(comparing).length">{{ results(comparing).map((result) => RESULT_LETTER[result]).join(' ') }}</template><template v-else>keine Spiele im Zeitraum</template></p>
      </div>
    </div>

    <p v-if="errorMessage" class="mb-2 text-sm text-amber-800" role="alert">{{ errorMessage }}</p>
    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" class="mx-auto w-full max-w-xl" role="img" :aria-label="`Vergleichsradar ${ownLabel} gegen ${comparingLabel}`">
      <polygon v-for="(points, index) in grid" :key="index" :points="points" fill="none" stroke="#dfe0d9" />
      <line v-for="(axis, index) in axes" :key="axis.id" :x1="CX" :y1="CY" :x2="point(index, 1)[0]" :y2="point(index, 1)[1]" stroke="#eef0ea" />
      <polygon :points="polygon(axes.map((axis) => axis.comparingRadius))" fill="#c9772f" fill-opacity=".3" stroke="#c9772f" stroke-width="2" />
      <polygon :points="polygon(axes.map((axis) => axis.ownRadius))" fill="#163a2c" fill-opacity=".3" stroke="#163a2c" stroke-width="2" />
      <g v-for="(axis, index) in axes" :key="`label-${axis.id}`" font-size="20" text-anchor="middle">
        <text :x="point(index, 1.16)[0]" :y="point(index, 1.16)[1]" fill="#5b625d">{{ keyMetricDefinition(axis.id)?.label ?? axis.id }}</text>
        <text :x="point(index, 1.16)[0]" :y="point(index, 1.16)[1] + 23" font-weight="700" fill="#163a2c">{{ formatKeyMetric(axis.id, axis.own) }} · {{ formatKeyMetric(axis.id, axis.comparing) }}</text>
      </g>
    </svg>
    <!-- Tabellen ignorieren die 1-px-Breite von sr-only; der Rahmen haelt sie aus dem Layout. -->
    <div class="sr-only">
      <table>
        <caption>Vergleich {{ ownLabel }} gegen {{ comparingLabel }}</caption>
        <thead><tr><th scope="col">Kennzahl</th><th scope="col">{{ ownLabel }}</th><th scope="col">{{ comparingLabel }}</th></tr></thead>
        <tbody>
          <tr v-for="axis in axes" :key="axis.id"><th scope="row">{{ keyMetricDefinition(axis.id)?.label ?? axis.id }}</th><td>{{ formatKeyMetric(axis.id, axis.own) }}</td><td>{{ formatKeyMetric(axis.id, axis.comparing) }}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-[#6c756f]">Jede Achse misst beide Seiten am größeren Wert der beiden.</p>
      <button v-if="canEdit" type="button" class="focus-ring min-h-11 rounded-xl border border-[#dfe0d9] bg-white px-4 text-sm font-semibold text-ink" @click="editing = true">Kennzahlen bearbeiten</button>
    </div>
    <PlayerboardVeoMetricPicker
      v-if="editing" title="Kennzahlen bearbeiten" description="Wähle genau sechs Kennzahlen für den Vergleich."
      :selected="settings.metrics" :min="6" :max="6"
      @apply="(ids) => { change({ metrics: PlayerboardVeoKeyMetricIdSchema.array().parse(ids) }); editing = false }" @close="editing = false"
    />
  </div>
</template>
