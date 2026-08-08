<script setup lang="ts">
import { AlertTriangle, TrendingDown, TrendingUp } from '@lucide/vue'
import {
  AnalyticsBreakdownResponseSchema,
  AnalyticsFunnelResponseSchema,
  AnalyticsSummarySchema,
  AnalyticsTimeseriesResponseSchema,
  type AnalyticsBreakdownDimension,
  type AnalyticsBreakdownEntry,
  type AnalyticsFunnelEntry,
  type AnalyticsGranularity,
  type AnalyticsSummary,
  type AnalyticsTimeseriesMetric,
  type AnalyticsTimeseriesPoint,
} from '@vereinsfunk/contracts'

// Paket 016: Auswertung: interne Kennzahlen. Alle vier Endpunkte berechnen live aus den
// Rohtabellen (siehe plans/016-auswertung-interne-kennzahlen.md, "Abweichungen vom Plan" Punkt 4)
// -- kein Cache, keine Vorberechnung. Kein eigener Scope-Waehler auf dieser Seite: die aktive
// Verein-/Abteilungsauswahl kommt wie auf jeder anderen Seite aus der Sidebar (layouts/default.vue),
// nicht aus einem zweiten, redundanten Auswahlfeld.
const config = useRuntimeConfig()
const session = await useSession()
const scope = await useScope()

const activeOrganization = computed(() => session.value?.scopes.find((item) => item.organizationId === scope.value?.organizationId) ?? null)
const timezone = computed(() => activeOrganization.value?.organizationTimezone ?? 'Europe/Berlin')
const departmentName = computed(() => activeOrganization.value?.departments.find((item) => item.id === scope.value?.departmentId)?.name ?? null)

function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
function addDaysToKey(day: string, delta: number): string {
  const [year, month, date] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))]
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10)
}

type RangePreset = '7d' | '30d' | '90d' | 'this_month' | 'last_month' | 'custom'
const rangePreset = ref<RangePreset>('30d')
const customFrom = ref('')
const customTo = ref('')

const range = computed<{ from: string; to: string }>(() => {
  const todayKey = localDateKey(new Date(), timezone.value)
  if (rangePreset.value === '7d') return { from: addDaysToKey(todayKey, -6), to: todayKey }
  if (rangePreset.value === '90d') return { from: addDaysToKey(todayKey, -89), to: todayKey }
  if (rangePreset.value === 'this_month') return { from: `${todayKey.slice(0, 7)}-01`, to: todayKey }
  if (rangePreset.value === 'last_month') {
    const firstOfThisMonth = `${todayKey.slice(0, 7)}-01`
    const lastOfPreviousMonth = addDaysToKey(firstOfThisMonth, -1)
    return { from: `${lastOfPreviousMonth.slice(0, 7)}-01`, to: lastOfPreviousMonth }
  }
  if (rangePreset.value === 'custom' && customFrom.value && customTo.value) return { from: customFrom.value, to: customTo.value }
  return { from: addDaysToKey(todayKey, -29), to: todayKey }
})

const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: '7d', label: '7 Tage' }, { value: '30d', label: '30 Tage' }, { value: '90d', label: '90 Tage' },
  { value: 'this_month', label: 'Laufender Monat' }, { value: 'last_month', label: 'Vormonat' }, { value: 'custom', label: 'Frei' },
]

const BREAKDOWN_DIMENSIONS: { value: AnalyticsBreakdownDimension; label: string }[] = [
  { value: 'department', label: 'Abteilung' }, { value: 'preset', label: 'Anlass' }, { value: 'goal', label: 'Ziel' },
]
const breakdownDimension = ref<AnalyticsBreakdownDimension>('department')

const TIMESERIES_METRICS: { value: AnalyticsTimeseriesMetric; label: string }[] = [
  { value: 'postsCreated', label: 'Beiträge erstellt' }, { value: 'postsPublished', label: 'Beiträge veröffentlicht' },
  { value: 'publicationsPublished', label: 'Publikationen' }, { value: 'approvalsGranted', label: 'Freigaben erteilt' },
  { value: 'approvalsChangesRequested', label: 'Änderungen angefordert' },
]
const timeseriesMetric = ref<AnalyticsTimeseriesMetric>('postsCreated')
const timeseriesGranularity = ref<AnalyticsGranularity>('day')

const loading = ref(true)
const errorMessage = ref('')
const summary = ref<AnalyticsSummary | null>(null)
const timeseriesPoints = ref<AnalyticsTimeseriesPoint[]>([])
const breakdownEntries = ref<AnalyticsBreakdownEntry[]>([])
const funnelStages = ref<AnalyticsFunnelEntry[]>([])

function buildScopeQuery(): Record<string, string> {
  const organizationId = scope.value?.organizationId
  if (!organizationId) return {}
  const query: Record<string, string> = { organizationId, from: range.value.from, to: range.value.to }
  if (scope.value?.departmentId) query.departmentId = scope.value.departmentId
  return query
}

async function load() {
  const organizationId = scope.value?.organizationId
  if (!organizationId) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const base = `${config.public.apiBase}/v1/analytics`
    const baseQuery = buildScopeQuery()
    const [summaryResponse, timeseriesResponse, breakdownResponse, funnelResponse] = await Promise.all([
      $fetch<unknown>(`${base}/summary`, { headers, query: baseQuery }),
      $fetch<unknown>(`${base}/timeseries`, { headers, query: { ...baseQuery, metric: timeseriesMetric.value, granularity: timeseriesGranularity.value } }),
      $fetch<unknown>(`${base}/breakdown`, { headers, query: { ...baseQuery, dimension: breakdownDimension.value } }),
      $fetch<unknown>(`${base}/funnel`, { headers, query: baseQuery }),
    ])
    summary.value = AnalyticsSummarySchema.parse(summaryResponse)
    timeseriesPoints.value = AnalyticsTimeseriesResponseSchema.parse(timeseriesResponse).points
    breakdownEntries.value = AnalyticsBreakdownResponseSchema.parse(breakdownResponse).entries
    funnelStages.value = AnalyticsFunnelResponseSchema.parse(funnelResponse).stages
  } catch {
    errorMessage.value = 'Die Kennzahlen konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()
watch([() => scope.value?.organizationId, () => scope.value?.departmentId, range], () => { void load() })
watch([timeseriesMetric, timeseriesGranularity], async () => {
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/analytics/timeseries`, {
      headers, query: { ...buildScopeQuery(), metric: timeseriesMetric.value, granularity: timeseriesGranularity.value },
    })
    timeseriesPoints.value = AnalyticsTimeseriesResponseSchema.parse(response).points
  } catch {
    // Der Rest der Seite bleibt bei einem Fehlschlag der Zeitreihe unberuehrt.
  }
})
watch(breakdownDimension, async () => {
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/analytics/breakdown`, {
      headers, query: { ...buildScopeQuery(), dimension: breakdownDimension.value },
    })
    breakdownEntries.value = AnalyticsBreakdownResponseSchema.parse(response).entries
  } catch {
    // Siehe oben.
  }
})

function formatTrend(value: number | null): string | null {
  if (value === null) return null
  const percent = Math.round(value * 100)
  return `${percent > 0 ? '+' : ''}${percent} %`
}
function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)} %`
}
function formatSeconds(value: number | null): string {
  if (value === null) return '—'
  if (value < 3600) return `${Math.round(value / 60)} Min`
  if (value < 86_400) return `${(value / 3600).toFixed(1)} Std`
  return `${(value / 86_400).toFixed(1)} Tage`
}
function formatDate(day: string): string {
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' }).format(new Date(`${day}T00:00:00Z`))
}

const FUNNEL_LABELS: Record<string, string> = {
  draft: 'Entwurf', approval_requested: 'Freigabe angefragt', approved: 'Freigegeben', scheduled: 'Geplant', published: 'Veröffentlicht',
}

// Handgerolltes SVG statt einer neuen Chart-Bibliothek (Abweichung 5 im Plan) -- echte Achse,
// Datumslabels, Skala und Nulllinie, keine neue Laufzeitabhaengigkeit.
const CHART_WIDTH = 640
const CHART_HEIGHT = 200
const CHART_PAD_LEFT = 34
const CHART_PAD_BOTTOM = 22
const CHART_PAD_TOP = 10

const chartMaxValue = computed(() => Math.max(1, ...timeseriesPoints.value.map((point) => point.value)))
const chartInnerHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM
const chartInnerWidth = computed(() => CHART_WIDTH - CHART_PAD_LEFT - 8)

function chartX(index: number): number {
  const count = timeseriesPoints.value.length
  if (count <= 1) return CHART_PAD_LEFT
  return CHART_PAD_LEFT + (index / (count - 1)) * chartInnerWidth.value
}
function chartY(value: number): number {
  return CHART_PAD_TOP + chartInnerHeight - (value / chartMaxValue.value) * chartInnerHeight
}
const chartPath = computed(() => timeseriesPoints.value.map((point, index) => `${index === 0 ? 'M' : 'L'}${chartX(index).toFixed(1)},${chartY(point.value).toFixed(1)}`).join(' '))
const chartGridLines = computed(() => {
  const steps = 4
  return Array.from({ length: steps + 1 }, (_, step) => {
    const value = Math.round((chartMaxValue.value / steps) * step)
    return { value, y: chartY(value) }
  })
})
// Hoechstens ~6 Datumsbeschriftungen, sonst ueberlappen sie sich bei 90 Tagen oder mehr.
const chartLabelIndices = computed(() => {
  const count = timeseriesPoints.value.length
  if (count === 0) return []
  const labelCount = Math.min(6, count)
  const step = (count - 1) / Math.max(1, labelCount - 1)
  return Array.from({ length: labelCount }, (_, index) => Math.round(index * step))
})

const maxBreakdownCount = computed(() => Math.max(1, ...breakdownEntries.value.map((entry) => entry.count)))
const maxFunnelCount = computed(() => Math.max(1, ...funnelStages.value.map((stage) => stage.count)))
</script>

<template>
  <div class="mx-auto max-w-[1180px] px-5 py-8 sm:px-10">
    <header class="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div class="eyebrow mb-3">Auswertung</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">{{ departmentName ?? 'Verein' }}</h1>
        <p class="mt-2 text-sm text-[#727a75]">
          {{ formatDate(range.from) }} – {{ formatDate(range.to) }}
          <span v-if="summary?.coverage.measurementStartsAt"> · Messung seit {{ formatDate(summary.coverage.measurementStartsAt) }}</span>
        </p>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="preset in RANGE_PRESETS" :key="preset.value" type="button"
          class="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold transition"
          :class="rangePreset === preset.value ? 'bg-forest text-white' : 'bg-white text-[#5c6359] hover:bg-stone-100'"
          @click="rangePreset = preset.value"
        >{{ preset.label }}</button>
      </div>
    </header>

    <div v-if="rangePreset === 'custom'" class="mb-6 flex flex-wrap items-center gap-2 text-xs">
      <label class="flex items-center gap-1.5">von <input v-model="customFrom" type="date" class="focus-ring rounded-lg border border-[#dfe0d9] px-2 py-1" /></label>
      <label class="flex items-center gap-1.5">bis <input v-model="customTo" type="date" class="focus-ring rounded-lg border border-[#dfe0d9] px-2 py-1" /></label>
    </div>

    <section v-if="errorMessage" class="card mb-7 p-5 text-sm font-semibold text-red-700">{{ errorMessage }}</section>

    <section v-else-if="loading" class="card mb-7 p-8 text-center text-sm text-[#7b827d]">Kennzahlen werden geladen …</section>

    <template v-else-if="summary">
      <section class="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Kennzahlen">
        <article class="card p-4">
          <div class="font-display text-2xl font-extrabold tracking-[-.04em]">{{ summary.postsCreated }}</div>
          <div class="mt-1 flex items-center gap-1 text-[11px] text-[#7a817d]">
            <span class="font-semibold text-ink">Beiträge erstellt</span>
            <span v-if="formatTrend(summary.postsCreatedTrend)" class="flex items-center gap-0.5" :class="(summary.postsCreatedTrend ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'">
              <component :is="(summary.postsCreatedTrend ?? 0) >= 0 ? TrendingUp : TrendingDown" :size="11" />{{ formatTrend(summary.postsCreatedTrend) }}
            </span>
          </div>
        </article>
        <article class="card p-4">
          <div class="font-display text-2xl font-extrabold tracking-[-.04em]">{{ summary.postsPublished }}</div>
          <div class="mt-1 flex items-center gap-1 text-[11px] text-[#7a817d]">
            <span class="font-semibold text-ink">Veröffentlicht</span>
            <span v-if="formatTrend(summary.postsPublishedTrend)" class="flex items-center gap-0.5" :class="(summary.postsPublishedTrend ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'">
              <component :is="(summary.postsPublishedTrend ?? 0) >= 0 ? TrendingUp : TrendingDown" :size="11" />{{ formatTrend(summary.postsPublishedTrend) }}
            </span>
          </div>
        </article>
        <article class="card p-4">
          <div class="font-display text-2xl font-extrabold tracking-[-.04em]">{{ summary.publicationsPublished }}</div>
          <div class="mt-1 flex items-center gap-1 text-[11px] text-[#7a817d]">
            <span class="font-semibold text-ink">Publikationen</span>
            <span v-if="formatTrend(summary.publicationsPublishedTrend)" class="flex items-center gap-0.5" :class="(summary.publicationsPublishedTrend ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'">
              <component :is="(summary.publicationsPublishedTrend ?? 0) >= 0 ? TrendingUp : TrendingDown" :size="11" />{{ formatTrend(summary.publicationsPublishedTrend) }}
            </span>
          </div>
        </article>
        <article class="card p-4">
          <div class="font-display text-2xl font-extrabold tracking-[-.04em]">{{ formatPercent(summary.approvalRate) }}</div>
          <div class="mt-1 flex items-center gap-1 text-[11px] text-[#7a817d]">
            <span class="font-semibold text-ink">Freigabequote</span>
            <span v-if="formatTrend(summary.approvalRateTrend)" class="flex items-center gap-0.5" :class="(summary.approvalRateTrend ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'">
              <component :is="(summary.approvalRateTrend ?? 0) >= 0 ? TrendingUp : TrendingDown" :size="11" />{{ formatTrend(summary.approvalRateTrend) }}
            </span>
          </div>
        </article>
        <article class="card p-4">
          <div class="font-display text-2xl font-extrabold tracking-[-.04em]">{{ formatSeconds(summary.leadTimeSecondsMedian) }}</div>
          <div class="mt-1 flex items-center gap-1 text-[11px] text-[#7a817d]">
            <span class="font-semibold text-ink">Durchlaufzeit-Median</span>
            <span v-if="formatTrend(summary.leadTimeSecondsMedianTrend)" class="flex items-center gap-0.5" :class="(summary.leadTimeSecondsMedianTrend ?? 0) <= 0 ? 'text-emerald-700' : 'text-red-700'">
              <component :is="(summary.leadTimeSecondsMedianTrend ?? 0) <= 0 ? TrendingDown : TrendingUp" :size="11" />{{ formatTrend(summary.leadTimeSecondsMedianTrend) }}
            </span>
          </div>
        </article>
      </section>

      <section class="card mb-7 p-5 sm:p-6">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-display text-base font-bold tracking-[-.02em]">Zeitreihe</h2>
          <div class="flex flex-wrap gap-2">
            <select v-model="timeseriesMetric" class="focus-ring rounded-lg border border-[#dfe0d9] bg-white px-2 py-1 text-xs font-semibold">
              <option v-for="metric in TIMESERIES_METRICS" :key="metric.value" :value="metric.value">{{ metric.label }}</option>
            </select>
            <div class="flex overflow-hidden rounded-lg border border-[#dfe0d9]">
              <button
                v-for="granularity in (['day', 'week', 'month'] as const)" :key="granularity" type="button"
                class="px-2.5 py-1 text-xs font-semibold transition"
                :class="timeseriesGranularity === granularity ? 'bg-forest text-white' : 'bg-white text-[#5c6359] hover:bg-stone-100'"
                @click="timeseriesGranularity = granularity"
              >{{ granularity === 'day' ? 'Tag' : granularity === 'week' ? 'Woche' : 'Monat' }}</button>
            </div>
          </div>
        </div>
        <div v-if="timeseriesPoints.length === 0" class="p-8 text-center text-xs text-[#7b827d]">Für diesen Zeitraum liegen keine Daten vor.</div>
        <svg v-else :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" class="w-full" role="img" aria-label="Zeitreihe der gewählten Kennzahl">
          <line
            v-for="grid in chartGridLines" :key="grid.value"
            :x1="CHART_PAD_LEFT" :x2="CHART_WIDTH - 8" :y1="grid.y" :y2="grid.y"
            :stroke="grid.value === 0 ? '#b7bdb2' : '#eceee7'" :stroke-width="grid.value === 0 ? 1.5 : 1"
          />
          <text v-for="grid in chartGridLines" :key="`label-${grid.value}`" :x="CHART_PAD_LEFT - 6" :y="grid.y + 3" text-anchor="end" font-size="9" fill="#8a908b">{{ grid.value }}</text>
          <path :d="chartPath" fill="none" stroke="#163a2c" stroke-width="2" />
          <text
            v-for="index in chartLabelIndices" :key="`x-${index}`"
            :x="chartX(index)" :y="CHART_HEIGHT - 4" text-anchor="middle" font-size="9" fill="#8a908b"
          >{{ formatDate(timeseriesPoints[index]?.bucketStart ?? '') }}</text>
        </svg>
      </section>

      <section class="card mb-7 p-5 sm:p-6">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-display text-base font-bold tracking-[-.02em]">Aufschlüsselung</h2>
          <div class="flex overflow-hidden rounded-lg border border-[#dfe0d9]">
            <button
              v-for="dimension in BREAKDOWN_DIMENSIONS" :key="dimension.value" type="button"
              class="px-2.5 py-1 text-xs font-semibold transition"
              :class="breakdownDimension === dimension.value ? 'bg-forest text-white' : 'bg-white text-[#5c6359] hover:bg-stone-100'"
              @click="breakdownDimension = dimension.value"
            >{{ dimension.label }}</button>
          </div>
        </div>
        <div v-if="breakdownEntries.length === 0" class="p-8 text-center text-xs text-[#7b827d]">Für diesen Zeitraum liegen keine Einreichungen vor.</div>
        <ul v-else class="space-y-2">
          <li v-for="entry in breakdownEntries" :key="entry.key" class="flex items-center gap-3">
            <span class="w-32 shrink-0 truncate text-xs font-semibold text-ink" :title="entry.label">{{ entry.label }}</span>
            <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-[#eceee7]">
              <div class="h-full rounded-full bg-forest" :style="{ width: `${(entry.count / maxBreakdownCount) * 100}%` }" />
            </div>
            <span class="w-8 shrink-0 text-right text-xs font-bold text-ink">{{ entry.count }}</span>
          </li>
        </ul>
      </section>

      <section class="card mb-7 p-5 sm:p-6">
        <h2 class="mb-4 font-display text-base font-bold tracking-[-.02em]">Funnel: wo bleiben Beiträge liegen</h2>
        <ul class="space-y-2">
          <li v-for="stage in funnelStages" :key="stage.stage" class="flex items-center gap-3">
            <span class="w-36 shrink-0 text-xs font-semibold text-ink">{{ FUNNEL_LABELS[stage.stage] ?? stage.stage }}</span>
            <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-[#eceee7]">
              <div class="h-full rounded-full bg-lime" :style="{ width: `${(stage.count / maxFunnelCount) * 100}%` }" />
            </div>
            <span class="w-8 shrink-0 text-right text-xs font-bold text-ink">{{ stage.count }}</span>
          </li>
        </ul>
      </section>

      <section v-if="summary.quotas.length > 0" class="card mb-7 p-5 sm:p-6">
        <h2 class="mb-4 font-display text-base font-bold tracking-[-.02em]">Kontingentauslastung</h2>
        <ul class="space-y-2">
          <li v-for="quota in summary.quotas" :key="quota.id" class="flex items-center gap-3">
            <span class="w-36 shrink-0 truncate text-xs font-semibold text-ink">{{ quota.scope === 'organization' ? 'Verein' : quota.scope === 'department' ? 'Abteilung' : 'Team' }} · {{ quota.period === 'day' ? 'Tag' : quota.period === 'week' ? 'Woche' : 'Monat' }}</span>
            <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-[#eceee7]">
              <div class="h-full rounded-full" :class="quota.used >= quota.maxPublications ? 'bg-red-600' : 'bg-forest'" :style="{ width: `${Math.min(100, (quota.used / quota.maxPublications) * 100)}%` }" />
            </div>
            <span class="w-16 shrink-0 text-right text-xs font-bold text-ink">{{ quota.used }} / {{ quota.maxPublications }}</span>
          </li>
        </ul>
      </section>

      <section class="card p-6">
        <h2 class="mb-2 flex items-center gap-2 font-display text-base font-bold">
          <AlertTriangle :size="16" class="text-amber-700" /> Reichweite und Interaktionen
        </h2>
        <p class="text-xs text-[#7b827d]">
          Noch nicht verfügbar — diese Zahlen kommen von Instagram und Facebook selbst und liegen erst vor, sobald die Plattform-Anbindung (Paket 017) freigeschaltet ist.
          Diese Seite zeigt bis dahin nur, was im eigenen System messbar ist: Produktion, Freigabe und Veröffentlichung.
        </p>
      </section>
    </template>
  </div>
</template>
