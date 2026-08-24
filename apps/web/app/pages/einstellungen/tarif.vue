<script setup lang="ts">
import {
  ChangeSubscriptionPlanRequestSchema,
  StorageUsageResponseSchema,
  SubscriptionPlanSchema,
  SubscriptionSummarySchema,
  type MediaOrigin,
  type StorageUsageResponse,
  type SubscriptionPlan,
  type SubscriptionSummary,
} from '@vereinsfunk/contracts'

// Plan 021: Tarif, Speicher- und Beitragskontingente des eigenen Vereins -- Balken mit
// absoluten Zahlen daneben, keine Instagram-Fachbegriffe, keine Kosten-/Tokenzahl (siehe
// plans/021, "Fachliches Modell"). ai_image/ai_video sind spezifiziert, aber noch wirkungslos
// (keine Erzeugung existiert) -- als "bald verfügbar" markiert, nicht verschwiegen.
const MEDIA_ORIGIN_LABELS: Record<MediaOrigin, string> = { own_upload: 'Eigene Beiträge', ai_image: 'KI-Bilder', ai_video: 'KI-Videos' }
const MEDIA_ORIGIN_AVAILABLE: Record<MediaOrigin, boolean> = { own_upload: true, ai_image: false, ai_video: false }

const api = useApiClient()
const { organizationId, level: activeScopeLevel } = await useActiveScope()
const isOrganizationScope = computed(() => activeScopeLevel.value === 'organization')
const canView = computed(() => useCan('organization.manage', { organizationId: organizationId.value ?? '' }) || useCan('billing.manage', { organizationId: organizationId.value ?? '' }))
// Der Tarif gehoert zum Verein, nicht zu einer Abteilung. Auch eine Person mit
// Abrechnungsrolle wechselt ihn deshalb erst nach dem Wechsel in den Vereinsbereich.
const canChangePlan = computed(() => isOrganizationScope.value && useCan('billing.manage', { organizationId: organizationId.value ?? '' }))

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')
const saving = ref(false)

const summary = ref<SubscriptionSummary | null>(null)
const plans = ref<SubscriptionPlan[]>([])
const storageBreakdown = ref<StorageUsageResponse | null>(null)
const selectedPlanKey = ref('')

function formatQuota(value: number): string {
  return new Intl.NumberFormat('de-DE').format(value)
}

async function load() {
  if (!organizationId.value || !canView.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const [summaryResponse, plansResponse, storageResponse] = await Promise.all([
      api.request('/v1/subscription', { query: { organizationId: organizationId.value } }, SubscriptionSummarySchema),
      api.request('/v1/subscription/plans', {}, SubscriptionPlanSchema.array()),
      api.request('/v1/storage/usage', { query: { organizationId: organizationId.value } }, StorageUsageResponseSchema),
    ])
    summary.value = summaryResponse
    plans.value = plansResponse
    storageBreakdown.value = storageResponse
    selectedPlanKey.value = summaryResponse.plan.key
  } catch {
    errorMessage.value = 'Der Tarif konnte nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()
watch(organizationId, () => { void load() })

async function changePlan() {
  if (!canChangePlan.value || !organizationId.value || !summary.value || selectedPlanKey.value === summary.value.plan.key) return
  saving.value = true
  actionError.value = ''
  try {
    const body = ChangeSubscriptionPlanRequestSchema.parse({ planKey: selectedPlanKey.value })
    await api.request('/v1/subscription/plan', { method: 'POST', body: { organizationId: organizationId.value, ...body } })
    await load()
  } catch {
    actionError.value = 'Tarifwechsel fehlgeschlagen.'
  } finally {
    saving.value = false
  }
}

function formatPrice(cents: number | null, currency: string): string {
  if (cents === null) return 'Individuell'
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100)
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Einstellungen</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Tarif</h1>
      <p class="mt-2 text-sm text-[#727a75]">Speicher und Beitragskontingente eures Vereins, und was der jeweilige Tarif davon erlaubt.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="!canView" class="text-sm text-amber-800">Nur die Vereinsleitung kann den Tarif einsehen.</p>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else-if="summary">
      <section class="card mb-6 p-6">
        <h2 class="mb-1 font-display text-base font-bold">{{ summary.plan.displayName }}</h2>
        <p class="mb-4 text-sm text-[#727a75]">{{ formatPrice(summary.plan.monthlyPriceCents, summary.plan.currency) }} / Monat</p>
        <p v-if="summary.isStorageOverridden || summary.isStructureOverridden" class="mb-4 text-xs text-amber-800">
          Für euren Verein gelten individuell angepasste Grenzen.
        </p>

        <div class="space-y-3">
          <UsageBar label="Speicher" :used="summary.usage.storageBytes" :max="summary.limits.storageBytes" :format-value="formatBytes" />
          <UsageBar
            v-for="quota in summary.contentQuotas"
            :key="quota.mediaOrigin"
            :label="`${MEDIA_ORIGIN_LABELS[quota.mediaOrigin]} · diesen Monat`"
            :used="quota.used"
            :max="quota.maxPerMonth"
            :format-value="formatQuota"
          />
          <UsageBar label="Mannschaften" :used="summary.usage.teams" :max="summary.limits.maxTeams" :format-value="formatQuota" />
          <UsageBar label="Abteilungen" :used="summary.usage.departments" :max="summary.limits.maxDepartments" :format-value="formatQuota" />
        </div>

        <p v-if="summary.contentQuotas.some((quota) => quota.mediaOrigin === 'ai_video' && quota.maxDurationSeconds !== null)" class="mt-3 text-xs text-[#727a75]">
          KI-Videos bis {{ summary.contentQuotas.find((quota) => quota.mediaOrigin === 'ai_video')?.maxDurationSeconds }} Sekunden Länge.
        </p>
      </section>

      <section v-if="storageBreakdown" class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Speicher nach Quelle</h2>
        <dl class="grid gap-4 sm:grid-cols-3">
          <div><dt class="text-xs text-[#727a75]">Eigene Beiträge</dt><dd class="mt-1 font-display text-lg font-bold">{{ formatBytes(storageBreakdown.breakdown.ownUploads) }}</dd></div>
          <div><dt class="text-xs text-[#727a75]">Gerenderte Medien</dt><dd class="mt-1 font-display text-lg font-bold">{{ formatBytes(storageBreakdown.breakdown.renderedMedia) }}</dd></div>
          <div><dt class="text-xs text-[#727a75]">Vereinsmarke</dt><dd class="mt-1 font-display text-lg font-bold">{{ formatBytes(storageBreakdown.breakdown.brandAssets) }}</dd></div>
        </dl>
      </section>

      <section v-if="canChangePlan" class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Tarif wechseln</h2>
        <form class="flex flex-wrap items-end gap-3" @submit.prevent="changePlan">
          <label class="text-xs font-semibold text-[#5c655f]">Neuer Tarif
            <Select v-model="selectedPlanKey">
              <SelectTrigger class="mt-1 rounded-xl px-4 py-2.5 text-sm font-normal"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="plan in plans" :key="plan.key" :value="plan.key">{{ plan.displayName }} · {{ formatPrice(plan.monthlyPriceCents, plan.currency) }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <button type="submit" :disabled="saving || selectedPlanKey === summary.plan.key" class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
            Wechseln
          </button>
        </form>
        <p v-if="actionError" class="mt-3 text-sm text-amber-800">{{ actionError }}</p>
      </section>

      <section class="card overflow-x-auto p-6">
        <h2 class="mb-4 font-display text-base font-bold">Tarifvergleich</h2>
        <table class="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr class="text-[#7b827d]">
              <th class="pb-2 pr-4 font-semibold">Tarif</th>
              <th class="pb-2 pr-4 font-semibold">Preis</th>
              <th class="pb-2 pr-4 font-semibold">Speicher</th>
              <th v-for="origin in (['own_upload', 'ai_image', 'ai_video'] as const)" :key="origin" class="pb-2 pr-4 font-semibold">
                {{ MEDIA_ORIGIN_LABELS[origin] }}<span v-if="!MEDIA_ORIGIN_AVAILABLE[origin]" class="ml-1 font-normal text-[#9aa096]">(bald)</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in plans" :key="plan.key" class="border-t border-[#e9ebe4]" :class="{ 'font-semibold': plan.key === summary.plan.key }">
              <td class="py-2 pr-4">{{ plan.displayName }}</td>
              <td class="py-2 pr-4">{{ formatPrice(plan.monthlyPriceCents, plan.currency) }}</td>
              <td class="py-2 pr-4">{{ formatBytes(plan.storageBytes) }}</td>
              <td v-for="origin in (['own_upload', 'ai_image', 'ai_video'] as const)" :key="origin" class="py-2 pr-4">
                {{ plan.contentLimits.find((limit) => limit.mediaOrigin === origin)?.maxPerMonth ?? 'unbegrenzt' }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
