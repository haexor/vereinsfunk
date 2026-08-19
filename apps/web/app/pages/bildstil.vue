<script setup lang="ts">
import { LoaderCircle, Upload } from '@lucide/vue'
import { CreateImageStylePresetRequestSchema, ImageStylePresetSchema, UpdateImageStylePresetRequestSchema, type ImageStylePreset } from '@vereinsfunk/contracts'
import { isBrandAssetSelectable, type ScopeLevelName } from '@vereinsfunk/domain'
import { z } from 'zod'
import { emptyImageStylePresetDraft, type ImageStylePresetDraft } from '../utils/imageStylePresetDraft'
import { selectableImageStylePresets } from '../utils/imageStylePresets'

interface DepartmentRow { id: string; name: string }
interface TeamRow { id: string; name: string; departmentId: string }
interface BrandAssetOption { id: string; departmentId: string | null; teamId: string | null; objectPath: string; signedUrl: string }

const api = useApiClient()
const session = await useSession()
const scope = await useScope()
const supabase = useSupabaseClient()
const organizationId = computed(() => scope.value?.organizationId ?? null)
const activeOrganization = computed(() => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)

const loading = ref(true)
const loadError = ref(false)
const saving = ref(false)

const departments = ref<DepartmentRow[]>([])
const teams = ref<TeamRow[]>([])
const presets = ref<ImageStylePreset[]>([])
const frameAssets = ref<BrandAssetOption[]>([])
const logoAssets = ref<BrandAssetOption[]>([])
const orgColors = reactive({ primaryColor: '#163a2c', accentColor: '#caff4a' })

const activeLevel = ref<ScopeLevelName>('organization')
const activeDepartmentId = ref<string | null>(null)
const activeTeamId = ref<string | null>(null)

function selectScope(level: ScopeLevelName, departmentId: string | null, teamId: string | null) {
  activeLevel.value = level
  activeDepartmentId.value = departmentId
  activeTeamId.value = teamId
  // selectableFrameAssets/selectableLogoAssets sind von der aktiven Ebene abhaengig -- ein
  // Rahmen-/Logo-Asset, das in der alten Ebene waehlbar war, kann in der neuen fehlen. Ohne
  // Reset bliebe die veraltete Asset-ID im Entwurf stehen und faellt erst beim Speichern als
  // invalid_asset_reference auf.
  draft.value = emptyImageStylePresetDraft()
  editingId.value = null
}

const canManageActiveLevel = computed(() => {
  if (!organizationId.value) return false
  return useCan('brand.manage', { organizationId: organizationId.value, departmentId: activeDepartmentId.value ?? undefined, teamId: activeTeamId.value ?? undefined })
})

// "Erben, bis die Ebene ein eigenes Preset anlegt" (plans/045): alle Presets, die von hier aus
// waehlbar waeren -- eigene UND vererbte von oben, dieselbe Richtung wie brand_assets.
const visiblePresets = computed(() => selectableImageStylePresets(presets.value, activeLevel.value, activeDepartmentId.value ?? undefined, activeTeamId.value ?? undefined))
const ownPresets = computed(() => visiblePresets.value.filter((preset) => preset.departmentId === activeDepartmentId.value && preset.teamId === activeTeamId.value))
const inheritedPresets = computed(() => visiblePresets.value.filter((preset) => !ownPresets.value.includes(preset)))

function scopeLabel(preset: ImageStylePreset): string {
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

function assetOption(asset: BrandAssetOption): { id: string; signedUrl: string; label: string } {
  const label = asset.teamId ? 'aus dieser Mannschaft' : asset.departmentId ? 'aus dieser Abteilung' : 'vom Verein'
  return { id: asset.id, signedUrl: asset.signedUrl, label }
}
const selectableFrameAssets = computed(() =>
  frameAssets.value
    .filter((asset) => isBrandAssetSelectable({ scope: asset.teamId ? 'team' : asset.departmentId ? 'department' : 'organization', departmentId: asset.departmentId ?? undefined, teamId: asset.teamId ?? undefined }, activeLevel.value, activeDepartmentId.value ?? undefined, activeTeamId.value ?? undefined))
    .map(assetOption),
)
const selectableLogoAssets = computed(() =>
  logoAssets.value
    .filter((asset) => isBrandAssetSelectable({ scope: asset.teamId ? 'team' : asset.departmentId ? 'department' : 'organization', departmentId: asset.departmentId ?? undefined, teamId: asset.teamId ?? undefined }, activeLevel.value, activeDepartmentId.value ?? undefined, activeTeamId.value ?? undefined))
    .map(assetOption),
)

function resolveFrameColor(frameColor: string | null): string {
  if (frameColor === 'primary') return orgColors.primaryColor
  if (frameColor === 'accent') return orgColors.accentColor
  return frameColor ?? 'transparent'
}
function signedUrlFor(assets: BrandAssetOption[], assetId: string | null): string {
  return assets.find((asset) => asset.id === assetId)?.signedUrl ?? ''
}

async function loadAll() {
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  loadError.value = false
  try {
    const [departmentsResult, teamsResult, brandAssetsResult, orgBrandResult, presetsResponse] = await Promise.all([
      supabase.from('departments').select('id, name').eq('organization_id', organizationId.value).is('archived_at', null).order('name'),
      supabase.from('teams').select('id, name, department_id').eq('organization_id', organizationId.value).is('archived_at', null).order('name'),
      supabase.from('brand_assets').select('id, department_id, team_id, kind, object_path').eq('organization_id', organizationId.value).eq('status', 'ready').in('kind', ['frame', 'watermark']),
      supabase.from('organization_brand_profiles').select('primary_color, accent_color').eq('organization_id', organizationId.value).maybeSingle(),
      api.request('/v1/image-style-presets', { query: { organizationId: organizationId.value } }, z.object({ presets: z.array(ImageStylePresetSchema) })),
    ])
    if (departmentsResult.error || teamsResult.error || brandAssetsResult.error || orgBrandResult.error) { loadError.value = true; return }
    departments.value = departmentsResult.data.map((row) => ({ id: row.id, name: row.name }))
    teams.value = teamsResult.data.map((row) => ({ id: row.id, name: row.name, departmentId: row.department_id }))
    if (orgBrandResult.data) {
      orgColors.primaryColor = orgBrandResult.data.primary_color
      orgColors.accentColor = orgBrandResult.data.accent_color
    }
    const signedUrls = await Promise.all(
      brandAssetsResult.data.map(async (row) => [row.id, (await supabase.storage.from('brand-assets').createSignedUrl(row.object_path, 600)).data?.signedUrl ?? ''] as const),
    )
    const urlById = Object.fromEntries(signedUrls)
    frameAssets.value = brandAssetsResult.data.filter((row) => row.kind === 'frame').map((row) => ({ id: row.id, departmentId: row.department_id, teamId: row.team_id, objectPath: row.object_path, signedUrl: urlById[row.id] ?? '' }))
    logoAssets.value = brandAssetsResult.data.filter((row) => row.kind === 'watermark').map((row) => ({ id: row.id, departmentId: row.department_id, teamId: row.team_id, objectPath: row.object_path, signedUrl: urlById[row.id] ?? '' }))
    presets.value = presetsResponse.presets
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
await loadAll()

// --- Bausteine hochladen (Rahmengrafik/Wasserzeichen) --------------------------------------
//
// Dieselbe Route wie die Marke-Seite (POST /v1/brand/assets), nur mit kind='frame'/'watermark'
// statt logo_mark/wordmark -- keine neue Upload-Route noetig (plans/045, PR1 Schritt 2).
const uploadingAsset = ref(false)
const uploadError = ref('')
async function uploadBrandAsset(event: Event, kind: 'frame' | 'watermark') {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  ;(event.target as HTMLInputElement).value = ''
  if (!file || !organizationId.value) return
  uploadingAsset.value = true
  uploadError.value = ''
  try {
    const formData = new FormData()
    formData.append('organizationId', organizationId.value)
    if (activeDepartmentId.value) formData.append('departmentId', activeDepartmentId.value)
    if (activeLevel.value === 'team' && activeTeamId.value) formData.append('teamId', activeTeamId.value)
    formData.append('kind', kind)
    formData.append('file', file)
    await api.request('/v1/brand/assets', { method: 'POST', body: formData })
    await loadAll()
  } catch {
    uploadError.value = 'Die Datei konnte nicht hochgeladen werden. Bitte Format und Größe prüfen.'
  } finally {
    uploadingAsset.value = false
  }
}

// --- Anlage ------------------------------------------------------------------------------

const draft = ref<ImageStylePresetDraft>(emptyImageStylePresetDraft())
const createError = ref('')

async function createPreset() {
  if (!organizationId.value) return
  saving.value = true
  createError.value = ''
  try {
    const body = CreateImageStylePresetRequestSchema.parse({
      ...draft.value,
      organizationId: organizationId.value,
      departmentId: activeDepartmentId.value ?? undefined,
      teamId: activeTeamId.value ?? undefined,
    })
    await api.request('/v1/image-style-presets', { method: 'POST', body })
    draft.value = emptyImageStylePresetDraft()
    await loadAll()
  } catch {
    createError.value = 'Das Preset konnte nicht angelegt werden.'
  } finally {
    saving.value = false
  }
}

// --- Bearbeitung ---------------------------------------------------------------------------

const editingId = ref<string | null>(null)
const editDraft = ref<ImageStylePresetDraft>(emptyImageStylePresetDraft())
const editSaving = ref(false)
const editError = ref('')

function startEdit(preset: ImageStylePreset) {
  editingId.value = preset.id
  editDraft.value = {
    name: preset.name, frameType: preset.frameType, frameColor: preset.frameColor, frameWidthPx: preset.frameWidthPx,
    frameCornerRadiusPx: preset.frameCornerRadiusPx, frameBrandAssetId: preset.frameBrandAssetId,
    logoEnabled: preset.logoEnabled, logoBrandAssetId: preset.logoBrandAssetId, logoPosition: preset.logoPosition,
    logoSizePercent: preset.logoSizePercent, logoMarginPercent: preset.logoMarginPercent, filter: preset.filter,
  }
  editError.value = ''
}
function cancelEdit() {
  editingId.value = null
}
async function saveEdit() {
  if (!editingId.value) return
  editSaving.value = true
  editError.value = ''
  try {
    const body = UpdateImageStylePresetRequestSchema.parse(editDraft.value)
    await api.request(`/v1/image-style-presets/${editingId.value}`, { method: 'PATCH', body })
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
async function deletePreset(preset: ImageStylePreset) {
  if (!confirm(`"${preset.name}" wirklich löschen?`)) return
  deletingId.value = preset.id
  deleteError.value = ''
  try {
    await api.request(`/v1/image-style-presets/${preset.id}`, { method: 'DELETE' })
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
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Bildstil</h1>
      <p class="mt-2 text-sm text-[#727a75]">Rahmen, Logo-Wasserzeichen und Filter für Beitragsfotos — je Verein, Abteilung oder Mannschaft.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <div v-else-if="loadError" class="card p-8 text-center text-sm font-semibold text-red-700">Die Bildstil-Presets konnten nicht geladen werden. Bitte lade die Seite neu.</div>
    <template v-else>
      <div class="card mb-6 flex flex-wrap items-center gap-2 p-4" role="group" aria-label="Bildstil-Ebene wählen">
        <button type="button" :aria-pressed="activeLevel === 'organization'" class="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold" :class="activeLevel === 'organization' ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectScope('organization', null, null)">Verein</button>
        <span v-for="department in departments" :key="department.id" class="flex items-center gap-1">
          <button type="button" :aria-pressed="activeLevel === 'department' && activeDepartmentId === department.id" class="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold" :class="activeLevel === 'department' && activeDepartmentId === department.id ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectScope('department', department.id, null)">{{ department.name }}</button>
          <button v-for="team in teams.filter((t) => t.departmentId === department.id)" :key="team.id" type="button" :aria-pressed="activeLevel === 'team' && activeTeamId === team.id" class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold" :class="activeLevel === 'team' && activeTeamId === team.id ? 'bg-forest text-white' : 'bg-[#f4f6f1] text-[#7b827d]'" @click="selectScope('team', department.id, team.id)">{{ team.name }}</button>
        </span>
      </div>

      <div class="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div class="space-y-6">
          <section v-if="!canManageActiveLevel" class="card p-6 text-center text-sm text-[#7b827d]">
            Du hast auf dieser Ebene keine Berechtigung, Bildstil-Presets zu verwalten.
          </section>
          <template v-else>
            <section class="card p-6">
              <h2 class="font-display text-base font-bold">Bausteine für diese Ebene</h2>
              <p class="mt-1 text-xs text-[#7a817c]">Rahmengrafiken und Wasserzeichen, die ein Preset dieser Ebene referenzieren kann.</p>
              <div class="mt-4 flex flex-wrap gap-2">
                <label class="focus-ring flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold">
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml" class="sr-only" :disabled="uploadingAsset" @change="uploadBrandAsset($event, 'frame')" />
                  <LoaderCircle v-if="uploadingAsset" :size="12" class="animate-spin" /><Upload v-else :size="12" /> Rahmengrafik hochladen
                </label>
                <label class="focus-ring flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold">
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml" class="sr-only" :disabled="uploadingAsset" @change="uploadBrandAsset($event, 'watermark')" />
                  <LoaderCircle v-if="uploadingAsset" :size="12" class="animate-spin" /><Upload v-else :size="12" /> Wasserzeichen hochladen
                </label>
              </div>
              <p v-if="uploadError" class="mt-2 text-[11px] text-amber-800">{{ uploadError }}</p>
            </section>
            <ImageStylePresetForm
              v-model:draft="draft"
              :saving="saving"
              :error="createError"
              :frame-assets="selectableFrameAssets"
              :logo-assets="selectableLogoAssets"
              submit-label="Preset anlegen"
              @save="createPreset"
            />
          </template>

          <section class="card p-6">
            <h2 class="mb-4 font-display text-base font-bold">Presets dieser Ebene ({{ ownPresets.length }})</h2>
            <div v-for="preset in ownPresets" :key="preset.id" class="border-t border-[#e9ebe4] py-4 first:border-t-0 first:pt-0">
              <template v-if="editingId === preset.id">
                <ImageStylePresetForm
                  v-model:draft="editDraft"
                  :saving="editSaving"
                  :error="editError"
                  :frame-assets="selectableFrameAssets"
                  :logo-assets="selectableLogoAssets"
                  submit-label="Speichern"
                  cancellable
                  @save="saveEdit"
                  @cancel="cancelEdit"
                />
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
          <ImageStyleLivePreview
            :frame-width-px="(editingId ? editDraft : draft).frameWidthPx"
            :frame-corner-radius-px="(editingId ? editDraft : draft).frameCornerRadiusPx"
            :frame-color-hex="resolveFrameColor((editingId ? editDraft : draft).frameColor)"
            :custom-frame-url="(editingId ? editDraft : draft).frameType === 'custom' ? signedUrlFor(frameAssets, (editingId ? editDraft : draft).frameBrandAssetId) : ''"
            :logo-enabled="(editingId ? editDraft : draft).logoEnabled"
            :logo-url="signedUrlFor(logoAssets, (editingId ? editDraft : draft).logoBrandAssetId)"
            :logo-position="(editingId ? editDraft : draft).logoPosition"
            :logo-size-percent="(editingId ? editDraft : draft).logoSizePercent"
            :logo-margin-percent="(editingId ? editDraft : draft).logoMarginPercent"
            :filter="(editingId ? editDraft : draft).filter"
            :primary-color="orgColors.primaryColor"
            :accent-color="orgColors.accentColor"
          />
        </div>
      </div>
    </template>
  </div>
</template>
