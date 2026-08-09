<script setup lang="ts">
import {
  MemberSchema,
  OrganizationProfileSchema,
  ProcessingRecordSchema,
  RetentionDeletionSchema,
  RetentionSettingsSchema,
  RunRetentionResponseSchema,
  type Member,
  type OrganizationProfile,
  type ProcessingRecord,
  type RetentionDeletion,
  type RetentionSettings,
  type RunRetentionResponse,
} from '@vereinsfunk/contracts'

// Paket 020: Rechtliche Pflichten und Datenschutzbetrieb -- Aufbewahrung, Betroffenenanfragen-
// Verweis, Verarbeitungsdokumentation, Auftragsverarbeiter und der manipulationssichere
// Audit-Trail auf einer Seite, analog zur Struktur von einstellungen/index.vue.
const api = useApiClient()
const scope = await useScope()
const organizationId = computed(() => scope.value?.organizationId ?? null)
const canManage = computed(() => useCan('organization.manage', { organizationId: organizationId.value ?? '' }))

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')

const retentionSettings = ref<RetentionSettings | null>(null)
const deletions = ref<RetentionDeletion[]>([])
const processingRecords = ref<ProcessingRecord[]>([])
const organizationProfile = ref<OrganizationProfile | null>(null)
const members = ref<Member[]>([])

async function load() {
  if (!organizationId.value || !canManage.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const [settingsResponse, deletionsResponse, recordsResponse, profileResponse, membersResponse] = await Promise.all([
      api.request(`/v1/organizations/${organizationId.value}/retention-settings`, {}, RetentionSettingsSchema),
      api.request(`/v1/organizations/${organizationId.value}/retention-deletions`, {}, RetentionDeletionSchema.array()),
      api.request(`/v1/organizations/${organizationId.value}/processing-records`, {}, ProcessingRecordSchema.array()),
      api.request(`/v1/organizations/${organizationId.value}/profile`, {}, OrganizationProfileSchema),
      api.request(`/v1/organizations/${organizationId.value}/members`, {}, MemberSchema.array()),
    ])
    retentionSettings.value = settingsResponse
    deletions.value = deletionsResponse
    processingRecords.value = recordsResponse
    organizationProfile.value = profileResponse
    members.value = membersResponse
  } catch {
    errorMessage.value = 'Die rechtlichen Einstellungen konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()
watch(organizationId, () => { void load() })

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('de-DE') : 'nicht angegeben'
}
function errorCodeOf(error: unknown): string | undefined {
  return (error as { data?: { error?: string } })?.data?.error
}
function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// --- Impressumsangaben des Vereins -----------------------------------------------------------

const LEGAL_FORMS: { id: NonNullable<OrganizationProfile['legalForm']>; label: string }[] = [
  { id: 'e_v', label: 'eingetragener Verein (e. V.)' },
  { id: 'gmbh', label: 'GmbH' },
  { id: 'gugmbh', label: 'gemeinnützige UG (haftungsbeschränkt)' },
  { id: 'ggmbh', label: 'gemeinnützige GmbH' },
  { id: 'nicht_eingetragen', label: 'nicht eingetragener Verein' },
  { id: 'sonstige', label: 'Sonstige' },
]

const profileDraft = reactive({
  legalName: '',
  legalForm: '' as '' | NonNullable<OrganizationProfile['legalForm']>,
  registerCourt: '',
  registerNumber: '',
  street: '',
  houseNumber: '',
  postalCode: '',
  city: '',
  countryCode: 'DE',
  contactEmail: '',
  contactPhone: '',
  websiteUrl: '',
  foundedYear: '',
  responsiblePersonProfileId: '',
  imprintPublished: false,
})
watch(organizationProfile, (profile) => {
  if (!profile) return
  profileDraft.legalName = profile.legalName ?? ''
  profileDraft.legalForm = profile.legalForm ?? ''
  profileDraft.registerCourt = profile.registerCourt ?? ''
  profileDraft.registerNumber = profile.registerNumber ?? ''
  profileDraft.street = profile.street ?? ''
  profileDraft.houseNumber = profile.houseNumber ?? ''
  profileDraft.postalCode = profile.postalCode ?? ''
  profileDraft.city = profile.city ?? ''
  profileDraft.countryCode = profile.countryCode
  profileDraft.contactEmail = profile.contactEmail ?? ''
  profileDraft.contactPhone = profile.contactPhone ?? ''
  profileDraft.websiteUrl = profile.websiteUrl ?? ''
  profileDraft.foundedYear = profile.foundedYear ? String(profile.foundedYear) : ''
  profileDraft.responsiblePersonProfileId = profile.responsiblePersonProfileId ?? ''
  profileDraft.imprintPublished = profile.imprintPublished
}, { immediate: true })

const profileSaving = ref(false)
const profileSaveError = ref('')
async function saveProfile() {
  if (!organizationId.value) return
  profileSaving.value = true
  profileSaveError.value = ''
  try {
    organizationProfile.value = await api.request(`/v1/organizations/${organizationId.value}/profile`, {
      method: 'PATCH',
      body: {
        legalName: blankToNull(profileDraft.legalName),
        legalForm: profileDraft.legalForm || null,
        registerCourt: blankToNull(profileDraft.registerCourt),
        registerNumber: blankToNull(profileDraft.registerNumber),
        street: blankToNull(profileDraft.street),
        houseNumber: blankToNull(profileDraft.houseNumber),
        postalCode: blankToNull(profileDraft.postalCode),
        city: blankToNull(profileDraft.city),
        countryCode: profileDraft.countryCode.trim().toUpperCase(),
        contactEmail: blankToNull(profileDraft.contactEmail),
        contactPhone: blankToNull(profileDraft.contactPhone),
        websiteUrl: blankToNull(profileDraft.websiteUrl),
        foundedYear: profileDraft.foundedYear.trim() ? Number(profileDraft.foundedYear) : null,
        responsiblePersonProfileId: profileDraft.responsiblePersonProfileId || null,
        imprintPublished: profileDraft.imprintPublished,
      },
    }, OrganizationProfileSchema)
  } catch (error) {
    profileSaveError.value = errorCodeOf(error) === 'invalid_responsible_person'
      ? 'Die gewählte Person ist kein aktives Mitglied dieses Vereins.'
      : 'Die Impressumsangaben konnten nicht gespeichert werden.'
  } finally {
    profileSaving.value = false
  }
}

// --- Aufbewahrungsfristen -----------------------------------------------------------------

const retentionDraft = reactive({ rawMediaDays: 90, derivativeEnabled: false, derivativeDays: 90, auditEventDays: 1095, consentEvidenceYears: 5, statusEventDays: 730 })
watch(retentionSettings, (value) => {
  if (!value) return
  retentionDraft.rawMediaDays = value.rawMediaDays
  retentionDraft.derivativeEnabled = value.derivativeDays !== null
  retentionDraft.derivativeDays = value.derivativeDays ?? 90
  retentionDraft.auditEventDays = value.auditEventDays
  retentionDraft.consentEvidenceYears = value.consentEvidenceYears
  // Paket 016: Statushistorie (post_status_events) fuer die Durchlaufzeit-Messung.
  retentionDraft.statusEventDays = value.statusEventDays
}, { immediate: true })

const retentionSaving = ref(false)
const retentionSaveError = ref('')
async function saveRetentionSettings() {
  if (!organizationId.value) return
  retentionSaving.value = true
  retentionSaveError.value = ''
  try {
    retentionSettings.value = await api.request(`/v1/organizations/${organizationId.value}/retention-settings`, {
      method: 'PUT',
      body: {
        rawMediaDays: retentionDraft.rawMediaDays,
        derivativeDays: retentionDraft.derivativeEnabled ? retentionDraft.derivativeDays : null,
        auditEventDays: retentionDraft.auditEventDays,
        consentEvidenceYears: retentionDraft.consentEvidenceYears,
        statusEventDays: retentionDraft.statusEventDays,
      },
    }, RetentionSettingsSchema)
  } catch {
    retentionSaveError.value = 'Die Aufbewahrungsfristen konnten nicht gespeichert werden.'
  } finally {
    retentionSaving.value = false
  }
}

// --- Retention-Lauf -------------------------------------------------------------------------

const RULE_KEY_LABELS: Record<string, string> = {
  raw_media: 'Rohmedien',
  media_derivatives: 'Abgeleitete Medien (Zuschnitte, Re-Encodes)',
  audit_events: 'Audit-Ereignisse',
  expired_tokens: 'Abgelaufene Einladungen, Anfragen und Freigabelinks',
  status_events: 'Statushistorie (Auswertung)',
}

const runResult = ref<RunRetentionResponse | null>(null)
const runWasDry = ref(true)
const runError = ref('')
const runningDry = ref(false)
const runningReal = ref(false)

async function runRetention(dryRun: boolean) {
  if (!organizationId.value) return
  if (!dryRun && !confirm('Diesen Lauf jetzt scharf ausführen? Rohmedien, ggf. abgeleitete Medien, alte Audit-Ereignisse, abgelaufene Token und alte Statushistorie werden dabei unwiderruflich gelöscht. Das lässt sich nicht zurücknehmen.')) return
  if (dryRun) runningDry.value = true
  else runningReal.value = true
  runError.value = ''
  try {
    runResult.value = await api.request(`/v1/organizations/${organizationId.value}/retention/run`, { method: 'POST', body: { dryRun } }, RunRetentionResponseSchema)
    runWasDry.value = dryRun
    if (!dryRun) {
      deletions.value = await api.request(`/v1/organizations/${organizationId.value}/retention-deletions`, {}, RetentionDeletionSchema.array())
    }
  } catch {
    runError.value = 'Der Lauf konnte nicht ausgeführt werden.'
  } finally {
    runningDry.value = false
    runningReal.value = false
  }
}

// --- Verarbeitungsdokumentation --------------------------------------------------------------

function splitList(text: string): string[] {
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}
function emptyRecordForm() {
  return { purpose: '', legalBasis: '', dataCategoriesText: '', subjectCategoriesText: '', recipientsText: '', thirdCountryTransfer: false, transferSafeguard: '', retentionNote: '' }
}

const newRecordForm = reactive(emptyRecordForm())
const creatingRecord = ref(false)
const recordCreateError = ref('')

async function createProcessingRecord() {
  if (!organizationId.value) return
  creatingRecord.value = true
  recordCreateError.value = ''
  try {
    const record = await api.request(`/v1/organizations/${organizationId.value}/processing-records`, {
      method: 'POST',
      body: {
        purpose: newRecordForm.purpose,
        legalBasis: newRecordForm.legalBasis,
        dataCategories: splitList(newRecordForm.dataCategoriesText),
        subjectCategories: splitList(newRecordForm.subjectCategoriesText),
        recipients: splitList(newRecordForm.recipientsText),
        thirdCountryTransfer: newRecordForm.thirdCountryTransfer,
        transferSafeguard: newRecordForm.thirdCountryTransfer ? (newRecordForm.transferSafeguard.trim() || null) : null,
        retentionNote: newRecordForm.retentionNote,
      },
    }, ProcessingRecordSchema)
    processingRecords.value = [...processingRecords.value, record]
    Object.assign(newRecordForm, emptyRecordForm())
  } catch {
    recordCreateError.value = 'Die Verarbeitung konnte nicht angelegt werden.'
  } finally {
    creatingRecord.value = false
  }
}

const editingRecordId = ref<string | null>(null)
const editRecordForm = reactive(emptyRecordForm())
const editRecordError = ref('')
const editRecordSaving = ref(false)

function startEditRecord(record: ProcessingRecord) {
  editingRecordId.value = record.id
  editRecordForm.purpose = record.purpose
  editRecordForm.legalBasis = record.legalBasis
  editRecordForm.dataCategoriesText = record.dataCategories.join(', ')
  editRecordForm.subjectCategoriesText = record.subjectCategories.join(', ')
  editRecordForm.recipientsText = record.recipients.join(', ')
  editRecordForm.thirdCountryTransfer = record.thirdCountryTransfer
  editRecordForm.transferSafeguard = record.transferSafeguard ?? ''
  editRecordForm.retentionNote = record.retentionNote
  editRecordError.value = ''
}
function cancelEditRecord() {
  editingRecordId.value = null
}
async function saveEditRecord() {
  if (!editingRecordId.value) return
  editRecordSaving.value = true
  editRecordError.value = ''
  try {
    const updated = await api.request(`/v1/processing-records/${editingRecordId.value}`, {
      method: 'PATCH',
      body: {
        purpose: editRecordForm.purpose,
        legalBasis: editRecordForm.legalBasis,
        dataCategories: splitList(editRecordForm.dataCategoriesText),
        subjectCategories: splitList(editRecordForm.subjectCategoriesText),
        recipients: splitList(editRecordForm.recipientsText),
        thirdCountryTransfer: editRecordForm.thirdCountryTransfer,
        transferSafeguard: editRecordForm.thirdCountryTransfer ? (editRecordForm.transferSafeguard.trim() || null) : null,
        retentionNote: editRecordForm.retentionNote,
      },
    }, ProcessingRecordSchema)
    processingRecords.value = processingRecords.value.map((item) => (item.id === updated.id ? updated : item))
    editingRecordId.value = null
  } catch {
    editRecordError.value = 'Die Änderung konnte nicht gespeichert werden.'
  } finally {
    editRecordSaving.value = false
  }
}

const confirmingRecordId = ref<string | null>(null)
async function confirmRecord(record: ProcessingRecord) {
  confirmingRecordId.value = record.id
  actionError.value = ''
  try {
    const updated = await api.request(`/v1/processing-records/${record.id}`, { method: 'PATCH', body: { confirmReviewed: true } }, ProcessingRecordSchema)
    processingRecords.value = processingRecords.value.map((item) => (item.id === updated.id ? updated : item))
  } catch {
    actionError.value = 'Die Bestätigung konnte nicht gespeichert werden.'
  } finally {
    confirmingRecordId.value = null
  }
}

</script>

<template>
  <div class="mx-auto max-w-[980px] px-5 py-8 sm:px-10">
    <header class="mb-8">
      <div class="eyebrow mb-3">Verein</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Recht &amp; Datenschutz</h1>
      <p class="mt-2 text-sm text-[#727a75]">Aufbewahrungsfristen, Löschläufe, Verarbeitungsdokumentation, Auftragsverarbeiter und der manipulationssichere Audit-Trail.</p>
      <p class="mt-3 text-xs text-[#9aa096]">Betroffenenanfragen (Auskunft, Löschung, Berichtigung) werden auf einer eigenen Seite bearbeitet: <NuxtLink to="/datenschutz/anfragen" class="focus-ring font-semibold text-forest">Betroffenenanfragen</NuxtLink>.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <div v-else-if="!canManage" class="card p-8 text-center text-sm text-[#7b827d]">
      Du hast hier keine Berechtigung. Das übernimmt der Vereinsadmin.
    </div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else>
      <p v-if="actionError" class="mb-4 text-sm text-amber-800">{{ actionError }}</p>

      <LegalOrganizationProfileForm :organization-id="organizationId" :members="members" :profile-draft="profileDraft" :legal-forms="LEGAL_FORMS" :saving="profileSaving" :error="profileSaveError" @save="saveProfile" />

      <RetentionSettingsForm :draft="retentionDraft" :saving="retentionSaving" :error="retentionSaveError" @save="saveRetentionSettings" />

      <!-- Retention-Lauf -->
      <section class="card mb-6 p-6">
        <h2 class="mb-1 font-display text-base font-bold">Löschlauf</h2>
        <p class="mb-4 text-[11px] text-[#7b827d]">Es läuft noch kein automatischer Job dafür — der Lauf muss hier ausgelöst werden. Vor dem ersten scharfen Lauf lohnt sich ein Testlauf.</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" :disabled="runningDry || runningReal" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold disabled:opacity-60" @click="runRetention(true)">
            {{ runningDry ? 'Wird ausgeführt …' : 'Testlauf ansehen' }}
          </button>
          <button type="button" :disabled="runningDry || runningReal" class="focus-ring rounded-lg border border-amber-300 px-3 py-2 text-[11px] font-semibold text-amber-800 disabled:opacity-60" @click="runRetention(false)">
            {{ runningReal ? 'Wird ausgeführt …' : 'Jetzt scharf ausführen' }}
          </button>
        </div>
        <p v-if="runError" class="mt-3 text-xs text-amber-800">{{ runError }}</p>

        <div v-if="runResult" class="mt-4 rounded-xl p-4" :class="runWasDry ? 'bg-[#f4f5ef]' : 'bg-amber-50'">
          <p class="text-xs font-semibold" :class="runWasDry ? 'text-ink' : 'text-amber-900'">
            {{ runWasDry ? 'Testlauf — es wurde nichts gelöscht' : 'Scharf ausgeführt' }}
          </p>
          <ul class="mt-2 space-y-1 text-xs text-[#43483f]">
            <li v-for="result in runResult.results" :key="result.ruleKey">
              {{ RULE_KEY_LABELS[result.ruleKey] ?? result.ruleKey }}: {{ result.entityCount }} {{ runWasDry ? 'würden gelöscht (Stichtag' : 'gelöscht (Stichtag' }} {{ formatDate(result.cutoffDate) }})
            </li>
          </ul>
        </div>

        <h3 class="mb-1 mt-6 text-xs font-bold uppercase tracking-wide text-[#7b827d]">Löschprotokoll</h3>
        <p class="mb-3 text-[11px] text-[#9aa096]">Nur tatsächliche Läufe — zählt, was gelöscht wurde, nennt keine Namen oder IDs.</p>
        <ul class="space-y-1.5">
          <li v-for="(entry, index) in deletions" :key="index" class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f7f8f4] px-3 py-2 text-xs">
            <span>{{ RULE_KEY_LABELS[entry.ruleKey] ?? entry.ruleKey }} — {{ entry.entityCount }} gelöscht</span>
            <span class="text-[#9aa096]">Stichtag {{ formatDate(entry.cutoffDate) }}</span>
          </li>
          <li v-if="!deletions.length" class="text-xs text-[#9aa096]">Noch kein scharfer Lauf protokolliert.</li>
        </ul>
      </section>

      <!-- Verarbeitungsdokumentation -->
      <section class="card mb-6 p-6">
        <h2 class="mb-1 font-display text-base font-bold">Verarbeitungsdokumentation</h2>
        <p class="mb-4 text-[11px] text-[#7b827d]">Bei Vereinsanlage automatisch als Entwurf angelegt — bitte durch den Verein bestätigen oder anpassen.</p>

        <div v-for="record in processingRecords" :key="record.id" class="mb-4 rounded-xl border border-[#e8e9e2] p-4">
          <template v-if="editingRecordId === record.id">
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Zweck</span>
                <input v-model="editRecordForm.purpose" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
              </label>
              <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Rechtsgrundlage</span>
                <textarea v-model="editRecordForm.legalBasis" rows="2" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
              </label>
              <label><span class="mb-1 block text-xs font-semibold">Datenkategorien (kommagetrennt)</span>
                <input v-model="editRecordForm.dataCategoriesText" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
              </label>
              <label><span class="mb-1 block text-xs font-semibold">Betroffenenkategorien (kommagetrennt)</span>
                <input v-model="editRecordForm.subjectCategoriesText" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
              </label>
              <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Empfänger (kommagetrennt)</span>
                <input v-model="editRecordForm.recipientsText" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
              </label>
              <label class="flex items-center gap-2 sm:col-span-2"><input v-model="editRecordForm.thirdCountryTransfer" type="checkbox" /> <span class="text-sm">Übermittlung in Drittländer</span></label>
              <label v-if="editRecordForm.thirdCountryTransfer" class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Garantie/Schutzmaßnahme</span>
                <input v-model="editRecordForm.transferSafeguard" required class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
              </label>
              <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Aufbewahrung</span>
                <input v-model="editRecordForm.retentionNote" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
              </label>
            </div>
            <p v-if="editRecordError" class="mt-2 text-xs text-amber-800">{{ editRecordError }}</p>
            <div class="mt-3 flex gap-2">
              <button type="button" :disabled="editRecordSaving" class="focus-ring rounded-lg bg-forest px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60" @click="saveEditRecord">
                {{ editRecordSaving ? 'Wird gespeichert …' : 'Speichern' }}
              </button>
              <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold" @click="cancelEditRecord">Abbrechen</button>
            </div>
          </template>
          <template v-else>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold">{{ record.purpose }}</p>
                <p class="mt-1 text-[11px] text-[#9aa096]">{{ record.legalBasis }}</p>
              </div>
              <span v-if="!record.reviewedAt" class="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">Entwurf, bitte bestätigen</span>
              <span v-else class="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-800">Bestätigt am {{ formatDate(record.reviewedAt) }}</span>
            </div>
            <dl class="mt-2 space-y-1 text-[11px] text-[#7b827d]">
              <div v-if="record.dataCategories.length"><span class="font-semibold">Daten:</span> {{ record.dataCategories.join(', ') }}</div>
              <div v-if="record.subjectCategories.length"><span class="font-semibold">Betroffene:</span> {{ record.subjectCategories.join(', ') }}</div>
              <div v-if="record.recipients.length"><span class="font-semibold">Empfänger:</span> {{ record.recipients.join(', ') }}</div>
              <div v-if="record.thirdCountryTransfer"><span class="font-semibold">Drittlandübermittlung:</span> {{ record.transferSafeguard ?? 'keine Garantie angegeben' }}</div>
              <div><span class="font-semibold">Aufbewahrung:</span> {{ record.retentionNote }}</div>
            </dl>
            <div class="mt-3 flex gap-2">
              <button v-if="!record.reviewedAt" type="button" :disabled="confirmingRecordId === record.id" class="focus-ring rounded-lg bg-forest px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60" @click="confirmRecord(record)">
                {{ confirmingRecordId === record.id ? 'Wird bestätigt …' : 'Bestätigen' }}
              </button>
              <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold" @click="startEditRecord(record)">Bearbeiten</button>
            </div>
          </template>
        </div>
        <p v-if="!processingRecords.length" class="text-xs text-[#9aa096]">Noch keine Verarbeitung dokumentiert.</p>

        <h3 class="mb-3 mt-6 text-xs font-bold uppercase tracking-wide text-[#7b827d]">Neue Verarbeitung anlegen</h3>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="createProcessingRecord">
          <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Zweck</span>
            <input v-model="newRecordForm.purpose" required maxlength="300" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Rechtsgrundlage</span>
            <textarea v-model="newRecordForm.legalBasis" required rows="2" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Datenkategorien (kommagetrennt)</span>
            <input v-model="newRecordForm.dataCategoriesText" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Betroffenenkategorien (kommagetrennt)</span>
            <input v-model="newRecordForm.subjectCategoriesText" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Empfänger (kommagetrennt)</span>
            <input v-model="newRecordForm.recipientsText" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label class="flex items-center gap-2 sm:col-span-2"><input v-model="newRecordForm.thirdCountryTransfer" type="checkbox" /> <span class="text-sm">Übermittlung in Drittländer</span></label>
          <label v-if="newRecordForm.thirdCountryTransfer" class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Garantie/Schutzmaßnahme</span>
            <input v-model="newRecordForm.transferSafeguard" required class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Aufbewahrung</span>
            <input v-model="newRecordForm.retentionNote" required class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <div class="sm:col-span-2">
            <p v-if="recordCreateError" class="mb-2 text-xs text-amber-800">{{ recordCreateError }}</p>
            <button type="submit" :disabled="creatingRecord" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
              {{ creatingRecord ? 'Wird angelegt …' : 'Anlegen' }}
            </button>
          </div>
        </form>
      </section>

      <ProcessorAgreements :organization-id="organizationId" />

      <LegalAuditChain :organization-id="organizationId" />
    </template>
  </div>
</template>
