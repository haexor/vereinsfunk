<script setup lang="ts">
import {
  CreateSubscriptionPlanRequestSchema,
  MediaOriginSchema,
  SubscriptionPlanSchema,
  UpdateSubscriptionPlanRequestSchema,
  type MediaOrigin,
  type SubscriptionPlan,
} from '@vereinsfunk/contracts'

// Plan 021: Tarif-Editor -- Tabellen-/Formular-Layout nach dem Vorbild von llm.vue (Liste,
// Anlegen-Formular, Inline-Aktionen), aber useApiClient() statt useAuthHeader()+$fetch (siehe
// Recherche-Fakten: llm.vue ist das veraltete Muster, neue Seiten migrieren).
definePageMeta({ layout: 'admin' })

const MEDIA_ORIGINS: readonly MediaOrigin[] = MediaOriginSchema.options
const MEDIA_ORIGIN_LABELS: Record<MediaOrigin, string> = { own_upload: 'Eigene Beiträge', ai_image: 'KI-Bilder', ai_video: 'KI-Videos' }

const api = useApiClient()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const plans = ref<SubscriptionPlan[]>([])
const expandedKey = ref<string | null>(null)

function emptyContentLimits(): Record<MediaOrigin, { maxPerMonth: string; maxDurationSeconds: string }> {
  return { own_upload: { maxPerMonth: '', maxDurationSeconds: '' }, ai_image: { maxPerMonth: '', maxDurationSeconds: '' }, ai_video: { maxPerMonth: '', maxDurationSeconds: '' } }
}

const newPlan = reactive({
  key: '', displayName: '', monthlyPriceCents: '', currency: 'EUR', storageBytes: '', maxTeams: '', maxDepartments: '', sortOrder: 0,
  contentLimits: emptyContentLimits(),
})
const contentLimitDrafts = reactive<Record<string, Record<MediaOrigin, { maxPerMonth: string; maxDurationSeconds: string }>>>({})

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    plans.value = await api.request('/v1/platform-admin/subscription-plans', {}, SubscriptionPlanSchema.array())
    for (const plan of plans.value) {
      const draft = emptyContentLimits()
      for (const limit of plan.contentLimits) draft[limit.mediaOrigin] = { maxPerMonth: limit.maxPerMonth?.toString() ?? '', maxDurationSeconds: limit.maxDurationSeconds?.toString() ?? '' }
      contentLimitDrafts[plan.key] = draft
    }
  } catch {
    errorMessage.value = 'Tarife konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

function toContentLimitsPayload(draft: Record<MediaOrigin, { maxPerMonth: string; maxDurationSeconds: string }>) {
  return MEDIA_ORIGINS.map((mediaOrigin) => ({
    mediaOrigin,
    maxPerMonth: draft[mediaOrigin].maxPerMonth.trim() ? Number(draft[mediaOrigin].maxPerMonth) : null,
    maxDurationSeconds: draft[mediaOrigin].maxDurationSeconds.trim() ? Number(draft[mediaOrigin].maxDurationSeconds) : null,
  }))
}

async function createPlan() {
  if (!newPlan.key.trim() || !newPlan.displayName.trim() || !newPlan.storageBytes.trim()) return
  saving.value = true
  errorMessage.value = ''
  try {
    const body = CreateSubscriptionPlanRequestSchema.parse({
      key: newPlan.key, displayName: newPlan.displayName,
      monthlyPriceCents: newPlan.monthlyPriceCents.trim() ? Number(newPlan.monthlyPriceCents) : null,
      currency: newPlan.currency, storageBytes: Number(newPlan.storageBytes),
      maxTeams: newPlan.maxTeams.trim() ? Number(newPlan.maxTeams) : null,
      maxDepartments: newPlan.maxDepartments.trim() ? Number(newPlan.maxDepartments) : null,
      sortOrder: newPlan.sortOrder,
      contentLimits: toContentLimitsPayload(newPlan.contentLimits),
    })
    await api.request('/v1/platform-admin/subscription-plans', { method: 'POST', body })
    newPlan.key = ''; newPlan.displayName = ''; newPlan.monthlyPriceCents = ''; newPlan.storageBytes = ''; newPlan.maxTeams = ''; newPlan.maxDepartments = ''
    newPlan.contentLimits = emptyContentLimits()
    await load()
  } catch {
    errorMessage.value = 'Tarif konnte nicht angelegt werden.'
  } finally {
    saving.value = false
  }
}

async function saveContentLimits(planKey: string) {
  saving.value = true
  errorMessage.value = ''
  try {
    const body = { contentLimits: toContentLimitsPayload(contentLimitDrafts[planKey]!) }
    await api.request(`/v1/platform-admin/subscription-plans/${planKey}/content-limits`, { method: 'PUT', body })
    await load()
  } catch {
    errorMessage.value = 'Kontingente konnten nicht gespeichert werden.'
  } finally {
    saving.value = false
  }
}

async function makeUnbookable(plan: SubscriptionPlan) {
  if (!confirm(`"${plan.displayName}" nicht mehr buchbar machen? Vereine mit diesem Tarif behalten ihn, er erscheint nur nicht mehr in der Auswahl.`)) return
  saving.value = true
  errorMessage.value = ''
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const body = UpdateSubscriptionPlanRequestSchema.parse({ availableUntil: yesterday })
    await api.request(`/v1/platform-admin/subscription-plans/${plan.key}`, { method: 'PATCH', body })
    await load()
  } catch {
    errorMessage.value = 'Tarif konnte nicht als nicht mehr buchbar markiert werden.'
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
      <div class="eyebrow mb-3">Plattform-Administration</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Tarife</h1>
      <p class="mt-2 text-sm text-[#727a75]">Preise, Grenzen und Beitragskontingente sind Daten -- Änderungen wirken sofort, ohne Deployment.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <template v-else>
      <section class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Tarif anlegen</h2>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="createPlan">
          <input v-model="newPlan.key" type="text" required placeholder="Schlüssel, z. B. premium_plus" pattern="^[a-z][a-z0-9_]*$" class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm" />
          <input v-model="newPlan.displayName" type="text" required placeholder="Anzeigename" class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm" />
          <label class="text-xs font-semibold text-[#5c655f]">Preis in Cent je Monat (leer = individuell)
            <input v-model="newPlan.monthlyPriceCents" type="number" min="0" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
          </label>
          <label class="text-xs font-semibold text-[#5c655f]">Speicher in Bytes
            <input v-model="newPlan.storageBytes" type="number" required min="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
          </label>
          <label class="text-xs font-semibold text-[#5c655f]">Mannschaften, max. (leer = unbegrenzt)
            <input v-model="newPlan.maxTeams" type="number" min="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
          </label>
          <label class="text-xs font-semibold text-[#5c655f]">Abteilungen, max. (leer = unbegrenzt)
            <input v-model="newPlan.maxDepartments" type="number" min="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
          </label>
          <label class="text-xs font-semibold text-[#5c655f]">Reihenfolge
            <input v-model.number="newPlan.sortOrder" type="number" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
          </label>

          <fieldset class="sm:col-span-2">
            <legend class="mb-2 text-xs font-semibold text-[#5c655f]">Beitragskontingente je Monat (leer = unbegrenzt)</legend>
            <div class="grid gap-3 sm:grid-cols-3">
              <div v-for="mediaOrigin in MEDIA_ORIGINS" :key="mediaOrigin">
                <label class="text-xs font-semibold text-[#5c655f]">{{ MEDIA_ORIGIN_LABELS[mediaOrigin] }}
                  <input v-model="newPlan.contentLimits[mediaOrigin].maxPerMonth" type="number" min="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
                </label>
                <label v-if="mediaOrigin === 'ai_video'" class="mt-2 block text-xs font-semibold text-[#5c655f]">Höchstlänge in Sekunden
                  <input v-model="newPlan.contentLimits[mediaOrigin].maxDurationSeconds" type="number" min="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
                </label>
              </div>
            </div>
          </fieldset>

          <button type="submit" :disabled="saving" class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60 sm:col-span-2">
            Anlegen
          </button>
        </form>
      </section>

      <section class="card overflow-x-auto p-6">
        <h2 class="mb-4 font-display text-base font-bold">Bestehende Tarife</h2>
        <table class="w-full min-w-[720px] text-left text-xs">
          <thead>
            <tr class="text-[#7b827d]">
              <th class="pb-2 pr-4 font-semibold">Tarif</th>
              <th class="pb-2 pr-4 font-semibold">Preis</th>
              <th class="pb-2 pr-4 font-semibold">Speicher</th>
              <th class="pb-2 pr-4 font-semibold">Mannschaften</th>
              <th class="pb-2 pr-4 font-semibold">Abteilungen</th>
              <th class="pb-2 pr-4 font-semibold">Buchbar bis</th>
              <th class="pb-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            <template v-for="plan in plans" :key="plan.key">
              <tr class="border-t border-[#e9ebe4]">
                <td class="py-2 pr-4 font-medium">{{ plan.displayName }} <span class="text-[#9aa096]">({{ plan.key }})</span></td>
                <td class="py-2 pr-4">{{ formatPrice(plan.monthlyPriceCents, plan.currency) }}</td>
                <td class="py-2 pr-4">{{ formatBytes(plan.storageBytes) }}</td>
                <td class="py-2 pr-4">{{ plan.maxTeams ?? 'unbegrenzt' }}</td>
                <td class="py-2 pr-4">{{ plan.maxDepartments ?? 'unbegrenzt' }}</td>
                <td class="py-2 pr-4">{{ plan.availableUntil ?? '—' }}</td>
                <td class="py-2 text-right">
                  <button type="button" class="focus-ring rounded-lg px-2 py-1 text-[11px] font-semibold text-forest" @click="expandedKey = expandedKey === plan.key ? null : plan.key">
                    Kontingente
                  </button>
                  <button type="button" class="focus-ring ml-2 rounded-lg px-2 py-1 text-[11px] font-semibold text-amber-800" @click="makeUnbookable(plan)">
                    Nicht mehr buchbar
                  </button>
                </td>
              </tr>
              <tr v-if="expandedKey === plan.key" class="border-t border-[#e9ebe4] bg-[#f6f7f2]">
                <td colspan="7" class="p-4">
                  <div class="grid gap-3 sm:grid-cols-3">
                    <div v-for="mediaOrigin in MEDIA_ORIGINS" :key="mediaOrigin">
                      <label class="text-xs font-semibold text-[#5c655f]">{{ MEDIA_ORIGIN_LABELS[mediaOrigin] }} je Monat
                        <input v-model="contentLimitDrafts[plan.key]![mediaOrigin].maxPerMonth" type="number" min="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
                      </label>
                      <label v-if="mediaOrigin === 'ai_video'" class="mt-2 block text-xs font-semibold text-[#5c655f]">Höchstlänge in Sekunden
                        <input v-model="contentLimitDrafts[plan.key]![mediaOrigin].maxDurationSeconds" type="number" min="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
                      </label>
                    </div>
                  </div>
                  <button type="button" :disabled="saving" class="focus-ring mt-3 rounded-xl border border-[#dfe0d9] px-5 py-2.5 text-xs font-bold disabled:opacity-60" @click="saveContentLimits(plan.key)">
                    Kontingente speichern
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-if="!plans.length" class="py-4 text-center text-xs text-[#9aa096]">Noch kein Tarif angelegt.</p>
      </section>
      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
    </template>
  </div>
</template>
