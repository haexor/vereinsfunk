<script setup lang="ts">
import { Archive, ArchiveRestore, Plus, Trash2 } from '@lucide/vue'

interface TeamRow { id: string; name: string; department_id: string; archived_at: string | null }
interface DepartmentRow { id: string; name: string; slug: string; archived_at: string | null }

const config = useRuntimeConfig()
const scope = await useScope()
const organizationId = computed(() => scope.value?.organizationId ?? null)

const loading = ref(true)
const errorMessage = ref('')
const departments = ref<DepartmentRow[]>([])
const teams = ref<TeamRow[]>([])

const teamsByDepartment = computed(() => {
  const map = new Map<string, TeamRow[]>()
  for (const team of teams.value) {
    const list = map.get(team.department_id) ?? []
    list.push(team)
    map.set(team.department_id, list)
  }
  return map
})

async function load() {
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  const supabase = useSupabaseClient()
  const [departmentsResult, teamsResult] = await Promise.all([
    supabase.from('departments').select('id, name, slug, archived_at').eq('organization_id', organizationId.value).order('name'),
    supabase.from('teams').select('id, name, department_id, archived_at').eq('organization_id', organizationId.value).order('name'),
  ])
  if (departmentsResult.error || teamsResult.error) {
    errorMessage.value = 'Die Vereinsstruktur konnte nicht geladen werden.'
    loading.value = false
    return
  }
  departments.value = departmentsResult.data
  teams.value = teamsResult.data
  loading.value = false
}
await load()

const newDepartmentName = ref('')
const creatingDepartment = ref(false)
const newTeamNameByDepartment = reactive<Record<string, string>>({})
const creatingTeamFor = ref<string | null>(null)
const renameDraft = reactive<Record<string, string>>({})
const actionError = ref('')

async function createDepartment() {
  if (!organizationId.value || !newDepartmentName.value.trim()) return
  creatingDepartment.value = true
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/organizations/${organizationId.value}/departments`, {
      method: 'POST',
      headers,
      body: { name: newDepartmentName.value.trim() },
    })
    newDepartmentName.value = ''
    await load()
  } catch {
    actionError.value = 'Die Abteilung konnte nicht angelegt werden.'
  } finally {
    creatingDepartment.value = false
  }
}

async function createTeam(departmentId: string) {
  const name = newTeamNameByDepartment[departmentId]?.trim()
  if (!name) return
  creatingTeamFor.value = departmentId
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/departments/${departmentId}/teams`, { method: 'POST', headers, body: { name } })
    newTeamNameByDepartment[departmentId] = ''
    await load()
  } catch {
    actionError.value = 'Das Team konnte nicht angelegt werden.'
  } finally {
    creatingTeamFor.value = null
  }
}

async function renameDepartment(department: DepartmentRow) {
  const name = renameDraft[department.id]?.trim()
  if (!name || name === department.name) return
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/departments/${department.id}`, { method: 'PATCH', headers, body: { name } })
    await load()
  } catch {
    actionError.value = 'Die Abteilung konnte nicht umbenannt werden.'
  }
}

async function toggleDepartmentArchived(department: DepartmentRow) {
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/departments/${department.id}`, { method: 'PATCH', headers, body: { archived: !department.archived_at } })
    await load()
  } catch {
    actionError.value = 'Der Archivstatus konnte nicht geändert werden.'
  }
}

async function deleteDepartment(department: DepartmentRow) {
  if (!confirm(`"${department.name}" wirklich löschen? Das geht nur, wenn die Abteilung leer ist.`)) return
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/departments/${department.id}`, { method: 'DELETE', headers })
    await load()
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    actionError.value = code === 'department_delete_blocked'
      ? 'Diese Abteilung enthält bereits Beiträge oder ist die letzte im Verein und kann nicht gelöscht werden. Bitte archivieren.'
      : 'Die Abteilung konnte nicht gelöscht werden.'
  }
}

async function renameTeam(team: TeamRow) {
  const name = renameDraft[team.id]?.trim()
  if (!name || name === team.name) return
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/teams/${team.id}`, { method: 'PATCH', headers, body: { name } })
    await load()
  } catch {
    actionError.value = 'Das Team konnte nicht umbenannt werden.'
  }
}

async function toggleTeamArchived(team: TeamRow) {
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/teams/${team.id}`, { method: 'PATCH', headers, body: { archived: !team.archived_at } })
    await load()
  } catch {
    actionError.value = 'Der Archivstatus konnte nicht geändert werden.'
  }
}

async function deleteTeam(team: TeamRow) {
  if (!confirm(`"${team.name}" wirklich löschen? Das geht nur, wenn das Team leer ist.`)) return
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/teams/${team.id}`, { method: 'DELETE', headers })
    await load()
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    actionError.value = code === 'team_delete_blocked'
      ? 'Dieses Team enthält bereits Beiträge und kann nicht gelöscht werden. Bitte archivieren.'
      : 'Das Team konnte nicht gelöscht werden.'
  }
}

const canManageOrganization = computed(() => useCan('department.manage', { organizationId: organizationId.value ?? '' }))
</script>

<template>
  <div class="mx-auto max-w-[980px] px-5 py-8 sm:px-10">
    <header class="mb-8">
      <div class="eyebrow mb-3">Vereinsstruktur</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Struktur</h1>
      <p class="mt-2 text-sm text-[#727a75]">Abteilungen und Teams anlegen, umbenennen und archivieren.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else>
      <p v-if="actionError" class="mb-4 text-sm text-amber-800">{{ actionError }}</p>

      <section v-if="canManageOrganization" class="card mb-6 p-6">
        <h2 class="mb-3 font-display text-base font-bold">Neue Abteilung</h2>
        <form class="flex gap-2" @submit.prevent="createDepartment">
          <input v-model="newDepartmentName" placeholder="z. B. Handball" required class="focus-ring flex-1 rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
          <button type="submit" :disabled="creatingDepartment" class="focus-ring flex items-center gap-1.5 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
            <Plus :size="14" /> Anlegen
          </button>
        </form>
      </section>

      <section v-for="department in departments" :key="department.id" class="card mb-4 p-6" :class="{ 'opacity-60': department.archived_at }">
        <div class="mb-3 flex items-center justify-between gap-3">
          <input
            v-model="renameDraft[department.id]"
            :placeholder="department.name"
            class="focus-ring w-full max-w-[280px] rounded-lg border border-transparent bg-transparent px-1 font-display text-lg font-bold hover:border-[#dfe0d9] focus:border-[#dfe0d9]"
            @keyup.enter="renameDepartment(department)"
            @blur="renameDepartment(department)"
          />
          <div class="flex shrink-0 gap-2">
            <span v-if="department.archived_at" class="self-center text-[10px] font-semibold text-[#9aa096]">Archiviert</span>
            <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2" :title="department.archived_at ? 'Wiederherstellen' : 'Archivieren'" @click="toggleDepartmentArchived(department)">
              <ArchiveRestore v-if="department.archived_at" :size="14" />
              <Archive v-else :size="14" />
            </button>
            <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-amber-800" title="Löschen" @click="deleteDepartment(department)">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <div class="ml-4 space-y-2 border-l border-[#e8e9e2] pl-4">
          <div v-for="team in teamsByDepartment.get(department.id) ?? []" :key="team.id" class="flex items-center justify-between gap-3" :class="{ 'opacity-60': team.archived_at }">
            <input
              v-model="renameDraft[team.id]"
              :placeholder="team.name"
              class="focus-ring w-full max-w-[240px] rounded-lg border border-transparent bg-transparent px-1 text-sm hover:border-[#dfe0d9] focus:border-[#dfe0d9]"
              @keyup.enter="renameTeam(team)"
              @blur="renameTeam(team)"
            />
            <div class="flex shrink-0 gap-2">
              <span v-if="team.archived_at" class="self-center text-[10px] font-semibold text-[#9aa096]">Archiviert</span>
              <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-1.5" :title="team.archived_at ? 'Wiederherstellen' : 'Archivieren'" @click="toggleTeamArchived(team)">
                <ArchiveRestore v-if="team.archived_at" :size="12" />
                <Archive v-else :size="12" />
              </button>
              <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-1.5 text-amber-800" title="Löschen" @click="deleteTeam(team)">
                <Trash2 :size="12" />
              </button>
            </div>
          </div>
          <form v-if="!department.archived_at" class="flex gap-2 pt-1" @submit.prevent="createTeam(department.id)">
            <input v-model="newTeamNameByDepartment[department.id]" placeholder="Neues Team" class="focus-ring flex-1 rounded-lg border border-[#dfe0d9] p-2 text-xs" />
            <button type="submit" :disabled="creatingTeamFor === department.id" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[10px] font-semibold disabled:opacity-60">
              + Team
            </button>
          </form>
        </div>
      </section>

      <p v-if="!departments.length" class="p-8 text-center text-xs text-[#9aa096]">Noch keine Abteilungen angelegt.</p>
    </template>
  </div>
</template>
