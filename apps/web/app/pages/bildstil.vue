<script setup lang="ts">
import { LoaderCircle, Upload } from '@lucide/vue'
import {
  CreateImageStylePresetRequestSchema,
  ImageStylePresetSchema,
  BrandLogoAssetKindSchema,
  UpdateImageStylePresetRequestSchema,
  type ImageStylePreset,
} from '@vereinsfunk/contracts'
import { isBrandAssetSelectable } from '@vereinsfunk/domain'
import { z } from 'zod'
import {
  emptyImageStylePresetDraft,
  type ImageStylePresetDraft,
} from '../utils/imageStylePresetDraft'
import { selectableImageStylePresets } from '../utils/imageStylePresets'

interface BrandAssetOption {
  id: string
  departmentId: string | null
  teamId: string | null
  objectPath: string
  signedUrl: string
  kind: string
}

const api = useApiClient()
const session = await useSession()
const {
  organizationId,
  departmentId: activeDepartmentId,
  teamId: activeTeamId,
  level: activeLevel,
} = await useActiveScope()
const supabase = useSupabaseClient()
const activeOrganization = computed(
  () => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null,
)

const loading = ref(true)
const loadError = ref(false)
const saving = ref(false)
let latestLoadRun = 0

const presets = ref<ImageStylePreset[]>([])
const frameAssets = ref<BrandAssetOption[]>([])
const logoAssets = ref<BrandAssetOption[]>([])
const orgColors = reactive({ primaryColor: '#163a2c', accentColor: '#caff4a' })
const workshopFile = ref<File | null>(null)
const workshopResultFile = ref<File | null>(null)
const workshopPreviewUrl = ref('')

// Die technische Liste enthält Altwerte für wiederhergestellte Daten; im Produkt werden sie alle
// als einheitliches Logo behandelt. Neue Uploads nutzen logo_primary.
const LOGO_ASSET_KINDS = BrandLogoAssetKindSchema.options

function resetScopeDependentDraft() {
  // selectableFrameAssets/selectableLogoAssets sind von der aktiven Ebene abhaengig -- ein im
  // Anlage-Entwurf gewaehltes Rahmen-/Logo-Asset der alten Ebene kann in der neuen fehlen und
  // faellt sonst erst beim Speichern als invalid_asset_reference auf. Nur die betroffenen
  // Entwurfsfelder zuruecksetzen, nicht den ganzen Entwurf -- unabhaengige Eingaben (Name,
  // Filter, ...) sollen einen bloßen Ebenenwechsel ueberleben.
  if (!selectableFrameAssets.value.some((asset) => asset.id === draft.value.frameBrandAssetId))
    draft.value.frameBrandAssetId = null
  if (!selectableLogoAssets.value.some((asset) => asset.id === draft.value.logoBrandAssetId))
    draft.value.logoBrandAssetId = null
  // Der Canvas arbeitet immer mit activeDraft. Beim Ebenenwechsel darf er deshalb keinen
  // unsichtbaren Entwurf eines Presets der vorherigen Ebene weiterbearbeiten.
  if (editingId.value && !ownPresets.value.some((preset) => preset.id === editingId.value)) {
    editingId.value = null
    editError.value = ''
  }
  createError.value = ''
  uploadError.value = ''
  deleteError.value = ''
}

const canManageActiveLevel = computed(() => {
  if (!organizationId.value) return false
  return useCan('brand.manage', {
    organizationId: organizationId.value,
    departmentId: activeDepartmentId.value ?? undefined,
    teamId: activeTeamId.value ?? undefined,
  })
})

// "Erben, bis die Ebene ein eigenes Preset anlegt" (plans/045): alle Presets, die von hier aus
// waehlbar waeren -- eigene UND vererbte von oben, dieselbe Richtung wie brand_assets.
const visiblePresets = computed(() =>
  selectableImageStylePresets(
    presets.value,
    activeLevel.value,
    activeDepartmentId.value ?? undefined,
    activeTeamId.value ?? undefined,
  ),
)
const ownPresets = computed(() =>
  visiblePresets.value.filter(
    (preset) =>
      preset.departmentId === activeDepartmentId.value && preset.teamId === activeTeamId.value,
  ),
)
const inheritedPresets = computed(() =>
  visiblePresets.value.filter((preset) => !ownPresets.value.includes(preset)),
)

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
  if (preset.departmentId)
    return (
      organization.departments.find((item) => item.id === preset.departmentId)?.name ?? 'Abteilung'
    )
  return 'Verein'
}

function assetOption(asset: BrandAssetOption): {
  id: string
  signedUrl: string
  label: string
  kind: string
} {
  const label = asset.teamId
    ? 'aus dieser Mannschaft'
    : asset.departmentId
      ? 'aus dieser Abteilung'
      : 'vom Verein'
  return { id: asset.id, signedUrl: asset.signedUrl, label, kind: asset.kind }
}
const selectableFrameAssets = computed(() =>
  frameAssets.value
    .filter((asset) =>
      isBrandAssetSelectable(
        {
          scope: asset.teamId ? 'team' : asset.departmentId ? 'department' : 'organization',
          departmentId: asset.departmentId ?? undefined,
          teamId: asset.teamId ?? undefined,
        },
        activeLevel.value,
        activeDepartmentId.value ?? undefined,
        activeTeamId.value ?? undefined,
      ),
    )
    .map(assetOption),
)
const selectableLogoAssets = computed(() =>
  logoAssets.value
    .filter((asset) =>
      isBrandAssetSelectable(
        {
          scope: asset.teamId ? 'team' : asset.departmentId ? 'department' : 'organization',
          departmentId: asset.departmentId ?? undefined,
          teamId: asset.teamId ?? undefined,
        },
        activeLevel.value,
        activeDepartmentId.value ?? undefined,
        activeTeamId.value ?? undefined,
      ),
    )
    .map(assetOption),
)

async function loadAll() {
  const loadRun = ++latestLoadRun
  if (!organizationId.value) {
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = false
  try {
    const [brandAssetsResult, orgBrandResult, presetsResponse] = await Promise.all([
      supabase
        .from('brand_assets')
        .select('id, department_id, team_id, kind, object_path')
        .eq('organization_id', organizationId.value)
        .eq('status', 'ready')
        .in('kind', ['frame', ...LOGO_ASSET_KINDS]),
      supabase
        .from('organization_brand_profiles')
        .select('primary_color, accent_color')
        .eq('organization_id', organizationId.value)
        .maybeSingle(),
      api.request(
        '/v1/image-style-presets',
        { query: { organizationId: organizationId.value } },
        z.object({ presets: z.array(ImageStylePresetSchema) }),
      ),
    ])
    if (brandAssetsResult.error || orgBrandResult.error) {
      if (loadRun !== latestLoadRun) return
      loadError.value = true
      return
    }
    if (loadRun !== latestLoadRun) return
    if (orgBrandResult.data) {
      orgColors.primaryColor = orgBrandResult.data.primary_color
      orgColors.accentColor = orgBrandResult.data.accent_color
    }
    const signedUrls = await Promise.all(
      brandAssetsResult.data.map(
        async (row) =>
          [
            row.id,
            (await supabase.storage.from('brand-assets').createSignedUrl(row.object_path, 600)).data
              ?.signedUrl ?? '',
          ] as const,
      ),
    )
    if (loadRun !== latestLoadRun) return
    const urlById = Object.fromEntries(signedUrls)
    frameAssets.value = brandAssetsResult.data
      .filter((row) => row.kind === 'frame')
      .map((row) => ({
        id: row.id,
        departmentId: row.department_id,
        teamId: row.team_id,
        objectPath: row.object_path,
        signedUrl: urlById[row.id] ?? '',
        kind: row.kind,
      }))
    logoAssets.value = brandAssetsResult.data
      .filter((row) => row.kind !== 'frame')
      .map((row) => ({
        id: row.id,
        departmentId: row.department_id,
        teamId: row.team_id,
        objectPath: row.object_path,
        signedUrl: urlById[row.id] ?? '',
        kind: row.kind,
      }))
    presets.value = presetsResponse.presets
  } catch {
    if (loadRun === latestLoadRun) loadError.value = true
  } finally {
    if (loadRun === latestLoadRun) loading.value = false
  }
}
await loadAll()
watch(organizationId, () => {
  void loadAll()
})
watch([activeLevel, activeDepartmentId], resetScopeDependentDraft)

// --- Bausteine hochladen (Rahmengrafik/Logo) ------------------------------------------------
//
// Dieselbe Route wie die Marke-Seite (POST /v1/brand/assets), nur mit kind='frame'/'logo_primary'.
const uploadingAsset = ref(false)
const uploadError = ref('')
async function uploadBrandAsset(event: Event, kind: 'frame' | 'logo_primary') {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  ;(event.target as HTMLInputElement).value = ''
  if (!file || !organizationId.value) return
  uploadingAsset.value = true
  uploadError.value = ''
  try {
    const formData = new FormData()
    formData.append('organizationId', organizationId.value)
    if (activeDepartmentId.value) formData.append('departmentId', activeDepartmentId.value)
    if (activeLevel.value === 'team' && activeTeamId.value)
      formData.append('teamId', activeTeamId.value)
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

function updateWorkshopPreview(file: File) {
  if (workshopPreviewUrl.value) URL.revokeObjectURL(workshopPreviewUrl.value)
  workshopPreviewUrl.value = URL.createObjectURL(file)
}
function openPhotoWorkshop(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  ;(event.target as HTMLInputElement).value = ''
  if (!file) return
  workshopFile.value = file
}
function acceptWorkshopFile(file: File) {
  workshopResultFile.value = file
  updateWorkshopPreview(file)
  workshopFile.value = null
}
function closePhotoWorkshop() {
  workshopFile.value = null
}
function reopenPhotoWorkshop() {
  if (workshopResultFile.value) workshopFile.value = workshopResultFile.value
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
    name: preset.name,
    frameType: preset.frameType,
    frameStyle: preset.frameStyle,
    frameColor: preset.frameColor,
    frameWidthPx: preset.frameWidthPx,
    frameCornerRadiusPx: preset.frameCornerRadiusPx,
    frameBrandAssetId: preset.frameBrandAssetId,
    logoEnabled: preset.logoEnabled,
    logoBrandAssetId: preset.logoBrandAssetId,
    logoPosition: preset.logoPosition,
    logoSizePercent: preset.logoSizePercent,
    logoMarginPercent: preset.logoMarginPercent,
    filter: preset.filter,
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

onBeforeUnmount(() => {
  if (workshopPreviewUrl.value) URL.revokeObjectURL(workshopPreviewUrl.value)
})
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Vereinsprofil</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Bildstil</h1>
      <p class="mt-2 text-sm text-[#727a75]">
        Rahmen, Logos und Filter für Beitragsfotos — je Verein, Abteilung oder Mannschaft.
      </p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <div v-else-if="loadError" class="card p-8 text-center text-sm font-semibold text-red-700">
      Die Bildstil-Presets konnten nicht geladen werden. Bitte lade die Seite neu.
    </div>
    <template v-else>
      <PhotoImageWorkshop
        v-if="workshopFile"
        :file="workshopFile"
        :organization-id="organizationId ?? ''"
        :department-id="activeDepartmentId ?? null"
        @save="acceptWorkshopFile"
        @cancel="closePhotoWorkshop"
      />
      <div
        class="grid min-w-0 items-start gap-5 2xl:grid-cols-[minmax(0,.85fr)_minmax(0,1.75fr)_minmax(0,.8fr)]"
      >
        <div
          class="min-w-0 space-y-5 2xl:sticky 2xl:top-6 2xl:max-h-[calc(100vh-3rem)] 2xl:overflow-y-auto 2xl:pr-1"
        >
          <section v-if="!canManageActiveLevel" class="card p-6 text-center text-sm text-[#7b827d]">
            Du hast auf dieser Ebene keine Berechtigung, Bildstil-Presets zu verwalten.
          </section>
          <template v-else>
            <ImageStylePresetForm
              v-model:draft="draft"
              :saving="saving"
              :error="createError"
              :frame-assets="selectableFrameAssets"
              :logo-assets="selectableLogoAssets"
              :primary-color="orgColors.primaryColor"
              :accent-color="orgColors.accentColor"
              :organization-id="organizationId ?? ''"
              :department-id="activeDepartmentId ?? null"
              :team-id="activeTeamId ?? null"
              submit-label="Preset anlegen"
              @save="createPreset"
            />
            <section class="card p-6">
              <h2 class="font-display text-base font-bold">Bausteine für diese Ebene</h2>
              <p class="mt-1 text-xs text-[#7a817c]">
                Rahmengrafiken und Logos, die ein Preset dieser Ebene verwenden kann.
              </p>
              <div class="mt-4 flex flex-wrap gap-2">
                <label
                  class="focus-ring relative flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold"
                >
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    class="sr-only"
                    :disabled="uploadingAsset"
                    @change="uploadBrandAsset($event, 'frame')"
                  />
                  <LoaderCircle v-if="uploadingAsset" :size="12" class="animate-spin" /><Upload
                    v-else
                    :size="12"
                  />
                  Rahmengrafik hochladen
                </label>
                <label
                  class="focus-ring relative flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold"
                >
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    class="sr-only"
                    :disabled="uploadingAsset"
                    @change="uploadBrandAsset($event, 'logo_primary')"
                  />
                  <LoaderCircle v-if="uploadingAsset" :size="12" class="animate-spin" /><Upload
                    v-else
                    :size="12"
                  />
                  Logo hochladen
                </label>
              </div>
              <p v-if="uploadError" class="mt-2 text-[11px] text-amber-800">{{ uploadError }}</p>
            </section>
          </template>
        </div>

        <div class="min-w-0 2xl:sticky 2xl:top-6 2xl:self-start">
          <section class="card overflow-hidden">
            <div class="border-b border-[#e9ebe4] p-6">
              <h2 class="font-display text-base font-bold">Bildwerkstatt</h2>
              <p class="mt-1 text-xs text-[#7a817c]">
                Testfoto auswählen und Zuschnitt, Filter, Rahmen oder Logo direkt ausprobieren.
              </p>
              <div class="mt-4 flex flex-wrap gap-2">
                <label
                  class="focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white"
                >
                  <Upload :size="14" />
                  Testfoto auswählen
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    class="sr-only"
                    @change="openPhotoWorkshop"
                  />
                </label>
                <button
                  v-if="workshopResultFile"
                  type="button"
                  class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-xs font-semibold"
                  @click="reopenPhotoWorkshop"
                >
                  Erneut bearbeiten
                </button>
              </div>
            </div>
            <div class="bg-[#f7f8f6] p-4">
              <img
                v-if="workshopPreviewUrl"
                :src="workshopPreviewUrl"
                alt="Vorschau des bearbeiteten Testfotos"
                class="mx-auto max-h-[min(60vh,720px)] w-full rounded-xl object-contain"
              />
              <div
                v-else
                class="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-[#cfd5ce] px-6 text-center text-sm text-[#7a817c]"
              >
                Wähle ein Testfoto aus, um die neue Bildwerkstatt zu öffnen.
              </div>
            </div>
          </section>
        </div>

        <div class="min-w-0 space-y-5">
          <section class="card p-6">
            <h2 class="mb-4 font-display text-base font-bold">
              Presets dieser Ebene ({{ ownPresets.length }})
            </h2>
            <div
              v-for="preset in ownPresets"
              :key="preset.id"
              class="border-t border-[#e9ebe4] py-4 first:border-t-0 first:pt-0"
            >
              <template v-if="editingId === preset.id">
                <ImageStylePresetForm
                  v-model:draft="editDraft"
                  :saving="editSaving"
                  :error="editError"
                  :frame-assets="selectableFrameAssets"
                  :logo-assets="selectableLogoAssets"
                  :primary-color="orgColors.primaryColor"
                  :accent-color="orgColors.accentColor"
                  :organization-id="organizationId ?? ''"
                  :department-id="activeDepartmentId ?? null"
                  :team-id="activeTeamId ?? null"
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
                    <button
                      type="button"
                      class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[11px] font-semibold"
                      @click="startEdit(preset)"
                    >
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      :disabled="deletingId === preset.id"
                      class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                      @click="deletePreset(preset)"
                    >
                      {{ deletingId === preset.id ? 'Wird gelöscht …' : 'Löschen' }}
                    </button>
                  </div>
                </div>
              </template>
            </div>
            <p v-if="!ownPresets.length" class="py-4 text-center text-xs text-[#9aa096]">
              Noch kein eigenes Preset auf dieser Ebene angelegt.
            </p>
          </section>

          <section v-if="inheritedPresets.length" class="card p-6">
            <h2 class="mb-4 font-display text-base font-bold">
              Geerbt von oben ({{ inheritedPresets.length }})
            </h2>
            <div
              v-for="preset in inheritedPresets"
              :key="preset.id"
              class="border-t border-[#e9ebe4] py-3 first:border-t-0 first:pt-0"
            >
              <p class="text-sm font-semibold">{{ preset.name }}</p>
              <p class="mt-1 text-[11px] text-[#9aa096]">{{ scopeLabel(preset) }}</p>
            </div>
          </section>

          <p v-if="deleteError" class="text-sm text-amber-800">{{ deleteError }}</p>
        </div>
      </div>
    </template>
  </div>
</template>
