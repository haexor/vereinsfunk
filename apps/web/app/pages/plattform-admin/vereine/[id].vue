<script setup lang="ts">
import { ArrowLeft, Database, HardDrive, Server } from '@lucide/vue'
import {
  PlatformAdminOrganizationDetailSchema,
  type PlatformAdminOrganizationDetail,
} from '@vereinsfunk/contracts'

definePageMeta({ layout: 'admin' })

const config = useRuntimeConfig()
const route = useRoute()
const loading = ref(true)
const errorMessage = ref('')
const organization = ref<PlatformAdminOrganizationDetail | null>(null)

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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`
}

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

await load()
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
    </template>
  </div>
</template>
