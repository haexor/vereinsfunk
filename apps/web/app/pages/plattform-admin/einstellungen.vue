<script setup lang="ts">
definePageMeta({ layout: 'admin' })

const config = useRuntimeConfig()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')

const maxOrganizationsPerOwner = ref(3)

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const settings = await $fetch<{ key: string; value: unknown }[]>(`${config.public.apiBase}/v1/platform-settings`, { headers })
    const limitSetting = settings.find((setting) => setting.key === 'max_organizations_per_owner')
    if (typeof limitSetting?.value === 'number') maxOrganizationsPerOwner.value = limitSetting.value
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
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Plattform-Administration</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Einstellungen</h1>
      <p class="mt-2 text-sm text-[#727a75]">
        Globale Limits. Abo-Pläne und Speicherkontingente werden in einem eigenen Paket verwaltet.
      </p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <template v-else>
      <section class="card p-6">
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
      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
    </template>
  </div>
</template>
