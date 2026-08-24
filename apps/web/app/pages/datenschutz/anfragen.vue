<script setup lang="ts">
import {
  DataSubjectEraseResponseSchema,
  DataSubjectExportResponseSchema,
  DataSubjectRequestSchema,
  DirectoryPersonSchema,
  type DataSubjectEraseResponse,
  type DataSubjectExportResponse,
  type DataSubjectRequest,
  type DataSubjectRequestKind,
  type DataSubjectRequestStatus,
  type DataSubjectRequestSubjectKind,
  type DirectoryPerson,
} from '@vereinsfunk/contracts'

// Paket 020: Betroffenenanfragen (Auskunft, Löschung, Berichtigung, Widerspruch,
// Datenübertragbarkeit) -- Frist wird serverseitig aus receivedAt berechnet, hier nur angezeigt.
const config = useRuntimeConfig()
const { organizationId, level: activeScopeLevel } = await useActiveScope()
const isOrganizationScope = computed(() => activeScopeLevel.value === 'organization')
const canManage = computed(() => isOrganizationScope.value && useCan('organization.manage', { organizationId: organizationId.value ?? '' }))

const loading = ref(true)
const errorMessage = ref('')
const requests = ref<DataSubjectRequest[]>([])
const people = ref<DirectoryPerson[]>([])

async function load() {
  if (!organizationId.value || !canManage.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const [requestsResponse, peopleResponse] = await Promise.all([
      $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/data-subject-requests`, { headers }),
      $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/directory-people`, { headers }),
    ])
    requests.value = DataSubjectRequestSchema.array().parse(requestsResponse)
    people.value = DirectoryPersonSchema.array().parse(peopleResponse)
  } catch {
    errorMessage.value = 'Die Betroffenenanfragen konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()
watch([organizationId, isOrganizationScope], () => { void load() })

function personLabel(personId: string | null): string {
  if (!personId) return ''
  const person = people.value.find((item) => item.id === personId)
  return person ? `${person.firstName} ${person.lastName}` : 'Unbekannte Person'
}
function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('de-DE') : 'nicht angegeben'
}

const KIND_LABELS: Record<DataSubjectRequestKind, string> = {
  access: 'Auskunft', deletion: 'Löschung', rectification: 'Berichtigung', objection: 'Widerspruch', portability: 'Datenübertragbarkeit',
}
const SUBJECT_KIND_LABELS: Record<DataSubjectRequestSubjectKind, string> = {
  member: 'Mitglied', directory_person: 'Verzeichnisperson', guardian: 'Erziehungsberechtigte:r', external: 'Externe Person',
}
const STATUS_LABELS: Record<DataSubjectRequestStatus, string> = {
  open: 'Offen', in_progress: 'In Bearbeitung', completed: 'Abgeschlossen', rejected: 'Abgelehnt', partially_completed: 'Teilweise erledigt',
}
const STATUS_OPTIONS: DataSubjectRequestStatus[] = ['open', 'in_progress', 'completed', 'rejected', 'partially_completed']

function effectiveDueDate(request: DataSubjectRequest): string {
  return request.extendedUntil ?? request.dueAt
}
function dueDateClass(request: DataSubjectRequest): string {
  if (request.status === 'completed' || request.status === 'rejected') return 'text-[#9aa096]'
  const daysLeft = Math.ceil((new Date(effectiveDueDate(request)).getTime() - Date.now()) / 86_400_000)
  if (daysLeft < 0) return 'font-bold text-red-700'
  if (daysLeft <= 7) return 'font-semibold text-amber-700'
  return 'text-[#43483f]'
}

// --- Anlegen -----------------------------------------------------------------------------

const createForm = reactive({
  kind: 'access' as DataSubjectRequestKind,
  subjectKind: 'directory_person' as DataSubjectRequestSubjectKind,
  directoryPersonId: '',
  subjectLabel: '',
  receivedAt: new Date().toISOString().slice(0, 10),
})
watch(() => createForm.directoryPersonId, (id) => {
  if (createForm.subjectKind !== 'directory_person' || createForm.subjectLabel) return
  const person = people.value.find((item) => item.id === id)
  if (person) createForm.subjectLabel = `${person.firstName} ${person.lastName}`
})
const createFormDirectoryPersonIdModel = computed({
  get: () => createForm.directoryPersonId || '__none__',
  set: (v: string) => { createForm.directoryPersonId = v === '__none__' ? '' : v },
})
const creating = ref(false)
const createError = ref('')

async function createRequest() {
  if (!organizationId.value) return
  creating.value = true
  createError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/data-subject-requests`, {
      method: 'POST',
      headers,
      body: {
        kind: createForm.kind,
        subjectKind: createForm.subjectKind,
        directoryPersonId: createForm.subjectKind === 'directory_person' && createForm.directoryPersonId ? createForm.directoryPersonId : null,
        subjectLabel: createForm.subjectLabel,
        receivedAt: createForm.receivedAt,
      },
    })
    requests.value = [DataSubjectRequestSchema.parse(response), ...requests.value]
    createForm.directoryPersonId = ''
    createForm.subjectLabel = ''
  } catch {
    createError.value = 'Die Anfrage konnte nicht angelegt werden.'
  } finally {
    creating.value = false
  }
}

// --- Status, Fristverlängerung, Abschlussnotiz --------------------------------------------

const actionError = ref('')
const statusUpdatingId = ref<string | null>(null)
async function updateStatus(request: DataSubjectRequest, status: DataSubjectRequestStatus) {
  if (status === request.status) return
  statusUpdatingId.value = request.id
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/data-subject-requests/${request.id}`, { method: 'PATCH', headers, body: { status } })
    const updated = DataSubjectRequestSchema.parse(response)
    requests.value = requests.value.map((item) => (item.id === updated.id ? updated : item))
  } catch {
    actionError.value = 'Der Status konnte nicht geändert werden.'
  } finally {
    statusUpdatingId.value = null
  }
}

const extendingId = ref<string | null>(null)
const extendForm = reactive({ extendedUntil: '', extensionReason: '' })
function startExtend(request: DataSubjectRequest) {
  extendingId.value = request.id
  extendForm.extendedUntil = request.extendedUntil ?? ''
  extendForm.extensionReason = request.extensionReason ?? ''
}
const extending = ref(false)
async function saveExtend(request: DataSubjectRequest) {
  extending.value = true
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/data-subject-requests/${request.id}`, {
      method: 'PATCH',
      headers,
      body: { extendedUntil: extendForm.extendedUntil || null, extensionReason: extendForm.extensionReason.trim() || null },
    })
    const updated = DataSubjectRequestSchema.parse(response)
    requests.value = requests.value.map((item) => (item.id === updated.id ? updated : item))
    extendingId.value = null
  } catch {
    actionError.value = 'Die Fristverlängerung konnte nicht gespeichert werden.'
  } finally {
    extending.value = false
  }
}

const resolutionDraft = reactive<Record<string, string>>({})
watch(requests, (list) => {
  for (const request of list) if (resolutionDraft[request.id] === undefined) resolutionDraft[request.id] = request.resolutionNote ?? ''
}, { immediate: true })
async function saveResolutionNote(request: DataSubjectRequest) {
  const value = (resolutionDraft[request.id] ?? '').trim()
  if (value === (request.resolutionNote ?? '')) return
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/data-subject-requests/${request.id}`, { method: 'PATCH', headers, body: { resolutionNote: value || null } })
    const updated = DataSubjectRequestSchema.parse(response)
    requests.value = requests.value.map((item) => (item.id === updated.id ? updated : item))
  } catch {
    actionError.value = 'Die Abschlussnotiz konnte nicht gespeichert werden.'
  }
}

// --- Auskunft exportieren und Person löschen ------------------------------------------------

const exportingId = ref<string | null>(null)
const exportError = ref('')
const exportResults = reactive<Record<string, DataSubjectExportResponse>>({})
async function exportPerson(request: DataSubjectRequest) {
  if (!request.directoryPersonId) return
  exportingId.value = request.id
  exportError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/data-subjects/${request.directoryPersonId}/export`, { headers })
    const parsed = DataSubjectExportResponseSchema.parse(response)
    exportResults[request.id] = parsed
    window.open(parsed.signedUrl, '_blank')
  } catch {
    exportError.value = 'Der Export konnte nicht erzeugt werden.'
  } finally {
    exportingId.value = null
  }
}

const erasingId = ref<string | null>(null)
const eraseError = ref('')
const eraseResults = reactive<Record<string, DataSubjectEraseResponse>>({})
async function erasePerson(request: DataSubjectRequest) {
  if (!request.directoryPersonId) return
  if (!confirm(`"${personLabel(request.directoryPersonId)}" wirklich aus dem Verzeichnis löschen? Das umfasst Verzeichniseintrag, Elternkontakt und Gesichtszuordnung und lässt sich nicht zurücknehmen.`)) return
  erasingId.value = request.id
  eraseError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/data-subjects/${request.directoryPersonId}/erase`, { method: 'POST', headers })
    eraseResults[request.id] = DataSubjectEraseResponseSchema.parse(response)
  } catch {
    eraseError.value = 'Die Löschung konnte nicht ausgeführt werden.'
  } finally {
    erasingId.value = null
  }
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Verein</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Betroffenenanfragen</h1>
      <p class="mt-2 text-sm text-[#727a75]">Auskunft, Löschung, Berichtigung, Widerspruch und Datenübertragbarkeit — mit Frist, damit keine Anfrage im Postfach übersehen wird.</p>
      <p class="mt-3 text-xs text-[#9aa096]">Ein Widerspruch gegen eine erteilte Einwilligung läuft über den Widerrufslink aus <NuxtLink to="/einwilligungen" class="focus-ring font-semibold text-forest">Einwilligungen</NuxtLink>.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <div v-else-if="!canManage" class="card p-8 text-center text-sm text-[#7b827d]">
      Du hast hier keine Berechtigung. Das übernimmt der Vereinsadmin.
    </div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else>
      <p v-if="actionError" class="mb-4 text-sm text-amber-800">{{ actionError }}</p>
      <p v-if="exportError" class="mb-4 text-sm text-amber-800">{{ exportError }}</p>
      <p v-if="eraseError" class="mb-4 text-sm text-amber-800">{{ eraseError }}</p>

      <section class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Neue Anfrage erfassen</h2>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="createRequest">
          <label><span class="mb-1 block text-xs font-semibold">Art</span>
            <Select v-model="createForm.kind">
              <SelectTrigger class="rounded-lg p-2 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(label, kind) in KIND_LABELS" :key="kind" :value="kind">{{ label }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Betroffene Person, Art</span>
            <Select v-model="createForm.subjectKind">
              <SelectTrigger class="rounded-lg p-2 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(label, kind) in SUBJECT_KIND_LABELS" :key="kind" :value="kind">{{ label }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label v-if="createForm.subjectKind === 'directory_person'" class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Verzeichnisperson (optional, für Auskunft/Löschung nötig)</span>
            <Select v-model="createFormDirectoryPersonIdModel">
              <SelectTrigger class="rounded-lg p-2 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Keine Verknüpfung</SelectItem>
                <SelectItem v-for="person in people" :key="person.id" :value="person.id">{{ person.firstName }} {{ person.lastName }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Bezeichnung der Person</span>
            <input v-model="createForm.subjectLabel" required maxlength="200" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Eingegangen am</span>
            <input v-model="createForm.receivedAt" type="date" required class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <div class="flex items-end sm:col-span-2">
            <div>
              <p v-if="createError" class="mb-2 text-xs text-amber-800">{{ createError }}</p>
              <button type="submit" :disabled="creating" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
                {{ creating ? 'Wird angelegt …' : 'Anfrage anlegen' }}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section class="card divide-y divide-[#e8e9e2]">
        <h2 class="p-4 font-display text-base font-bold sm:px-6">Anfragen</h2>
        <div v-for="request in requests" :key="request.id" class="p-4 sm:px-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold">{{ request.subjectLabel }} <span class="text-[11px] font-normal text-[#9aa096]">({{ SUBJECT_KIND_LABELS[request.subjectKind] }})</span></p>
              <p class="mt-1 text-[11px] text-[#9aa096]">{{ KIND_LABELS[request.kind] }} · eingegangen am {{ formatDate(request.receivedAt) }}</p>
              <p class="mt-1 text-[11px]" :class="dueDateClass(request)">
                Frist: {{ formatDate(effectiveDueDate(request)) }}
                <span v-if="request.extendedUntil" class="text-[#9aa096]"> (verlängert{{ request.extensionReason ? ': ' + request.extensionReason : '' }})</span>
              </p>
            </div>
            <label class="shrink-0 text-[11px]">
              <Select
                :model-value="request.status"
                :disabled="statusUpdatingId === request.id"
                @update:model-value="(value: unknown) => updateStatus(request, value as typeof request.status)"
              >
                <SelectTrigger class="w-auto rounded-lg p-1.5 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in STATUS_OPTIONS" :key="option" :value="option">{{ STATUS_LABELS[option] }}</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold" @click="startExtend(request)">Frist verlängern</button>
            <template v-if="request.directoryPersonId">
              <button type="button" :disabled="exportingId === request.id" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60" @click="exportPerson(request)">
                {{ exportingId === request.id ? 'Wird erzeugt …' : 'Auskunft exportieren' }}
              </button>
              <button type="button" :disabled="erasingId === request.id" class="focus-ring rounded-lg border border-amber-300 px-3 py-1.5 text-[11px] font-semibold text-amber-800 disabled:opacity-60" @click="erasePerson(request)">
                {{ erasingId === request.id ? 'Wird gelöscht …' : 'Löschen' }}
              </button>
            </template>
          </div>

          <div v-if="extendingId === request.id" class="mt-3 grid gap-2 rounded-lg bg-[#f7f8f4] p-3 sm:grid-cols-3">
            <label><span class="mb-1 block text-[11px] font-semibold">Verlängert bis</span>
              <input v-model="extendForm.extendedUntil" type="date" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-1.5 text-xs" />
            </label>
            <label class="sm:col-span-2"><span class="mb-1 block text-[11px] font-semibold">Begründung</span>
              <input v-model="extendForm.extensionReason" maxlength="500" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-1.5 text-xs" />
            </label>
            <div class="flex gap-2 sm:col-span-3">
              <button type="button" :disabled="extending" class="focus-ring rounded-lg bg-forest px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60" @click="saveExtend(request)">
                {{ extending ? 'Wird gespeichert …' : 'Speichern' }}
              </button>
              <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold" @click="extendingId = null">Abbrechen</button>
            </div>
          </div>

          <label class="mt-3 block"><span class="mb-1 block text-[11px] font-semibold text-[#7b827d]">Abschlussnotiz</span>
            <textarea
              v-model="resolutionDraft[request.id]"
              rows="2"
              maxlength="2000"
              placeholder="Wie wurde die Anfrage bearbeitet?"
              class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs"
              @blur="saveResolutionNote(request)"
            />
          </label>

          <div v-if="exportResults[request.id]" class="mt-3 rounded-lg bg-[#f4f5ef] p-3 text-[11px] text-[#43483f]">
            Auskunftslink erzeugt, gültig bis {{ new Date(exportResults[request.id]!.expiresAt).toLocaleTimeString('de-DE') }}:
            <a :href="exportResults[request.id]!.signedUrl" target="_blank" rel="noopener" class="font-semibold text-forest">Herunterladen</a>
          </div>

          <div v-if="eraseResults[request.id]" class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p class="text-sm font-bold text-amber-900">Löschung ausgeführt</p>
            <p class="mt-2 text-[11px] font-semibold text-emerald-800">Gelöscht:</p>
            <ul class="list-disc pl-4 text-[11px] text-emerald-800">
              <li v-for="item in eraseResults[request.id]!.erased" :key="item">{{ item }}</li>
            </ul>
            <p class="mt-2 text-[11px] font-semibold text-amber-800">Nicht gelöscht (mit Begründung):</p>
            <ul class="list-disc pl-4 text-[11px] text-amber-800">
              <li v-for="item in eraseResults[request.id]!.retained" :key="item.category"><span class="font-semibold">{{ item.category }}:</span> {{ item.reason }}</li>
            </ul>
          </div>
        </div>
        <p v-if="!requests.length" class="p-8 text-center text-xs text-[#9aa096]">Noch keine Betroffenenanfrage erfasst.</p>
      </section>
    </template>
  </div>
</template>
