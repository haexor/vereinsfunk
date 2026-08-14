<script setup lang="ts">
import {
  CreateCustomStyleProfileRequestSchema,
  CustomStyleProfileSchema,
  GeneratedPostSchema,
  PreviewCustomStyleProfileRequestSchema,
  UpdateCustomStyleProfileRequestSchema,
  type CustomStyleProfile,
  type GeneratedPost,
} from '@vereinsfunk/contracts'
import { avoidRulesFromDraft, doRulesFromDraft, emptyStyleProfileDraft, previewErrorMessage, styleProfileDraftFrom, styleRulesFromDraft } from '../utils/styleProfileDraft'

const api = useApiClient()
const session = await useSession()
const scope = await useScope()
const supabase = useSupabaseClient()
const organizationId = computed(() => scope.value?.organizationId ?? null)
const activeOrganization = computed(() => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)

interface ScopeChoice { key: string; label: string; departmentId: string | null; teamId: string | null }

const scopeChoices = computed<ScopeChoice[]>(() => {
  const organization = activeOrganization.value
  if (!organization || !organizationId.value) return []
  const orgId = organizationId.value
  const choices: ScopeChoice[] = []
  if (useCan('post.create', { organizationId: orgId })) choices.push({ key: 'organization', label: 'Ganzer Verein', departmentId: null, teamId: null })
  for (const department of organization.departments) {
    if (useCan('post.create', { organizationId: orgId, departmentId: department.id })) {
      choices.push({ key: `department:${department.id}`, label: department.name, departmentId: department.id, teamId: null })
    }
    for (const team of department.teams) {
      if (useCan('post.create', { organizationId: orgId, departmentId: department.id, teamId: team.id })) {
        choices.push({ key: `team:${team.id}`, label: `${department.name} – ${team.name}`, departmentId: department.id, teamId: team.id })
      }
    }
  }
  return choices
})
const canCreateAnywhere = computed(() => scopeChoices.value.length > 0)

function scopeLabel(profile: CustomStyleProfile): string {
  const organization = activeOrganization.value
  if (!organization) return 'Ganzer Verein'
  if (profile.teamId) {
    for (const department of organization.departments) {
      const team = department.teams.find((item) => item.id === profile.teamId)
      if (team) return `${department.name} – ${team.name}`
    }
    return 'Mannschaft'
  }
  if (profile.departmentId) return organization.departments.find((item) => item.id === profile.departmentId)?.name ?? 'Abteilung'
  return 'Ganzer Verein'
}
function canManage(profile: CustomStyleProfile): boolean {
  if (!organizationId.value) return false
  return useCan('post.create', { organizationId: organizationId.value, departmentId: profile.departmentId ?? undefined, teamId: profile.teamId ?? undefined })
}

const loading = ref(true)
const loadError = ref(false)
const profiles = ref<CustomStyleProfile[]>([])

async function load() {
  const requestedOrganizationId = organizationId.value
  if (!requestedOrganizationId) { loading.value = false; return }
  loading.value = true
  loadError.value = false
  try {
    const result = await supabase
      .from('content_style_profiles')
      .select('id, organization_id, department_id, team_id, slug, name, description, style_rules, avoid_rules, do_rules, is_active, created_by, created_at, updated_at')
      .eq('organization_id', requestedOrganizationId)
      .order('created_at', { ascending: false })
    // Nach dem await pruefen, ob der Verein inzwischen gewechselt hat (Muster aus layouts/default.vue).
    if (organizationId.value !== requestedOrganizationId) return
    if (result.error) { loadError.value = true; return }
    profiles.value = result.data.map((row) => CustomStyleProfileSchema.parse({
      id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
      slug: row.slug, kind: 'custom', name: row.name, description: row.description,
      styleRules: row.style_rules, avoidRules: row.avoid_rules, doRules: row.do_rules,
      isActive: row.is_active, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    }))
  } finally {
    if (organizationId.value === requestedOrganizationId) loading.value = false
  }
}
await load()
watch(organizationId, () => { void load() })

// --- Anlage ------------------------------------------------------------------------------

const selectedScopeKey = ref('')
watch(scopeChoices, (choices) => {
  if (choices.some((choice) => choice.key === selectedScopeKey.value)) return
  const preferred = scope.value?.departmentId ? choices.find((choice) => choice.departmentId === scope.value?.departmentId && choice.teamId === null) : undefined
  selectedScopeKey.value = preferred?.key ?? choices[0]?.key ?? ''
}, { immediate: true })

function slugify(value: string): string {
  const slug = value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return slug || 'profil'
}

const draft = ref(emptyStyleProfileDraft())
const creating = ref(false)
const createError = ref('')
const creatingPreviewing = ref(false)
const creatingPreviewResult = ref<GeneratedPost | null>(null)
const creatingPreviewError = ref('')
const creatingPreviewKey = ref(crypto.randomUUID())
watch(draft, () => { creatingPreviewKey.value = crypto.randomUUID() }, { deep: true })

async function createProfile() {
  const scopeChoice = scopeChoices.value.find((choice) => choice.key === selectedScopeKey.value)
  if (!organizationId.value || !scopeChoice || !draft.value.name.trim() || !draft.value.description.trim()) return
  creating.value = true
  createError.value = ''
  try {
    const body = CreateCustomStyleProfileRequestSchema.parse({
      organizationId: organizationId.value, departmentId: scopeChoice.departmentId, teamId: scopeChoice.teamId,
      slug: slugify(draft.value.name), name: draft.value.name, description: draft.value.description,
      styleRules: styleRulesFromDraft(draft.value), avoidRules: avoidRulesFromDraft(draft.value), doRules: doRulesFromDraft(draft.value),
    })
    await api.request('/v1/content-style-profiles', { method: 'POST', body })
    draft.value = emptyStyleProfileDraft()
    creatingPreviewResult.value = null
    await load()
  } catch {
    createError.value = 'Das Stilprofil konnte nicht angelegt werden. Prüfe, ob der Name in diesem Bereich schon vergeben ist.'
  } finally {
    creating.value = false
  }
}

async function previewCreate() {
  const scopeChoice = scopeChoices.value.find((choice) => choice.key === selectedScopeKey.value)
  if (!organizationId.value || !scopeChoice) return
  creatingPreviewing.value = true
  creatingPreviewError.value = ''
  try {
    const body = PreviewCustomStyleProfileRequestSchema.parse({
      organizationId: organizationId.value, departmentId: scopeChoice.departmentId, teamId: scopeChoice.teamId,
      name: draft.value.name, description: draft.value.description,
      styleRules: styleRulesFromDraft(draft.value), avoidRules: avoidRulesFromDraft(draft.value), doRules: doRulesFromDraft(draft.value),
      sampleInput: draft.value.sampleInput,
    })
    creatingPreviewResult.value = await api.request('/v1/content-style-profiles/preview', { method: 'POST', body, headers: { 'idempotency-key': creatingPreviewKey.value } }, GeneratedPostSchema)
    creatingPreviewKey.value = crypto.randomUUID()
  } catch (error) {
    creatingPreviewError.value = previewErrorMessage(error)
  } finally {
    creatingPreviewing.value = false
  }
}

// --- Bearbeitung ---------------------------------------------------------------------------

const editingId = ref<string | null>(null)
const editDraft = ref(emptyStyleProfileDraft())
const editSaving = ref(false)
const editError = ref('')
const editPreviewing = ref(false)
const editPreviewResult = ref<GeneratedPost | null>(null)
const editPreviewError = ref('')
const editPreviewKey = ref(crypto.randomUUID())
watch(editDraft, () => { editPreviewKey.value = crypto.randomUUID() }, { deep: true })

function startEdit(profile: CustomStyleProfile) {
  editingId.value = profile.id
  editDraft.value = styleProfileDraftFrom(profile)
  editError.value = ''
  editPreviewResult.value = null
  editPreviewError.value = ''
}
function cancelEdit() {
  editingId.value = null
  editPreviewResult.value = null
  editPreviewError.value = ''
}
async function saveEdit() {
  if (!editingId.value || !editDraft.value.name.trim() || !editDraft.value.description.trim()) return
  editSaving.value = true
  editError.value = ''
  try {
    const body = UpdateCustomStyleProfileRequestSchema.parse({
      name: editDraft.value.name, description: editDraft.value.description,
      styleRules: styleRulesFromDraft(editDraft.value), avoidRules: avoidRulesFromDraft(editDraft.value), doRules: doRulesFromDraft(editDraft.value),
    })
    await api.request(`/v1/content-style-profiles/${editingId.value}`, { method: 'PATCH', body })
    editingId.value = null
    editPreviewResult.value = null
    editPreviewError.value = ''
    await load()
  } catch {
    editError.value = 'Die Änderung konnte nicht gespeichert werden.'
  } finally {
    editSaving.value = false
  }
}
async function previewEdit() {
  const profile = profiles.value.find((item) => item.id === editingId.value)
  if (!profile || !organizationId.value) return
  editPreviewing.value = true
  editPreviewError.value = ''
  try {
    const body = PreviewCustomStyleProfileRequestSchema.parse({
      organizationId: organizationId.value, departmentId: profile.departmentId, teamId: profile.teamId,
      name: editDraft.value.name, description: editDraft.value.description,
      styleRules: styleRulesFromDraft(editDraft.value), avoidRules: avoidRulesFromDraft(editDraft.value), doRules: doRulesFromDraft(editDraft.value),
      sampleInput: editDraft.value.sampleInput,
    })
    editPreviewResult.value = await api.request('/v1/content-style-profiles/preview', { method: 'POST', body, headers: { 'idempotency-key': editPreviewKey.value } }, GeneratedPostSchema)
    editPreviewKey.value = crypto.randomUUID()
  } catch (error) {
    editPreviewError.value = previewErrorMessage(error)
  } finally {
    editPreviewing.value = false
  }
}

// --- Löschen ---------------------------------------------------------------------------

const deletingId = ref<string | null>(null)
const deleteError = ref('')
async function deleteProfile(profile: CustomStyleProfile) {
  if (!confirm(`"${profile.name}" wirklich löschen?`)) return
  deletingId.value = profile.id
  deleteError.value = ''
  try {
    await api.request(`/v1/content-style-profiles/${profile.id}`, { method: 'DELETE' })
    if (editingId.value === profile.id) editingId.value = null
    await load()
  } catch {
    deleteError.value = 'Das Stilprofil konnte nicht gelöscht werden.'
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-[980px] px-5 py-8 sm:px-10">
    <header class="mb-8">
      <div class="eyebrow mb-3">Verein</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Stilprofile</h1>
      <p class="mt-2 text-sm text-[#727a75]">Eigene Stilprofile für die Textwerkstatt — Tonalität, Catchphrases, Do's und Don'ts, mit denen ihr eure Beiträge formulieren lasst.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <div v-else-if="loadError" class="card p-8 text-center text-sm font-semibold text-red-700">Die Stilprofile konnten nicht geladen werden. Bitte lade die Seite neu.</div>
    <div v-else-if="!canCreateAnywhere" class="card p-8 text-center text-sm text-[#7b827d]">
      Du hast hier keine Berechtigung. Das übernimmt jemand mit der Rolle „Beiträge erstellen“ in deinem Verein, deiner Abteilung oder Mannschaft.
    </div>
    <template v-else>
      <section class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Stilprofil anlegen</h2>
        <label class="mb-4 block text-xs font-semibold text-[#5c655f]">Bereich
          <select v-model="selectedScopeKey" class="focus-ring mt-1 w-full max-w-sm rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm font-normal">
            <option v-for="choice in scopeChoices" :key="choice.key" :value="choice.key">{{ choice.label }}</option>
          </select>
        </label>
      </section>

      <StyleProfileEditorForm
        v-model:draft="draft"
        :saving="creating"
        :error="createError"
        :previewing="creatingPreviewing"
        :preview-result="creatingPreviewResult"
        :preview-error="creatingPreviewError"
        submit-label="Anlegen"
        @save="createProfile"
        @preview="previewCreate"
      />

      <section class="card p-6">
        <h2 class="mb-4 font-display text-base font-bold">Eigene Stilprofile ({{ profiles.length }})</h2>
        <div v-for="profile in profiles" :key="profile.id" class="border-t border-[#e9ebe4] py-4 first:border-t-0 first:pt-0">
          <template v-if="editingId === profile.id">
            <p class="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#9aa096]">{{ scopeLabel(profile) }}</p>
            <StyleProfileEditorForm
              v-model:draft="editDraft"
              :saving="editSaving"
              :error="editError"
              :previewing="editPreviewing"
              :preview-result="editPreviewResult"
              :preview-error="editPreviewError"
              submit-label="Speichern"
              cancellable
              @save="saveEdit"
              @preview="previewEdit"
              @cancel="cancelEdit"
            />
          </template>
          <template v-else>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold">{{ profile.name }}</p>
                <p class="mt-1 text-[11px] text-[#9aa096]">{{ scopeLabel(profile) }}</p>
                <p class="mt-1 text-xs text-[#727a75]">{{ profile.description }}</p>
              </div>
              <div v-if="canManage(profile)" class="flex shrink-0 gap-2">
                <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold" @click="startEdit(profile)">Bearbeiten</button>
                <button type="button" :disabled="deletingId === profile.id" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60" @click="deleteProfile(profile)">
                  {{ deletingId === profile.id ? 'Wird gelöscht …' : 'Löschen' }}
                </button>
              </div>
            </div>
          </template>
        </div>
        <p v-if="!profiles.length" class="py-4 text-center text-xs text-[#9aa096]">Noch kein eigenes Stilprofil angelegt.</p>
      </section>
      <p v-if="deleteError" class="mt-4 text-sm text-amber-800">{{ deleteError }}</p>
    </template>
  </div>
</template>
