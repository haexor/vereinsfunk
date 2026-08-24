<script setup lang="ts">
import { CreatePhotoLayoutPresetRequestSchema, PhotoLayoutPresetSchema, UpdatePhotoLayoutPresetRequestSchema, type PhotoLayoutPreset } from '@vereinsfunk/contracts'
import { z } from 'zod'
import { emptyPhotoLayoutPresetDraft, type PhotoLayoutPresetDraft } from '../utils/photoLayoutPresetDraft'
import { selectablePhotoLayoutPresets } from '../utils/photoLayoutPresets'

const api = useApiClient()
const session = await useSession()
const { organizationId, departmentId: activeDepartmentId, teamId: activeTeamId, level: activeLevel } = await useActiveScope()
const supabase = useSupabaseClient()
const activeOrganization = computed(() => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)

const loading = ref(true)
const loadError = ref(false)
const saving = ref(false)
let latestLoadRun = 0

const presets = ref<PhotoLayoutPreset[]>([])
const orgColors = reactive({ primaryColor: '#163a2c', accentColor: '#caff4a' })

const canManageActiveLevel = computed(() => {
  if (!organizationId.value) return false
  return useCan('brand.manage', { organizationId: organizationId.value, departmentId: activeDepartmentId.value ?? undefined, teamId: activeTeamId.value ?? undefined })
})

// "Erben, bis die Ebene ein eigenes Preset anlegt" -- alle Presets, die von hier aus waehlbar
// waeren, eigene UND vererbte von oben, dieselbe Richtung wie Bildstil-Presets.
const visiblePresets = computed(() => selectablePhotoLayoutPresets(presets.value, activeLevel.value, activeDepartmentId.value ?? undefined, activeTeamId.value ?? undefined))
const ownPresets = computed(() => visiblePresets.value.filter((preset) => preset.departmentId === activeDepartmentId.value && preset.teamId === activeTeamId.value))
const inheritedPresets = computed(() => visiblePresets.value.filter((preset) => !ownPresets.value.includes(preset)))

function scopeLabel(preset: PhotoLayoutPreset): string {
  const organization = activeOrganization.value
  if (!organization) return 'Verein'
  if (preset.teamId) {
    for (const department of organization.departments) {
      const team = department.teams.find((item) => item.id === preset.teamId)
      if (team) return `${department.name} – ${team.name}`
    }
    return 'Mannschaft'
  }
  if (preset.departmentId) return organization.departments.find((item) => item.id === preset.departmentId)?.name ?? 'Abteilung'
  return 'Verein'
}
function resolveDividerColor(dividerColor: string): string {
  if (dividerColor === 'primary') return orgColors.primaryColor
  if (dividerColor === 'accent') return orgColors.accentColor
  return dividerColor
}

async function loadAll() {
  const loadRun = ++latestLoadRun
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  loadError.value = false
  try {
    const [orgBrandResult, presetsResponse] = await Promise.all([
      supabase.from('organization_brand_profiles').select('primary_color, accent_color').eq('organization_id', organizationId.value).maybeSingle(),
      api.request('/v1/photo-layout-presets', { query: { organizationId: organizationId.value } }, z.object({ presets: z.array(PhotoLayoutPresetSchema) })),
    ])
    if (loadRun !== latestLoadRun) return
    if (orgBrandResult.error) { loadError.value = true; return }
    if (orgBrandResult.data) {
      orgColors.primaryColor = orgBrandResult.data.primary_color
      orgColors.accentColor = orgBrandResult.data.accent_color
    }
    presets.value = presetsResponse.presets
  } catch {
    loadError.value = true
  } finally {
    if (loadRun === latestLoadRun) loading.value = false
  }
}
await loadAll()
watch(organizationId, () => { void loadAll() })
watch([activeLevel, activeDepartmentId], () => {
  createError.value = ''
  deleteError.value = ''
})

// --- Anlage ------------------------------------------------------------------------------

const draft = ref<PhotoLayoutPresetDraft>(emptyPhotoLayoutPresetDraft())
const createError = ref('')

async function createPreset() {
  if (!organizationId.value) return
  saving.value = true
  createError.value = ''
  let body: z.infer<typeof CreatePhotoLayoutPresetRequestSchema>
  try {
    body = CreatePhotoLayoutPresetRequestSchema.parse({
      ...draft.value,
      organizationId: organizationId.value,
      departmentId: activeDepartmentId.value ?? undefined,
      teamId: activeTeamId.value ?? undefined,
    })
  } catch (error) {
    // Ein Schema-Fehler hier bedeutet, dass isValid im Formular etwas durchgelassen hat, das die
    // API ohnehin ablehnen wuerde -- ein Programmierfehler, keine behebbare Nutzeraktion, deshalb
    // eine andere Meldung als bei einem echten Transportfehler unten.
    console.error('CreatePhotoLayoutPresetRequestSchema rejected form draft', error)
    createError.value = 'Unerwarteter Eingabefehler. Bitte lade die Seite neu.'
    saving.value = false
    return
  }
  try {
    await api.request('/v1/photo-layout-presets', { method: 'POST', body })
    draft.value = emptyPhotoLayoutPresetDraft()
    await loadAll()
  } catch {
    createError.value = 'Das Preset konnte nicht angelegt werden.'
  } finally {
    saving.value = false
  }
}

// --- Bearbeitung ---------------------------------------------------------------------------

const editingId = ref<string | null>(null)
const editDraft = ref<PhotoLayoutPresetDraft>(emptyPhotoLayoutPresetDraft())
const editSaving = ref(false)
const editError = ref('')

function startEdit(preset: PhotoLayoutPreset) {
  editingId.value = preset.id
  editDraft.value = { name: preset.name, kind: preset.kind, dividerColor: preset.dividerColor, dividerWidthPx: preset.dividerWidthPx, cornerRadiusPx: preset.cornerRadiusPx }
  editError.value = ''
}
function cancelEdit() {
  editingId.value = null
}
async function saveEdit() {
  if (!editingId.value) return
  editSaving.value = true
  editError.value = ''
  let body: z.infer<typeof UpdatePhotoLayoutPresetRequestSchema>
  try {
    body = UpdatePhotoLayoutPresetRequestSchema.parse(editDraft.value)
  } catch (error) {
    console.error('UpdatePhotoLayoutPresetRequestSchema rejected form draft', error)
    editError.value = 'Unerwarteter Eingabefehler. Bitte lade die Seite neu.'
    editSaving.value = false
    return
  }
  try {
    await api.request(`/v1/photo-layout-presets/${editingId.value}`, { method: 'PATCH', body })
    editingId.value = null
    await loadAll()
  } catch {
    editError.value = 'Die Änderung konnte nicht gespeichert werden.'
  } finally {
    editSaving.value = false
  }
}

// --- Löschen ---------------------------------------------------------------------------

const deletingId = ref<string | null>(null)
const deleteError = ref('')
async function deletePreset(preset: PhotoLayoutPreset) {
  if (!confirm(`"${preset.name}" wirklich löschen?`)) return
  deletingId.value = preset.id
  deleteError.value = ''
  try {
    await api.request(`/v1/photo-layout-presets/${preset.id}`, { method: 'DELETE' })
    if (editingId.value === preset.id) editingId.value = null
    await loadAll()
  } catch {
    deleteError.value = 'Das Preset konnte nicht gelöscht werden.'
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Vereinsprofil</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Bildkomposition</h1>
      <p class="mt-2 text-sm text-[#727a75]">Layouts, mit denen mehrere Fotos zu einem Bild zusammengefügt werden — je Verein, Abteilung oder Mannschaft.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <div v-else-if="loadError" class="card p-8 text-center text-sm font-semibold text-red-700">Die Layout-Presets konnten nicht geladen werden. Bitte lade die Seite neu.</div>
    <template v-else>
      <div class="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div class="space-y-6">
          <section v-if="!canManageActiveLevel" class="card p-6 text-center text-sm text-[#7b827d]">
            Du hast auf dieser Ebene keine Berechtigung, Bildkomposition-Presets zu verwalten.
          </section>
          <PhotoLayoutPresetForm v-else v-model:draft="draft" :saving="saving" :error="createError" :primary-color="orgColors.primaryColor" :accent-color="orgColors.accentColor" submit-label="Preset anlegen" @save="createPreset" />

          <section class="card p-6">
            <h2 class="mb-4 font-display text-base font-bold">Presets dieser Ebene ({{ ownPresets.length }})</h2>
            <div v-for="preset in ownPresets" :key="preset.id" class="border-t border-[#e9ebe4] py-4 first:border-t-0 first:pt-0">
              <template v-if="editingId === preset.id">
                <PhotoLayoutPresetForm v-model:draft="editDraft" :saving="editSaving" :error="editError" :primary-color="orgColors.primaryColor" :accent-color="orgColors.accentColor" submit-label="Speichern" cancellable @save="saveEdit" @cancel="cancelEdit" />
              </template>
              <template v-else>
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold">{{ preset.name }}</p>
                    <p class="mt-1 text-[11px] text-[#9aa096]">{{ scopeLabel(preset) }}</p>
                  </div>
                  <div v-if="canManageActiveLevel" class="flex shrink-0 gap-2">
                    <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold" @click="startEdit(preset)">Bearbeiten</button>
                    <button type="button" :disabled="deletingId === preset.id" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60" @click="deletePreset(preset)">
                      {{ deletingId === preset.id ? 'Wird gelöscht …' : 'Löschen' }}
                    </button>
                  </div>
                </div>
              </template>
            </div>
            <p v-if="!ownPresets.length" class="py-4 text-center text-xs text-[#9aa096]">Noch kein eigenes Preset auf dieser Ebene angelegt.</p>
          </section>

          <section v-if="inheritedPresets.length" class="card p-6">
            <h2 class="mb-4 font-display text-base font-bold">Geerbt von oben ({{ inheritedPresets.length }})</h2>
            <div v-for="preset in inheritedPresets" :key="preset.id" class="border-t border-[#e9ebe4] py-3 first:border-t-0 first:pt-0">
              <p class="text-sm font-semibold">{{ preset.name }}</p>
              <p class="mt-1 text-[11px] text-[#9aa096]">{{ scopeLabel(preset) }}</p>
            </div>
          </section>

          <p v-if="deleteError" class="text-sm text-amber-800">{{ deleteError }}</p>
        </div>

        <div class="lg:sticky lg:top-6 lg:self-start">
          <PhotoLayoutPreview :kind="(editingId ? editDraft : draft).kind" :divider-color-hex="resolveDividerColor((editingId ? editDraft : draft).dividerColor)" :divider-width-px="(editingId ? editDraft : draft).dividerWidthPx" />
        </div>
      </div>
    </template>
  </div>
</template>
