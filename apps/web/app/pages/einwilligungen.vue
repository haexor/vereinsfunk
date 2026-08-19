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

const config = useRuntimeConfig()
const session = await useSession()
const scope = await useScope()

const organizationId = computed(() => scope.value?.organizationId ?? null)
const organization = computed(() => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)

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

function personLabel(personId: string | null): string {
  if (!personId) return 'Pseudonym erfasst'
  const person = people.value.find((item) => item.id === personId)
  return person ? `${person.firstName} ${person.lastName}` : 'Unbekannte Person'
}

async function loadPeople(currentOrganizationId: string, currentDepartmentId: string) {
  const headers = await useAuthHeader()
  const query: Record<string, string> = {}
  if (currentDepartmentId) query.departmentId = currentDepartmentId
  const response = await $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${currentOrganizationId}/directory-people`, { headers, query })
  // Verein/Abteilung koennte sich waehrend des Requests geaendert haben -- ein frueher gestarteter
  // Durchlauf darf eine spaeter gewaehlte Auswahl nicht ueberschreiben (siehe loadAll).
  if (organizationId.value !== currentOrganizationId || filterDepartmentId.value !== currentDepartmentId) return
  people.value = DirectoryPersonSchema.array().parse(response)
}

async function loadAll() {
  if (!organizationId.value) { loading.value = false; return }
  const currentOrganizationId = organizationId.value
  const currentDepartmentId = filterDepartmentId.value
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const query: Record<string, string> = {}
    if (currentDepartmentId) query.departmentId = currentDepartmentId
    const [consentsResponse, requestsResponse] = await Promise.all([
      $fetch<unknown>(`${config.public.apiBase}/v1/consents`, { headers, query: { organizationId: currentOrganizationId, ...query } }),
      $fetch<unknown>(`${config.public.apiBase}/v1/consent-requests`, { headers, query: { organizationId: currentOrganizationId, ...query } }),
      loadPeople(currentOrganizationId, currentDepartmentId),
    ])
    // Ein frueher gestarteter Durchlauf kann nach einem spaeter gestarteten zurueckkehren, wenn
    // sich Verein/Abteilung zwischendurch aendern -- er wuerde sonst deren Ergebnisse mit denen der
    // vorigen Auswahl ueberschreiben (gefunden im Code-Review, gleiches Muster wie layouts/default.vue).
    if (organizationId.value !== currentOrganizationId || filterDepartmentId.value !== currentDepartmentId) return
    consents.value = ConsentRecordSchema.array().parse(consentsResponse)
    requests.value = ConsentRequestSchema.array().parse(requestsResponse)
  } catch {
    errorMessage.value = 'Die Einwilligungen konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await loadAll()
watch([organizationId, filterDepartmentId], () => { void loadAll() })

const showMinorsWithoutConsent = ref(true)
const minorsWithoutValidConsent = computed(() => {
  const validPersonIds = new Set(consents.value.filter((consent) => consent.status === 'valid').map((consent) => consent.directoryPersonId))
  return people.value.filter((person) => person.isMinor && person.status === 'active' && !validPersonIds.has(person.id))
})

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

// --- Widerruf ------------------------------------------------------------------------------

const revokingId = ref<string | null>(null)
const revokeError = ref('')
async function revoke(consent: ConsentRecord) {
  if (!confirm('Diese Einwilligung wirklich widerrufen? Offene Freigaben und geplante Veröffentlichungen werden sofort betroffen.')) return
  // prompt() statt confirm(), weil der Widerrufsgrund (consent_records.revocation_reason) sonst an
  // dieser Oberflaeche nie erfasst wuerde (gefunden im Code-Review). null bei Abbruch.
  const reason = prompt('Grund für den Widerruf (optional):')
  revokingId.value = consent.id
  revokeError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/consents/${consent.id}/revoke`, { method: 'POST', headers, body: { revokedBy: 'organization', reason: reason || undefined } })
    const updated = ConsentRecordSchema.parse(response)
    consents.value = consents.value.map((item) => (item.id === updated.id ? updated : item))
  } catch {
    revokeError.value = 'Der Widerruf konnte nicht gespeichert werden.'
  } finally {
    revokingId.value = null
  }
}

// --- Papiererklärung hinterlegen ------------------------------------------------------------

const registerForm = reactive({
  directoryPersonId: '', scope: '', signedAt: '', signerName: '', signerRole: 'guardian' as 'self' | 'guardian', guardianConfirmed: false,
  purposes: ['social_media'] as string[], mediaKinds: ['photo'] as string[], allPlatforms: true, platforms: [] as string[], namingAllowed: false,
  file: null as File | null,
})
const registerSubmitting = ref(false)
const registerError = ref('')

const GUARDIAN_REQUIRED_MESSAGE = 'Diese Person ist minderjährig. Eine Einwilligung muss von einer erziehungsberechtigten Person erteilt werden.'
function errorCodeOf(error: unknown): string | undefined {
  return (error as { data?: { error?: string } })?.data?.error
}

async function registerConsent() {
  if (!organizationId.value || !registerForm.file) return
  // Die Person ist Pflicht: seit der Umstellung auf die shadcn-Select-Komponente gibt es kein
  // natives required mehr (reka-ui rendert das versteckte <select> nur mit name-Prop), und die
  // API nimmt eine Erklaerung ohne directoryPersonId klaglos an.
  if (!registerForm.directoryPersonId) { registerError.value = 'Bitte eine Person wählen.'; return }
  registerSubmitting.value = true
  registerError.value = ''
  try {
    const headers = await useAuthHeader()
    const scopeStructured = {
      purposes: registerForm.purposes, platforms: registerForm.allPlatforms ? null : registerForm.platforms,
      mediaKinds: registerForm.mediaKinds, contexts: null, namingAllowed: registerForm.namingAllowed, departmentIds: null,
    }
    const body = new FormData()
    body.set('organizationId', organizationId.value)
    if (registerForm.directoryPersonId) body.set('directoryPersonId', registerForm.directoryPersonId)
    body.set('scope', registerForm.scope)
    body.set('scopeStructured', JSON.stringify(scopeStructured))
    body.set('signedAt', registerForm.signedAt)
    body.set('signerName', registerForm.signerName)
    body.set('signerRole', registerForm.signerRole)
    // Eine Erziehungsberechtigung kann nur bestaetigt sein, wenn die Rolle 'guardian' ist -- sonst
    // bliebe ein zuvor gesetzter Haken auch nach dem Wechsel auf 'self' bestehen (gefunden im
    // Code-Review), weil das Feld dann ausgeblendet wird, aber registerForm.guardianConfirmed nicht.
    body.set('guardianConfirmed', String(registerForm.signerRole === 'guardian' && registerForm.guardianConfirmed))
    body.set('file', registerForm.file)
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/consents`, { method: 'POST', headers, body })
    consents.value = [ConsentRecordSchema.parse(response), ...consents.value]
    registerForm.directoryPersonId = ''; registerForm.scope = ''; registerForm.signedAt = ''; registerForm.signerName = ''
    registerForm.guardianConfirmed = false; registerForm.file = null
  } catch (error) {
    registerError.value = errorCodeOf(error) === 'guardian_required_for_minor' ? GUARDIAN_REQUIRED_MESSAGE : 'Die Erklärung konnte nicht hinterlegt werden.'
  } finally {
    registerSubmitting.value = false
  }
}

// --- Digital anfragen ------------------------------------------------------------------------

const requestForm = reactive({
  directoryPersonId: '', recipientEmail: '', recipientRole: 'guardian' as 'self' | 'guardian',
  purposes: ['social_media'] as string[], mediaKinds: ['photo'] as string[], namingAllowed: false,
})
const requestSubmitting = ref(false)
const requestError = ref('')

async function sendConsentRequest() {
  if (!organizationId.value) return
  if (!requestForm.directoryPersonId) { requestError.value = 'Bitte eine Person wählen.'; return }
  requestSubmitting.value = true
  requestError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/consent-requests`, {
      method: 'POST', headers,
      body: {
        organizationId: organizationId.value, directoryPersonId: requestForm.directoryPersonId,
        recipientEmail: requestForm.recipientEmail, recipientRole: requestForm.recipientRole,
        requestedScope: { purposes: requestForm.purposes, platforms: null, mediaKinds: requestForm.mediaKinds, contexts: null, namingAllowed: requestForm.namingAllowed, departmentIds: null },
      },
    })
    requests.value = [ConsentRequestSchema.parse(response), ...requests.value]
    requestForm.directoryPersonId = ''; requestForm.recipientEmail = ''
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
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/consent-requests/${request.id}/resend`, { method: 'POST', headers })
    const updated = ConsentRequestSchema.parse(response)
    requests.value = requests.value.map((item) => (item.id === updated.id ? updated : item))
  } catch {
    requestError.value = 'Die Anfrage konnte nicht erneut gesendet werden.'
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

      <section v-if="showMinorsWithoutConsent && minorsWithoutValidConsent.length" class="card mb-6 border-amber-200 bg-amber-50 p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-bold text-amber-900">Minderjährige ohne gültige Einwilligung</p>
            <ul class="mt-2 space-y-0.5 text-xs text-amber-800">
              <li v-for="person in minorsWithoutValidConsent" :key="person.id">{{ person.firstName }} {{ person.lastName }}</li>
            </ul>
          </div>
          <button type="button" class="focus-ring shrink-0 text-xs font-semibold text-amber-800" @click="showMinorsWithoutConsent = false">Ausblenden</button>
        </div>
      </section>

      <p v-if="revokeError" class="mb-4 text-sm text-amber-800">{{ revokeError }}</p>

      <section class="card mb-6 divide-y divide-[#e8e9e2]">
        <h2 class="p-4 font-display text-base font-bold sm:px-6">Erfasste Einwilligungen</h2>
        <div v-for="consent in consents" :key="consent.id" class="p-4 sm:px-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold">{{ personLabel(consent.directoryPersonId) }}</p>
              <p class="mt-1 text-[11px] text-[#9aa096]">{{ consent.scope }}</p>
              <p class="mt-1 text-[11px] text-[#9aa096]">
                {{ consent.origin === 'paper' ? 'Papiererklärung' : consent.origin === 'digital' ? 'Digital erteilt' : 'Aus Quellsystem' }}
                <span v-if="consent.validUntil"> · gültig bis {{ new Date(consent.validUntil).toLocaleDateString('de-DE') }}</span>
              </p>
              <span class="mt-1.5 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold" :class="STATUS_COLORS[consent.status]">
                {{ STATUS_LABELS[consent.status] }}
              </span>
            </div>
            <button
              v-if="!consent.revokedAt && !consent.supersededBy"
              type="button" :disabled="revokingId === consent.id"
              class="focus-ring shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 text-[11px] font-semibold text-amber-800 disabled:opacity-60"
              @click="revoke(consent)"
            >
              {{ revokingId === consent.id ? 'Wird widerrufen …' : 'Widerrufen' }}
            </button>
          </div>
        </div>
        <p v-if="!consents.length" class="p-8 text-center text-xs text-[#9aa096]">Noch keine Einwilligungen erfasst.</p>
      </section>

      <section class="card mb-6 divide-y divide-[#e8e9e2]">
        <h2 class="p-4 font-display text-base font-bold sm:px-6">Offene digitale Anfragen</h2>
        <div v-for="request in requests.filter((item) => item.status === 'sent')" :key="request.id" class="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-6">
          <div>
            <p class="text-sm font-semibold">{{ personLabel(request.directoryPersonId) }}</p>
            <p class="mt-1 text-[11px] text-[#9aa096]">An {{ request.recipientEmail }} · läuft ab am {{ new Date(request.expiresAt).toLocaleDateString('de-DE') }}</p>
          </div>
          <button type="button" class="focus-ring shrink-0 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold" @click="resendRequest(request)">
            Erneut senden
          </button>
        </div>
        <p v-if="!requests.some((item) => item.status === 'sent')" class="p-8 text-center text-xs text-[#9aa096]">Keine offenen Anfragen.</p>
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
            <label><span class="mb-1 block text-xs font-semibold">Wiedergabe der Erklärung</span>
              <textarea v-model="registerForm.scope" required maxlength="500" rows="2" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
            </label>
            <div class="flex flex-wrap gap-3 text-xs">
              <label class="flex items-center gap-1.5"><input v-model="registerForm.mediaKinds" type="checkbox" value="photo" /> Foto</label>
              <label class="flex items-center gap-1.5"><input v-model="registerForm.mediaKinds" type="checkbox" value="video" /> Video</label>
              <label class="flex items-center gap-1.5"><input v-model="registerForm.namingAllowed" type="checkbox" /> Namentliche Nennung erlaubt</label>
            </div>
            <label><span class="mb-1 block text-xs font-semibold">Unterschriftsdatum</span>
              <input v-model="registerForm.signedAt" type="date" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Unterzeichnet von</span>
              <input v-model="registerForm.signerName" required maxlength="160" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
            </label>
            <div class="flex items-center gap-3 text-xs">
              <label class="flex items-center gap-1.5"><input v-model="registerForm.signerRole" type="radio" name="signerRole" value="self" /> Person selbst</label>
              <label class="flex items-center gap-1.5"><input v-model="registerForm.signerRole" type="radio" name="signerRole" value="guardian" /> Erziehungsberechtigte:r</label>
            </div>
            <label v-if="registerForm.signerRole === 'guardian'" class="flex items-center gap-1.5 text-xs">
              <input v-model="registerForm.guardianConfirmed" type="checkbox" required /> Erziehungsberechtigung bestätigt
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Nachweis (PDF, JPEG, PNG, WEBP)</span>
              <input type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp" class="focus-ring w-full text-xs" @change="registerForm.file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
            </label>
            <p v-if="registerError" class="text-xs text-amber-800">{{ registerError }}</p>
            <button type="submit" :disabled="registerSubmitting" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
              {{ registerSubmitting ? 'Wird hinterlegt …' : 'Hinterlegen' }}
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
            <label><span class="mb-1 block text-xs font-semibold">E-Mail-Adresse</span>
              <input v-model="requestForm.recipientEmail" type="email" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
            </label>
            <div class="flex items-center gap-3 text-xs">
              <label class="flex items-center gap-1.5"><input v-model="requestForm.recipientRole" type="radio" name="recipientRole" value="self" /> An die Person selbst</label>
              <label class="flex items-center gap-1.5"><input v-model="requestForm.recipientRole" type="radio" name="recipientRole" value="guardian" /> An Erziehungsberechtigte:n</label>
            </div>
            <div class="flex flex-wrap gap-3 text-xs">
              <label class="flex items-center gap-1.5"><input v-model="requestForm.mediaKinds" type="checkbox" value="photo" /> Foto</label>
              <label class="flex items-center gap-1.5"><input v-model="requestForm.mediaKinds" type="checkbox" value="video" /> Video</label>
              <label class="flex items-center gap-1.5"><input v-model="requestForm.namingAllowed" type="checkbox" /> Namentliche Nennung erlaubt</label>
            </div>
            <p v-if="requestError" class="text-xs text-amber-800">{{ requestError }}</p>
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
