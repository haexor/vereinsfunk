<script setup lang="ts">
import {
  AuditChainVerificationSchema,
  MemberSchema,
  OrganizationProfileSchema,
  ProcessingRecordSchema,
  ProcessorAgreementSchema,
  RetentionDeletionSchema,
  RetentionSettingsSchema,
  RunRetentionResponseSchema,
  SignAuditChainResponseSchema,
  type AuditChainVerification,
  type Member,
  type OrganizationProfile,
  type ProcessingRecord,
  type ProcessorAgreement,
  type ProcessorAgreementStatus,
  type RetentionDeletion,
  type RetentionSettings,
  type RunRetentionResponse,
  type SignAuditChainResponse,
} from '@vereinsfunk/contracts'

// Paket 020: Rechtliche Pflichten und Datenschutzbetrieb -- Aufbewahrung, Betroffenenanfragen-
// Verweis, Verarbeitungsdokumentation, Auftragsverarbeiter und der manipulationssichere
// Audit-Trail auf einer Seite, analog zur Struktur von einstellungen/index.vue.
const config = useRuntimeConfig()
const scope = await useScope()
const organizationId = computed(() => scope.value?.organizationId ?? null)
const canManage = computed(() => useCan('organization.manage', { organizationId: organizationId.value ?? '' }))

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')

const retentionSettings = ref<RetentionSettings | null>(null)
const deletions = ref<RetentionDeletion[]>([])
const processingRecords = ref<ProcessingRecord[]>([])
const agreements = ref<ProcessorAgreement[]>([])
const organizationProfile = ref<OrganizationProfile | null>(null)
const members = ref<Member[]>([])

async function load() {
  if (!organizationId.value || !canManage.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const base = `${config.public.apiBase}/v1/organizations/${organizationId.value}`
    const [settingsResponse, deletionsResponse, recordsResponse, agreementsResponse, profileResponse, membersResponse] = await Promise.all([
      $fetch<unknown>(`${base}/retention-settings`, { headers }),
      $fetch<unknown>(`${base}/retention-deletions`, { headers }),
      $fetch<unknown>(`${base}/processing-records`, { headers }),
      $fetch<unknown>(`${base}/processor-agreements`, { headers }),
      $fetch<unknown>(`${base}/profile`, { headers }),
      $fetch<unknown>(`${base}/members`, { headers }),
    ])
    retentionSettings.value = RetentionSettingsSchema.parse(settingsResponse)
    deletions.value = RetentionDeletionSchema.array().parse(deletionsResponse)
    processingRecords.value = ProcessingRecordSchema.array().parse(recordsResponse)
    agreements.value = ProcessorAgreementSchema.array().parse(agreementsResponse)
    organizationProfile.value = OrganizationProfileSchema.parse(profileResponse)
    members.value = MemberSchema.array().parse(membersResponse)
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
function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('de-DE') : 'nicht angegeben'
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
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/profile`, {
      method: 'PATCH',
      headers,
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
    })
    organizationProfile.value = OrganizationProfileSchema.parse(response)
  } catch (error) {
    profileSaveError.value = errorCodeOf(error) === 'invalid_responsible_person'
      ? 'Die gewählte Person ist kein aktives Mitglied dieses Vereins.'
      : 'Die Impressumsangaben konnten nicht gespeichert werden.'
  } finally {
    profileSaving.value = false
  }
}

// --- Aufbewahrungsfristen -----------------------------------------------------------------

const retentionDraft = reactive({ rawMediaDays: 90, derivativeEnabled: false, derivativeDays: 90, auditEventDays: 1095, consentEvidenceYears: 5 })
watch(retentionSettings, (value) => {
  if (!value) return
  retentionDraft.rawMediaDays = value.rawMediaDays
  retentionDraft.derivativeEnabled = value.derivativeDays !== null
  retentionDraft.derivativeDays = value.derivativeDays ?? 90
  retentionDraft.auditEventDays = value.auditEventDays
  retentionDraft.consentEvidenceYears = value.consentEvidenceYears
}, { immediate: true })

const retentionSaving = ref(false)
const retentionSaveError = ref('')
async function saveRetentionSettings() {
  if (!organizationId.value) return
  retentionSaving.value = true
  retentionSaveError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/retention-settings`, {
      method: 'PUT',
      headers,
      body: {
        rawMediaDays: retentionDraft.rawMediaDays,
        derivativeDays: retentionDraft.derivativeEnabled ? retentionDraft.derivativeDays : null,
        auditEventDays: retentionDraft.auditEventDays,
        consentEvidenceYears: retentionDraft.consentEvidenceYears,
      },
    })
    retentionSettings.value = RetentionSettingsSchema.parse(response)
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
}

const runResult = ref<RunRetentionResponse | null>(null)
const runWasDry = ref(true)
const runError = ref('')
const runningDry = ref(false)
const runningReal = ref(false)

async function runRetention(dryRun: boolean) {
  if (!organizationId.value) return
  if (!dryRun && !confirm('Diesen Lauf jetzt scharf ausführen? Rohmedien, ggf. abgeleitete Medien, alte Audit-Ereignisse und abgelaufene Token werden dabei unwiderruflich gelöscht. Das lässt sich nicht zurücknehmen.')) return
  if (dryRun) runningDry.value = true
  else runningReal.value = true
  runError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/retention/run`, { method: 'POST', headers, body: { dryRun } })
    runResult.value = RunRetentionResponseSchema.parse(response)
    runWasDry.value = dryRun
    if (!dryRun) {
      const deletionsResponse = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/retention-deletions`, { headers })
      deletions.value = RetentionDeletionSchema.array().parse(deletionsResponse)
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
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/processing-records`, {
      method: 'POST',
      headers,
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
    })
    processingRecords.value = [...processingRecords.value, ProcessingRecordSchema.parse(response)]
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
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/processing-records/${editingRecordId.value}`, {
      method: 'PATCH',
      headers,
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
    })
    const updated = ProcessingRecordSchema.parse(response)
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
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/processing-records/${record.id}`, { method: 'PATCH', headers, body: { confirmReviewed: true } })
    const updated = ProcessingRecordSchema.parse(response)
    processingRecords.value = processingRecords.value.map((item) => (item.id === updated.id ? updated : item))
  } catch {
    actionError.value = 'Die Bestätigung konnte nicht gespeichert werden.'
  } finally {
    confirmingRecordId.value = null
  }
}

// --- Auftragsverarbeiter ---------------------------------------------------------------------

const AGREEMENT_STATUS_LABELS: Record<ProcessorAgreementStatus, string> = { pending: 'Ausstehend', active: 'Aktiv', expired: 'Abgelaufen', terminated: 'Beendet' }
const AGREEMENT_STATUS_CLASSES: Record<ProcessorAgreementStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  expired: 'bg-red-100 text-red-800',
  terminated: 'bg-[#eef0ea] text-[#7b827d]',
}
const AGREEMENT_STATUS_OPTIONS: ProcessorAgreementStatus[] = ['pending', 'active', 'expired', 'terminated']

const agreementForm = reactive({ processorName: '', purpose: '', signedAt: '', validUntil: '', status: 'pending' as ProcessorAgreementStatus, file: null as File | null })
const creatingAgreement = ref(false)
const agreementCreateError = ref('')

async function createAgreement() {
  if (!organizationId.value) return
  creatingAgreement.value = true
  agreementCreateError.value = ''
  try {
    const headers = await useAuthHeader()
    let response: unknown
    if (agreementForm.file) {
      const body = new FormData()
      body.set('processorName', agreementForm.processorName)
      body.set('purpose', agreementForm.purpose)
      if (agreementForm.signedAt) body.set('signedAt', agreementForm.signedAt)
      if (agreementForm.validUntil) body.set('validUntil', agreementForm.validUntil)
      body.set('status', agreementForm.status)
      body.set('file', agreementForm.file)
      response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/processor-agreements`, { method: 'POST', headers, body })
    } else {
      response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/processor-agreements`, {
        method: 'POST',
        headers,
        body: {
          processorName: agreementForm.processorName,
          purpose: agreementForm.purpose,
          signedAt: agreementForm.signedAt || undefined,
          validUntil: agreementForm.validUntil || undefined,
          status: agreementForm.status,
        },
      })
    }
    agreements.value = [...agreements.value, ProcessorAgreementSchema.parse(response)]
    agreementForm.processorName = ''
    agreementForm.purpose = ''
    agreementForm.signedAt = ''
    agreementForm.validUntil = ''
    agreementForm.status = 'pending'
    agreementForm.file = null
  } catch {
    agreementCreateError.value = 'Die Vereinbarung konnte nicht angelegt werden.'
  } finally {
    creatingAgreement.value = false
  }
}

const changingAgreementId = ref<string | null>(null)
async function changeAgreementStatus(agreement: ProcessorAgreement, status: ProcessorAgreementStatus) {
  if (status === agreement.status) return
  changingAgreementId.value = agreement.id
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/processor-agreements/${agreement.id}`, { method: 'PATCH', headers, body: { status } })
    const updated = ProcessorAgreementSchema.parse(response)
    agreements.value = agreements.value.map((item) => (item.id === updated.id ? updated : item))
  } catch {
    actionError.value = 'Der Status konnte nicht geändert werden.'
  } finally {
    changingAgreementId.value = null
  }
}

const viewingAgreementId = ref<string | null>(null)
async function viewAgreementDocument(agreement: ProcessorAgreement) {
  viewingAgreementId.value = agreement.id
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<{ signedUrl: string }>(`${config.public.apiBase}/v1/processor-agreements/${agreement.id}/document-url`, { headers })
    window.open(response.signedUrl, '_blank', 'noopener')
  } catch {
    actionError.value = 'Das Dokument konnte nicht geöffnet werden.'
  } finally {
    viewingAgreementId.value = null
  }
}

// --- Audit-Kette -------------------------------------------------------------------------------

const auditVerification = ref<AuditChainVerification | null>(null)
const auditVerifying = ref(false)
const auditVerifyError = ref('')
async function verifyAuditChain() {
  if (!organizationId.value) return
  auditVerifying.value = true
  auditVerifyError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/audit-chain/verify`, { headers })
    auditVerification.value = AuditChainVerificationSchema.parse(response)
  } catch {
    auditVerifyError.value = 'Die Kette konnte nicht geprüft werden.'
  } finally {
    auditVerifying.value = false
  }
}

const auditSignResult = ref<SignAuditChainResponse | null>(null)
const auditSigning = ref(false)
const auditSignError = ref('')
async function signAuditChain() {
  if (!organizationId.value) return
  auditSigning.value = true
  auditSignError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/audit-chain/sign`, { method: 'POST', headers })
    auditSignResult.value = SignAuditChainResponseSchema.parse(response)
    await verifyAuditChain()
  } catch {
    auditSignError.value = 'Die Kette konnte nicht signiert werden.'
  } finally {
    auditSigning.value = false
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

      <!-- Impressumsangaben des Vereins -->
      <section class="card mb-6 p-6">
        <h2 class="mb-1 font-display text-base font-bold">Impressumsangaben des Vereins</h2>
        <p class="mb-4 text-[11px] text-[#7b827d]">
          Diese Angaben erscheinen im öffentlichen Impressum dieses Vereins —
          <NuxtLink v-if="organizationId" :to="`/impressum/${organizationId}`" target="_blank" class="font-semibold text-forest">/impressum/{{ organizationId }}</NuxtLink>,
          verlinkbar aus eurer Instagram- oder Facebook-Bio. Nicht ausgefüllte Felder erscheinen dort ehrlich als „nicht angegeben“, nicht als erfundener Platzhalter.
        </p>
        <label class="mb-4 flex items-center gap-2">
          <input v-model="profileDraft.imprintPublished" type="checkbox" />
          <span class="text-xs font-semibold">Öffentliches Impressum veröffentlichen</span>
        </label>
        <p v-if="!profileDraft.imprintPublished" class="mb-4 text-[11px] text-[#7b827d]">
          Solange diese Freigabe nicht gesetzt ist, liefert die Impressumsseite „nicht gefunden“ — die Angaben unten bleiben intern.
        </p>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Name (rechtlich)</span>
            <input v-model="profileDraft.legalName" maxlength="160" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Rechtsform</span>
            <select v-model="profileDraft.legalForm" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm">
              <option value="">Keine Angabe</option>
              <option v-for="item in LEGAL_FORMS" :key="item.id" :value="item.id">{{ item.label }}</option>
            </select>
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Land (2-stelliger Code)</span>
            <input v-model="profileDraft.countryCode" required maxlength="2" pattern="[A-Za-z]{2}" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Registergericht</span>
            <input v-model="profileDraft.registerCourt" maxlength="160" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Registernummer</span>
            <input v-model="profileDraft.registerNumber" maxlength="80" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Straße</span>
            <input v-model="profileDraft.street" maxlength="160" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Hausnummer</span>
            <input v-model="profileDraft.houseNumber" maxlength="20" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Postleitzahl</span>
            <input v-model="profileDraft.postalCode" maxlength="20" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Ort</span>
            <input v-model="profileDraft.city" maxlength="120" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Kontakt-E-Mail</span>
            <input v-model="profileDraft.contactEmail" type="email" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Telefon</span>
            <input v-model="profileDraft.contactPhone" maxlength="40" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Website</span>
            <input v-model="profileDraft.websiteUrl" type="url" placeholder="https://…" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Gründungsjahr</span>
            <input v-model="profileDraft.foundedYear" type="number" min="1800" max="2100" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Verantwortlich für den Inhalt (§ 18 Abs. 2 MStV)</span>
            <select v-model="profileDraft.responsiblePersonProfileId" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm">
              <option value="">Keine benannt</option>
              <option v-for="member in members" :key="member.userId" :value="member.userId">{{ member.displayName }}</option>
            </select>
          </label>
        </div>
        <p v-if="profileSaveError" class="mt-3 text-xs text-amber-800">{{ profileSaveError }}</p>
        <button type="button" :disabled="profileSaving" class="focus-ring mt-4 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="saveProfile">
          {{ profileSaving ? 'Wird gespeichert …' : 'Speichern' }}
        </button>
      </section>

      <!-- Aufbewahrungsfristen -->
      <section class="card mb-6 p-6">
        <h2 class="mb-1 font-display text-base font-bold">Aufbewahrungsfristen</h2>
        <p class="mb-4 text-[11px] text-[#7b827d]">Diese Fristen setzt der Löschlauf durch — nicht der Vorsatz, sie einzuhalten.</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <label><span class="mb-1 block text-xs font-semibold">Rohmedien (Tage)</span>
            <input v-model.number="retentionDraft.rawMediaDays" type="number" min="7" max="730" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
            <span class="mt-1 block text-[10px] text-[#9aa096]">7 bis 730 Tage.</span>
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Audit-Ereignisse (Tage)</span>
            <input v-model.number="retentionDraft.auditEventDays" type="number" min="365" max="3650" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
            <span class="mt-1 block text-[10px] text-[#9aa096]">365 bis 3650 Tage. Ereignisse zu Einwilligungen, Widerrufen und Elternkontakten sind ausgenommen und folgen der Nachweisfrist rechts.</span>
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Nachweisfrist für Einwilligungen (Jahre)</span>
            <input v-model.number="retentionDraft.consentEvidenceYears" type="number" min="1" max="30" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
            <span class="mt-1 block text-[10px] text-[#9aa096]">1 bis 30 Jahre, gerechnet ab Ende der Gültigkeit einer Einwilligung.</span>
          </label>
          <div>
            <label class="flex items-center gap-2"><input v-model="retentionDraft.derivativeEnabled" type="checkbox" /> <span class="text-xs font-semibold">Abgeleitete Medien automatisch löschen</span></label>
            <input v-if="retentionDraft.derivativeEnabled" v-model.number="retentionDraft.derivativeDays" type="number" min="30" max="3650" class="focus-ring mt-2 w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
            <span class="mt-1 block text-[10px] text-[#9aa096]">
              Standardmäßig deaktiviert: Zuschnitte und Re-Encodes werden in veröffentlichten Beiträgen weiterverwendet und sollen nicht versehentlich verschwinden. Nur Rohmedien haben eine Pflichtfrist, weil sie die sensibleren Originale sind — ob abgeleitete Medien überhaupt automatisch gelöscht werden, ist eine bewusste Vereinsentscheidung (30 bis 3650 Tage, falls aktiviert).
            </span>
          </div>
        </div>
        <p v-if="retentionSaveError" class="mt-3 text-xs text-amber-800">{{ retentionSaveError }}</p>
        <button type="button" :disabled="retentionSaving" class="focus-ring mt-4 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="saveRetentionSettings">
          {{ retentionSaving ? 'Wird gespeichert …' : 'Speichern' }}
        </button>
      </section>

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

      <!-- Auftragsverarbeiter -->
      <section class="card mb-6 p-6">
        <h2 class="mb-1 font-display text-base font-bold">Auftragsverarbeiter</h2>
        <p class="mb-4 text-[11px] text-[#7b827d]">Supabase, Hosting, E-Mail-Versand, LLM-Anbieter, Meta und ggf. Quellsysteme — jeweils mit dem eigenen Vertrag, falls vorhanden.</p>

        <ul class="mb-4 space-y-2">
          <li v-for="agreement in agreements" :key="agreement.id" class="rounded-lg bg-[#f7f8f4] px-3 py-2.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="text-sm font-semibold">{{ agreement.processorName }}</p>
                <p class="text-[11px] text-[#9aa096]">{{ agreement.purpose }}</p>
              </div>
              <span class="rounded-full px-2.5 py-1 text-[10px] font-bold" :class="AGREEMENT_STATUS_CLASSES[agreement.status]">{{ AGREEMENT_STATUS_LABELS[agreement.status] }}</span>
            </div>
            <p class="mt-1.5 text-[11px] text-[#9aa096]">
              Unterzeichnet: {{ formatDate(agreement.signedAt) }} · Gültig bis: {{ formatDate(agreement.validUntil) }} ·
              {{ agreement.hasDocument ? 'Dokument hinterlegt' : 'Kein Dokument hinterlegt' }}
            </p>
            <label class="mt-2 inline-flex items-center gap-2 text-[11px]">
              <span class="font-semibold">Status ändern:</span>
              <select
                :value="agreement.status"
                :disabled="changingAgreementId === agreement.id"
                class="focus-ring rounded-lg border border-[#dfe0d9] p-1.5 text-[11px]"
                @change="changeAgreementStatus(agreement, ($event.target as HTMLSelectElement).value as typeof agreement.status)"
              >
                <option v-for="option in AGREEMENT_STATUS_OPTIONS" :key="option" :value="option">{{ AGREEMENT_STATUS_LABELS[option] }}</option>
              </select>
            </label>
            <button
              v-if="agreement.hasDocument"
              type="button"
              :disabled="viewingAgreementId === agreement.id"
              class="focus-ring ml-3 mt-2 rounded-lg border border-[#dfe0d9] px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
              @click="viewAgreementDocument(agreement)"
            >
              {{ viewingAgreementId === agreement.id ? 'Öffnet …' : 'Dokument ansehen' }}
            </button>
          </li>
          <li v-if="!agreements.length" class="text-xs text-[#9aa096]">Noch kein Auftragsverarbeiter erfasst.</li>
        </ul>

        <h3 class="mb-3 mt-4 text-xs font-bold uppercase tracking-wide text-[#7b827d]">Neu anlegen</h3>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="createAgreement">
          <label><span class="mb-1 block text-xs font-semibold">Name</span>
            <input v-model="agreementForm.processorName" required maxlength="200" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Zweck</span>
            <input v-model="agreementForm.purpose" required maxlength="300" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Unterzeichnet am</span>
            <input v-model="agreementForm.signedAt" type="date" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Gültig bis</span>
            <input v-model="agreementForm.validUntil" type="date" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Status</span>
            <select v-model="agreementForm.status" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm">
              <option v-for="option in AGREEMENT_STATUS_OPTIONS" :key="option" :value="option">{{ AGREEMENT_STATUS_LABELS[option] }}</option>
            </select>
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Vertragsdokument (PDF oder DOCX, optional)</span>
            <input type="file" accept=".pdf,.docx" class="focus-ring w-full text-xs" @change="agreementForm.file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
          </label>
          <div class="sm:col-span-2">
            <p v-if="agreementCreateError" class="mb-2 text-xs text-amber-800">{{ agreementCreateError }}</p>
            <button type="submit" :disabled="creatingAgreement" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
              {{ creatingAgreement ? 'Wird angelegt …' : 'Anlegen' }}
            </button>
          </div>
        </form>
      </section>

      <!-- Audit-Kette -->
      <section class="card p-6">
        <h2 class="mb-1 font-display text-base font-bold">Manipulationssicherer Audit-Trail</h2>
        <p class="mb-4 text-[11px] text-[#7b827d]">Rollen- und Mitgliedschaftsänderungen sind als Hash-Kette verkettet. Signieren macht den aktuellen Kettenkopf mit einem Schlüssel außerhalb der Datenbank nachweisbar.</p>

        <div class="flex flex-wrap gap-2">
          <button type="button" :disabled="auditVerifying" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold disabled:opacity-60" @click="verifyAuditChain">
            {{ auditVerifying ? 'Wird geprüft …' : 'Kette prüfen' }}
          </button>
          <button type="button" :disabled="auditSigning" class="focus-ring rounded-lg bg-forest px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60" @click="signAuditChain">
            {{ auditSigning ? 'Wird signiert …' : 'Jetzt signieren' }}
          </button>
        </div>
        <p v-if="auditVerifyError" class="mt-3 text-xs text-amber-800">{{ auditVerifyError }}</p>
        <p v-if="auditSignError" class="mt-3 text-xs text-amber-800">{{ auditSignError }}</p>

        <div v-if="auditVerification" class="mt-4 rounded-xl p-4" :class="auditVerification.tamperedCount > 0 ? 'bg-red-50' : 'bg-[#f4f5ef]'">
          <p v-if="auditVerification.tamperedCount > 0" class="text-sm font-bold text-red-800">Manipulation erkannt: {{ auditVerification.tamperedCount }} von {{ auditVerification.checkedCount }} geprüften Ereignissen weichen von der erwarteten Kette ab.</p>
          <p v-else class="text-sm font-semibold text-ink">Keine Manipulation erkannt — {{ auditVerification.checkedCount }} Ereignisse geprüft.</p>
          <p v-if="auditVerification.unlinkedCount > 0" class="mt-1 text-[11px] text-[#7b827d]">{{ auditVerification.unlinkedCount }} Ereignisse sind nicht verkettet — das ist nach einer regulären Aufbewahrungslöschung normal und kein Alarmsignal für sich.</p>
          <p class="mt-1 text-[11px] text-[#9aa096]">Zuletzt signiert: {{ formatDateTime(auditVerification.lastSignedAt) }}</p>
        </div>

        <div v-if="auditSignResult" class="mt-4 rounded-xl bg-[#f4f5ef] p-4 text-[11px] text-[#43483f]">
          <p class="font-semibold text-ink">Signatur hinterlegt</p>
          <p class="mt-1">{{ auditSignResult.eventCount }} Ereignisse, Schlüsselversion {{ auditSignResult.keyVersion }}, signiert am {{ formatDateTime(auditSignResult.signedAt) }}.</p>
        </div>
      </section>
    </template>
  </div>
</template>
