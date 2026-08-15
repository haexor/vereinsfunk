<script setup lang="ts">
import { X } from '@lucide/vue'
import {
  MemberSchema,
  PolicyRuleSettingSchema,
  rolesForScopeLevel,
  type Member,
  type PolicyRuleSetting,
  type PolicyRuleValues,
  type ReviewerRef,
  type ScopeLevel,
} from '@vereinsfunk/contracts'
import { roleLabels } from '~/composables/roleLabels'

// Paket 011: einstellungen.vue wird zur scopeabhaengigen Richtlinienseite (Plan 011, "4.
// Oberflaeche") -- ersetzt die fuenf hartkodierten Zeilen aus Paket 008/010.
const config = useRuntimeConfig()
const session = await useSession()
const scope = await useScope()
const organizationId = computed(() => scope.value?.organizationId ?? null)
const organization = computed(() => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')
const entries = ref<PolicyRuleSetting[]>([])
const members = ref<Member[]>([])
const selectedKey = ref('')

function entryKey(entry: { scope: ScopeLevel; scopeId: string }) {
  return `${entry.scope}:${entry.scopeId}`
}

async function load() {
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const [rulesResponse, membersResponse] = await Promise.all([
      $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/policy-rules`, { headers }),
      $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/members`, { headers }),
    ])
    entries.value = PolicyRuleSettingSchema.array().parse(rulesResponse)
    members.value = MemberSchema.array().parse(membersResponse)
    if (!entries.value.some((entry) => entryKey(entry) === selectedKey.value)) {
      selectedKey.value = entries.value[0] ? entryKey(entries.value[0]) : ''
    }
  } catch {
    errorMessage.value = 'Die Richtlinien konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

watch(organizationId, () => { selectedKey.value = ''; void load() })

const selectedEntry = computed(() => entries.value.find((entry) => entryKey(entry) === selectedKey.value) ?? null)

const draft = reactive<PolicyRuleValues>({
  reviewRequired: null, reviewMode: null, reviewStageLabel: null, reviewMinimumApprovals: null, reviewDeadlineHours: null,
  minorApprovalRequired: null, selfApprovalAllowed: null, allowSameReviewerAcrossStages: null, allowReviewExemptions: null,
  mediaRequiresConsentCheck: null, consentExpiresOnLeave: null, consentValidityMonths: null,
  allowedPresets: null, allowedFormats: null, allowedChannelIds: null, defaultTargetPlatforms: null,
  forbiddenTopics: [], requiredHashtags: [],
})
const forbiddenTopicsText = ref('')
const requiredHashtagsText = ref('')
const allowedPresetsText = ref('')
const saving = ref(false)
const saveError = ref('')

function loadDraftFrom(entry: PolicyRuleSetting) {
  Object.assign(draft, entry.own)
  forbiddenTopicsText.value = entry.own.forbiddenTopics.join(', ')
  requiredHashtagsText.value = entry.own.requiredHashtags.join(', ')
  allowedPresetsText.value = entry.own.allowedPresets?.join(', ') ?? ''
}
watch(selectedEntry, (entry) => { if (entry) loadDraftFrom(entry) }, { immediate: true })

function splitList(text: string): string[] {
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}

// Ein geleertes Text- oder Zahlenfeld liefert '' (bei v-model.number auch dort). Ohne diese
// Normalisierung wäre ein einmal gesetzter Wert nicht mehr auf „geerbt“ zurückzunehmen:
// Mindestanzahl und Frist lehnt das Contracts-Schema als '' mit 400 ab, und eine leere
// Stufenbezeichnung landete in der Datenbank und ließ danach jede Freigabeliste am
// ApprovalStageSchema scheitern (eigener Review-Fund). '' heißt hier „geerbt“, also null.
function blankToNull(value: unknown): unknown {
  return value === '' ? null : value
}

async function save() {
  if (!selectedEntry.value) return
  saving.value = true
  saveError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/policy-rules`, {
      method: 'PUT',
      headers,
      body: {
        scope: selectedEntry.value.scope,
        scopeId: selectedEntry.value.scopeId,
        patch: {
          ...draft,
          reviewStageLabel: blankToNull(draft.reviewStageLabel),
          reviewMinimumApprovals: blankToNull(draft.reviewMinimumApprovals),
          reviewDeadlineHours: blankToNull(draft.reviewDeadlineHours),
          consentValidityMonths: blankToNull(draft.consentValidityMonths),
          forbiddenTopics: splitList(forbiddenTopicsText.value),
          requiredHashtags: splitList(requiredHashtagsText.value),
          allowedPresets: allowedPresetsText.value.trim() ? splitList(allowedPresetsText.value) : null,
        },
      },
    })
    await load()
  } catch {
    saveError.value = 'Die Richtlinie konnte nicht gespeichert werden.'
  } finally {
    saving.value = false
  }
}

// Prueferzuweisung: Person aus der Mitgliederliste oder eine Rolle in Verein/Abteilung/Team.
const reviewerKind = ref<ReviewerRef['kind']>('user')
const reviewerUserId = ref('')
const reviewerRole = ref('')
const reviewerAdding = ref(false)
const reviewerError = ref('')

// Eine Rollenreferenz benennt immer eine Rolle auf der gewählten Ebene oder darüber — die Abteilung
// bzw. das Team leitet sich aus der gewählten Ebene ab, es gibt hier keine eigene Auswahl dafür.
// Deshalb sind nur diese Kombinationen abbildbar: eine Team-Rolle nur auf einer Team-Ebene, eine
// Abteilungsrolle nur auf einer Abteilungs- oder Team-Ebene. Vorher stand die Auswahl unabhängig von
// der Ebene offen und schickte etwa die Team-ID als departmentId (beim Review gefunden).
const reviewerKindOptions: { value: ReviewerRef['kind']; label: string }[] = [
  { value: 'user', label: 'Person' },
  { value: 'organization_role', label: 'Rolle im Verein' },
  { value: 'department_role', label: 'Rolle in Abteilung' },
  { value: 'team_role', label: 'Rolle im Team' },
]

// Die Elternabteilung der gewählten Team-Ebene, bzw. die Ebene selbst, wenn sie eine Abteilung ist.
const selectedDepartmentId = computed(() => {
  const entry = selectedEntry.value
  if (!entry) return null
  if (entry.scope === 'department') return entry.scopeId
  if (entry.scope === 'team') return organization.value?.departments.find((department) => department.teams.some((team) => team.id === entry.scopeId))?.id ?? null
  return null
})

// Welche Zielplattform-Vorgabe greift, wenn diese Ebene keine eigene setzt: die effektive Auflösung
// der ÜBERGEORDNETEN Ebene. `effective` der Ebene selbst taugt dafür nicht — es rechnet ihre eigene
// Zeile mit und zeigte beim Umschalten auf „geerbt“ deshalb genau den Wert an, den der Betreiber
// gerade abwählt (Review dieses PRs). Auf Vereinsebene gibt es keine übergeordnete Ebene: dort heißt
// „geerbt“ immer „keine Vorauswahl“. `undefined` heißt „nicht ableitbar“ — die Komponente behauptet
// dann keinen Wert, statt „keine Vorauswahl“ zu unterstellen.
const inheritedTargetPlatforms = computed(() => {
  const entry = selectedEntry.value
  if (!entry) return undefined
  if (entry.scope === 'organization') return []
  const parent = entry.scope === 'team'
    ? entries.value.find((item) => item.scope === 'department' && item.scopeId === selectedDepartmentId.value)
    : entries.value.find((item) => item.scope === 'organization')
  return parent ? parent.effective.defaultTargetPlatforms ?? [] : undefined
})

const availableKindsForReviewer = computed(() => {
  const entry = selectedEntry.value
  if (!entry) return []
  return reviewerKindOptions.filter((option) => {
    if (option.value === 'team_role') return entry.scope === 'team'
    if (option.value === 'department_role') return selectedDepartmentId.value !== null
    return true
  })
})
watch(availableKindsForReviewer, (options) => {
  if (!options.some((option) => option.value === reviewerKind.value)) reviewerKind.value = 'user'
})

const availableRolesForReviewer = computed(() => {
  if (!selectedEntry.value) return []
  if (reviewerKind.value === 'organization_role') return rolesForScopeLevel('organization')
  if (reviewerKind.value === 'department_role') return rolesForScopeLevel('department')
  if (reviewerKind.value === 'team_role') return rolesForScopeLevel('team')
  return []
})

async function addReviewer() {
  if (!selectedEntry.value) return
  reviewerAdding.value = true
  reviewerError.value = ''
  try {
    const headers = await useAuthHeader()
    let reviewerRef: ReviewerRef
    if (reviewerKind.value === 'user') {
      if (!reviewerUserId.value) { reviewerError.value = 'Bitte eine Person wählen.'; return }
      reviewerRef = { kind: 'user', userId: reviewerUserId.value }
    } else if (reviewerKind.value === 'organization_role') {
      reviewerRef = { kind: 'organization_role', role: reviewerRole.value as never }
    } else if (reviewerKind.value === 'department_role') {
      if (!selectedDepartmentId.value) { reviewerError.value = 'Für diese Ebene ist keine Abteilung bestimmbar.'; return }
      reviewerRef = { kind: 'department_role', departmentId: selectedDepartmentId.value, role: reviewerRole.value as never }
    } else {
      if (selectedEntry.value.scope !== 'team' || !selectedDepartmentId.value) {
        reviewerError.value = 'Eine Team-Rolle ist nur auf einer Team-Ebene möglich.'
        return
      }
      reviewerRef = { kind: 'team_role', departmentId: selectedDepartmentId.value, teamId: selectedEntry.value.scopeId, role: reviewerRole.value as never }
    }
    await $fetch(`${config.public.apiBase}/v1/policy-reviewers`, {
      method: 'POST', headers, body: { scope: selectedEntry.value.scope, scopeId: selectedEntry.value.scopeId, ref: reviewerRef },
    })
    reviewerUserId.value = ''
    reviewerRole.value = ''
    await load()
  } catch {
    reviewerError.value = 'Die Prüferzuweisung konnte nicht angelegt werden.'
  } finally {
    reviewerAdding.value = false
  }
}

async function removeReviewer(id: string) {
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/policy-reviewers/${id}`, { method: 'DELETE', headers })
    await load()
  } catch {
    actionError.value = 'Die Prüferzuweisung konnte nicht entfernt werden.'
  }
}

function reviewerLabel(reviewer: { kind: string; userId: string | null; role: string | null; targetDepartmentId: string | null; targetTeamId: string | null }) {
  if (reviewer.kind === 'user') return members.value.find((member) => member.userId === reviewer.userId)?.displayName ?? 'Unbekannt'
  const role = roleLabels[reviewer.role ?? ''] ?? reviewer.role
  if (reviewer.kind === 'organization_role') return `Rolle „${role}“ im Verein`
  if (reviewer.kind === 'department_role') return `Rolle „${role}“ in ${organization.value?.departments.find((department) => department.id === reviewer.targetDepartmentId)?.name ?? 'Abteilung'}`
  return `Rolle „${role}“ im Team`
}
</script>

<template>
  <div>
    <div class="eyebrow mb-3">Regelwerk</div>
    <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Richtlinien</h1>
    <p class="mt-2 text-sm text-[#727a75]">Wer einreichen darf, ob geprüft wird und von wem — je Verein, Abteilung und Team.</p>

    <div v-if="loading" class="mt-8 p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="errorMessage" class="mt-8 text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else>
      <p v-if="actionError" class="mt-6 text-sm text-amber-800">{{ actionError }}</p>

      <label class="mt-8 block"><span class="mb-1 block text-xs font-semibold">Ebene</span>
        <select v-model="selectedKey" class="focus-ring w-full max-w-sm rounded-xl border border-[#dfe0d9] p-2.5 text-sm">
          <option v-for="entry in entries" :key="entryKey(entry)" :value="entryKey(entry)">
            {{ entry.name }} ({{ entry.scope === 'organization' ? 'Verein' : entry.scope === 'department' ? 'Abteilung' : 'Team' }})
          </option>
        </select>
      </label>

      <template v-if="selectedEntry">
        <section class="card mt-6 p-6">
          <h2 class="mb-4 font-display text-base font-bold">Freigabe</h2>
          <div v-if="!selectedEntry.canEdit" class="mb-4 rounded-lg bg-[#eef1ea] p-3 text-xs text-[#5b625d]">
            Du darfst diese Ebene nicht bearbeiten — die Werte sind wirksam (effective), nicht änderbar.
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="flex items-center gap-2"><input v-model="draft.reviewRequired" type="checkbox" :disabled="!selectedEntry.canEdit" /> <span class="text-sm">Prüfung auf dieser Ebene erforderlich</span></label>
            <label v-if="draft.reviewRequired"><span class="mb-1 block text-xs font-semibold">Modus</span>
              <select v-model="draft.reviewMode" :disabled="!selectedEntry.canEdit" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm">
                <option :value="null">geerbt</option>
                <option value="any_with_permission">jede Person mit Freigaberecht im Scope</option>
                <option value="named">nur benannte Prüfer</option>
              </select>
            </label>
            <label v-if="draft.reviewRequired"><span class="mb-1 block text-xs font-semibold">Bezeichnung der Stufe</span>
              <input v-model="draft.reviewStageLabel" :disabled="!selectedEntry.canEdit" placeholder="z. B. Medienverantwortliche" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
            </label>
            <label v-if="draft.reviewRequired"><span class="mb-1 block text-xs font-semibold">Mindestanzahl Freigaben</span>
              <input v-model.number="draft.reviewMinimumApprovals" type="number" min="1" max="5" :disabled="!selectedEntry.canEdit" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
            </label>
            <label v-if="draft.reviewRequired"><span class="mb-1 block text-xs font-semibold">Frist (Stunden)</span>
              <input v-model.number="draft.reviewDeadlineHours" type="number" min="1" max="720" :disabled="!selectedEntry.canEdit" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
            </label>
            <label class="flex items-center gap-2"><input v-model="draft.minorApprovalRequired" type="checkbox" :disabled="!selectedEntry.canEdit" /> <span class="text-sm">Minderjährigenschutz erzwingen</span></label>
            <label class="flex items-center gap-2"><input v-model="draft.mediaRequiresConsentCheck" type="checkbox" :disabled="!selectedEntry.canEdit" /> <span class="text-sm">Einwilligungsprüfung bei Medien</span></label>
            <label class="flex items-center gap-2"><input v-model="draft.consentExpiresOnLeave" type="checkbox" :disabled="!selectedEntry.canEdit" /> <span class="text-sm">Einwilligung endet, wenn die Person den Verein verlässt</span></label>
            <label><span class="mb-1 block text-xs font-semibold">Gültigkeitsdauer neuer Einwilligungen (Monate)</span>
              <input v-model.number="draft.consentValidityMonths" type="number" min="1" max="120" placeholder="unbegrenzt" :disabled="!selectedEntry.canEdit" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
            </label>
            <label class="flex items-center gap-2">
              <input :checked="draft.selfApprovalAllowed === false" type="checkbox" :disabled="!selectedEntry.canEdit" @change="draft.selfApprovalAllowed = ($event.target as HTMLInputElement).checked ? false : null" />
              <span class="text-sm">Selbstfreigabe verbieten</span>
            </label>
            <label class="flex items-center gap-2">
              <input :checked="draft.allowSameReviewerAcrossStages === false" type="checkbox" :disabled="!selectedEntry.canEdit" @change="draft.allowSameReviewerAcrossStages = ($event.target as HTMLInputElement).checked ? false : null" />
              <span class="text-sm">Dieselbe Person darf nicht auf zwei Stufen entscheiden</span>
            </label>
            <label v-if="selectedEntry.scope === 'organization'" class="flex items-center gap-2">
              <input :checked="draft.allowReviewExemptions === false" type="checkbox" :disabled="!selectedEntry.canEdit" @change="draft.allowReviewExemptions = ($event.target as HTMLInputElement).checked ? false : null" />
              <span class="text-sm">Befreiungen vom Prüfzwang vereinsweit verbieten</span>
            </label>
          </div>
        </section>

        <section class="card mt-4 p-6">
          <h2 class="mb-4 font-display text-base font-bold">Inhalt und Kanäle</h2>
          <div class="grid gap-4 sm:grid-cols-2">
            <label><span class="mb-1 block text-xs font-semibold">Erlaubte Anlässe (Presets, kommagetrennt, leer = keine Einschränkung)</span>
              <input v-model="allowedPresetsText" :disabled="!selectedEntry.canEdit" placeholder="z. B. match_result, training" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Verbotene Themen (kommagetrennt)</span>
              <input v-model="forbiddenTopicsText" :disabled="!selectedEntry.canEdit" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
            </label>
            <label><span class="mb-1 block text-xs font-semibold">Pflicht-Hashtags (kommagetrennt)</span>
              <input v-model="requiredHashtagsText" :disabled="!selectedEntry.canEdit" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" />
            </label>
          </div>
          <div class="mt-4 border-t border-[#e8e9e2] pt-4">
            <span class="mb-1 block text-xs font-semibold">Zielplattform-Vorgabe der Textwerkstatt</span>
            <DefaultTargetPlatformsPicker
              v-model:own-value="draft.defaultTargetPlatforms"
              :disabled="!selectedEntry.canEdit"
              :inherited-value="inheritedTargetPlatforms"
            />
          </div>
          <p v-if="saveError" class="mt-3 text-xs text-amber-800">{{ saveError }}</p>
          <button v-if="selectedEntry.canEdit" type="button" :disabled="saving" class="focus-ring mt-4 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="save">
            {{ saving ? 'Wird gespeichert …' : 'Speichern' }}
          </button>
        </section>

        <section class="card mt-4 p-6">
          <h2 class="mb-1 font-display text-base font-bold">Zuständige Prüfer</h2>
          <p class="mb-4 text-[10px] text-[#7b827d]">Wer auf dieser Ebene prüft — als Person oder als Rolle. Wer die Rolle verlässt, verliert die Prüfrolle automatisch.</p>
          <ul class="mb-4 space-y-2">
            <li v-for="reviewer in selectedEntry.reviewers" :key="reviewer.id" class="flex items-center justify-between gap-3 rounded-lg bg-[#f7f8f4] px-3 py-2 text-sm">
              <span>{{ reviewerLabel(reviewer) }}</span>
              <button v-if="selectedEntry.canEdit" type="button" class="focus-ring text-[#8a9186] hover:text-amber-800" @click="removeReviewer(reviewer.id)"><X :size="14" /></button>
            </li>
            <li v-if="!selectedEntry.reviewers.length" class="text-xs text-[#9aa096]">Noch keine Prüfer zugewiesen — im Modus „jede Person mit Freigaberecht“ auch nicht nötig.</li>
          </ul>
          <form v-if="selectedEntry.canEdit" class="grid gap-3 sm:grid-cols-3" @submit.prevent="addReviewer">
            <label><span class="mb-1 block text-xs font-semibold">Art</span>
              <select v-model="reviewerKind" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm">
                <option v-for="option in availableKindsForReviewer" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label v-if="reviewerKind === 'user'" class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Person</span>
              <select v-model="reviewerUserId" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm">
                <option value="" disabled>Person wählen</option>
                <option v-for="member in members" :key="member.userId" :value="member.userId">{{ member.displayName }}</option>
              </select>
            </label>
            <label v-else class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Rolle</span>
              <select v-model="reviewerRole" required class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm">
                <option value="" disabled>Rolle wählen</option>
                <option v-for="role in availableRolesForReviewer" :key="role" :value="role">{{ roleLabels[role] ?? role }}</option>
              </select>
            </label>
            <div class="sm:col-span-3">
              <p v-if="reviewerError" class="mb-2 text-xs text-amber-800">{{ reviewerError }}</p>
              <button type="submit" :disabled="reviewerAdding" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-xs font-semibold disabled:opacity-60">
                {{ reviewerAdding ? 'Wird hinzugefügt …' : 'Prüfer hinzufügen' }}
              </button>
            </div>
          </form>
        </section>
      </template>
      <p v-else class="mt-8 text-center text-xs text-[#9aa096]">Keine Ebene verfügbar.</p>
    </template>
  </div>
</template>
