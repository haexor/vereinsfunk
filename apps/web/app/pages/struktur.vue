<script setup lang="ts">
import { Archive, ArchiveRestore, Plus, Trash2 } from '@lucide/vue'
import { z } from 'zod'
import { PolicySettingSchema, StorageUsageResponseSchema, type PolicyFlag, type PolicySetting, type ScopeLevel, type StorageUsageResponse } from '@vereinsfunk/contracts'

const DepartmentRowSchema = z.object({ id: z.string(), name: z.string(), slug: z.string(), archived_at: z.string().nullable() })
const TeamRowSchema = z.object({ id: z.string(), name: z.string(), department_id: z.string(), archived_at: z.string().nullable() })
type DepartmentRow = z.infer<typeof DepartmentRowSchema>
type TeamRow = z.infer<typeof TeamRowSchema>

const config = useRuntimeConfig()
const scope = await useScope()
const organizationId = computed(() => scope.value?.organizationId ?? null)

const loading = ref(true)
const errorMessage = ref('')
const departments = ref<DepartmentRow[]>([])
const teams = ref<TeamRow[]>([])
const policySettings = ref<PolicySetting[]>([])
const policyUpdating = ref<string | null>(null)
const storageUsageByDepartment = reactive<Record<string, StorageUsageResponse>>({})
const storageUsageByTeam = reactive<Record<string, StorageUsageResponse>>({})

const teamsByDepartment = computed(() => {
  const map = new Map<string, TeamRow[]>()
  for (const team of teams.value) {
    const list = map.get(team.department_id) ?? []
    list.push(team)
    map.set(team.department_id, list)
  }
  return map
})

const renameDraft = reactive<Record<string, string>>({})

async function load() {
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  const supabase = useSupabaseClient()
  let departmentsResult, teamsResult, policySettingsResponse
  try {
    // Ohne eigenes try/catch verwirft ein fehlschlagender Policy-Settings-Request den gesamten
    // Promise.all -- load() wuerde den Fehler weiterwerfen, loading bliebe aktiv, und await load()
    // koennte das Seiten-Setup abbrechen (beim Review gefunden).
    ;[departmentsResult, teamsResult, policySettingsResponse] = await Promise.all([
      supabase.from('departments').select('id, name, slug, archived_at').eq('organization_id', organizationId.value).order('name'),
      supabase.from('teams').select('id, name, department_id, archived_at').eq('organization_id', organizationId.value).order('name'),
      // Die Berechtigung (canEdit) und der geerbte/effektive Wert kommen fertig aus der API, damit
      // die Oberflaeche resolve_policy_flag()/die Manage-Permission nicht selbst nachbildet (Plan
      // 023, "eine Quelle, nicht aus zwei").
      useAuthHeader().then((headers) => $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/policy-settings`, { headers })),
    ])
  } catch {
    errorMessage.value = 'Die Vereinsstruktur konnte nicht geladen werden.'
    loading.value = false
    return
  }
  if (departmentsResult.error || teamsResult.error) {
    errorMessage.value = 'Die Vereinsstruktur konnte nicht geladen werden.'
    loading.value = false
    return
  }
  const parsedDepartments = DepartmentRowSchema.array().safeParse(departmentsResult.data)
  const parsedTeams = TeamRowSchema.array().safeParse(teamsResult.data)
  const parsedPolicySettings = PolicySettingSchema.array().safeParse(policySettingsResponse)
  if (!parsedDepartments.success || !parsedTeams.success || !parsedPolicySettings.success) {
    errorMessage.value = 'Die Vereinsstruktur konnte nicht geladen werden.'
    loading.value = false
    return
  }
  departments.value = parsedDepartments.data
  teams.value = parsedTeams.data
  policySettings.value = parsedPolicySettings.data
  for (const department of departments.value) renameDraft[department.id] ??= department.name
  for (const team of teams.value) renameDraft[team.id] ??= team.name
  loading.value = false
}

// Eigener, nicht blockierender Ladevorgang: der Speicherbalken je Abteilung/Team ist eine
// Zusatzanzeige (Plan 021), kein Grund, die Kernseite (Umbenennen/Archivieren/Löschen) bei einem
// Fehlschlag unbenutzbar zu machen. departmentId wird bei Teams mitgeschickt, weil
// storage_usage_bytes() sie fuer den brand_assets-Teil der Aufschluesselung braucht.
async function loadStorageUsage() {
  if (!organizationId.value) return
  const headers = await useAuthHeader()
  await Promise.all([
    ...departments.value.map(async (department) => {
      try {
        const response = await $fetch(`${config.public.apiBase}/v1/storage/usage`, { headers, query: { organizationId: organizationId.value, departmentId: department.id } })
        storageUsageByDepartment[department.id] = StorageUsageResponseSchema.parse(response)
      } catch { /* Speicherbalken bleibt fuer diese Abteilung leer, der Rest der Seite bleibt nutzbar. */ }
    }),
    ...teams.value.map(async (team) => {
      try {
        const response = await $fetch(`${config.public.apiBase}/v1/storage/usage`, { headers, query: { organizationId: organizationId.value, departmentId: team.department_id, teamId: team.id } })
        storageUsageByTeam[team.id] = StorageUsageResponseSchema.parse(response)
      } catch { /* Speicherbalken bleibt fuer dieses Team leer, der Rest der Seite bleibt nutzbar. */ }
    }),
  ])
}

await load()
void loadStorageUsage()

const newDepartmentName = ref('')
const creatingDepartment = ref(false)
const newTeamNameByDepartment = reactive<Record<string, string>>({})
const creatingTeamFor = ref<string | null>(null)
const actionError = ref('')

// Ein Wechsel des aktiven Vereins in der Sidebar aktualisierte diese Seite nicht -- load() lief
// nur einmal beim Setup. Dieselbe Luecke wie auf /mitglieder, dort bereits behoben.
watch(organizationId, () => {
  newDepartmentName.value = ''
  actionError.value = ''
  void load().then(() => loadStorageUsage())
})

// Abteilungen und Teams stecken auch in useSession() (authz.membership_scopes speist den
// Abteilungswaehler der Sidebar und die Ebenen-/Rollenauswahl auf /mitglieder). Ohne
// refreshSession() taucht eine hier neu angelegte Abteilung bzw. ein neues Team dort erst nach
// einem vollen Seiten-Reload auf -- eine Einladung in ein frisch angelegtes Team war deshalb
// nicht moeglich.
async function reload() {
  await refreshSession()
  await load()
  await loadStorageUsage()
}

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
    await reload()
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
    await reload()
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
    await reload()
  } catch {
    actionError.value = 'Die Abteilung konnte nicht umbenannt werden.'
  }
}

async function toggleDepartmentArchived(department: DepartmentRow) {
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/departments/${department.id}`, { method: 'PATCH', headers, body: { archived: !department.archived_at } })
    await reload()
  } catch {
    actionError.value = 'Der Archivstatus konnte nicht geändert werden.'
  }
}

async function deleteDepartment(department: DepartmentRow) {
  if (!confirm(`"${department.name}" wirklich löschen? Das geht nur, wenn die Abteilung leer ist.`)) return
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/departments/${department.id}`, { method: 'DELETE', headers })
    await reload()
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    actionError.value = code === 'last_department_cannot_be_deleted'
      ? 'Dies ist die letzte Abteilung im Verein und kann nicht gelöscht werden.'
      : code === 'department_delete_blocked'
        ? 'Diese Abteilung enthält bereits Beiträge und kann nicht gelöscht werden. Bitte archivieren.'
        : 'Die Abteilung konnte nicht gelöscht werden.'
  }
}

async function renameTeam(team: TeamRow) {
  const name = renameDraft[team.id]?.trim()
  if (!name || name === team.name) return
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/teams/${team.id}`, { method: 'PATCH', headers, body: { name } })
    await reload()
  } catch {
    actionError.value = 'Das Team konnte nicht umbenannt werden.'
  }
}

async function toggleTeamArchived(team: TeamRow) {
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/teams/${team.id}`, { method: 'PATCH', headers, body: { archived: !team.archived_at } })
    await reload()
  } catch {
    actionError.value = 'Der Archivstatus konnte nicht geändert werden.'
  }
}

async function deleteTeam(team: TeamRow) {
  if (!confirm(`"${team.name}" wirklich löschen? Das geht nur, wenn das Team leer ist.`)) return
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/teams/${team.id}`, { method: 'DELETE', headers })
    await reload()
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    actionError.value = code === 'team_delete_blocked'
      ? 'Dieses Team enthält bereits Beiträge und kann nicht gelöscht werden. Bitte archivieren.'
      : 'Das Team konnte nicht gelöscht werden.'
  }
}

// Neue Abteilungen duerfen ausschliesslich Vereinsadmins und nur im Vereinsbereich anlegen.
// In einem aktiven Abteilungsbereich darf auch ein Vereinsadmin keine neue Abteilung
// versehentlich aus dem falschen Kontext heraus anlegen.
const isOrganizationScope = computed(() => !scope.value?.departmentId)
const canManageOrganization = computed(() => (
  isOrganizationScope.value && useCan('organization.manage', { organizationId: organizationId.value ?? '' })
))
// Die Umbenennen-/Archivieren-/Loeschen-Steuerelemente waren fuer alle Mitglieder sichtbar,
// auch fuer einen viewer -- ein Klick erzeugte einen API-Aufruf, den der Server korrekt ablehnt,
// aber die Oberflaeche wirkte dadurch irrefuehrend (beim Review dieses Pakets gefunden). Die
// Durchsetzung selbst lag bereits korrekt in API und RLS.
function canManageDepartment(departmentId: string) {
  return useCan('department.manage', { organizationId: organizationId.value ?? '', departmentId })
}
function canManageTeam(departmentId: string) {
  return useCan('team.manage', { organizationId: organizationId.value ?? '', departmentId })
}

function policySettingFor(scopeLevel: ScopeLevel, scopeId: string): PolicySetting | undefined {
  return policySettings.value.find((entry) => entry.scope === scopeLevel && entry.scopeId === scopeId)
}

async function updatePolicySetting(scopeLevel: ScopeLevel, scopeId: string, flag: PolicyFlag, value: boolean | null) {
  policyUpdating.value = scopeId
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/policy-settings`, {
      method: 'PUT', headers, body: { scope: scopeLevel, scopeId, flag, value },
    })
    await load()
  } catch {
    actionError.value = 'Die Richtlinie konnte nicht geändert werden.'
  } finally {
    policyUpdating.value = null
  }
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Vereinsstruktur</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Struktur</h1>
      <p class="mt-2 text-sm text-[#727a75]">Abteilungen und Teams anlegen, umbenennen und archivieren.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else>
      <p v-if="actionError" class="mb-4 text-sm text-amber-800">{{ actionError }}</p>

      <section v-if="policySettingFor('organization', organizationId ?? '')" class="card mb-6 p-6">
        <h2 class="mb-3 font-display text-base font-bold">Vereinsweite Richtlinien</h2>
        <p class="mb-3 text-[10px] text-[#7b827d]">Gelten für den ganzen Verein, sofern eine Abteilung oder ein Team nicht selbst verschärft.</p>
        <PolicyFlagToggles
          :setting="policySettingFor('organization', organizationId ?? '')!"
          :pending="policyUpdating === organizationId"
          @change="(flag, value) => updatePolicySetting('organization', organizationId ?? '', flag, value)"
        />
      </section>

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
            :aria-label="`Abteilung ${department.name} umbenennen`"
            :placeholder="department.name"
            class="focus-ring w-full max-w-[280px] rounded-lg border border-transparent bg-transparent px-1 font-display text-lg font-bold hover:border-[#dfe0d9] focus:border-[#dfe0d9]"
            @keyup.enter="renameDepartment(department)"
            @blur="renameDepartment(department)"
          />
          <div v-if="canManageDepartment(department.id)" class="flex shrink-0 gap-2">
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

        <UsageBar
          v-if="storageUsageByDepartment[department.id]"
          class="mb-4"
          label="Speicher"
          :used="storageUsageByDepartment[department.id]!.usedBytes"
          :max="storageUsageByDepartment[department.id]!.limitBytes"
          :format-value="formatBytes"
        />

        <PolicyFlagToggles
          v-if="policySettingFor('department', department.id)"
          class="mb-4"
          :setting="policySettingFor('department', department.id)!"
          :pending="policyUpdating === department.id"
          @change="(flag, value) => updatePolicySetting('department', department.id, flag, value)"
        />

        <div class="ml-4 space-y-3 border-l border-[#e8e9e2] pl-4">
          <div v-for="team in teamsByDepartment.get(department.id) ?? []" :key="team.id" :class="{ 'opacity-60': team.archived_at }">
            <div class="flex items-center justify-between gap-3">
              <input
                v-model="renameDraft[team.id]"
                :aria-label="`Team ${team.name} umbenennen`"
                :placeholder="team.name"
                class="focus-ring w-full max-w-[240px] rounded-lg border border-transparent bg-transparent px-1 text-sm hover:border-[#dfe0d9] focus:border-[#dfe0d9]"
                @keyup.enter="renameTeam(team)"
                @blur="renameTeam(team)"
              />
              <div v-if="canManageTeam(department.id)" class="flex shrink-0 gap-2">
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
            <UsageBar
              v-if="storageUsageByTeam[team.id]"
              class="mt-1.5"
              label="Speicher"
              :used="storageUsageByTeam[team.id]!.usedBytes"
              :max="storageUsageByTeam[team.id]!.limitBytes"
              :format-value="formatBytes"
            />
            <PolicyFlagToggles
              v-if="policySettingFor('team', team.id)"
              class="mt-1.5"
              :setting="policySettingFor('team', team.id)!"
              :pending="policyUpdating === team.id"
              @change="(flag, value) => updatePolicySetting('team', team.id, flag, value)"
            />
          </div>
          <form v-if="!department.archived_at && canManageTeam(department.id)" class="flex gap-2 pt-1" @submit.prevent="createTeam(department.id)">
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
