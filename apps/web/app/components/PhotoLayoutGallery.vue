<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import { PHOTO_LAYOUT_MIN_PHOTOS, PHOTO_LAYOUT_PHOTO_COUNTS, PhotoLayoutPresetSchema, RenderPhotoLayoutResponseSchema, type PhotoLayoutPreset } from '@vereinsfunk/contracts'
import { z } from 'zod'
import { selectablePhotoLayoutPresets } from '../utils/photoLayoutPresets'

// Plan 047, PR 1: "Diese Fotos zu einem Bild zusammenfügen" -- eingebettet direkt nach
// PhotoAttachmentList.vue in erstellen.vue. mediaAssetIds wird nach erfolgreicher Komposition auf
// genau ein Element (die neue, komponierte media_asset_id) verdichtet, PR 0 bleibt dafuer
// unveraendert nutzbar. PhotoAttachment.vue/PhotoAttachmentList.vue selbst bleiben unangetastet
// (PR 0s eigene Entscheidung) -- sie koennen ein von aussen gesetztes, bereits fertiges Foto nicht
// hydrieren (ihr `phase`-Zustand kennt nur den eigenen Upload-Ablauf). composedPreview ist deshalb
// eine EIGENE Anzeige, die erstellen.vue anstelle von PhotoAttachmentList einblendet, statt zu
// versuchen, deren Slots von aussen auf das komponierte Foto umzubiegen.
const props = defineProps<{ organizationId: string; departmentId: string }>()
const mediaAssetIds = defineModel<string[]>('mediaAssetIds', { required: true })
const composedPreview = defineModel<{ mediaAssetId: string; signedUrl: string } | null>('composedPreview', { required: true })

const api = useApiClient()
const presets = ref<PhotoLayoutPreset[]>([])
const loading = ref(true)
const composingId = ref<string | null>(null)
const error = ref('')

async function loadPresets() {
  loading.value = true
  try {
    const response = await api.request('/v1/photo-layout-presets', { query: { organizationId: props.organizationId } }, z.object({ presets: z.array(PhotoLayoutPresetSchema) }))
    presets.value = response.presets.filter((preset) => preset.isActive)
  } catch {
    presets.value = []
  } finally {
    loading.value = false
  }
}
await loadPresets()
watch(() => props.organizationId, loadPresets)

// Nur die department-eigenen und vererbten Presets -- die Foto-Anhang-UI kennt keine
// Mannschaftsebene, dieselbe Grenze wie die Render-Route selbst durchsetzt.
const selectablePresets = computed(() => selectablePhotoLayoutPresets(presets.value, 'department', props.departmentId))

function photoCountLabel(preset: PhotoLayoutPreset): string {
  const range = PHOTO_LAYOUT_PHOTO_COUNTS[preset.kind]
  return range.min === range.max ? `${range.min} Fotos` : `${range.min}–${range.max} Fotos`
}
function fitsCurrentCount(preset: PhotoLayoutPreset): boolean {
  const range = PHOTO_LAYOUT_PHOTO_COUNTS[preset.kind]
  return mediaAssetIds.value.length >= range.min && mediaAssetIds.value.length <= range.max
}

async function composeLayout(preset: PhotoLayoutPreset) {
  if (!fitsCurrentCount(preset) || composingId.value) return
  composingId.value = preset.id
  error.value = ''
  try {
    const response = await api.request('/v1/photo-layout-presets/render', {
      method: 'POST',
      body: { organizationId: props.organizationId, departmentId: props.departmentId, presetId: preset.id, mediaAssetIds: mediaAssetIds.value },
    }, RenderPhotoLayoutResponseSchema)
    mediaAssetIds.value = [response.mediaAssetId]
    composedPreview.value = { mediaAssetId: response.mediaAssetId, signedUrl: response.signedUrl }
  } catch (thrown) {
    // Dieselben drei Fehlercodes wie beim Absenden der Textwerkstatt-Sitzung selbst (erstellen.vue,
    // createCandidate) -- die Personen-Pruefung eines angehaengten Fotos kann sich seit dem
    // Anhaengen geaendert haben (2026081802, invalidate_people_review_on_face_change).
    const code = (thrown as { data?: { error?: string } })?.data?.error
    if (code === 'media_asset_not_reviewed' || code === 'media_asset_not_ready' || code === 'media_asset_not_found') {
      mediaAssetIds.value = []
      error.value = 'Die Personen-Prüfung eines angehängten Fotos ist nicht mehr aktuell. Bitte die Fotos erneut prüfen.'
    } else {
      error.value = 'Die Fotos konnten nicht zusammengefügt werden.'
    }
  } finally {
    composingId.value = null
  }
}
</script>

<template>
  <div v-if="!loading && selectablePresets.length && mediaAssetIds.length >= PHOTO_LAYOUT_MIN_PHOTOS" class="mt-3">
    <p class="mb-2 text-xs font-semibold text-[#5c655f]">Diese Fotos zu einem Bild zusammenfügen</p>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="preset in selectablePresets" :key="preset.id" type="button"
        class="focus-ring w-24 space-y-1 rounded-lg p-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!fitsCurrentCount(preset) || !!composingId"
        :title="!fitsCurrentCount(preset) ? `Braucht ${photoCountLabel(preset)}` : preset.name"
        @click="composeLayout(preset)"
      >
        <PhotoLayoutPreview :kind="preset.kind" :divider-width-px="4" class="rounded-md" />
        <span class="flex items-center justify-center gap-1 text-center text-[10px] font-semibold text-[#5b625d]">
          <LoaderCircle v-if="composingId === preset.id" :size="10" class="animate-spin" />
          <span class="truncate">{{ preset.name }}</span>
        </span>
      </button>
    </div>
    <p v-if="error" class="mt-2 text-[11px] text-amber-800">{{ error }}</p>
  </div>
</template>
