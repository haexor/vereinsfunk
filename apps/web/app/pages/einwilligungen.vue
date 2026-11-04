<script setup lang="ts">
import {
  ConsentRecordSchema,
  ConsentRequestSchema,
  DirectoryPersonSchema,
  type ConsentRecord,
  type ConsentRequest,
  type ConsentStatus,
  type DirectoryPerson,
} from '@vereinsfunk/contracts'
import { ApiRequestError } from '../utils/apiClient'
import { CONSENT_PURPOSE_OPTIONS, PURPOSE_REQUIRED_MESSAGE } from '../utils/consentPurposes'

const api = useApiClient()
const { organizationId, organization } = await useActiveScope()

const canManageOrgWide = computed(() => useCan('consent.manage', { organizationId: organizationId.value ?? '' }))
function canManageDepartment(departmentId: string): boolean {
  return canManageOrgWide.value || useCan('consent.manage', { organizationId: organizationId.value ?? '', departmentId })
}
const manageableDepartments = computed(() => (organization.value?.departments ?? []).filter((department) => canManageDepartment(department.id)))
const canAccessPage = computed(() => canManageOrgWide.value || manageableDepartments.value.length > 0)

const filterDepartmentId = ref('')
watch(
  manageableDepartments,
  (list) => {
    if (canManageOrgWide.value) return
    if (!list.some((department) => department.id === filterDepartmentId.value)) filterDepartmentId.value = list[0]?.id ?? ''
  },
  { immediate: true },
)
const filterDepartmentIdModel = computed({
  get: () => filterDepartmentId.value || '__none__',
  set: (v: string) => { filterDepartmentId.value = v === '__none__' ? '' : v },
})

const loading = ref(true)
const errorMessage = ref('')
const consents = ref<ConsentRecord[]>([])
const requests = ref<ConsentRequest[]>([])
const people = ref<DirectoryPerson[]>([])

// Nur der zuletzt gestartete Lauf darf schreiben -- auch im Fehlerfall: ein frueher gestarteter
// Lauf fuer eine vorige Verein-/Abteilungsauswahl ueberschriebe sonst deren Ergebnisse oder setzte
// eine Fehlermeldung ueber die bereits geladenen aktuellen Daten.
const { ready } = useScopedLoad(
  () => (organizationId.value ? `${organizationId.value}:${filterDepartmentId.value}` : null),
  async (_key, isLatest) => {
    const currentOrganizationId = organizationId.value
    if (!currentOrganizationId) { loading.value = false; return }
    // undefined faellt aus der Query heraus: ohne Abteilung gilt der ganze Verein.
    const departmentId = filterDepartmentId.value || undefined
    loading.value = true
    errorMessage.value = ''
    try {
      const [loadedConsents, loadedRequests, loadedPeople] = await Promise.all([
        api.request('/v1/consents', { query: { organizationId: currentOrganizationId, departmentId } }, ConsentRecordSchema.array()),
        api.request('/v1/consent-requests', { query: { organizationId: currentOrganizationId, departmentId } }, ConsentRequestSchema.array()),
        api.request(`/v1/organizations/${currentOrganizationId}/directory-people`, { query: { departmentId } }, DirectoryPersonSchema.array()),
      ])
      if (!isLatest()) return
      consents.value = loadedConsents
      requests.value = loadedRequests
      people.value = loadedPeople
    } catch {
      if (isLatest()) errorMessage.value = 'Die Einwilligungen konnten nicht geladen werden.'
    } finally {
      if (isLatest()) loading.value = false
    }
  },
)
await ready

const STATUS_LABELS: Record<ConsentStatus, string> = {
  valid: 'Gültig', expiring_soon: 'Läuft ab', expired: 'Abgelaufen', revoked: 'Widerrufen',
  not_yet_valid: 'Noch nicht gültig', guardian_missing: 'Bestätigung fehlt', superseded: 'Abgelöst',
  imported_unverified: 'Nur Hinweis aus Quellsystem',
}
const STATUS_COLORS: Record<ConsentStatus, string> = {
  valid: 'bg-emerald-100 text-emerald-800', expiring_soon: 'bg-amber-100 text-amber-800', expired: 'bg-red-100 text-red-800',
  revoked: 'bg-red-100 text-red-800', not_yet_valid: 'bg-[#eef1ea] text-[#3d453f]', guardian_missing: 'bg-amber-100 text-amber-800',
  superseded: 'bg-[#eef1ea] text-[#6c756f]', imported_unverified: 'bg-[#eef1ea] text-[#6c756f]',
}
const ORIGIN_LABELS: Record<ConsentRecord['origin'], string> = { paper: 'Papiererklärung', digital: 'Digital erteilt', imported: 'Aus Quellsystem' }

function newestFirst<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
// Die Seite zeigt keine Liste mehr: was zu einer Person gespeichert ist, steht im Formular, sobald
// sie ausgewaehlt wird. Massgeblich ist die juengste Einwilligung, die weder abgeloest noch
// widerrufen ist; ohne sie wird ein juengerer Widerruf angezeigt.
function currentConsentOf(personId: string): ConsentRecord | undefined {
  return newestFirst(consents.value.filter((consent) => consent.directoryPersonId === personId && !consent.supersededBy && !consent.revokedAt))[0]
}
function storedConsentOf(personId: string): ConsentRecord | undefined {
  return currentConsentOf(personId) ?? newestFirst(consents.value.filter((consent) => consent.directoryPersonId === personId && !consent.supersededBy))[0]
}
function openRequestOf(personId: string): ConsentRequest | undefined {
  return newestFirst(requests.value.filter((request) => request.directoryPersonId === personId && request.status === 'sent'))[0]
}
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('de-DE')
}

const GUARDIAN_REQUIRED_MESSAGE = 'Diese Person ist minderjährig. Eine Einwilligung muss von einer erziehungsberechtigten Person erteilt werden.'
const MEDIA_KIND_REQUIRED_MESSAGE = 'Bitte mindestens eine Medienart auswählen.'
function errorCodeOf(error: unknown): string | undefined {
  return error instanceof ApiRequestError ? error.code : undefined
}

// --- Papiererklärung hinterlegen ------------------------------------------------------------

const purposeOptions = CONSENT_PURPOSE_OPTIONS

// Website ist vorausgewaehlt, weil die Papierformulare des Vereins sie abdecken und PlayerBoard-
// Trainingsfotos nur damit oeffentlich werden (Betreiberentscheidung, 2026-11-04). Die digitale
// Anfrage bleibt bei Social Media: dort waehlt die Person selbst.
const PAPER_DEFAULT_PURPOSES = ['social_media', 'website']
const registerForm = reactive({
  directoryPersonId: '', signedAt: '', signerName: '', signerRole: 'guardian' as 'self' | 'guardian', guardianConfirmed: false,
  purposes: [...PAPER_DEFAULT_PURPOSES] as string[], mediaKinds: ['photo'] as string[], allPlatforms: true, platforms: [] as string[], namingAllowed: false,
  file: null as File | null,
})
const registerSubmitting = ref(false)
const registerError = ref('')
const registerNotice = ref('')
// Das Datei-Feld laesst sich nicht per v-model leeren: ohne neuen key zeigte es nach dem Hinterlegen
// weiter die alte Datei, waehrend registerForm.file schon null war -- der naechste Eintrag liefe dann
// ohne Nachweis, obwohl einer angezeigt wird (gleiches Muster wie syncFileInputKey in integrationen.vue).
const registerFileInputKey = ref(0)

const registerStored = computed(() => (registerForm.directoryPersonId ? storedConsentOf(registerForm.directoryPersonId) : undefined))
// Nur eine Papiererklaerung wird beim Speichern abgeloest (POST /v1/consents/:id/supersede): dort
// uebertraegt der Verein selbst, was auf dem Formular steht. Den Umfang einer digital erteilten
// Einwilligung hat die Person gewaehlt -- neben ihr wird eine weitere Papiererklaerung hinterlegt.
const registerSupersedes = computed(() => {
  const stored = registerStored.value
  return stored && stored.origin === 'paper' && !stored.revokedAt ? stored : undefined
})

function prefillRegisterForm(personId: string) {
  const current = personId ? currentConsentOf(personId) : undefined
  const scope = current?.scopeStructured
  registerForm.purposes = scope ? [...scope.purposes] : [...PAPER_DEFAULT_PURPOSES]
  registerForm.mediaKinds = scope ? [...scope.mediaKinds] : ['photo']
  registerForm.namingAllowed = scope?.namingAllowed ?? false
  registerForm.allPlatforms = !scope?.platforms
  registerForm.platforms = scope?.platforms ? [...scope.platforms] : []
  registerForm.signedAt = current?.signedAt ?? ''
  registerForm.signerName = current?.signerName ?? ''
  registerForm.signerRole = current?.signerRole ?? 'guardian'
  registerForm.guardianConfirmed = current?.guardianConfirmed ?? false
  registerForm.file = null; registerFileInputKey.value += 1
}
// sync: die Werte stehen sofort nach der Auswahl im Formular, nicht erst nach dem naechsten Tick --
// sonst ueberschriebe ein spaeter laufender Watcher schon begonnene Eingaben.
watch(() => registerForm.directoryPersonId, (personId) => {
  registerError.value = ''
  if (personId) registerNotice.value = ''
  prefillRegisterForm(personId)
}, { flush: 'sync' })

async function registerConsent() {
  if (!organizationId.value) return
  // Die Person ist Pflicht: seit der Umstellung auf die shadcn-Select-Komponente gibt es kein
  // natives required mehr (reka-ui rendert das versteckte <select> nur mit name-Prop), und die
  // API nimmt eine Erklaerung ohne directoryPersonId klaglos an.
  if (!registerForm.directoryPersonId) { registerError.value = 'Bitte eine Person wählen.'; return }
  if (registerForm.purposes.length === 0) { registerError.value = PURPOSE_REQUIRED_MESSAGE; return }
  if (registerForm.mediaKinds.length === 0) { registerError.value = MEDIA_KIND_REQUIRED_MESSAGE; return }
  registerSubmitting.value = true
  registerError.value = ''
  const previous = registerSupersedes.value
  try {
    // Eine Erziehungsberechtigung kann nur bestaetigt sein, wenn die Rolle 'guardian' ist -- sonst
    // bliebe ein zuvor gesetzter Haken auch nach dem Wechsel auf 'self' bestehen (gefunden im
    // Code-Review), weil das Feld dann ausgeblendet wird, aber registerForm.guardianConfirmed nicht.
    const guardianConfirmed = registerForm.signerRole === 'guardian' && registerForm.guardianConfirmed
    if (previous) {
      const successor = await api.request(`/v1/consents/${previous.id}/supersede`, {
        method: 'POST',
        body: {
          // Anlaesse und Abteilungen bietet das Formular nicht an -- sie bleiben wie in der bisherigen
          // Version, statt beim Speichern stillschweigend zu "alle" zu werden.
          scopeStructured: { ...previous.scopeStructured, purposes: registerForm.purposes, mediaKinds: registerForm.mediaKinds, namingAllowed: registerForm.namingAllowed },
          signedAt: registerForm.signedAt,
          signerName: registerForm.signerName.trim() || undefined,
          signerRole: registerForm.signerRole,
          guardianConfirmed,
        },
      }, ConsentRecordSchema)
      consents.value = [
        successor,
        ...consents.value.map((item) => (item.id === previous.id ? { ...item, supersededBy: successor.id, status: 'superseded' as const } : item)),
      ]
    } else {
      const scopeStructured = {
        purposes: registerForm.purposes, platforms: registerForm.allPlatforms ? null : registerForm.platforms,
        mediaKinds: registerForm.mediaKinds, contexts: null, namingAllowed: registerForm.namingAllowed, departmentIds: null,
      }
      const body = new FormData()
      body.set('organizationId', organizationId.value)
      body.set('directoryPersonId', registerForm.directoryPersonId)
      body.set('scopeStructured', JSON.stringify(scopeStructured))
      body.set('signedAt', registerForm.signedAt)
      // Optional: ein leerer Name wird gar nicht erst gesendet, sonst scheiterte er an min(1).
      if (registerForm.signerName.trim()) body.set('signerName', registerForm.signerName)
      body.set('signerRole', registerForm.signerRole)
      body.set('guardianConfirmed', String(guardianConfirmed))
      // Der Nachweis ist optional; ohne Datei wird kein Dateiteil gesendet.
      if (registerForm.file) body.set('file', registerForm.file)
      const created = await api.request('/v1/consents', { method: 'POST', body }, ConsentRecordSchema)
      consents.value = [created, ...consents.value]
    }
    registerNotice.value = previous ? 'Die Änderung ist gespeichert.' : 'Die Erklärung ist hinterlegt.'
    registerForm.directoryPersonId = ''
  } catch (error) {
    const code = errorCodeOf(error)
    registerError.value = code === 'guardian_required_for_minor'
      ? GUARDIAN_REQUIRED_MESSAGE
      : code === 'already_superseded' || code === 'already_revoked'
        ? 'Diese Einwilligung wurde inzwischen geändert oder widerrufen. Bitte die Seite neu laden.'
        : previous ? 'Die Änderung konnte nicht gespeichert werden.' : 'Die Erklärung konnte nicht hinterlegt werden.'
  } finally {
    registerSubmitting.value = false
  }
}

// --- Widerruf ------------------------------------------------------------------------------

const revokingId = ref<string | null>(null)
async function revoke(consent: ConsentRecord) {
  if (!confirm('Diese Einwilligung wirklich widerrufen? Offene Freigaben und geplante Veröffentlichungen werden sofort betroffen.')) return
  // prompt() statt confirm(), weil der Widerrufsgrund (consent_records.revocation_reason) sonst an
  // dieser Oberflaeche nie erfasst wuerde (gefunden im Code-Review). null bei Abbruch.
  const reason = prompt('Grund für den Widerruf (optional):')
  revokingId.value = consent.id
  registerError.value = ''
  try {
    const updated = await api.request(`/v1/consents/${consent.id}/revoke`, { method: 'POST', body: { revokedBy: 'organization', reason: reason || undefined } }, ConsentRecordSchema)
    consents.value = consents.value.map((item) => (item.id === updated.id ? updated : item))
    if (registerForm.directoryPersonId === updated.directoryPersonId) prefillRegisterForm(registerForm.directoryPersonId)
  } catch (error) {
    registerError.value = errorCodeOf(error) === 'already_revoked'
      ? 'Diese Einwilligung wurde bereits widerrufen.'
      : 'Der Widerruf konnte nicht gespeichert werden.'
  } finally {
    revokingId.value = null
  }
}

// --- Digital anfragen ------------------------------------------------------------------------

const requestForm = reactive({
  directoryPersonId: '', recipientEmail: '', recipientRole: 'guardian' as 'self' | 'guardian',
  purposes: ['social_media'] as string[], mediaKinds: ['photo'] as string[], namingAllowed: false,
})
const requestSubmitting = ref(false)
const requestError = ref('')
const requestNotice = ref('')

const requestOpen = computed(() => (requestForm.directoryPersonId ? openRequestOf(requestForm.directoryPersonId) : undefined))
const requestStored = computed(() => (requestForm.directoryPersonId ? storedConsentOf(requestForm.directoryPersonId) : undefined))

// Vorbelegung: eine offene Anfrage zuerst (Adresse und angefragter Umfang), sonst der Umfang der
// gespeicherten Einwilligung -- so fragt der Verein nicht versehentlich weniger an als schon gilt.
watch(() => requestForm.directoryPersonId, (personId) => {
  requestError.value = ''
  if (personId) requestNotice.value = ''
  const open = personId ? openRequestOf(personId) : undefined
  const scope = open?.requestedScope ?? (personId ? currentConsentOf(personId)?.scopeStructured : undefined)
  requestForm.purposes = scope ? [...scope.purposes] : ['social_media']
  requestForm.mediaKinds = scope ? [...scope.mediaKinds] : ['photo']
  requestForm.namingAllowed = scope?.namingAllowed ?? false
  requestForm.recipientEmail = open?.recipientEmail ?? ''
  requestForm.recipientRole = open?.recipientRole ?? 'guardian'
}, { flush: 'sync' })

async function sendConsentRequest() {
  if (!organizationId.value) return
  if (!requestForm.directoryPersonId) { requestError.value = 'Bitte eine Person wählen.'; return }
  if (requestForm.purposes.length === 0) { requestError.value = PURPOSE_REQUIRED_MESSAGE; return }
  requestSubmitting.value = true
  requestError.value = ''
  try {
    const created = await api.request('/v1/consent-requests', {
      method: 'POST',
      body: {
        organizationId: organizationId.value, directoryPersonId: requestForm.directoryPersonId,
        recipientEmail: requestForm.recipientEmail, recipientRole: requestForm.recipientRole,
        requestedScope: { purposes: requestForm.purposes, platforms: null, mediaKinds: requestForm.mediaKinds, contexts: null, namingAllowed: requestForm.namingAllowed, departmentIds: null },
      },
    }, ConsentRequestSchema)
    requests.value = [created, ...requests.value]
    requestNotice.value = `Die Anfrage ist an ${created.recipientEmail} versendet.`
    requestForm.directoryPersonId = ''
  } catch (error) {
    const code = errorCodeOf(error)
    requestError.value = code === 'request_already_open'
      ? 'Für diese Person und Adresse liegt bereits eine offene Anfrage vor.'
      : code === 'guardian_required_for_minor'
        ? GUARDIAN_REQUIRED_MESSAGE
        : 'Die Anfrage konnte nicht versendet werden.'
  } finally {
    requestSubmitting.value = false
  }
}

async function resendRequest(request: ConsentRequest) {
  requestError.value = ''
  try {
    const updated = await api.request(`/v1/consent-requests/${request.id}/resend`, { method: 'POST' }, ConsentRequestSchema)
    requests.value = requests.value.map((item) => (item.id === updated.id ? updated : item))
    requestNotice.value = `Die Anfrage ist erneut an ${updated.recipientEmail} versendet.`
  } catch (error) {
    requestError.value = errorCodeOf(error) === 'request_not_open'
      ? 'Diese Anfrage ist nicht mehr offen und kann nicht erneut gesendet werden.'
      : 'Die Anfrage konnte nicht erneut gesendet werden.'
  }
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Verein</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Einwilligungen</h1>
      <p class="mt-2 text-sm text-[#727a75]">Wer darf gezeigt werden, in welchem Umfang, und woher der Nachweis kommt.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <div v-else-if="!canAccessPage" class="card p-8 text-center text-sm text-[#7b827d]">
      Du hast hier keine Berechtigung, Einwilligungen zu verwalten. Das übernimmt der Vereins- oder Abteilungsadmin.
    </div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else>
      <section class="card mb-6 p-6">
        <Select v-model="filterDepartmentIdModel">
          <SelectTrigger class="w-auto rounded-lg p-2 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-if="canManageOrgWide" value="__none__">Alle Abteilungen</SelectItem>
            <SelectItem v-for="department in manageableDepartments" :key="department.id" :value="department.id">{{ department.name }}</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <div class="grid gap-6 sm:grid-cols-2">
        <section class="card p-6">
          <h2 class="mb-4 font-display text-base font-bold">Papiererklärung hinterlegen</h2>
          <form class="grid gap-3" @submit.prevent="registerConsent">
            <label><span class="mb-1 block text-xs font-semibold">Person</span>
              <Select v-model="registerForm.directoryPersonId" required>
                <SelectTrigger class="rounded-xl p-2.5 text-sm"><SelectValue placeholder="Auswählen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="person in people" :key="person.id" :value="person.id">{{ person.firstName }} {{ person.lastName }}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div v-if="registerStored" class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f4f5ef] p-3 text-xs">
              <p class="flex flex-wrap items-center gap-1.5">
                <span class="inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold" :class="STATUS_COLORS[registerStored.status]">{{ STATUS_LABELS[registerStored.status] }}</span>
                {{ ORIGIN_LABELS[registerStored.origin] }}
                <span v-if="registerStored.revokedAt">· widerrufen am {{ formatDate(registerStored.revokedAt) }}</span>
                <span v-else-if="registerStored.validUntil">· gültig bis {{ formatDate(registerStored.validUntil) }}</span>
              </p>
              <button
                v-if="!registerStored.revokedAt"
                type="button" :disabled="revokingId === registerStored.id"
                class="focus-ring rounded-lg border border-amber-300 px-3 py-1.5 text-[11px] font-semibold text-amber-800 disabled:opacity-60"
                @click="revoke(registerStored)"
              >
                {{ revokingId === registerStored.id ? 'Wird widerrufen …' : 'Widerrufen' }}
              </button>
              <p v-if="!registerStored.revokedAt && !registerSupersedes" class="w-full text-[#6c756f]">
                Diese Einwilligung wurde nicht auf Papier erteilt. Beim Speichern wird zusätzlich eine Papiererklärung hinterlegt.
              </p>
            </div>
            <p v-else-if="registerForm.directoryPersonId" class="text-xs text-[#6c756f]">Für diese Person ist noch keine Einwilligung gespeichert.</p>
            <fieldset class="flex flex-wrap gap-3 text-xs"
              :aria-invalid="registerError === PURPOSE_REQUIRED_MESSAGE && registerForm.purposes.length === 0"
              :aria-describedby="registerError === PURPOSE_REQUIRED_MESSAGE && registerForm.purposes.length === 0 ? 'register-consent-error' : undefined">
              <legend class="mb-1 block text-xs font-semibold">Zweck</legend>
              <label v-for="purpose in purposeOptions" :key="purpose.value" class="flex items-center gap-1.5"><input v-model="registerForm.purposes" type="checkbox" :value="purpose.value" /> {{ purpose.label }}</label>
            </fieldset>
            <div class="flex flex-wrap gap-3 text-xs">
              <label class="flex items-center gap-1.5"><input v-model="registerForm.mediaKinds" type="checkbox" value="photo" /> Foto</label>
              <label class="flex items-center gap-1.5"><input v-model="registerForm.mediaKinds" type="checkbox" value="video" /> Video</label>
              <label class="flex items-center gap-1.5"><input v-model="registerForm.namingAllowed" type="checkbox" /> Namentliche Nennung erlaubt</label>
            </div>
            <label><span class="mb-1 block text-xs font-semibold">Unterschriftsdatum</span>
              <input v-model="registerForm.signedAt" type="date" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Unterzeichnet von <span class="font-normal text-[#7b827d]">(optional)</span></span>
              <input v-model="registerForm.signerName" maxlength="160" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
            </label>
            <div class="flex items-center gap-3 text-xs">
              <label class="flex items-center gap-1.5"><input v-model="registerForm.signerRole" type="radio" name="signerRole" value="self" /> Person selbst</label>
              <label class="flex items-center gap-1.5"><input v-model="registerForm.signerRole" type="radio" name="signerRole" value="guardian" /> Erziehungsberechtigte:r</label>
            </div>
            <label v-if="registerForm.signerRole === 'guardian'" class="flex items-center gap-1.5 text-xs">
              <input v-model="registerForm.guardianConfirmed" type="checkbox" required /> Erziehungsberechtigung bestätigt
            </label>
            <!-- Eine Abloesung uebernimmt den Nachweis der bisherigen Version; ein neues Dokument laedt sie nicht hoch. -->
            <p v-if="registerSupersedes" class="text-xs text-[#6c756f]">Der bisherige Nachweis bleibt erhalten.</p>
            <label v-else><span class="mb-1 block text-xs font-semibold">Nachweis (PDF, JPEG, PNG, WEBP) <span class="font-normal text-[#7b827d]">(optional)</span></span>
              <input :key="registerFileInputKey" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" class="focus-ring w-full text-xs" @change="registerForm.file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
            </label>
            <p v-if="registerError" id="register-consent-error" role="alert" class="text-xs text-amber-800">{{ registerError }}</p>
            <p v-if="registerNotice" role="status" class="text-xs text-emerald-800">{{ registerNotice }}</p>
            <button type="submit" :disabled="registerSubmitting" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
              {{ registerSubmitting ? 'Wird gespeichert …' : registerSupersedes ? 'Änderung speichern' : 'Hinterlegen' }}
            </button>
          </form>
        </section>

        <section class="card p-6">
          <h2 class="mb-4 font-display text-base font-bold">Digital anfragen</h2>
          <form class="grid gap-3" @submit.prevent="sendConsentRequest">
            <label><span class="mb-1 block text-xs font-semibold">Person</span>
              <Select v-model="requestForm.directoryPersonId" required>
                <SelectTrigger class="rounded-xl p-2.5 text-sm"><SelectValue placeholder="Auswählen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="person in people" :key="person.id" :value="person.id">{{ person.firstName }} {{ person.lastName }}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div v-if="requestOpen" class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f4f5ef] p-3 text-xs">
              <p>Offene Anfrage an {{ requestOpen.recipientEmail }} · läuft ab am {{ formatDate(requestOpen.expiresAt) }}</p>
              <button type="button" class="focus-ring shrink-0 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold" @click="resendRequest(requestOpen)">
                Erneut senden
              </button>
            </div>
            <p v-else-if="requestStored" class="text-xs text-[#6c756f]">
              Gespeichert: {{ ORIGIN_LABELS[requestStored.origin] }} · {{ STATUS_LABELS[requestStored.status] }}
            </p>
            <label><span class="mb-1 block text-xs font-semibold">E-Mail-Adresse</span>
              <input v-model="requestForm.recipientEmail" type="email" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
            </label>
            <div class="flex items-center gap-3 text-xs">
              <label class="flex items-center gap-1.5"><input v-model="requestForm.recipientRole" type="radio" name="recipientRole" value="self" /> An die Person selbst</label>
              <label class="flex items-center gap-1.5"><input v-model="requestForm.recipientRole" type="radio" name="recipientRole" value="guardian" /> An Erziehungsberechtigte:n</label>
            </div>
            <fieldset class="flex flex-wrap gap-3 text-xs"
              :aria-invalid="requestError === PURPOSE_REQUIRED_MESSAGE && requestForm.purposes.length === 0"
              :aria-describedby="requestError === PURPOSE_REQUIRED_MESSAGE && requestForm.purposes.length === 0 ? 'request-consent-error' : undefined">
              <legend class="mb-1 block text-xs font-semibold">Zweck</legend>
              <label v-for="purpose in purposeOptions" :key="purpose.value" class="flex items-center gap-1.5"><input v-model="requestForm.purposes" type="checkbox" :value="purpose.value" /> {{ purpose.label }}</label>
            </fieldset>
            <div class="flex flex-wrap gap-3 text-xs">
              <label class="flex items-center gap-1.5"><input v-model="requestForm.mediaKinds" type="checkbox" value="photo" /> Foto</label>
              <label class="flex items-center gap-1.5"><input v-model="requestForm.mediaKinds" type="checkbox" value="video" /> Video</label>
              <label class="flex items-center gap-1.5"><input v-model="requestForm.namingAllowed" type="checkbox" /> Namentliche Nennung erlaubt</label>
            </div>
            <p v-if="requestError" id="request-consent-error" role="alert" class="text-xs text-amber-800">{{ requestError }}</p>
            <p v-if="requestNotice" role="status" class="text-xs text-emerald-800">{{ requestNotice }}</p>
            <button type="submit" :disabled="requestSubmitting" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
              {{ requestSubmitting ? 'Wird gesendet …' : 'Anfrage senden' }}
            </button>
            <p class="text-xs text-[#7b827d]">
              Ein E-Mail-Link belegt nicht die Identität der antwortenden Person — für rechtlich verbindliche Nachweise bei Minderjährigen ist die Papiererklärung sicherer.
            </p>
          </form>
        </section>
      </div>
    </template>
  </div>
</template>
