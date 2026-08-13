<script setup lang="ts">
import {
  IntegrationSourceSchema,
  IntegrationSyncConflictSchema,
  IntegrationSyncRunSchema,
  SyncSourceResponseSchema,
  type IntegrationSource,
  type IntegrationSyncConflict,
  type IntegrationSyncRun,
} from '@vereinsfunk/contracts'

const api = useApiClient()
const session = await useSession()
const scope = await useScope()

const organizationId = computed(() => scope.value?.organizationId ?? null)
const organization = computed(() => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')
const sources = ref<IntegrationSource[]>([])

// Wer darf hier ueberhaupt etwas verwalten? Vereinsweit ODER in mindestens einer Abteilung --
// unterscheidet sich von "keine Quelle vorhanden" (leere Liste trotz Berechtigung).
const canManageOrgWide = computed(() => useCan('integration.manage', { organizationId: organizationId.value ?? '' }))
const manageableDepartments = computed(() =>
  (organization.value?.departments ?? []).filter((department) => useCan('integration.manage', { organizationId: organizationId.value ?? '', departmentId: department.id })),
)
const canManageAnything = computed(() => canManageOrgWide.value || manageableDepartments.value.length > 0)
const departmentOptionsForCreate = computed(() => (canManageOrgWide.value ? (organization.value?.departments ?? []) : manageableDepartments.value))

function canManageDepartment(departmentId: string | null): boolean {
  return useCan('integration.manage', { organizationId: organizationId.value ?? '', ...(departmentId ? { departmentId } : {}) })
}

async function load() {
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    sources.value = await api.request(`/v1/organizations/${organizationId.value}/integration-sources`, {}, IntegrationSourceSchema.array())
  } catch {
    errorMessage.value = 'Die Quellen konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()
watch(organizationId, () => { void load() })

const TRANSPORT_LABELS: Record<string, string> = { file: 'Datei (CSV/XLSX)', http: 'HTTP-API', ical: 'Kalender-Feed (iCal)', webhook: 'Webhook' }
const DOMAIN_LABELS: Record<string, string> = { people: 'Personen', teams: 'Mannschaften', fixtures: 'Spielpläne', events: 'Veranstaltungen' }
const RUN_STATUS_LABELS: Record<string, string> = {
  running: 'Läuft', succeeded: 'Erfolgreich', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen', aborted_loss_threshold: 'Abgebrochen (Verlustschwelle)',
}
const CONFLICT_KIND_LABELS: Record<string, string> = {
  ambiguous_match: 'Mehrdeutiger Treffer', unknown_structure: 'Unbekannte Struktur', value_conflict: 'Wertkonflikt', invalid_record: 'Ungültiger Datensatz',
}
const RESOLUTION_LABELS: Record<string, string> = { pending: 'Offen', keep_current: 'Behalten', take_incoming: 'Übernommen', ignore_permanently: 'Dauerhaft ignoriert' }

function scopeLabel(departmentId: string | null): string {
  if (!departmentId) return 'Vereinsweit'
  return organization.value?.departments.find((department) => department.id === departmentId)?.name ?? departmentId
}

// --- Quelle einrichten -------------------------------------------------------------------

const createForm = reactive({
  transport: 'file' as 'file' | 'ical',
  providerKey: '',
  displayName: '',
  departmentId: '',
  endpointUrl: '',
  lossThresholdPercent: '',
})
const mappingRows = reactive<{ column: string; field: string }[]>([{ column: '', field: '' }])
const createSubmitting = ref(false)
const createError = ref('')

// Ohne vereinsweites integration.manage ist "Vereinsweit" keine gueltige Voreinstellung --
// sonst zeigt das Formular eine Option, die die API mit 403 ablehnen wuerde.
watch(
  departmentOptionsForCreate,
  (list) => {
    if (canManageOrgWide.value) return
    if (!list.some((department) => department.id === createForm.departmentId)) createForm.departmentId = list[0]?.id ?? ''
  },
  { immediate: true },
)

const FIELD_MAPPING_BASE_TARGETS = [
  { value: 'firstName', label: 'Vorname' },
  { value: 'lastName', label: 'Nachname' },
  { value: 'birthYear', label: 'Geburtsjahr' },
  { value: 'departmentName', label: 'Abteilung (Name)' },
  { value: 'teamName', label: 'Mannschaft (Name)' },
  { value: 'status', label: 'Status' },
  { value: 'joinedAt', label: 'Beitrittsdatum' },
  { value: 'leftAt', label: 'Austrittsdatum' },
]
const GUARDIAN_MAPPING_TARGETS = [
  { value: 'guardianName', label: 'Name Erziehungsberechtigte:r' },
  { value: 'guardianEmail', label: 'E-Mail Erziehungsberechtigte:r' },
]
function mappingTargetsFor(departmentId: string | null): typeof FIELD_MAPPING_BASE_TARGETS {
  return canManageDepartment(departmentId) ? [...FIELD_MAPPING_BASE_TARGETS, ...GUARDIAN_MAPPING_TARGETS] : FIELD_MAPPING_BASE_TARGETS
}

function addMappingRow() { mappingRows.push({ column: '', field: '' }) }
function removeMappingRow(index: number) { mappingRows.splice(index, 1) }

function buildFieldMapping(rows: { column: string; field: string }[]): Record<string, string> {
  return Object.fromEntries(rows.filter((row) => row.column.trim() && row.field).map((row) => [row.column.trim(), row.field]))
}

async function createSource() {
  if (!organizationId.value) return
  if (createForm.transport === 'ical' && !createForm.endpointUrl.trim()) {
    createError.value = 'Für einen Kalender-Feed ist eine Adresse erforderlich.'
    return
  }
  createSubmitting.value = true
  createError.value = ''
  try {
    const body: Record<string, unknown> = {
      transport: createForm.transport,
      providerKey: createForm.providerKey.trim(),
      displayName: createForm.displayName.trim(),
      enabledDomains: ['people'],
      fieldMapping: buildFieldMapping(mappingRows),
    }
    if (createForm.departmentId) body.departmentId = createForm.departmentId
    if (createForm.transport === 'ical') body.endpointUrl = createForm.endpointUrl.trim()
    if (createForm.lossThresholdPercent) body.lossThresholdPercent = Number(createForm.lossThresholdPercent)
    const response = await api.request(`/v1/organizations/${organizationId.value}/integration-sources`, { method: 'POST', body }, IntegrationSourceSchema)
    sources.value = [...sources.value, response]
    createForm.providerKey = ''
    createForm.displayName = ''
    createForm.endpointUrl = ''
    createForm.lossThresholdPercent = ''
    mappingRows.splice(0, mappingRows.length, { column: '', field: '' })
  } catch {
    createError.value = 'Die Quelle konnte nicht angelegt werden.'
  } finally {
    createSubmitting.value = false
  }
}

// --- Aktivieren/Deaktivieren -------------------------------------------------------------

const busySourceId = ref<string | null>(null)
async function toggleEnabled(source: IntegrationSource) {
  busySourceId.value = source.id
  actionError.value = ''
  try {
    const updated = await api.request(`/v1/integration-sources/${source.id}`, { method: 'PATCH', body: { enabled: !source.enabled } }, IntegrationSourceSchema)
    sources.value = sources.value.map((item) => (item.id === updated.id ? updated : item))
  } catch {
    actionError.value = 'Der Status konnte nicht geändert werden.'
  } finally {
    busySourceId.value = null
  }
}

// --- Bearbeiten (Anzeigename, Endpunkt, Feldzuordnung, Verlustschwelle) ------------------

const editingSourceId = ref<string | null>(null)
const editForm = reactive({ displayName: '', endpointUrl: '', lossThresholdPercent: '30' })
const editMappingRows = reactive<{ column: string; field: string }[]>([])
const editSubmitting = ref(false)
const editError = ref('')

function startEdit(source: IntegrationSource) {
  editingSourceId.value = source.id
  editForm.displayName = source.displayName
  editForm.endpointUrl = source.endpointUrl ?? ''
  editForm.lossThresholdPercent = String(source.lossThresholdPercent)
  const entries = Object.entries(source.fieldMapping).map(([column, field]) => ({ column, field }))
  editMappingRows.splice(0, editMappingRows.length, ...(entries.length > 0 ? entries : [{ column: '', field: '' }]))
  editError.value = ''
}

async function saveEdit(source: IntegrationSource) {
  editSubmitting.value = true
  editError.value = ''
  try {
    const body: Record<string, unknown> = {
      displayName: editForm.displayName.trim(),
      fieldMapping: buildFieldMapping(editMappingRows),
      lossThresholdPercent: Number(editForm.lossThresholdPercent) || 30,
    }
    if (source.transport === 'ical') body.endpointUrl = editForm.endpointUrl.trim()
    const updated = await api.request(`/v1/integration-sources/${source.id}`, { method: 'PATCH', body }, IntegrationSourceSchema)
    sources.value = sources.value.map((item) => (item.id === updated.id ? updated : item))
    editingSourceId.value = null
  } catch {
    editError.value = 'Die Änderungen konnten nicht gespeichert werden.'
  } finally {
    editSubmitting.value = false
  }
}

// --- Trockenlauf / Uebernahme ------------------------------------------------------------

const SYNC_ERROR_MESSAGES: Record<string, string> = {
  source_disabled: 'Diese Quelle ist deaktiviert.',
  source_missing_endpoint: 'Für diese Quelle ist keine Adresse hinterlegt.',
  source_fetch_failed: 'Der Kalender-Feed konnte nicht abgerufen werden.',
  transport_not_implemented: 'Dieser Transport wird noch nicht unterstützt.',
  domain_not_implemented: 'Dieser Bereich wird noch nicht unterstützt.',
  domain_not_enabled: 'Dieser Bereich ist für diese Quelle nicht aktiviert.',
  file_too_large: 'Die Datei ist zu groß (max. 8 MB).',
  invalid_request: 'Die Anfrage ist ungültig.',
}

const syncingSourceId = ref<string | null>(null)
const syncMode = ref<'dry_run' | 'apply'>('dry_run')
const syncFile = ref<File | null>(null)
const syncFileInputKey = ref(0)
const syncSubmitting = ref(false)
const syncError = ref('')
const syncResults = reactive<Record<string, { run: IntegrationSyncRun; conflicts: IntegrationSyncConflict[] }>>({})

function openSync(source: IntegrationSource) {
  syncingSourceId.value = syncingSourceId.value === source.id ? null : source.id
  syncMode.value = 'dry_run'
  syncFile.value = null
  syncFileInputKey.value += 1
  syncError.value = ''
}
function onFileChange(event: Event) {
  syncFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

async function runSync(source: IntegrationSource) {
  if (source.transport === 'file' && !syncFile.value) {
    syncError.value = 'Bitte eine Datei auswählen.'
    return
  }
  syncSubmitting.value = true
  syncError.value = ''
  try {
    let response: unknown
    if (source.transport === 'file') {
      const formData = new FormData()
      formData.append('mode', syncMode.value)
      formData.append('domain', 'people')
      formData.append('file', syncFile.value as File)
      response = await api.request(`/v1/integration-sources/${source.id}/sync`, { method: 'POST', body: formData })
    } else {
      response = await api.request(`/v1/integration-sources/${source.id}/sync`, { method: 'POST', body: { mode: syncMode.value, domain: 'people' } })
    }
    syncResults[source.id] = SyncSourceResponseSchema.parse(response)
    if (historySourceId.value === source.id) await loadHistory(source.id)
    if (conflictsSourceId.value === source.id) await loadConflicts(source.id)
    await load()
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    syncError.value = (code && SYNC_ERROR_MESSAGES[code]) ?? 'Der Sync-Lauf ist fehlgeschlagen.'
  } finally {
    syncSubmitting.value = false
  }
}

// --- Verlauf der Laeufe --------------------------------------------------------------------

const historySourceId = ref<string | null>(null)
const historyRuns = ref<IntegrationSyncRun[]>([])
const historyLoading = ref(false)

async function loadHistory(sourceId: string) {
  historyLoading.value = true
  try {
    historyRuns.value = await api.request(`/v1/integration-sources/${sourceId}/sync-runs`, {}, IntegrationSyncRunSchema.array())
  } catch {
    historyRuns.value = []
  } finally {
    historyLoading.value = false
  }
}
async function toggleHistory(source: IntegrationSource) {
  if (historySourceId.value === source.id) { historySourceId.value = null; return }
  historySourceId.value = source.id
  await loadHistory(source.id)
}

// --- Konfliktliste -------------------------------------------------------------------------

const conflictsSourceId = ref<string | null>(null)
const conflictItems = ref<IntegrationSyncConflict[]>([])
const conflictsLoading = ref(false)
const showResolvedConflicts = ref(false)
const conflictActionError = ref('')
const conflictBusyId = ref<string | null>(null)

async function loadConflicts(sourceId: string) {
  conflictsLoading.value = true
  try {
    conflictItems.value = await api.request(`/v1/integration-sources/${sourceId}/conflicts`, {
      query: showResolvedConflicts.value ? {} : { resolution: 'pending' },
    }, IntegrationSyncConflictSchema.array())
  } catch {
    conflictItems.value = []
  } finally {
    conflictsLoading.value = false
  }
}
async function toggleConflicts(source: IntegrationSource) {
  if (conflictsSourceId.value === source.id) { conflictsSourceId.value = null; return }
  conflictsSourceId.value = source.id
  showResolvedConflicts.value = false
  await loadConflicts(source.id)
}
watch(showResolvedConflicts, () => { if (conflictsSourceId.value) void loadConflicts(conflictsSourceId.value) })

async function resolveConflict(conflict: IntegrationSyncConflict, resolution: 'keep_current' | 'take_incoming' | 'ignore_permanently') {
  conflictBusyId.value = conflict.id
  conflictActionError.value = ''
  try {
    const updated = await api.request(`/v1/integration-sync-conflicts/${conflict.id}`, { method: 'PATCH', body: { resolution } }, IntegrationSyncConflictSchema)
    for (const key of Object.keys(syncResults)) {
      const entry = syncResults[key]
      if (entry) entry.conflicts = entry.conflicts.map((item) => (item.id === updated.id ? updated : item))
    }
    if (conflictsSourceId.value === conflict.sourceId) await loadConflicts(conflict.sourceId)
  } catch {
    conflictActionError.value = 'Die Entscheidung konnte nicht gespeichert werden.'
  } finally {
    conflictBusyId.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-[980px] px-5 py-8 sm:px-10">
    <header class="mb-8">
      <div class="eyebrow mb-3">Verein</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Integrationen</h1>
      <p class="mt-2 text-sm text-[#727a75]">Was im Vereinsverwaltungssystem oder Mannschaftskalender schon steht, hier einlesen statt doppelt pflegen.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <div v-else-if="!canManageAnything" class="card p-8 text-center text-sm text-[#7b827d]">
      Du kannst hier keine Integrationsquellen verwalten. Das übernimmt der Vereins- oder Abteilungsadmin.
    </div>
    <template v-else>
      <p v-if="actionError" class="mb-4 text-sm text-amber-800">{{ actionError }}</p>

      <IntegrationSourceCreateForm
        v-model:form="createForm" v-model:mapping-rows="mappingRows" :departments="departmentOptionsForCreate"
        :can-manage-org-wide="canManageOrgWide" :submitting="createSubmitting" :error="createError"
        :mapping-targets-for="mappingTargetsFor" @submit="createSource" @add-row="addMappingRow" @remove-row="removeMappingRow"
      />

      <section v-for="source in sources" :key="source.id" class="card mb-4 p-6" :class="{ 'opacity-60': !source.enabled }">
        <IntegrationSourceHeader
          :source="source" :busy="busySourceId === source.id" :transport-labels="TRANSPORT_LABELS"
          :domain-labels="DOMAIN_LABELS" :run-status-labels="RUN_STATUS_LABELS" :scope-label="scopeLabel"
          @toggle="toggleEnabled(source)"
        />

        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold" @click="openSync(source)">Sync ausführen</button>
          <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold" @click="startEdit(source)">Bearbeiten</button>
          <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold" @click="toggleHistory(source)">
            {{ historySourceId === source.id ? 'Verlauf ausblenden' : 'Verlauf anzeigen' }}
          </button>
          <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold" @click="toggleConflicts(source)">
            {{ conflictsSourceId === source.id ? 'Konflikte ausblenden' : 'Konflikte anzeigen' }}
          </button>
        </div>

        <IntegrationSourceEditForm
          v-if="editingSourceId === source.id" :source="source" v-model:form="editForm" v-model:mapping-rows="editMappingRows"
          :submitting="editSubmitting" :error="editError" :mapping-targets-for="mappingTargetsFor"
          @save="saveEdit(source)" @cancel="editingSourceId = null" @add-row="editMappingRows.push({ column: '', field: '' })" @remove-row="editMappingRows.splice($event, 1)"
        />

        <div v-if="syncingSourceId === source.id" class="mt-4 rounded-xl border border-[#e8e9e2] bg-[#f7f8f4] p-4">
          <p class="mb-3 text-xs font-semibold">Sync ausführen</p>
          <div class="flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-1.5 text-xs"><input v-model="syncMode" type="radio" value="dry_run" /> Trockenlauf</label>
            <label class="flex items-center gap-1.5 text-xs"><input v-model="syncMode" type="radio" value="apply" /> Übernehmen</label>
          </div>
          <div v-if="source.transport === 'file'" class="mt-3">
            <input :key="syncFileInputKey" type="file" accept=".csv,.xlsx,.xls" class="text-xs" @change="onFileChange" />
          </div>
          <p v-if="syncError" class="mt-2 text-xs text-amber-800">{{ syncError }}</p>
          <div class="mt-3 flex items-center gap-2">
            <button type="button" :disabled="syncSubmitting" class="focus-ring rounded-lg bg-forest px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60" @click="runSync(source)">
              {{ syncSubmitting ? 'Läuft …' : 'Ausführen' }}
            </button>
            <button type="button" class="focus-ring text-xs text-[#8a9186]" @click="syncingSourceId = null">Schließen</button>
          </div>

          <div v-if="syncResults[source.id]" class="mt-4 border-t border-[#e8e9e2] pt-3 text-xs">
            <p class="font-semibold">
              {{ syncResults[source.id]!.run.mode === 'dry_run' ? 'Trockenlauf-Ergebnis' : 'Übernommen' }}:
              {{ syncResults[source.id]!.run.createdCount }} neu, {{ syncResults[source.id]!.run.updatedCount }} geändert,
              {{ syncResults[source.id]!.run.retiredCount }} stillgelegt, {{ syncResults[source.id]!.run.conflictCount }} Konflikte
            </p>
            <p v-if="syncResults[source.id]!.run.status !== 'succeeded'" class="mt-1 text-amber-800">
              Status: {{ RUN_STATUS_LABELS[syncResults[source.id]!.run.status] ?? syncResults[source.id]!.run.status }}
            </p>
            <div v-if="syncResults[source.id]!.conflicts.length" class="mt-3 space-y-2">
              <p class="text-[11px] text-[#7b827d]">
                Entscheidung wird vermerkt. Um die Daten tatsächlich zu ändern: Quelle/Zuordnung korrigieren und erneut synchronisieren, oder die Person manuell bearbeiten.
              </p>
              <p v-if="conflictActionError" class="text-amber-800">{{ conflictActionError }}</p>
              <IntegrationConflictList
                :conflicts="syncResults[source.id]!.conflicts" :labels="{ ...CONFLICT_KIND_LABELS, ...RESOLUTION_LABELS }"
                :busy-id="conflictBusyId" @resolve="resolveConflict"
              />
            </div>
          </div>
        </div>

        <IntegrationRunHistory v-if="historySourceId === source.id" :loading="historyLoading" :runs="historyRuns" :status-labels="RUN_STATUS_LABELS" />

        <div v-if="conflictsSourceId === source.id" class="mt-4 rounded-xl border border-[#e8e9e2] bg-[#f7f8f4] p-4 text-xs">
          <div class="mb-2 flex items-center justify-between">
            <p class="font-semibold">Konfliktliste</p>
            <label class="flex items-center gap-1.5 text-[11px]"><input v-model="showResolvedConflicts" type="checkbox" /> auch entschiedene anzeigen</label>
          </div>
          <p class="mb-2 text-[11px] text-[#7b827d]">
            Entscheidung wird vermerkt. Um die Daten tatsächlich zu ändern: Quelle/Zuordnung korrigieren und erneut synchronisieren, oder die Person manuell bearbeiten.
          </p>
          <p v-if="conflictActionError" class="mb-2 text-amber-800">{{ conflictActionError }}</p>
          <p v-if="conflictsLoading" class="text-[#7b827d]">Wird geladen …</p>
          <div v-else-if="!conflictItems.length" class="text-[#9aa096]">Keine offenen Konflikte.</div>
          <IntegrationConflictList v-else :conflicts="conflictItems" :labels="{ ...CONFLICT_KIND_LABELS, ...RESOLUTION_LABELS }" :busy-id="conflictBusyId" @resolve="resolveConflict" />
        </div>
      </section>

      <p v-if="!sources.length" class="p-8 text-center text-xs text-[#9aa096]">Noch ist keine Quelle eingerichtet.</p>
    </template>
  </div>
</template>
