<script setup lang="ts">
import { ArrowLeft, Database, HardDrive, Server } from '@lucide/vue'
import {
  PlatformAdminOrganizationDetailSchema,
  PlatformAdminOrganizationSubscriptionSchema,
  SetContentLimitOverrideRequestSchema,
  SetOrganizationSubscriptionRequestSchema,
  SubscriptionPlanSchema,
  type MediaOrigin,
  type PlatformAdminOrganizationDetail,
  type PlatformAdminOrganizationSubscription,
  type SubscriptionPlan,
} from '@vereinsfunk/contracts'

definePageMeta({ layout: 'admin' })

const MEDIA_ORIGIN_LABELS: Record<MediaOrigin, string> = { own_upload: 'Eigene Beiträge', ai_image: 'KI-Bilder', ai_video: 'KI-Videos' }
const BYTES_PER_MB = 1024 * 1024

const config = useRuntimeConfig()
const route = useRoute()
const loading = ref(true)
const errorMessage = ref('')
const organization = ref<PlatformAdminOrganizationDetail | null>(null)

const subscription = ref<PlatformAdminOrganizationSubscription | null>(null)
const plans = ref<SubscriptionPlan[]>([])
const selectedPlanKey = ref('')
const savingSubscription = ref(false)
const subscriptionError = ref('')

const structureOverride = reactive({ maxTeams: '', maxDepartments: '', storageMegabytes: '', reason: '' })
const contentOverride = reactive<Record<MediaOrigin, { maxPerMonth: string; maxDurationSeconds: string; reason: string }>>({
  own_upload: { maxPerMonth: '', maxDurationSeconds: '', reason: '' },
  ai_image: { maxPerMonth: '', maxDurationSeconds: '', reason: '' },
  ai_video: { maxPerMonth: '', maxDurationSeconds: '', reason: '' },
})

async function loadSubscription() {
  try {
    const headers = await useAuthHeader()
    const [subscriptionResponse, plansResponse] = await Promise.all([
      $fetch(`${config.public.apiBase}/v1/platform-admin/organizations/${route.params.id}/subscription`, { headers }),
      $fetch(`${config.public.apiBase}/v1/platform-admin/subscription-plans`, { headers }),
    ])
    subscription.value = PlatformAdminOrganizationSubscriptionSchema.parse(subscriptionResponse)
    plans.value = SubscriptionPlanSchema.array().parse(plansResponse)
    selectedPlanKey.value = subscription.value.planKey
  } catch {
    // Kein eigener Fehlerzustand fuer diesen Unterabschnitt -- die restliche Seite (Kontakt,
    // Ressourcenverbrauch) bleibt nutzbar, auch wenn der Tarifabschnitt einmal nicht laedt.
    subscription.value = null
  }
}

async function changePlan() {
  if (!subscription.value || selectedPlanKey.value === subscription.value.planKey) return
  savingSubscription.value = true
  subscriptionError.value = ''
  try {
    const headers = await useAuthHeader()
    const body = SetOrganizationSubscriptionRequestSchema.parse({ planKey: selectedPlanKey.value })
    await $fetch(`${config.public.apiBase}/v1/platform-admin/organizations/${route.params.id}/subscription`, { method: 'PUT', headers, body })
    await loadSubscription()
  } catch {
    subscriptionError.value = 'Tarifwechsel fehlgeschlagen.'
  } finally {
    savingSubscription.value = false
  }
}

async function saveStructureOverride() {
  if (!structureOverride.reason.trim()) { subscriptionError.value = 'Eine Begründung ist für eine Übersteuerung Pflicht.'; return }
  savingSubscription.value = true
  subscriptionError.value = ''
  try {
    const headers = await useAuthHeader()
    const body = SetOrganizationSubscriptionRequestSchema.parse({
      planKey: selectedPlanKey.value,
      maxTeamsOverride: structureOverride.maxTeams.trim() ? Number(structureOverride.maxTeams) : null,
      maxDepartmentsOverride: structureOverride.maxDepartments.trim() ? Number(structureOverride.maxDepartments) : null,
      storageBytesOverride: structureOverride.storageMegabytes.trim() ? Number(structureOverride.storageMegabytes) * BYTES_PER_MB : null,
      overrideReason: structureOverride.reason,
    })
    await $fetch(`${config.public.apiBase}/v1/platform-admin/organizations/${route.params.id}/subscription`, { method: 'PUT', headers, body })
    structureOverride.maxTeams = ''; structureOverride.maxDepartments = ''; structureOverride.storageMegabytes = ''; structureOverride.reason = ''
    await loadSubscription()
  } catch {
    subscriptionError.value = 'Übersteuerung konnte nicht gespeichert werden.'
  } finally {
    savingSubscription.value = false
  }
}

async function saveContentOverride(mediaOrigin: MediaOrigin) {
  const form = contentOverride[mediaOrigin]
  if (!form.reason.trim()) { subscriptionError.value = 'Eine Begründung ist für eine Übersteuerung Pflicht.'; return }
  savingSubscription.value = true
  subscriptionError.value = ''
  try {
    const headers = await useAuthHeader()
    const body = SetContentLimitOverrideRequestSchema.parse({
      mediaOrigin,
      maxPerMonth: form.maxPerMonth.trim() ? Number(form.maxPerMonth) : null,
      maxDurationSeconds: form.maxDurationSeconds.trim() ? Number(form.maxDurationSeconds) : null,
      overrideReason: form.reason,
    })
    await $fetch(`${config.public.apiBase}/v1/platform-admin/organizations/${route.params.id}/content-limit-overrides`, { method: 'PUT', headers, body })
    form.maxPerMonth = ''; form.maxDurationSeconds = ''; form.reason = ''
    await loadSubscription()
  } catch {
    subscriptionError.value = 'Kontingent-Übersteuerung konnte nicht gespeichert werden.'
  } finally {
    savingSubscription.value = false
  }
}

const activityPeriods = computed(() => {
  if (!organization.value) return []
  return [
    { label: 'Heute', values: organization.value.activity.day },
    { label: 'Diese Woche', values: organization.value.activity.week },
    { label: 'Dieser Monat', values: organization.value.activity.month },
    { label: 'Dieses Jahr', values: organization.value.activity.year },
  ]
})

const address = computed(() => {
  const contact = organization.value?.contact
  if (!contact) return null
  const street = [contact.street, contact.houseNumber].filter(Boolean).join(' ')
  const city = [contact.postalCode, contact.city].filter(Boolean).join(' ')
  return [street, city, contact.countryCode].filter(Boolean).join(', ') || null
})

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch(`${config.public.apiBase}/v1/platform-admin/organizations/${route.params.id}`, { headers })
    organization.value = PlatformAdminOrganizationDetailSchema.parse(response)
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode
    errorMessage.value = status === 404 ? 'Dieser Verein wurde nicht gefunden.' : 'Die Vereinsdetails konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

await Promise.all([load(), loadSubscription()])
</script>

<template>
  <div>
    <NuxtLink to="/plattform-admin" class="focus-ring mb-6 inline-flex items-center gap-2 rounded-lg px-1 py-1 text-xs font-semibold text-[#5c6861] hover:text-forest">
      <ArrowLeft :size="15" /> Zur Übersicht
    </NuxtLink>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else-if="organization">
      <header class="mb-8">
        <div class="eyebrow mb-3">Vereinsaccount</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">{{ organization.name }}</h1>
        <p class="mt-2 text-sm text-[#727a75]">
          Angelegt am {{ new Date(organization.createdAt).toLocaleDateString('de-DE') }} · Zeitzone {{ organization.timezone }}
        </p>
      </header>

      <section class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="card p-5"><p class="text-xs text-[#727a75]">Mitglieder</p><p class="mt-1 font-display text-2xl font-bold">{{ organization.memberCount }}</p></div>
        <div class="card p-5"><p class="text-xs text-[#727a75]">Abteilungen</p><p class="mt-1 font-display text-2xl font-bold">{{ organization.departmentCount }}</p></div>
        <div class="card p-5"><p class="text-xs text-[#727a75]">Beiträge, dieses Jahr</p><p class="mt-1 font-display text-2xl font-bold">{{ organization.activity.year.posts }}</p></div>
        <div class="card p-5"><p class="text-xs text-[#727a75]">Medienspeicher</p><p class="mt-1 font-display text-2xl font-bold">{{ formatBytes(organization.storage.totalMediaBytes) }}</p></div>
      </section>

      <section class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Ansprechpartner & Kontakt</h2>
        <dl class="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <div><dt class="text-xs text-[#727a75]">Verantwortliche Person</dt><dd class="mt-1 font-medium">{{ organization.contact.responsiblePersonName ?? 'Nicht hinterlegt' }}</dd></div>
          <div><dt class="text-xs text-[#727a75]">Vereinsname / Rechtsträger</dt><dd class="mt-1 font-medium">{{ organization.contact.legalName ?? organization.name }}</dd></div>
          <div><dt class="text-xs text-[#727a75]">E-Mail (Vereinskontakt)</dt><dd class="mt-1 font-medium">{{ organization.contact.email ?? 'Nicht hinterlegt' }}</dd></div>
          <div><dt class="text-xs text-[#727a75]">E-Mail (Inhaberkonto)</dt><dd class="mt-1 font-medium">{{ organization.contact.ownerAccountEmail ?? 'Nicht verfügbar' }}</dd></div>
          <div><dt class="text-xs text-[#727a75]">Telefon</dt><dd class="mt-1 font-medium">{{ organization.contact.phone ?? 'Nicht hinterlegt' }}</dd></div>
          <div><dt class="text-xs text-[#727a75]">Adresse</dt><dd class="mt-1 font-medium">{{ address ?? 'Nicht hinterlegt' }}</dd></div>
          <div><dt class="text-xs text-[#727a75]">Webseite</dt><dd class="mt-1 font-medium">{{ organization.contact.websiteUrl ?? 'Nicht hinterlegt' }}</dd></div>
        </dl>
      </section>

      <section class="card mb-6 overflow-x-auto p-6">
        <h2 class="mb-1 font-display text-base font-bold">Erstellte Inhalte</h2>
        <p class="mb-4 text-xs text-[#727a75]">Kalenderzeiträume in der Vereinszeitzone. Videos sind hochgeladene Video-Assets.</p>
        <table class="w-full min-w-[520px] text-left text-xs">
          <thead><tr class="text-[#7b827d]"><th class="pb-2 pr-4 font-semibold">Zeitraum</th><th class="pb-2 pr-4 font-semibold">Beiträge</th><th class="pb-2 pr-4 font-semibold">Reels</th><th class="pb-2 font-semibold">Video-Assets</th></tr></thead>
          <tbody>
            <tr v-for="period in activityPeriods" :key="period.label" class="border-t border-[#e9ebe4]">
              <td class="py-2 pr-4 font-medium">{{ period.label }}</td><td class="py-2 pr-4">{{ period.values.posts }}</td><td class="py-2 pr-4">{{ period.values.reels }}</td><td class="py-2">{{ period.values.videoAssets }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card p-6">
        <h2 class="mb-1 flex items-center gap-2 font-display text-base font-bold"><HardDrive :size="16" /> Ressourcenverbrauch</h2>
        <p class="mb-4 text-xs text-[#727a75]">Mandantengenau verfügbar ist aktuell der belegte Medienspeicher. Datenbank-, CPU- und Containerwerte benötigen einen angebundenen Monitoring-Stack und werden daher nicht geschätzt.</p>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-xl bg-[#f6f7f2] p-4"><p class="flex items-center gap-2 text-xs text-[#727a75]"><HardDrive :size="14" /> Rohmedien</p><p class="mt-1 font-display text-lg font-bold">{{ formatBytes(organization.storage.rawMediaBytes) }}</p></div>
          <div class="rounded-xl bg-[#f6f7f2] p-4"><p class="flex items-center gap-2 text-xs text-[#727a75]"><HardDrive :size="14" /> Gerenderte Medien</p><p class="mt-1 font-display text-lg font-bold">{{ formatBytes(organization.storage.renderedMediaBytes) }}</p></div>
          <div class="rounded-xl bg-[#f6f7f2] p-4"><p class="flex items-center gap-2 text-xs text-[#727a75]"><Database :size="14" /> Datenbank-Speicher</p><p class="mt-1 font-display text-lg font-bold">Nicht verfügbar</p></div>
          <div class="rounded-xl bg-[#f6f7f2] p-4"><p class="flex items-center gap-2 text-xs text-[#727a75]"><Server :size="14" /> CPU / Container</p><p class="mt-1 font-display text-lg font-bold">Nicht verfügbar</p></div>
        </div>
      </section>

      <section v-if="subscription" class="card mt-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Tarif</h2>
        <p class="mb-4 text-sm">
          Aktueller Tarif: <span class="font-semibold">{{ subscription.planDisplayName }}</span>
          <span v-if="subscription.status !== 'active'" class="ml-2 text-xs text-amber-800">({{ subscription.status }})</span>
        </p>

        <form class="mb-6 flex flex-wrap items-end gap-3" @submit.prevent="changePlan">
          <label class="text-xs font-semibold text-[#5c655f]">Tarif wechseln
            <select v-model="selectedPlanKey" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal">
              <option v-for="plan in plans" :key="plan.key" :value="plan.key">{{ plan.displayName }}</option>
            </select>
          </label>
          <button type="submit" :disabled="savingSubscription || selectedPlanKey === subscription.planKey" class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60">
            Wechseln
          </button>
        </form>

        <div class="mb-6 rounded-xl bg-[#f6f7f2] p-4">
          <h3 class="mb-3 text-xs font-bold uppercase tracking-wide text-[#5c655f]">Speicher- und Struktur-Übersteuerung</h3>
          <p v-if="subscription.storageBytesOverride || subscription.maxTeamsOverride || subscription.maxDepartmentsOverride" class="mb-3 text-xs text-[#727a75]">
            Aktuell übersteuert: Speicher {{ subscription.storageBytesOverride ? formatBytes(subscription.storageBytesOverride) : 'Tarifwert' }},
            Mannschaften {{ subscription.maxTeamsOverride ?? 'Tarifwert' }}, Abteilungen {{ subscription.maxDepartmentsOverride ?? 'Tarifwert' }}.
          </p>
          <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="saveStructureOverride">
            <label class="text-xs font-semibold text-[#5c655f]">Speicher in MB (leer = Tarifwert)
              <input v-model="structureOverride.storageMegabytes" type="number" min="1" step="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
            </label>
            <label class="text-xs font-semibold text-[#5c655f]">Mannschaften (leer = Tarifwert)
              <input v-model="structureOverride.maxTeams" type="number" min="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
            </label>
            <label class="text-xs font-semibold text-[#5c655f]">Abteilungen (leer = Tarifwert)
              <input v-model="structureOverride.maxDepartments" type="number" min="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
            </label>
            <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Begründung (Pflicht)
              <input v-model="structureOverride.reason" type="text" maxlength="500" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
            </label>
            <button type="submit" :disabled="savingSubscription" class="focus-ring rounded-xl border border-[#dfe0d9] px-5 py-2.5 text-xs font-bold disabled:opacity-60 sm:col-span-2">
              Übersteuerung speichern
            </button>
          </form>
        </div>

        <div class="rounded-xl bg-[#f6f7f2] p-4">
          <h3 class="mb-3 text-xs font-bold uppercase tracking-wide text-[#5c655f]">Beitragskontingent-Übersteuerung</h3>
          <div v-for="mediaOrigin in (['own_upload', 'ai_image', 'ai_video'] as const)" :key="mediaOrigin" class="mb-4 border-t border-[#e9ebe4] pt-3 first:mt-0 first:border-t-0 first:pt-0">
            <p class="mb-2 text-xs font-semibold">{{ MEDIA_ORIGIN_LABELS[mediaOrigin] }}</p>
            <p v-if="subscription.contentLimitOverrides.some((o) => o.mediaOrigin === mediaOrigin)" class="mb-2 text-xs text-[#727a75]">
              Übersteuert: {{ subscription.contentLimitOverrides.find((o) => o.mediaOrigin === mediaOrigin)?.maxPerMonth ?? 'unbegrenzt' }} / Monat
            </p>
            <form class="grid gap-3 sm:grid-cols-4" @submit.prevent="saveContentOverride(mediaOrigin)">
              <label class="text-xs font-semibold text-[#5c655f]">Je Monat (leer = Tarifwert)
                <input v-model="contentOverride[mediaOrigin].maxPerMonth" type="number" min="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
              </label>
              <label v-if="mediaOrigin === 'ai_video'" class="text-xs font-semibold text-[#5c655f]">Höchstlänge in Sekunden
                <input v-model="contentOverride[mediaOrigin].maxDurationSeconds" type="number" min="1" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
              </label>
              <label class="text-xs font-semibold text-[#5c655f] sm:col-span-2">Begründung (Pflicht)
                <input v-model="contentOverride[mediaOrigin].reason" type="text" maxlength="500" class="focus-ring mt-1 w-full rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal" />
              </label>
              <button type="submit" :disabled="savingSubscription" class="focus-ring rounded-xl border border-[#dfe0d9] px-5 py-2.5 text-xs font-bold disabled:opacity-60 sm:col-span-4">
                Übersteuerung speichern
              </button>
            </form>
          </div>
        </div>

        <p v-if="subscriptionError" class="mt-4 text-sm text-amber-800">{{ subscriptionError }}</p>
      </section>
    </template>
  </div>
</template>
