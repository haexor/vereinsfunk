<script setup lang="ts">
definePageMeta({ layout: 'admin' })

interface SubscriptionPlan {
  id: string
  name: string
  priceCents: number
  currency: string
  isActive: boolean
}

const config = useRuntimeConfig()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')

const maxOrganizationsPerOwner = ref(3)
const plans = ref<SubscriptionPlan[]>([])
const newPlan = reactive({ name: '', priceCents: 0 })

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const [settings, planList] = await Promise.all([
      $fetch<{ key: string; value: unknown }[]>(`${config.public.apiBase}/v1/platform-settings`, { headers }),
      $fetch<SubscriptionPlan[]>(`${config.public.apiBase}/v1/subscription-plans`, { headers }),
    ])
    const limitSetting = settings.find((setting) => setting.key === 'max_organizations_per_owner')
    if (typeof limitSetting?.value === 'number') maxOrganizationsPerOwner.value = limitSetting.value
    plans.value = planList
  } catch {
    errorMessage.value = 'Einstellungen konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

async function saveLimit() {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/platform-settings/max_organizations_per_owner`, {
      method: 'PUT',
      headers,
      body: { value: maxOrganizationsPerOwner.value },
    })
  } catch {
    errorMessage.value = 'Limit konnte nicht gespeichert werden.'
  } finally {
    saving.value = false
  }
}

async function createPlan() {
  if (!newPlan.name.trim()) return
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/subscription-plans`, {
      method: 'POST',
      headers,
      body: { name: newPlan.name, priceCents: newPlan.priceCents },
    })
    newPlan.name = ''
    newPlan.priceCents = 0
    await load()
  } catch {
    errorMessage.value = 'Tarif konnte nicht angelegt werden.'
  } finally {
    saving.value = false
  }
}

async function updatePlanPrice(plan: SubscriptionPlan) {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/subscription-plans/${plan.id}`, {
      method: 'PATCH',
      headers,
      body: { priceCents: plan.priceCents },
    })
  } catch {
    errorMessage.value = 'Preis konnte nicht gespeichert werden.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Plattform-Administration</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Einstellungen</h1>
      <p class="mt-2 text-sm text-[#727a75]">Globale Limits und Abo-Pläne. Keine echte Zahlungsabwicklung.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <template v-else>
      <section class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Vereine pro Eigentümer-Konto</h2>
        <div class="flex items-center gap-3">
          <input
            v-model.number="maxOrganizationsPerOwner"
            type="number"
            min="1"
            max="1000"
            class="focus-ring w-24 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm"
          />
          <button class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60" :disabled="saving" @click="saveLimit">
            Speichern
          </button>
        </div>
      </section>

      <section class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Neuer Abo-Plan</h2>
        <form class="flex flex-wrap gap-3" @submit.prevent="createPlan">
          <input v-model="newPlan.name" type="text" required placeholder="Name" class="focus-ring flex-1 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm" />
          <input
            v-model.number="newPlan.priceCents"
            type="number"
            min="0"
            placeholder="Preis (Cent)"
            class="focus-ring w-40 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm"
          />
          <button type="submit" class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60" :disabled="saving">
            Anlegen
          </button>
        </form>
      </section>

      <section class="card overflow-x-auto p-6">
        <h2 class="mb-4 font-display text-base font-bold">Abo-Pläne</h2>
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="text-[#7b827d]">
              <th class="pb-2 pr-4 font-semibold">Name</th>
              <th class="pb-2 pr-4 font-semibold">Preis (Cent)</th>
              <th class="pb-2 pr-4 font-semibold">Währung</th>
              <th class="pb-2 font-semibold">Aktiv</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in plans" :key="plan.id" class="border-t border-[#e9ebe4]">
              <td class="py-2 pr-4 font-medium">{{ plan.name }}</td>
              <td class="py-2 pr-4">
                <input
                  v-model.number="plan.priceCents"
                  type="number"
                  min="0"
                  class="focus-ring w-28 rounded-lg border border-[#dfe0d9] px-2 py-1"
                  @change="updatePlanPrice(plan)"
                />
              </td>
              <td class="py-2 pr-4">{{ plan.currency }}</td>
              <td class="py-2">{{ plan.isActive ? 'Ja' : 'Nein' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
    </template>
  </div>
</template>
