<script setup lang="ts">
import { AlertTriangle, Check, ImagePlus, LoaderCircle, Trash2, X } from '@lucide/vue'
import { MediaAssetSummarySchema } from '@vereinsfunk/contracts'
import { z } from 'zod'

// Foto-Anhang-Steuerung für die Textwerkstatt. Der lokale Editor läuft bewusst VOR dem Upload und
// vor der Personenprüfung: Gesichtsfelder und Einwilligungen beziehen sich dadurch auf den
// endgültigen Ausschnitt. Rahmen, Logo und Filter bleiben serverseitige, reproduzierbare Presets.
const props = defineProps<{ organizationId: string; departmentId: string | null; initialMediaAssetId?: string | null }>()
const mediaAssetId = defineModel<string | null>({ required: true })

type Phase = 'idle' | 'uploading' | 'processing' | 'failed' | 'marking' | 'reviewed' | 'hydrating'
type FaceBox = { id: string; x: number; y: number; width: number; height: number; subjectKind: 'adult' | 'minor' | 'unknown'; decision: 'pending' | 'consented'; consentRecordId: string | null }
type ConsentOption = { id: string; label: string }
const FaceRegionInsertSchema = z.object({ id: z.string().uuid() })
const PeopleReviewSchema = z.object({ id: z.string().uuid() })

const api = useApiClient()
const supabase = useSupabaseClient()

const phase = ref<Phase>('idle')
const errorMessage = ref('')
const previewUrl = ref('')
// Die Bearbeitung geschieht vor dem Upload und damit vor der Personenprüfung. So beziehen sich
// Einwilligungs-Markierungen immer auf genau die Pixel, die später veröffentlicht werden.
const pendingEditorFile = ref<File | null>(null)
// Die zuletzt übernommene lokale Datei bleibt nur während dieser Bearbeitungssitzung im Browser.
// So ist der Bildeditor nicht nur beim ersten Dateiauswahldialog erreichbar: vor der
// Personenprüfung kann der Ausschnitt jederzeit erneut geändert werden. Das Ergebnis wird als
// neues privates Asset hochgeladen und muss anschließend bewusst erneut geprüft werden.
const editableLocalFile = ref<File | null>(null)
// Nur ein frisch hochgeladenes Foto laeuft ueber createObjectURL -- ein wiederverwendetes/signiertes
// Foto bekommt immer eine echte https-URL. Aus dem URL-Schema ableitbar statt separat mitgefuehrt.
const previewIsObjectUrl = computed(() => previewUrl.value.startsWith('blob:'))
const boxes = ref<FaceBox[]>([])
const consents = ref<ConsentOption[]>([])
const imageEl = useTemplateRef<HTMLImageElement>('imageEl')
const drag = ref<{ startX: number; startY: number; x: number; y: number } | null>(null)
// Getrennt von mediaAssetId (dem Modelwert): das Model wird erst gesetzt, wenn die
// Personen-Pruefung abgeschlossen ist -- bis dahin braucht die Markier-UI die Asset-ID trotzdem.
const currentAssetId = ref<string | null>(null)
// Ein wiederverwendetes Foto (initialMediaAssetId) hat keine lokal geladenen face_regions -- die
// Markier-UI wuerde bei "Markierung bearbeiten" mit einem leeren boxes-Array starten und koennte
// eine echte, bereits bestaetigte Personen-Markierung faelschlich durch "keine Personen erkennbar"
// ersetzen. Deshalb bleibt "Markierung bearbeiten" fuer diesen Fall verborgen.
const isHydratedExternalAsset = ref(false)

watch(mediaAssetId, (assetId) => {
  if (assetId === null && phase.value === 'reviewed') phase.value = 'marking'
})

const hasUndecidedBox = computed(() => boxes.value.some((box) => box.decision === 'pending'))

function resetPreview() {
  if (previewIsObjectUrl.value && previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
}
function reset(clearEditableFile = true) {
  phase.value = 'idle'; errorMessage.value = ''; boxes.value = []; mediaAssetId.value = null; isHydratedExternalAsset.value = false; resetPreview()
  if (clearEditableFile) editableLocalFile.value = null
}
function removePhoto() { reset() }
onBeforeUnmount(resetPreview)

onMounted(async () => {
  if (!props.initialMediaAssetId) return
  phase.value = 'hydrating'
  try {
    const asset = await api.request(`/v1/media-assets/${props.initialMediaAssetId}`, {}, MediaAssetSummarySchema)
    if (asset.organizationId !== props.organizationId || asset.departmentId !== props.departmentId) {
      phase.value = 'failed'
      errorMessage.value = 'Dieses Foto gehört zu einem anderen Bereich und kann hier nicht verwendet werden.'
      return
    }
    if (!asset.mimeType.startsWith('image/') || !asset.peopleReviewedAt || !asset.signedUrl) {
      phase.value = 'failed'
      errorMessage.value = 'Dieses Foto wurde noch nicht geprüft und kann nicht wiederverwendet werden.'
      return
    }
    previewUrl.value = asset.signedUrl
    currentAssetId.value = asset.id
    isHydratedExternalAsset.value = true
    mediaAssetId.value = asset.id
    phase.value = 'reviewed'
  } catch {
    phase.value = 'failed'
    errorMessage.value = 'Das Foto konnte nicht geladen werden.'
  }
})

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function onFileSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  ;(event.target as HTMLInputElement).value = ''
  if (!file) return
  pendingEditorFile.value = file
}

async function uploadEditedFile(file: File) {
  // Ein erneuter Zuschnitt darf ein bereits geprüftes Attachment nicht schon beim Starten des
  // Ersatz-Uploads lösen. Während der Upload läuft, merken wir uns deshalb den kompletten
  // sichtbaren Zustand und ersetzen ihn erst, wenn das neue Asset tatsächlich bereit ist.
  const previous = {
    phase: phase.value,
    previewUrl: previewUrl.value,
    boxes: boxes.value,
    currentAssetId: currentAssetId.value,
    mediaAssetId: mediaAssetId.value,
    isHydratedExternalAsset: isHydratedExternalAsset.value,
    editableLocalFile: editableLocalFile.value,
  }
  const replacesExistingPhoto = previous.phase === 'marking' || previous.phase === 'reviewed'
  phase.value = 'uploading'
  errorMessage.value = ''
  try {
    const initiated = await api.request('/v1/media/uploads', {
      method: 'POST',
      body: { organizationId: props.organizationId, departmentId: props.departmentId, filename: file.name, mimeType: file.type, byteSize: file.size },
    }, z.object({ assetId: z.string(), uploadUrl: z.string() }))
    const upload = await fetch(initiated.uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type } })
    if (!upload.ok) throw new Error('upload_failed')
    phase.value = 'processing'
    const sha256 = await sha256Hex(file)
    await api.request(`/v1/media/${initiated.assetId}/complete`, { method: 'POST', body: { sha256 } }, z.object({ accepted: z.boolean() }))
    // complete() ist synchron (kein Worker in Plan 045 PR 0) -- ein einzelnes Nachlesen genuegt,
    // kein Polling noetig.
    const asset = await supabase.from('media_assets').select('upload_status').eq('id', initiated.assetId).single()
    if (asset.error) throw asset.error
    if (asset.data.upload_status !== 'ready') throw new Error('image_processing_failed')
    // Erst hier wird die bisherige Vorschau (und damit eine eventuell bestehende Object-URL)
    // verworfen. Das neue Asset muss anschließend wie jedes neue Foto erneut geprüft werden.
    reset(false)
    previewUrl.value = URL.createObjectURL(file)
    boxes.value = []
    currentAssetId.value = initiated.assetId
    editableLocalFile.value = file
    phase.value = 'marking'
    await loadConsents()
  } catch {
    if (replacesExistingPhoto) {
      phase.value = previous.phase
      previewUrl.value = previous.previewUrl
      boxes.value = previous.boxes
      currentAssetId.value = previous.currentAssetId
      mediaAssetId.value = previous.mediaAssetId
      isHydratedExternalAsset.value = previous.isHydratedExternalAsset
      editableLocalFile.value = previous.editableLocalFile
      errorMessage.value = 'Die Bearbeitung konnte nicht übernommen werden. Das bisherige Foto bleibt angehängt.'
      return
    }
    phase.value = 'failed'
    errorMessage.value = 'Der Upload ist fehlgeschlagen. Bitte erneut versuchen.'
  }
}

async function acceptEditedFile(file: File) {
  pendingEditorFile.value = null
  await uploadEditedFile(file)
}

function reopenImageEditor() {
  if (editableLocalFile.value) pendingEditorFile.value = editableLocalFile.value
}

async function loadConsents() {
  try {
    const rows = await api.request('/v1/consents', { query: { organizationId: props.organizationId, departmentId: props.departmentId ?? undefined } }, z.array(z.object({ id: z.string(), signerName: z.string().nullable(), scope: z.string(), status: z.string() })))
    consents.value = rows.map((row) => ({ id: row.id, label: `${row.signerName ?? 'Unbenannt'} — ${row.scope} (${row.status})` }))
  } catch {
    consents.value = []
    errorMessage.value = 'Einwilligungen konnten nicht geladen werden. Bitte die Seite neu laden.'
  }
}

function relativePosition(event: PointerEvent) {
  const rect = imageEl.value!.getBoundingClientRect()
  return { x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1), y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1) }
}
function startDrag(event: PointerEvent) {
  if (!imageEl.value) return
  imageEl.value.setPointerCapture(event.pointerId)
  const point = relativePosition(event)
  drag.value = { startX: point.x, startY: point.y, x: point.x, y: point.y }
}
function updateDrag(event: PointerEvent) {
  if (!drag.value) return
  const point = relativePosition(event)
  drag.value = { ...drag.value, x: point.x, y: point.y }
}
async function endDrag(event?: PointerEvent) {
  if (event && imageEl.value?.hasPointerCapture(event.pointerId)) imageEl.value.releasePointerCapture(event.pointerId)
  if (!drag.value || !currentAssetId.value) { drag.value = null; return }
  const x = Math.min(drag.value.startX, drag.value.x)
  const y = Math.min(drag.value.startY, drag.value.y)
  const width = Math.abs(drag.value.x - drag.value.startX)
  const height = Math.abs(drag.value.y - drag.value.startY)
  drag.value = null
  // Zu kleine Ziehbewegungen (Klick statt Markierung) ergeben keine Box.
  if (width < 0.01 || height < 0.01) return
  const inserted = await supabase.from('face_regions').insert({
    organization_id: props.organizationId, media_asset_id: currentAssetId.value, x, y, width, height, source: 'manual', subject_kind: 'adult', decision: 'pending',
  }).select('id').single()
  if (inserted.error) { errorMessage.value = 'Die Markierung konnte nicht gespeichert werden.'; return }
  const parsedInserted = FaceRegionInsertSchema.safeParse(inserted.data)
  if (!parsedInserted.success) { errorMessage.value = 'Die Markierung konnte nicht gespeichert werden.'; return }
  boxes.value = [...boxes.value, { id: parsedInserted.data.id, x, y, width, height, subjectKind: 'adult', decision: 'pending', consentRecordId: null }]
}
async function addPersonBox() {
  if (!currentAssetId.value) return
  drag.value = { startX: 0.35, startY: 0.35, x: 0.65, y: 0.65 }
  await endDrag()
}
async function updateBoxGeometry(box: FaceBox, field: 'x' | 'y' | 'width' | 'height', value: string) {
  const number = Number(value)
  const next = { ...box, [field]: number }
  if (!Number.isFinite(number) || next.x < 0 || next.y < 0 || next.width <= 0 || next.height <= 0 || next.x + next.width > 1 || next.y + next.height > 1) {
    errorMessage.value = 'Die Markierung muss vollständig innerhalb des Fotos liegen.'
    return
  }
  const update = await supabase.from('face_regions').update({ [field]: number }).eq('id', box.id)
  if (update.error) { errorMessage.value = 'Die Markierung konnte nicht angepasst werden.'; return }
  box[field] = number
}
async function setSubjectKind(box: FaceBox, subjectKind: FaceBox['subjectKind']) {
  const update = await supabase.from('face_regions').update({ subject_kind: subjectKind }).eq('id', box.id)
  if (update.error) { errorMessage.value = 'Die Änderung konnte nicht gespeichert werden.'; return }
  box.subjectKind = subjectKind
}
async function linkConsent(box: FaceBox, consentRecordId: string) {
  if (!consentRecordId) return
  const update = await supabase.from('face_regions').update({ decision: 'consented', consent_record_id: consentRecordId }).eq('id', box.id)
  if (update.error) { errorMessage.value = 'Die Einwilligung konnte nicht verknüpft werden.'; return }
  box.decision = 'consented'; box.consentRecordId = consentRecordId
}
async function removeBox(box: FaceBox) {
  const del = await supabase.from('face_regions').delete().eq('id', box.id)
  if (del.error) { errorMessage.value = 'Die Markierung konnte nicht entfernt werden.'; return }
  boxes.value = boxes.value.filter((entry) => entry.id !== box.id)
}
async function confirmReview(facesPresent: boolean) {
  if (!currentAssetId.value) return
  const result = await supabase.rpc('confirm_media_people_review', { target_asset_id: currentAssetId.value, faces_present: facesPresent })
  if (result.error) { errorMessage.value = 'Die Personen-Prüfung konnte nicht bestätigt werden.'; return }
  if (!PeopleReviewSchema.safeParse(result.data).success) { errorMessage.value = 'Die Personen-Prüfung konnte nicht bestätigt werden.'; return }
  mediaAssetId.value = currentAssetId.value
  phase.value = 'reviewed'
}
function editAgain() { mediaAssetId.value = null; phase.value = 'marking' }
</script>

<template>
  <div>
    <PhotoImageWorkshop
      v-if="pendingEditorFile"
      :file="pendingEditorFile"
      :organization-id="organizationId"
      :department-id="departmentId"
      @save="acceptEditedFile"
      @cancel="pendingEditorFile = null"
    />
    <label class="mb-1 block text-xs font-semibold">Foto (optional)</label>
    <input v-if="phase === 'idle' || phase === 'failed'" type="file" accept="image/jpeg,image/png,image/webp" class="block w-full text-sm" @change="onFileSelected" />
    <p v-if="phase === 'uploading' || phase === 'processing'" class="mt-2 inline-flex items-center gap-2 text-sm text-[#727a75]"><LoaderCircle class="animate-spin" :size="16" /> {{ phase === 'uploading' ? 'Foto wird hochgeladen …' : 'Foto wird geprüft …' }}</p>
    <p v-if="phase === 'hydrating'" class="mt-2 inline-flex items-center gap-2 text-sm text-[#727a75]"><LoaderCircle class="animate-spin" :size="16" /> Vorhandenes Foto wird geladen …</p>
    <p v-if="phase === 'failed'" class="mt-2 inline-flex items-center gap-2 text-sm text-red-700"><AlertTriangle :size="16" /> {{ errorMessage }}</p>

    <div v-if="phase === 'marking'" class="mt-3">
      <p class="mb-2 text-xs text-[#727a75]">Ziehe ein Rechteck über jede abgebildete Person. Ohne Markierung kann das Foto nicht veröffentlicht werden.</p>
      <div class="relative inline-block max-w-full select-none" @pointerdown="startDrag" @pointermove="updateDrag" @pointerup="endDrag" @pointercancel="drag = null" @pointerleave="drag = null" @dragstart.prevent>
        <img ref="imageEl" :src="previewUrl" class="max-h-96 max-w-full rounded-xl border" style="-webkit-user-drag: none" draggable="false" alt="Angehängtes Foto" />
        <div
          v-for="box in boxes" :key="box.id"
          class="absolute border-2"
          :class="box.decision === 'consented' ? 'border-emerald-500' : 'border-amber-500'"
          :style="{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }"
        />
        <div v-if="drag" class="absolute border-2 border-dashed border-forest" :style="{ left: `${Math.min(drag.startX, drag.x) * 100}%`, top: `${Math.min(drag.startY, drag.y) * 100}%`, width: `${Math.abs(drag.x - drag.startX) * 100}%`, height: `${Math.abs(drag.y - drag.startY) * 100}%` }" />
      </div>

      <div class="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" class="rounded-xl border px-3 py-2 text-sm font-semibold" @click="addPersonBox">Person hinzufügen</button>
        <button v-if="editableLocalFile" type="button" class="text-xs text-forest underline" @click="reopenImageEditor">Foto zuschneiden, drehen oder spiegeln</button>
      </div>

      <ul v-if="boxes.length" class="mt-3 grid gap-2">
        <li v-for="(box, index) in boxes" :key="box.id" class="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs">
          <span class="font-semibold">Person {{ index + 1 }}</span>
          <Select :model-value="box.subjectKind" @update:model-value="(value: unknown) => setSubjectKind(box, value as FaceBox['subjectKind'])">
            <SelectTrigger class="w-auto rounded p-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="adult">Erwachsen</SelectItem>
              <SelectItem value="minor">Minderjährig</SelectItem>
              <SelectItem value="unknown">Unbekannt</SelectItem>
            </SelectContent>
          </Select>
          <label v-for="field in ['x', 'y', 'width', 'height'] as const" :key="field" class="flex items-center gap-1">{{ field }}
            <input class="w-16 rounded border p-1" type="number" min="0" max="1" step="0.01" :value="box[field]" :aria-label="`Person ${index + 1}: ${field}`" @change="updateBoxGeometry(box, field, ($event.target as HTMLInputElement).value)" />
          </label>
          <template v-if="box.decision === 'consented'">
            <span class="inline-flex items-center gap-1 text-emerald-700"><Check :size="14" /> Einwilligung verknüpft</span>
          </template>
          <template v-else>
            <Select @update:model-value="(value: unknown) => linkConsent(box, value as string)">
              <SelectTrigger class="min-w-0 flex-1 rounded p-1"><SelectValue placeholder="Einwilligung verknüpfen …" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="consent in consents" :key="consent.id" :value="consent.id">{{ consent.label }}</SelectItem>
              </SelectContent>
            </Select>
            <NuxtLink to="/einwilligungen" target="_blank" class="focus-ring text-forest underline">Neu anlegen →</NuxtLink>
          </template>
          <button type="button" class="ml-auto text-red-700" title="Markierung entfernen" @click="removeBox(box)"><Trash2 :size="14" /></button>
        </li>
      </ul>

      <div class="mt-3 flex flex-wrap items-center gap-3">
        <button v-if="!boxes.length" type="button" class="rounded-xl border px-4 py-2 text-sm font-semibold" @click="confirmReview(false)">Keine Personen erkennbar</button>
        <button v-else type="button" class="rounded-xl bg-forest px-4 py-2 text-sm font-bold text-white disabled:opacity-60" :disabled="hasUndecidedBox" :title="hasUndecidedBox ? 'Jede Markierung braucht eine verknüpfte Einwilligung.' : undefined" @click="confirmReview(true)">Personen-Prüfung bestätigen</button>
        <button type="button" class="text-xs text-[#727a75] underline" @click="removePhoto"><X :size="12" class="mr-1 inline" />Foto entfernen</button>
      </div>
      <p v-if="errorMessage" class="mt-2 text-xs text-red-700">{{ errorMessage }}</p>
    </div>

    <div v-if="phase === 'reviewed'" class="mt-3 flex items-center gap-3">
      <img :src="previewUrl" class="h-16 w-16 rounded-lg border object-cover" alt="Angehängtes Foto" />
      <span class="inline-flex items-center gap-1 text-sm text-emerald-700"><Check :size="16" /> {{ isHydratedExternalAsset ? 'Vorhandenes Foto angehängt' : 'Foto geprüft und angehängt' }}</span>
      <button v-if="!isHydratedExternalAsset" type="button" class="text-xs text-forest underline" @click="editAgain">Markierung bearbeiten</button>
      <button v-if="editableLocalFile" type="button" class="text-xs text-forest underline" @click="reopenImageEditor">Foto bearbeiten</button>
      <button type="button" class="text-xs text-[#727a75] underline" @click="removePhoto">Entfernen</button>
    </div>
    <p v-if="phase === 'reviewed' && errorMessage" class="mt-2 text-xs text-red-700">{{ errorMessage }}</p>

    <p v-if="phase === 'idle'" class="mt-1 inline-flex items-center gap-1 text-[11px] text-[#9aa096]"><ImagePlus :size="13" /> JPEG, PNG oder WebP · direkt danach zuschneiden, drehen und spiegeln.</p>
  </div>
</template>
