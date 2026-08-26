<script setup lang="ts">
import { Check, Images, LoaderCircle, Paperclip, Trash2 } from '@lucide/vue'
import { MediaAssetSummarySchema, type MediaAssetSummary } from '@vereinsfunk/contracts'
import { z } from 'zod'

const props = withDefaults(defineProps<{
  organizationId: string
  departmentId: string | null
  /** Videos need an explicit visual review before they can be used in a post. */
  reviewVideos?: boolean
  allowImages?: boolean
  max?: number
}>(), { reviewVideos: false, allowImages: true, max: 10 })
const mediaAssetIds = defineModel<string[]>({ required: true })

type PendingAttachment = {
  id: string
  // Nur bei einem Neu-Upload gesetzt -- eine Auswahl aus vorhandenen Medien (pickExisting) hat
  // kein File-Objekt, dafuer existingMimeType/existingLabel.
  file: File | null
  assetId: string | null
  state: 'uploading' | 'review' | 'ready' | 'failed'
  error?: string
  existingMimeType?: string
  existingLabel?: string
}

const api = useApiClient()
const input = useTemplateRef<HTMLInputElement>('input')
const attachments = ref<PendingAttachment[]>([])
const effectiveMax = computed(() => Math.min(props.max, 10))
const mode = ref<'upload' | 'existing'>('upload')
const existingAssets = ref<MediaAssetSummary[]>([])
const loadingExisting = ref(false)
const loadExistingError = ref('')
const UploadCompletionSchema = z.object({
  accepted: z.literal(true),
  uploadStatus: z.enum(['initiated', 'uploaded', 'normalizing', 'ready', 'quarantined', 'failed', 'deleted']),
  mimeType: z.string().nullable(),
})
const PeopleReviewInputSchema = z.object({ target_asset_id: z.string().uuid(), faces_present: z.boolean() })
const ReviewedMediaAssetSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  department_id: z.string().uuid().nullable(),
  upload_status: z.literal('ready'),
  people_reviewed_at: z.string().datetime({ offset: true }),
  people_reviewed_by: z.string().uuid(),
})

function mimeTypeOf(attachment: PendingAttachment) {
  return attachment.file?.type ?? attachment.existingMimeType ?? ''
}
function nameOf(attachment: PendingAttachment) {
  return attachment.file?.name ?? attachment.existingLabel ?? 'Datei'
}
async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
function syncModel() {
  mediaAssetIds.value = attachments.value
    .filter((attachment) => attachment.state === 'ready' && attachment.assetId !== null)
    .map((attachment) => attachment.assetId!)
}
async function upload(attachment: PendingAttachment & { file: File }) {
  try {
    const initiated = await api.request('/v1/media/uploads', {
      method: 'POST',
      body: {
        organizationId: props.organizationId,
        departmentId: props.departmentId,
        filename: attachment.file.name,
        mimeType: attachment.file.type,
        byteSize: attachment.file.size,
      },
    }, z.object({ assetId: z.string(), uploadUrl: z.string() }))
    const sent = await fetch(initiated.uploadUrl, { method: 'PUT', body: attachment.file, headers: { 'content-type': attachment.file.type } })
    if (!sent.ok) throw new Error('upload_failed')
    const completed = await api.request(`/v1/media/${initiated.assetId}/complete`, { method: 'POST', body: { sha256: await sha256Hex(attachment.file) } }, UploadCompletionSchema)
    attachment.assetId = initiated.assetId
    if (completed.uploadStatus !== 'ready') {
      attachment.state = 'failed'
      attachment.error = 'Der Upload konnte nicht geprüft werden. Bitte versuche es erneut.'
      return
    }
    // Der clientseitig gemeldete File.type ist ungeprüft -- ob eine Video-Personenprüfung nötig
    // ist, richtet sich nach dem serverseitig aus den Bytes erkannten MIME-Typ.
    attachment.state = props.reviewVideos && completed.mimeType?.startsWith('video/') ? 'review' : 'ready'
    if (attachment.state === 'ready') syncModel()
  } catch {
    attachment.state = 'failed'
    attachment.error = 'Der Upload ist fehlgeschlagen. Bitte versuche es erneut.'
  }
}
function onFiles(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files ?? []).slice(0, effectiveMax.value - attachments.value.length)
  for (const file of files) {
    const attachment = { id: crypto.randomUUID(), file, assetId: null, state: 'uploading' as const }
    attachments.value.push(attachment)
    void upload(attachment)
  }
  ;(event.target as HTMLInputElement).value = ''
}
async function openExistingPicker() {
  mode.value = 'existing'
  if (existingAssets.value.length || loadingExisting.value) return
  loadingExisting.value = true
  loadExistingError.value = ''
  try {
    // reviewedOnly nur dort erzwingen, wo Anhaenge tatsaechlich veroeffentlicht werden koennen
    // (reviewVideos=true, siehe erstellen.vue) -- Chat-Anhaenge (assistent.vue) werden nie
    // veroeffentlicht, siehe agent.ts "never multimodal context for the model".
    const fetched = await api.request('/v1/media-assets', {
      query: { organizationId: props.organizationId, departmentId: props.departmentId ?? undefined, reviewedOnly: props.reviewVideos || undefined },
    }, z.array(MediaAssetSummarySchema))
    existingAssets.value = props.allowImages ? fetched : fetched.filter((asset) => !asset.mimeType.startsWith('image/'))
  } catch {
    loadExistingError.value = 'Vorhandene Medien konnten nicht geladen werden.'
  } finally {
    loadingExisting.value = false
  }
}
function pickExisting(asset: MediaAssetSummary) {
  if (attachments.value.length >= effectiveMax.value || attachments.value.some((entry) => entry.assetId === asset.id)) return
  attachments.value.push({
    id: crypto.randomUUID(), file: null, assetId: asset.id, state: 'ready',
    existingMimeType: asset.mimeType, existingLabel: asset.mimeType.startsWith('image/') ? 'Vorhandenes Bild' : asset.mimeType.startsWith('video/') ? 'Vorhandenes Video' : 'Vorhandene Datei',
  })
  syncModel()
}
async function confirmVideoReview(attachment: PendingAttachment) {
  if (!attachment.assetId) return
  try {
    const reviewInput = PeopleReviewInputSchema.parse({ target_asset_id: attachment.assetId, faces_present: false })
    const confirmed = await useSupabaseClient().rpc('confirm_media_people_review', reviewInput)
    if (confirmed.error) throw confirmed.error
    const asset = ReviewedMediaAssetSchema.parse(confirmed.data)
    if (asset.id !== reviewInput.target_asset_id || asset.organization_id !== props.organizationId || asset.department_id !== props.departmentId) throw new Error('unexpected_media_people_review_response')
    attachment.state = 'ready'
    syncModel()
  } catch {
    attachment.error = 'Die Personen-Prüfung konnte nicht bestätigt werden.'
  }
}
function remove(attachment: PendingAttachment) {
  attachments.value = attachments.value.filter((entry) => entry.id !== attachment.id)
  syncModel()
}
watch(mediaAssetIds, (ids) => {
  if (ids.length === 0 && attachments.value.length) attachments.value = []
})
</script>

<template>
  <div class="space-y-2">
    <input ref="input" class="sr-only" type="file" multiple :accept="allowImages ? 'image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/mp4' : 'video/mp4,audio/mpeg,audio/mp4'" @change="onFiles" />
    <div v-if="attachments.length < effectiveMax" class="flex flex-wrap gap-2">
      <button type="button" class="focus-ring inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-[#f6f8f3]" :class="mode === 'upload' ? 'border-forest text-forest' : 'border-[#dfe2da] text-[#435047]'" @click="mode = 'upload'"><Paperclip :size="16" /> {{ allowImages ? 'Bild, Video oder Musik' : 'Video oder Musik' }}</button>
      <button type="button" class="focus-ring inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-[#f6f8f3]" :class="mode === 'existing' ? 'border-forest text-forest' : 'border-[#dfe2da] text-[#435047]'" @click="openExistingPicker"><Images :size="16" /> Vorhandenes wählen</button>
    </div>
    <template v-if="mode === 'upload'">
      <p class="text-[11px] text-[#7a827c]">{{ allowImages ? 'JPEG, PNG, WebP, MP4, MP3 oder M4A' : 'MP4, MP3 oder M4A' }} · maximal {{ effectiveMax }} Dateien.</p>
      <button v-if="attachments.length < effectiveMax" type="button" class="text-xs font-semibold text-forest underline" @click="input?.click()">Datei auswählen …</button>
    </template>
    <template v-else-if="attachments.length < effectiveMax">
      <p v-if="loadingExisting" class="flex items-center gap-2 text-xs text-[#727a75]"><LoaderCircle class="animate-spin" :size="14" /> Lade vorhandene Medien …</p>
      <p v-else-if="loadExistingError" class="text-xs text-red-700">{{ loadExistingError }}</p>
      <p v-else-if="!existingAssets.length" class="text-xs text-[#727a75]">Keine vorhandenen Medien gefunden.</p>
      <div v-else class="grid grid-cols-4 gap-2 sm:grid-cols-6">
        <button
          v-for="asset in existingAssets" :key="asset.id" type="button"
          class="focus-ring group relative aspect-square overflow-hidden rounded-lg border border-[#dfe2da] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="attachments.some((entry) => entry.assetId === asset.id)"
          :title="attachments.some((entry) => entry.assetId === asset.id) ? 'Bereits angehängt' : undefined"
          @click="pickExisting(asset)"
        >
          <img v-if="asset.signedUrl" :src="asset.signedUrl" class="h-full w-full object-cover" alt="" />
          <span v-else class="grid h-full w-full place-items-center bg-[#f2f4ee] text-[#727a75]"><component :is="iconForMimeType(asset.mimeType)" :size="20" /></span>
        </button>
      </div>
    </template>
    <ul v-if="attachments.length" class="space-y-2">
      <li v-for="attachment in attachments" :key="attachment.id" class="flex items-center gap-2 rounded-xl bg-[#f2f4ee] px-3 py-2 text-xs text-[#435047]">
        <component :is="iconForMimeType(mimeTypeOf(attachment))" :size="16" class="shrink-0 text-forest" />
        <span class="min-w-0 flex-1 truncate font-semibold">{{ nameOf(attachment) }}</span>
        <span v-if="attachment.state === 'uploading'" class="inline-flex items-center gap-1 text-[#727a75]"><LoaderCircle :size="13" class="animate-spin" /> Lädt hoch</span>
        <button v-else-if="attachment.state === 'review'" type="button" class="rounded-lg bg-forest px-2 py-1 text-[11px] font-semibold text-white" @click="confirmVideoReview(attachment)">Video geprüft: keine Personen</button>
        <span v-else-if="attachment.state === 'ready'" class="inline-flex items-center gap-1 text-emerald-700"><Check :size="13" /> Angeheftet</span>
        <span v-else class="text-red-700">{{ attachment.error }}</span>
        <button type="button" class="shrink-0 text-[#727a75] hover:text-red-700" :aria-label="`${nameOf(attachment)} entfernen`" @click="remove(attachment)"><Trash2 :size="15" /></button>
      </li>
    </ul>
  </div>
</template>
