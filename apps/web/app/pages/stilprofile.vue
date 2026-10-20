<script setup lang="ts">
import { isBrandAssetSelectable } from '@vereinsfunk/domain'
import {
  CreateCustomStyleProfileRequestSchema,
  CustomStyleProfileSchema,
  PreviewCustomStyleProfileRequestSchema,
  UpdateCustomStyleProfileRequestSchema,
  type CustomStyleProfile,
} from '@vereinsfunk/contracts'
import { avoidRulesFromDraft, doRulesFromDraft, emptyStyleProfileDraft, styleProfileDraftFrom, styleRulesFromDraft } from '../utils/styleProfileDraft'

const api = useApiClient()
const { organizationId, departmentId: activeDepartmentId, teamId: activeTeamId, level: activeLevel, organization: activeOrganization } = await useActiveScope()
const supabase = useSupabaseClient()
// Auch auf Vereinsebene verwaltbar (departmentId null): POST/PATCH /v1/content-style-profiles und
// CreateCustomStyleProfileRequestSchema fuehren departmentId seit je nullable, nur diese Seite hat
// eine Abteilung verlangt -- ein vereinsweites Stilprofil liess sich dadurch gar nicht anlegen.
const canManageActiveScope = computed(() => {
  if (!organizationId.value) return false
  return useCan('post.create', {
    organizationId: organizationId.value,
    departmentId: activeDepartmentId.value ?? undefined,
    teamId: activeTeamId.value ?? undefined,
  })
})

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
// "Erben, bis die Ebene ein eigenes Profil anlegt" -- dieselbe Vererbungsrichtung wie brand_assets
// und die Seiten, die sie schon spiegeln (/bildstil, /bildkomposition, /textbausteine): ein
// vereinsweites Profil ist auf jeder Ebene sichtbar, ein Abteilungsprofil in seiner Abteilung, ein
// Mannschaftsprofil nur dort. Bisher zeigte diese Seite ausschliesslich die eigene Ebene -- in einer
// Abteilung war jedes vereinsweite Stilprofil unsichtbar, obwohl /erstellen es anbietet.
const visibleProfiles = computed(() =>
  profiles.value.filter((profile) =>
    isBrandAssetSelectable(
      { scope: profile.teamId ? 'team' : profile.departmentId ? 'department' : 'organization', departmentId: profile.departmentId ?? undefined, teamId: profile.teamId ?? undefined },
      activeLevel.value,
      activeDepartmentId.value ?? undefined,
      activeTeamId.value ?? undefined,
    ),
  ),
)
const ownProfiles = computed(() =>
  visibleProfiles.value.filter(
    (profile) => (profile.departmentId ?? null) === (activeDepartmentId.value ?? null) && (profile.teamId ?? null) === (activeTeamId.value ?? null),
  ),
)
const inheritedProfiles = computed(() => visibleProfiles.value.filter((profile) => !ownProfiles.value.includes(profile)))

const { reload: load, ready } = useScopedLoad(() => organizationId.value, async (requestedOrganizationId, isLatest) => {
  if (!requestedOrganizationId) { loading.value = false; return }
  loading.value = true
  loadError.value = false
  try {
    const result = await supabase
      .from('content_style_profiles')
      .select('id, organization_id, department_id, team_id, slug, name, description, style_rules, avoid_rules, do_rules, is_active, created_by, created_at, updated_at')
      .eq('organization_id', requestedOrganizationId)
      .order('created_at', { ascending: false })
    if (!isLatest()) return
    if (result.error) { loadError.value = true; return }
    profiles.value = result.data.map((row) => CustomStyleProfileSchema.parse({
      id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
      slug: row.slug, kind: 'custom', name: row.name, description: row.description,
      styleRules: row.style_rules, avoidRules: row.avoid_rules, doRules: row.do_rules,
      isActive: row.is_active, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    }))
  } catch {
    if (isLatest()) loadError.value = true
  } finally {
    if (isLatest()) loading.value = false
  }
})
await ready
watch(activeDepartmentId, () => {
  editingId.value = null
  createError.value = ''
  deleteError.value = ''
})

// --- Anlage ------------------------------------------------------------------------------

function slugify(value: string): string {
  const slug = value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return slug || 'profil'
}

const draft = ref(emptyStyleProfileDraft())
const creating = ref(false)
const createError = ref('')
const { previewing: creatingPreviewing, result: creatingPreviewResult, error: creatingPreviewError, preview: previewCreate } = useStyleProfilePreview({
  api,
  path: '/v1/content-style-profiles/preview',
  draft,
  requestBody: () => {
    if (!organizationId.value || !canManageActiveScope.value) return null
    return PreviewCustomStyleProfileRequestSchema.parse({
      organizationId: organizationId.value,
      departmentId: activeDepartmentId.value ?? undefined, teamId: activeTeamId.value ?? undefined,
      name: draft.value.name, description: draft.value.description,
      styleRules: styleRulesFromDraft(draft.value), avoidRules: avoidRulesFromDraft(draft.value), doRules: doRulesFromDraft(draft.value),
      sampleInput: draft.value.sampleInput,
    })
  },
})

async function createProfile() {
  if (!organizationId.value || !canManageActiveScope.value || !draft.value.name.trim() || !draft.value.description.trim()) return
  creating.value = true
  createError.value = ''
  try {
    const body = CreateCustomStyleProfileRequestSchema.parse({
      organizationId: organizationId.value,
      departmentId: activeDepartmentId.value ?? undefined, teamId: activeTeamId.value ?? undefined,
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

// --- Bearbeitung ---------------------------------------------------------------------------

const editingId = ref<string | null>(null)
const editDraft = ref(emptyStyleProfileDraft())
const editSaving = ref(false)
const editError = ref('')
const { previewing: editPreviewing, result: editPreviewResult, error: editPreviewError, preview: previewEdit, reset: resetEditPreview } = useStyleProfilePreview({
  api,
  path: '/v1/content-style-profiles/preview',
  draft: editDraft,
  requestBody: () => {
    const profile = profiles.value.find((item) => item.id === editingId.value)
    if (!profile || !organizationId.value) return null
    return PreviewCustomStyleProfileRequestSchema.parse({
      organizationId: organizationId.value, departmentId: profile.departmentId, teamId: profile.teamId,
      name: editDraft.value.name, description: editDraft.value.description,
      styleRules: styleRulesFromDraft(editDraft.value), avoidRules: avoidRulesFromDraft(editDraft.value), doRules: doRulesFromDraft(editDraft.value),
      sampleInput: editDraft.value.sampleInput,
    })
  },
})

function startEdit(profile: CustomStyleProfile) {
  editingId.value = profile.id
  editDraft.value = styleProfileDraftFrom(profile)
  editError.value = ''
  resetEditPreview()
}
function cancelEdit() {
  editingId.value = null
  resetEditPreview()
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
    resetEditPreview()
    await load()
  } catch {
    editError.value = 'Die Änderung konnte nicht gespeichert werden.'
  } finally {
    editSaving.value = false
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
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Verein</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Stilprofile</h1>
      <p class="mt-2 text-sm text-[#727a75]">Eigene Stilprofile für die Textwerkstatt — Tonalität, Catchphrases, Do's und Don'ts, mit denen ihr eure Beiträge formulieren lasst.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <div v-else-if="loadError" class="card p-8 text-center text-sm font-semibold text-red-700">Die Stilprofile konnten nicht geladen werden. Bitte lade die Seite neu.</div>
    <template v-else>
      <!-- Sichtbarkeit und Verwaltung sind getrennt (wie /textbausteine): wer hier nichts anlegen
           darf, sieht die Profile dieser Ebene trotzdem -- RLS gibt sie jedem Mitglied frei. -->
      <section v-if="!canManageActiveScope" class="card mb-6 p-6 text-center text-sm text-[#7b827d]">
        Du hast in diesem Arbeitsbereich keine Berechtigung, Stilprofile zu verwalten. Das übernimmt jemand mit der Rolle „Beiträge erstellen“.
      </section>
      <StyleProfileEditorForm
        v-else
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
        <h2 class="mb-4 font-display text-base font-bold">Stilprofile dieser Ebene ({{ ownProfiles.length }})</h2>
        <div v-for="profile in ownProfiles" :key="profile.id" class="border-t border-[#e9ebe4] py-4 first:border-t-0 first:pt-0">
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
        <p v-if="!ownProfiles.length" class="py-4 text-center text-xs text-[#9aa096]">Noch kein eigenes Stilprofil auf dieser Ebene angelegt.</p>
      </section>

      <section v-if="inheritedProfiles.length" class="card mt-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Geerbt ({{ inheritedProfiles.length }})</h2>
        <div v-for="profile in inheritedProfiles" :key="profile.id" class="border-t border-[#e9ebe4] py-3 first:border-t-0 first:pt-0">
          <p class="text-sm font-semibold">{{ profile.name }}</p>
          <p class="mt-1 text-[11px] text-[#9aa096]">{{ scopeLabel(profile) }}</p>
          <p class="mt-1 text-xs text-[#727a75]">{{ profile.description }}</p>
        </div>
      </section>
      <p v-if="deleteError" class="mt-4 text-sm text-amber-800">{{ deleteError }}</p>
    </template>
  </div>
</template>
