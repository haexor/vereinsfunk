<script setup lang="ts">
import { ProfileSchema, type Profile } from '@vereinsfunk/contracts'

const config = useRuntimeConfig()
const session = await useSession()

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')
const profile = ref<Profile | null>(null)
const displayNameDraft = ref('')
const saving = ref(false)
const saveSuccess = ref(false)

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/me/profile`, { headers })
    profile.value = ProfileSchema.parse(response)
    displayNameDraft.value = profile.value.displayName
  } catch {
    errorMessage.value = 'Das Profil konnte nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

async function save() {
  if (!displayNameDraft.value.trim()) return
  saving.value = true
  actionError.value = ''
  saveSuccess.value = false
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/me/profile`, { method: 'PATCH', headers, body: { displayName: displayNameDraft.value.trim() } })
    profile.value = ProfileSchema.parse(response)
    saveSuccess.value = true
  } catch {
    actionError.value = 'Der Anzeigename konnte nicht gespeichert werden.'
  } finally {
    saving.value = false
  }
}

const initials = computed(() => (profile.value?.displayName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase())

// Flache Liste aus Vereins-/Abteilungs-/Team-Rollen je Verein, damit das Template kein
// verschachteltes v-for braucht (siehe scopeName()-Muster in mitglieder.vue).
const membershipGroups = computed(() =>
  (session.value?.scopes ?? []).map((scopeEntry) => ({
    organizationId: scopeEntry.organizationId,
    organizationName: scopeEntry.organizationName,
    badges: [
      ...scopeEntry.organizationRoles.map((role) => ({ key: `org-${role}`, text: roleLabels[role] ?? role })),
      ...scopeEntry.departments.flatMap((department) => [
        ...department.roles.map((role) => ({ key: `dept-${department.id}-${role}`, text: `${roleLabels[role] ?? role} · ${department.name}` })),
        ...department.teams.flatMap((team) => team.roles.map((role) => ({ key: `team-${team.id}-${role}`, text: `${roleLabels[role] ?? role} · ${department.name} · ${team.name}` }))),
      ]),
    ],
  })),
)
</script>

<template>
  <div class="mx-auto max-w-[720px] px-5 py-8 sm:px-10">
    <header class="mb-8">
      <div class="eyebrow mb-3">Mein Konto</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Profil</h1>
      <p class="mt-2 text-sm text-[#727a75]">Selbstbedienung: Anzeigename und ein Blick auf deine Vereinsmitgliedschaften.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else>
      <section class="card mb-6 p-6">
        <div class="flex items-center gap-4">
          <span class="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#dce6d8] text-base font-bold">{{ initials }}</span>
          <p class="text-xs text-[#7b827d]">Ein Profilfoto lässt sich hier aktuell noch nicht hochladen.</p>
        </div>
        <form class="mt-5 grid gap-3" @submit.prevent="save">
          <label><span class="mb-1 block text-xs font-semibold">Anzeigename</span>
            <input v-model="displayNameDraft" required maxlength="120" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
          </label>
          <p v-if="actionError" class="text-xs text-amber-800">{{ actionError }}</p>
          <p v-if="saveSuccess" class="text-xs text-emerald-700">Gespeichert.</p>
          <div>
            <button type="submit" :disabled="saving" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
              {{ saving ? 'Wird gespeichert …' : 'Speichern' }}
            </button>
          </div>
        </form>
      </section>

      <section class="card p-6">
        <h2 class="mb-1 font-display text-base font-bold">Vereinsmitgliedschaften</h2>
        <p class="mb-4 text-xs text-[#7b827d]">Nur zur Ansicht: die Mitgliedschaft selbst entsteht über eine Einladung oder einen Admin, nicht hier.</p>
        <div v-if="membershipGroups.length" class="divide-y divide-[#e8e9e2]">
          <div v-for="group in membershipGroups" :key="group.organizationId" class="py-3">
            <div class="text-sm font-semibold">{{ group.organizationName }}</div>
            <div v-if="group.badges.length" class="mt-1.5 flex flex-wrap gap-1.5">
              <span v-for="badge in group.badges" :key="badge.key" class="inline-flex items-center rounded-full bg-[#eef1ea] px-2.5 py-1 text-[10px] font-semibold text-[#3d453f]">{{ badge.text }}</span>
            </div>
            <p v-else class="mt-1.5 text-[11px] text-[#9aa096]">Keine Rolle in diesem Verein.</p>
          </div>
        </div>
        <p v-else class="text-xs text-[#9aa096]">Keine Vereinsmitgliedschaft vorhanden.</p>
      </section>
    </template>
  </div>
</template>
