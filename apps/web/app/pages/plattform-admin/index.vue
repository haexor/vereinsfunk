<script setup lang="ts">
import { AlertTriangle } from '@lucide/vue'
import {
  PlatformAdminOrganizationSummarySchema,
  UsageMetricsResponseSchema,
  type PlatformAdminOrganizationSummary,
  type UsageMetricsBucket,
} from '@vereinsfunk/contracts'

definePageMeta({ layout: 'admin' })

const config = useRuntimeConfig()
const loading = ref(true)
const errorMessage = ref('')
const organizations = ref<PlatformAdminOrganizationSummary[]>([])
const usage = ref<UsageMetricsBucket[]>([])

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const to = new Date()
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
    const [orgsResponse, metricsResponse] = await Promise.all([
      $fetch(`${config.public.apiBase}/v1/platform-admin/organizations`, { headers }),
      $fetch(`${config.public.apiBase}/v1/platform-admin/usage-metrics`, {
        headers,
        query: { from: from.toISOString(), to: to.toISOString() },
      }),
    ])
    organizations.value = PlatformAdminOrganizationSummarySchema.array().parse(orgsResponse)
    usage.value = UsageMetricsResponseSchema.parse(metricsResponse).buckets
  } catch {
    errorMessage.value = 'Daten konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Plattform-Administration</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Übersicht</h1>
      <p class="mt-2 text-sm text-[#727a75]">Angemeldete Vereine, Abos und Nutzung der Content-Erzeugung.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else>
      <section class="card mb-6 overflow-x-auto p-6">
        <h2 class="mb-4 font-display text-base font-bold">Vereine ({{ organizations.length }})</h2>
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="text-[#7b827d]">
              <th class="pb-2 pr-4 font-semibold">Verein</th>
              <th class="pb-2 pr-4 font-semibold">Mitglieder</th>
              <th class="pb-2 pr-4 font-semibold">Abteilungen</th>
              <th class="pb-2 font-semibold">Angelegt</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="org in organizations" :key="org.organizationId" class="border-t border-[#e9ebe4]">
              <td class="py-2 pr-4 font-medium">
                <NuxtLink :to="`/plattform-admin/vereine/${org.organizationId}`" class="focus-ring rounded text-forest underline-offset-2 hover:underline">
                  {{ org.name }}
                </NuxtLink>
              </td>
              <td class="py-2 pr-4">{{ org.memberCount }}</td>
              <td class="py-2 pr-4">{{ org.departmentCount }}</td>
              <td class="py-2">{{ new Date(org.createdAt).toLocaleDateString('de-DE') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!organizations.length" class="py-4 text-center text-xs text-[#9aa096]">Noch keine Vereine angelegt.</p>
      </section>

      <section class="card mb-6 overflow-x-auto p-6">
        <h2 class="mb-4 font-display text-base font-bold">Content-Erzeugung, letzte 30 Tage</h2>
        <table v-if="usage.length" class="w-full text-left text-xs">
          <thead>
            <tr class="text-[#7b827d]">
              <th class="pb-2 pr-4 font-semibold">Tag</th>
              <th class="pb-2 pr-4 font-semibold">Beiträge erstellt</th>
              <th class="pb-2 pr-4 font-semibold">LLM-generierte Versionen</th>
              <th class="pb-2 pr-4 font-semibold">Fehlgeschlagene Workflows</th>
              <th class="pb-2 font-semibold">Fehlgeschlagene Veröffentlichungen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="bucket in usage" :key="bucket.date" class="border-t border-[#e9ebe4]">
              <td class="py-2 pr-4">{{ bucket.date }}</td>
              <td class="py-2 pr-4">{{ bucket.postsCreated }}</td>
              <td class="py-2 pr-4">{{ bucket.llmGeneratedVersions }}</td>
              <td class="py-2 pr-4">{{ bucket.workflowRunsFailed }}</td>
              <td class="py-2">{{ bucket.publicationsFailed }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="py-4 text-center text-xs text-[#9aa096]">Im Zeitraum keine Aktivität.</p>
      </section>

      <section class="card p-6">
        <h2 class="mb-2 flex items-center gap-2 font-display text-base font-bold">
          <AlertTriangle :size="16" class="text-amber-700" /> Server-/Container-Auslastung
        </h2>
        <p class="text-xs text-[#7b827d]">
          Noch nicht verfügbar — es ist kein Monitoring-Stack angebunden. Diese Ansicht wird ergänzt, sobald eine Hosting-/Metrik-Lösung feststeht.
        </p>
      </section>
    </template>
  </div>
</template>
