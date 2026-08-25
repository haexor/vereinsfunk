<script setup lang="ts">
import { Check, FileAudio, FileVideo, ImagePlus, LoaderCircle, Paperclip, Trash2 } from '@lucide/vue'
import { z } from 'zod'

const props = withDefaults(defineProps<{
  organizationId: string
  departmentId: string
  /** Videos need an explicit visual review before they can be used in a post. */
  reviewVideos?: boolean
  allowImages?: boolean
  max?: number
}>(), { reviewVideos: false, allowImages: true, max: 10 })
const mediaAssetIds = defineModel<string[]>({ required: true })

type PendingAttachment = {
  id: string
  file: File
  assetId: string | null
  state: 'uploading' | 'review' | 'ready' | 'failed'
  error?: string
}

const api = useApiClient()
const input = useTemplateRef<HTMLInputElement>('input')
const attachments = ref<PendingAttachment[]>([])
const effectiveMax = computed(() => Math.min(props.max, 10))

function iconFor(file: File) {
  if (file.type.startsWith('video/')) return FileVideo
  if (file.type.startsWith('audio/')) return FileAudio
  return ImagePlus
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
async function upload(attachment: PendingAttachment) {
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
    await api.request(`/v1/media/${initiated.assetId}/complete`, { method: 'POST', body: { sha256: await sha256Hex(attachment.file) } }, z.object({ accepted: z.boolean() }))
    attachment.assetId = initiated.assetId
    attachment.state = props.reviewVideos && attachment.file.type.startsWith('video/') ? 'review' : 'ready'
    syncModel()
  } catch {
    attachment.state = 'failed'
    attachment.error = 'Der Upload ist fehlgeschlagen. Bitte versuche es erneut.'
  }
}
function onFiles(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files ?? []).slice(0, effectiveMax.value - attachments.value.length)
  for (const file of files) {
    const attachment: PendingAttachment = { id: crypto.randomUUID(), file, assetId: null, state: 'uploading' }
    attachments.value.push(attachment)
    void upload(attachment)
  }
  ;(event.target as HTMLInputElement).value = ''
}
async function confirmVideoReview(attachment: PendingAttachment) {
  if (!attachment.assetId) return
  try {
    const confirmed = await useSupabaseClient().rpc('confirm_media_people_review', { target_asset_id: attachment.assetId, faces_present: false })
    if (confirmed.error) throw confirmed.error
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
    <button v-if="attachments.length < effectiveMax" type="button" class="focus-ring inline-flex items-center gap-2 rounded-xl border border-[#dfe2da] px-3 py-2 text-sm font-semibold text-[#435047] hover:bg-[#f6f8f3]" @click="input?.click()"><Paperclip :size="16" /> {{ allowImages ? 'Bild, Video oder Musik' : 'Video oder Musik' }}</button>
    <p class="text-[11px] text-[#7a827c]">{{ allowImages ? 'JPEG, PNG, WebP, MP4, MP3 oder M4A' : 'MP4, MP3 oder M4A' }} · maximal {{ effectiveMax }} Dateien.</p>
    <ul v-if="attachments.length" class="space-y-2">
      <li v-for="attachment in attachments" :key="attachment.id" class="flex items-center gap-2 rounded-xl bg-[#f2f4ee] px-3 py-2 text-xs text-[#435047]">
        <component :is="iconFor(attachment.file)" :size="16" class="shrink-0 text-forest" />
        <span class="min-w-0 flex-1 truncate font-semibold">{{ attachment.file.name }}</span>
        <span v-if="attachment.state === 'uploading'" class="inline-flex items-center gap-1 text-[#727a75]"><LoaderCircle :size="13" class="animate-spin" /> Lädt hoch</span>
        <button v-else-if="attachment.state === 'review'" type="button" class="rounded-lg bg-forest px-2 py-1 text-[11px] font-semibold text-white" @click="confirmVideoReview(attachment)">Video geprüft: keine Personen</button>
        <span v-else-if="attachment.state === 'ready'" class="inline-flex items-center gap-1 text-emerald-700"><Check :size="13" /> Angeheftet</span>
        <span v-else class="text-red-700">{{ attachment.error }}</span>
        <button type="button" class="shrink-0 text-[#727a75] hover:text-red-700" :aria-label="`${attachment.file.name} entfernen`" @click="remove(attachment)"><Trash2 :size="15" /></button>
      </li>
    </ul>
  </div>
</template>
