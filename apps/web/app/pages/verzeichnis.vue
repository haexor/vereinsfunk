<script setup lang="ts">
import {
  DirectoryPersonGuardianContactSchema,
  DirectoryPersonSchema,
  type DirectoryPerson,
  type DirectoryPersonGuardianContact,
  type DirectoryPersonStatus,
} from '@vereinsfunk/contracts'

const config = useRuntimeConfig()
const session = await useSession()
const scope = await useScope()

const organizationId = computed(() => scope.value?.organizationId ?? null)
const organization = computed(() => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')
const people = ref<DirectoryPerson[]>([])

const canReadOrgWide = computed(() => useCan('directory.read', { organizationId: organizationId.value ?? '' }))
function canReadDepartment(departmentId: string): boolean {
  return canReadOrgWide.value || useCan('directory.read', { organizationId: organizationId.value ?? '', departmentId })
}
function canReadTeam(departmentId: string, teamId: string): boolean {
  return canReadDepartment(departmentId) || useCan('directory.read', { organizationId: organizationId.value ?? '', departmentId, teamId })
}
const readableDepartments = computed(() =>
  (organization.value?.departments ?? []).filter((department) => canReadDepartment(department.id) || department.teams.some((team) => canReadTeam(department.id, team.id))),
)
const canAccessDirectory = computed(() => canReadOrgWide.value || readableDepartments.value.length > 0)

function departmentName(departmentId: string | null): string {
  if (!departmentId) return '–'
  return organization.value?.departments.find((department) => department.id === departmentId)?.name ?? '–'
}
function teamName(departmentId: string | null, teamId: string | null): string {
  if (!departmentId || !teamId) return '–'
  return organization.value?.departments.find((department) => department.id === departmentId)?.teams.find((team) => team.id === teamId)?.name ?? '–'
}
function canManageGuardianContact(person: { departmentId: string | null }): boolean {
  return useCan('department.manage', { organizationId: organizationId.value ?? '', ...(person.departmentId ? { departmentId: person.departmentId } : {}) })
}

const STATUS_LABELS: Record<DirectoryPersonStatus, string> = { active: 'Aktiv', inactive: 'Inaktiv', left: 'Ausgetreten', unknown: 'Unbekannt' }

// --- Filter ----------------------------------------------------------------------------

const filterDepartmentId = ref('')
const filterTeamId = ref('')
const filterMinor = ref(false)
const filterMissingGuardian = ref(false)
const filterLeft = ref(false)

// Voreinstellung: die aktive Sidebar-Abteilung, wenn lesbar -- sonst die erste lesbare
// Abteilung, oder "alle Abteilungen" fuer vereinsweite Betrachter.
watch(
  readableDepartments,
  (list) => {
    if (canReadOrgWide.value) {
      if (scope.value?.departmentId && list.some((department) => department.id === scope.value?.departmentId)) filterDepartmentId.value = scope.value.departmentId
      return
    }
    if (!list.some((department) => department.id === filterDepartmentId.value)) filterDepartmentId.value = list[0]?.id ?? ''
  },
  { immediate: true },
)
watch(filterDepartmentId, () => { filterTeamId.value = '' })

const teamOptionsForFilter = computed(() => {
  const department = organization.value?.departments.find((item) => item.id === filterDepartmentId.value)
  if (!department) return []
  return department.teams.filter((team) => canReadTeam(department.id, team.id))
})

const filterDepartmentIdModel = computed({
  get: () => filterDepartmentId.value || '__none__',
  set: (value: string) => { filterDepartmentId.value = value === '__none__' ? '' : value },
})
const filterTeamIdModel = computed({
  get: () => filterTeamId.value || '__none__',
  set: (value: string) => { filterTeamId.value = value === '__none__' ? '' : value },
})

async function loadPeople() {
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const query: Record<string, string> = {}
    if (filterDepartmentId.value) query.departmentId = filterDepartmentId.value
    if (filterTeamId.value) query.teamId = filterTeamId.value
    if (filterMinor.value) query.isMinor = 'true'
    if (filterMissingGuardian.value) query.missingGuardian = 'true'
    if (filterLeft.value) query.status = 'left'
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/directory-people`, { headers, query })
    people.value = DirectoryPersonSchema.array().parse(response)
  } catch {
    errorMessage.value = 'Das Verzeichnis konnte nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await loadPeople()
watch([organizationId, filterDepartmentId, filterTeamId, filterMinor, filterMissingGuardian, filterLeft], () => { void loadPeople() })

// --- Elternkontakt (nur mit department.manage, jeder Lesezugriff wird protokolliert) -----

const guardianContacts = reactive<Record<string, DirectoryPersonGuardianContact>>({})
const guardianLoadingId = ref<string | null>(null)
const guardianError = ref('')

async function toggleGuardianContact(person: DirectoryPerson) {
  if (guardianContacts[person.id]) { delete guardianContacts[person.id]; return }
  guardianLoadingId.value = person.id
  guardianError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/directory-people/${person.id}/guardian-contact`, { headers })
    guardianContacts[person.id] = DirectoryPersonGuardianContactSchema.parse(response)
  } catch {
    guardianError.value = 'Der Elternkontakt konnte nicht geladen werden.'
  } finally {
    guardianLoadingId.value = null
  }
}

// --- Anlegen -----------------------------------------------------------------------------

const createForm = reactive({
  firstName: '', lastName: '', departmentId: '', teamId: '', birthYear: '', status: 'active' as DirectoryPersonStatus, joinedAt: '', guardianName: '', guardianEmail: '',
})
const createSubmitting = ref(false)
const createError = ref('')

watch(
  readableDepartments,
  (list) => {
    if (canReadOrgWide.value) return
    if (!list.some((department) => department.id === createForm.departmentId)) createForm.departmentId = list[0]?.id ?? ''
  },
  { immediate: true },
)
const teamOptionsForCreate = computed(() => {
  const department = organization.value?.departments.find((item) => item.id === createForm.departmentId)
  if (!department) return []
  return canReadDepartment(department.id) ? department.teams : department.teams.filter((team) => canReadTeam(department.id, team.id))
})
watch(() => createForm.departmentId, () => { createForm.teamId = '' })
const canEditGuardianOnCreate = computed(() => canManageGuardianContact({ departmentId: createForm.departmentId || null }))

const createFormDepartmentIdModel = computed({
  get: () => createForm.departmentId || '__none__',
  set: (value: string) => { createForm.departmentId = value === '__none__' ? '' : value },
})
const createFormTeamIdModel = computed({
  get: () => createForm.teamId || '__none__',
  set: (value: string) => { createForm.teamId = value === '__none__' ? '' : value },
})

async function createPerson() {
  if (!organizationId.value) return
  createSubmitting.value = true
  createError.value = ''
  try {
    const headers = await useAuthHeader()
    const body: Record<string, unknown> = {
      firstName: createForm.firstName.trim(),
      lastName: createForm.lastName.trim(),
      status: createForm.status,
    }
    if (createForm.departmentId) body.departmentId = createForm.departmentId
    if (createForm.teamId) body.teamId = createForm.teamId
    if (createForm.birthYear) body.birthYear = Number(createForm.birthYear)
    if (createForm.joinedAt) body.joinedAt = createForm.joinedAt
    if (canEditGuardianOnCreate.value) {
      if (createForm.guardianName.trim()) body.guardianName = createForm.guardianName.trim()
      if (createForm.guardianEmail.trim()) body.guardianEmail = createForm.guardianEmail.trim()
    }
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/directory-people`, { method: 'POST', headers, body })
    people.value = [...people.value, DirectoryPersonSchema.parse(response)]
    createForm.firstName = ''; createForm.lastName = ''; createForm.birthYear = ''; createForm.joinedAt = ''; createForm.guardianName = ''; createForm.guardianEmail = ''
    createForm.status = 'active'
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    createError.value = code === 'guardian_contact_required'
      ? 'Für eine minderjährige, aktive Person ist eine Eltern-E-Mail-Adresse erforderlich.'
      : 'Die Person konnte nicht angelegt werden.'
  } finally {
    createSubmitting.value = false
  }
}

// --- Bearbeiten --------------------------------------------------------------------------

const editingPersonId = ref<string | null>(null)
const editForm = reactive({
  firstName: '', lastName: '', departmentId: '', teamId: '', birthYear: '', status: 'active' as DirectoryPersonStatus, joinedAt: '', leftAt: '', guardianName: '', guardianEmail: '',
})
const editSubmitting = ref(false)
const editError = ref('')

function startEdit(person: DirectoryPerson) {
  editingPersonId.value = person.id
  editForm.firstName = person.firstName
  editForm.lastName = person.lastName
  editForm.departmentId = person.departmentId ?? ''
  editForm.teamId = person.teamId ?? ''
  editForm.birthYear = person.birthYear ? String(person.birthYear) : ''
  editForm.status = person.status
  editForm.joinedAt = person.joinedAt ?? ''
  editForm.leftAt = person.leftAt ?? ''
  // Elternkontakt wird beim Bearbeiten bewusst nicht vorbefuellt (das waere ein weiterer,
  // hier nicht angefragter protokollierter Lesezugriff) -- "Elternkontakt anzeigen" in der
  // Zeile zeigt den aktuellen Wert. Ein leeres Feld hier laesst den bestehenden Wert unveraendert.
  editForm.guardianName = ''
  editForm.guardianEmail = ''
  editError.value = ''
}
const teamOptionsForEdit = computed(() => {
  const department = organization.value?.departments.find((item) => item.id === editForm.departmentId)
  if (!department) return []
  return canReadDepartment(department.id) ? department.teams : department.teams.filter((team) => canReadTeam(department.id, team.id))
})

const editFormDepartmentIdModel = computed({
  get: () => editForm.departmentId || '__none__',
  set: (value: string) => { editForm.departmentId = value === '__none__' ? '' : value },
})
const editFormTeamIdModel = computed({
  get: () => editForm.teamId || '__none__',
  set: (value: string) => { editForm.teamId = value === '__none__' ? '' : value },
})

async function saveEdit(person: DirectoryPerson) {
  editSubmitting.value = true
  editError.value = ''
  try {
    const headers = await useAuthHeader()
    const body: Record<string, unknown> = {
      firstName: editForm.firstName.trim(),
      lastName: editForm.lastName.trim(),
      departmentId: editForm.departmentId || null,
      teamId: editForm.teamId || null,
      status: editForm.status,
      birthYear: editForm.birthYear ? Number(editForm.birthYear) : null,
      joinedAt: editForm.joinedAt || null,
      leftAt: editForm.leftAt || null,
    }
    if (canManageGuardianContact(person)) {
      if (editForm.guardianName.trim()) body.guardianName = editForm.guardianName.trim()
      if (editForm.guardianEmail.trim()) body.guardianEmail = editForm.guardianEmail.trim()
    }
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/directory-people/${person.id}`, { method: 'PATCH', headers, body })
    const updated = DirectoryPersonSchema.parse(response)
    people.value = people.value.map((item) => (item.id === updated.id ? updated : item))
    editingPersonId.value = null
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    editError.value = code === 'guardian_contact_required'
      ? 'Für eine minderjährige, aktive Person ist eine Eltern-E-Mail-Adresse erforderlich.'
      : 'Die Änderungen konnten nicht gespeichert werden.'
  } finally {
    editSubmitting.value = false
  }
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Verein</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Verzeichnis</h1>
      <p class="mt-2 text-sm text-[#727a75]">Personen, die auf Fotos vorkommen können — mit dem Wenigsten, das dafür nötig ist.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <div v-else-if="!canAccessDirectory" class="card p-8 text-center text-sm text-[#7b827d]">
      Du hast hier keinen Lesezugriff auf das Mitgliederverzeichnis. Das übernimmt der Vereins-, Abteilungs- oder Teamadmin.
    </div>
    <template v-else>
      <p v-if="actionError" class="mb-4 text-sm text-amber-800">{{ actionError }}</p>

      <section class="card mb-6 p-6">
        <h2 class="mb-3 font-display text-base font-bold">Filter</h2>
        <div class="flex flex-wrap items-center gap-3">
          <Select v-model="filterDepartmentIdModel">
            <SelectTrigger class="w-auto rounded-lg p-2 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-if="canReadOrgWide" value="__none__">Alle Abteilungen</SelectItem>
              <SelectItem v-for="department in readableDepartments" :key="department.id" :value="department.id">{{ department.name }}</SelectItem>
            </SelectContent>
          </Select>
          <Select v-if="filterDepartmentId && teamOptionsForFilter.length" v-model="filterTeamIdModel">
            <SelectTrigger class="w-auto rounded-lg p-2 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Alle Mannschaften</SelectItem>
              <SelectItem v-for="team in teamOptionsForFilter" :key="team.id" :value="team.id">{{ team.name }}</SelectItem>
            </SelectContent>
          </Select>
          <label class="flex items-center gap-1.5 text-xs"><input v-model="filterMinor" type="checkbox" /> Minderjährig</label>
          <label class="flex items-center gap-1.5 text-xs"><input v-model="filterMissingGuardian" type="checkbox" /> Ohne Elternkontakt</label>
          <label class="flex items-center gap-1.5 text-xs"><input v-model="filterLeft" type="checkbox" /> Ausgetreten</label>
        </div>
      </section>

      <section class="card mb-6 divide-y divide-[#e8e9e2]">
        <div v-for="person in people" :key="person.id" class="p-4 sm:px-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold">{{ person.firstName }} {{ person.lastName }}</p>
              <p class="mt-1 text-[11px] text-[#9aa096]">
                {{ departmentName(person.departmentId) }}<span v-if="person.teamId"> · {{ teamName(person.departmentId, person.teamId) }}</span>
                <span v-if="person.birthYear"> · Jahrgang {{ person.birthYear }}</span>
                · {{ STATUS_LABELS[person.status] }}
              </p>
              <p v-if="person.joinedAt || person.leftAt" class="mt-1 text-[11px] text-[#9aa096]">
                <span v-if="person.joinedAt">Dabei seit {{ new Date(person.joinedAt).toLocaleDateString('de-DE') }}</span>
                <span v-if="person.joinedAt && person.leftAt"> · </span>
                <span v-if="person.leftAt">Ausgetreten am {{ new Date(person.leftAt).toLocaleDateString('de-DE') }}</span>
              </p>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                <span v-if="person.isMinor" class="inline-flex items-center rounded-full bg-[#eef1ea] px-2.5 py-1 text-[10px] font-semibold text-[#3d453f]">Minderjährig</span>
                <span v-if="person.becameAdultAt" class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-800">Kürzlich volljährig geworden</span>
              </div>
              <div v-if="canManageGuardianContact(person)" class="mt-2">
                <button type="button" class="focus-ring text-[11px] font-semibold text-forest" :disabled="guardianLoadingId === person.id" @click="toggleGuardianContact(person)">
                  {{ guardianContacts[person.id] ? 'Elternkontakt ausblenden' : 'Elternkontakt anzeigen' }}
                </button>
                <div v-if="guardianContacts[person.id]" class="mt-1.5 rounded-lg bg-[#f7f8f4] p-2 text-[11px]">
                  <p>{{ guardianContacts[person.id]!.guardianName ?? 'Kein Name hinterlegt' }}</p>
                  <p>{{ guardianContacts[person.id]!.guardianEmail ?? 'Keine E-Mail hinterlegt' }}</p>
                  <p class="mt-1 text-[#9aa096]">Dieser Zugriff wird protokolliert.</p>
                </div>
                <p v-if="guardianError" class="mt-1 text-[11px] text-amber-800">{{ guardianError }}</p>
              </div>
            </div>
            <button type="button" class="focus-ring shrink-0 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold" @click="startEdit(person)">Bearbeiten</button>
          </div>

          <div v-if="editingPersonId === person.id" class="mt-3 grid gap-3 rounded-xl border border-[#e8e9e2] bg-[#f7f8f4] p-3 sm:grid-cols-2">
            <label><span class="mb-1 block text-xs font-semibold">Vorname</span>
              <input v-model="editForm.firstName" required maxlength="80" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" />
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Nachname</span>
              <input v-model="editForm.lastName" required maxlength="80" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" />
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Abteilung</span>
              <!-- "Keine" nur vereinsweit, wie im Anlegen-Formular: eine Abteilungsverwalterin
                   darf keine Person auf departmentId null setzen (die API antwortet darauf mit
                   403, weil directory.read auf Vereinsebene fehlt) -- die Auswahl anzubieten
                   erzeugt nur eine Fehlermeldung. -->
              <Select v-model="editFormDepartmentIdModel">
                <SelectTrigger class="rounded-lg p-2 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-if="canReadOrgWide" value="__none__">Keine</SelectItem>
                  <SelectItem v-for="department in readableDepartments" :key="department.id" :value="department.id">{{ department.name }}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Mannschaft</span>
              <Select v-model="editFormTeamIdModel">
                <SelectTrigger class="rounded-lg p-2 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Keine</SelectItem>
                  <SelectItem v-for="team in teamOptionsForEdit" :key="team.id" :value="team.id">{{ team.name }}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Geburtsjahr</span>
              <input v-model="editForm.birthYear" type="number" min="1900" max="2100" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" />
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Status</span>
              <Select v-model="editForm.status">
                <SelectTrigger class="rounded-lg p-2 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Aktiv</SelectItem>
                  <SelectItem value="inactive">Inaktiv</SelectItem>
                  <SelectItem value="left">Ausgetreten</SelectItem>
                  <SelectItem value="unknown">Unbekannt</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Dabei seit</span>
              <input v-model="editForm.joinedAt" type="date" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" />
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Ausgetreten am</span>
              <input v-model="editForm.leftAt" type="date" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" />
            </label>
            <template v-if="canManageGuardianContact(person)">
              <label><span class="mb-1 block text-xs font-semibold">Name Erziehungsberechtigte:r</span>
                <input v-model="editForm.guardianName" maxlength="160" placeholder="leer lassen: unverändert" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" />
              </label>
              <label><span class="mb-1 block text-xs font-semibold">E-Mail Erziehungsberechtigte:r</span>
                <input v-model="editForm.guardianEmail" type="email" placeholder="leer lassen: unverändert" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" />
              </label>
            </template>
            <p v-if="editError" class="text-xs text-amber-800 sm:col-span-2">{{ editError }}</p>
            <div class="flex gap-2 sm:col-span-2">
              <button type="button" :disabled="editSubmitting" class="focus-ring rounded-lg bg-forest px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60" @click="saveEdit(person)">
                {{ editSubmitting ? 'Wird gespeichert …' : 'Speichern' }}
              </button>
              <button type="button" class="focus-ring text-xs text-[#8a9186]" @click="editingPersonId = null">Abbrechen</button>
            </div>
          </div>
        </div>
        <p v-if="!people.length" class="p-8 text-center text-xs text-[#9aa096]">Keine Personen für diesen Filter.</p>
      </section>

      <section class="card p-6">
        <h2 class="mb-4 font-display text-base font-bold">Person manuell anlegen</h2>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="createPerson">
          <label><span class="mb-1 block text-xs font-semibold">Vorname</span>
            <input v-model="createForm.firstName" required maxlength="80" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Nachname</span>
            <input v-model="createForm.lastName" required maxlength="80" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Abteilung</span>
            <Select v-model="createFormDepartmentIdModel">
              <SelectTrigger class="rounded-xl p-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-if="canReadOrgWide" value="__none__">Keine</SelectItem>
                <SelectItem v-for="department in readableDepartments" :key="department.id" :value="department.id">{{ department.name }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Mannschaft</span>
            <Select v-model="createFormTeamIdModel">
              <SelectTrigger class="rounded-xl p-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Keine</SelectItem>
                <SelectItem v-for="team in teamOptionsForCreate" :key="team.id" :value="team.id">{{ team.name }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Geburtsjahr</span>
            <input v-model="createForm.birthYear" type="number" min="1900" max="2100" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Status</span>
            <Select v-model="createForm.status">
              <SelectTrigger class="rounded-xl p-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktiv</SelectItem>
                <SelectItem value="inactive">Inaktiv</SelectItem>
                <SelectItem value="left">Ausgetreten</SelectItem>
                <SelectItem value="unknown">Unbekannt</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Dabei seit</span>
            <input v-model="createForm.joinedAt" type="date" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
          </label>
          <template v-if="canEditGuardianOnCreate">
            <label><span class="mb-1 block text-xs font-semibold">Name Erziehungsberechtigte:r</span>
              <input v-model="createForm.guardianName" maxlength="160" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
            </label>
            <label><span class="mb-1 block text-xs font-semibold">E-Mail Erziehungsberechtigte:r</span>
              <input v-model="createForm.guardianEmail" type="email" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
            </label>
          </template>

          <div class="sm:col-span-2">
            <p v-if="createError" class="mb-2 text-xs text-amber-800">{{ createError }}</p>
            <button type="submit" :disabled="createSubmitting" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
              {{ createSubmitting ? 'Wird angelegt …' : 'Anlegen' }}
            </button>
          </div>
        </form>
        <p class="mt-4 text-xs text-[#7b827d]">Adresse, Bankverbindung, Geschlecht, Nationalität, Gesundheitsdaten und das vollständige Geburtsdatum werden bewusst nicht gespeichert.</p>
      </section>
    </template>
  </div>
</template>
