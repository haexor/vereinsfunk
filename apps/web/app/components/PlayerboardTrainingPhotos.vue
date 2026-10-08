<script setup lang="ts">
import { Camera, Globe, ImagePlus, LoaderCircle, Lock, ShieldCheck, Trash2 } from '@lucide/vue'
import {
  PlayerboardPhotoContentTypeSchema,
  PlayerboardPhotoSchema,
  PlayerboardPhotoUploadSchema,
  type PlayerboardPhoto,
  type PlayerboardPhotoConsent,
  type PlayerboardPlayer,
} from '@vereinsfunk/contracts'
import { formatBytes } from '../utils/formatBytes'
import { playerboardErrorMessage } from '../utils/playerboardErrors'

// Paket 052, PR 3: Trainingsfotos. Hochladen in drei Schritten (reservieren, direkt in den
// privaten Bucket, abschliessen), danach der verbindliche Einzelbild-Review: wer ist erkennbar,
// liegt fuer jede Person eine gueltige Einwilligung vor, alle erfasst? Erst dann kann ein Foto
// oeffentlich werden. Fotos sind intern immer nur ueber kurzlebige signierte URLs sichtbar.
const props = defineProps<{
  trainingId: string
  players: readonly PlayerboardPlayer[]
  // null: Einwilligungsstand nicht geladen (keine Berechtigung oder Fehler).
  consents: readonly PlayerboardPhotoConsent[] | null
  canManage: boolean
}>()

const MAX_BYTES = 15 * 1024 * 1024
const api = useApiClient()
const photos = ref<PlayerboardPhoto[]>([])
const loading = ref(true)
const loadError = ref('')
const actionError = ref('')
const uploads = ref<{ id: string; name: string }[]>([])
const busyPhotoId = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    photos.value = await api.request(`/v1/playerboard/trainings/${props.trainingId}/photos`, {}, PlayerboardPhotoSchema.array())
  } catch (error) {
    loadError.value = playerboardErrorMessage(error, 'Die Fotos konnten nicht geladen werden.')
  } finally {
    loading.value = false
  }
}
await load()

function replacePhoto(photo: PlayerboardPhoto) {
  photos.value = photos.value.some((item) => item.id === photo.id)
    ? photos.value.map((item) => (item.id === photo.id ? photo : item))
    : [photo, ...photos.value]
}

async function uploadFile(file: File) {
  const contentType = PlayerboardPhotoContentTypeSchema.safeParse(file.type)
  if (!contentType.success) {
    actionError.value = `${file.name}: nur JPEG, PNG oder WebP.`
    return
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    actionError.value = `${file.name}: höchstens ${formatBytes(MAX_BYTES)}.`
    return
  }
  const pending = { id: crypto.randomUUID(), name: file.name }
  uploads.value = [...uploads.value, pending]
  let photoId: string | null = null
  try {
    const reserved = await api.request(`/v1/playerboard/trainings/${props.trainingId}/photos`, {
      method: 'POST', body: { contentType: contentType.data, sizeBytes: file.size },
    }, PlayerboardPhotoUploadSchema)
    photoId = reserved.photoId
    const sent = await fetch(reserved.uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': contentType.data } })
    if (!sent.ok) throw new Error('upload_failed')
    replacePhoto(await api.request(`/v1/playerboard/photos/${photoId}/complete`, { method: 'POST' }, PlayerboardPhotoSchema))
  } catch (error) {
    actionError.value = `${file.name}: ${playerboardErrorMessage(error, 'Das Hochladen hat nicht geklappt.')}`
    // Eine liegengebliebene Reservierung zaehlt aufs Kontingent -- wieder freigeben.
    if (photoId) await api.request(`/v1/playerboard/photos/${photoId}`, { method: 'DELETE' }).catch(() => undefined)
  } finally {
    uploads.value = uploads.value.filter((item) => item.id !== pending.id)
  }
}

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  actionError.value = ''
  // Nacheinander: schont die Verbindung am Platzrand und das Kontingent.
  void files.reduce((chain, file) => chain.then(() => uploadFile(file)), Promise.resolve())
}

// --- Review ------------------------------------------------------------------------------------

const reviewPhotoId = ref<string | null>(null)
const reviewPeople = ref<string[]>([])
const reviewAllListed = ref(false)
const reviewMakePublic = ref(false)
const consentByPlayer = computed(() => new Map((props.consents ?? []).map((consent) => [consent.playerId, consent])))
const reviewMissingConsent = computed(() =>
  props.players.filter((player) => reviewPeople.value.includes(player.id) && !consentByPlayer.value.get(player.id)?.consentRecordId))

function startReview(photo: PlayerboardPhoto) {
  reviewPhotoId.value = photo.id
  const listed = new Set(photo.people.map((person) => person.directoryPersonId))
  reviewPeople.value = props.players.filter((player) => listed.has(player.directoryPersonId)).map((player) => player.id)
  reviewAllListed.value = false
  reviewMakePublic.value = photo.public
  actionError.value = ''
}

async function submitReview() {
  const photoId = reviewPhotoId.value
  if (!photoId || !reviewAllListed.value || reviewMissingConsent.value.length > 0) return
  busyPhotoId.value = photoId
  actionError.value = ''
  try {
    const people = props.players
      .filter((player) => reviewPeople.value.includes(player.id))
      .map((player) => ({ directoryPersonId: player.directoryPersonId, consentRecordId: consentByPlayer.value.get(player.id)!.consentRecordId! }))
    replacePhoto(await api.request(`/v1/playerboard/photos/${photoId}/review`, {
      method: 'POST', body: { people, allRecognizablePeopleListed: true, makePublic: reviewMakePublic.value },
    }, PlayerboardPhotoSchema))
    reviewPhotoId.value = null
  } catch (error) {
    actionError.value = playerboardErrorMessage(error, 'Die Prüfung konnte nicht gespeichert werden.')
  } finally {
    busyPhotoId.value = null
  }
}

async function setPublic(photo: PlayerboardPhoto, value: boolean) {
  busyPhotoId.value = photo.id
  actionError.value = ''
  try {
    replacePhoto(await api.request(`/v1/playerboard/photos/${photo.id}/public`, { method: 'PUT', body: { public: value } }, PlayerboardPhotoSchema))
  } catch (error) {
    actionError.value = playerboardErrorMessage(error, 'Die Sichtbarkeit konnte nicht geändert werden.')
  } finally {
    busyPhotoId.value = null
  }
}

async function remove(photo: PlayerboardPhoto) {
  if (!window.confirm('Foto endgültig löschen?')) return
  busyPhotoId.value = photo.id
  actionError.value = ''
  try {
    await api.request(`/v1/playerboard/photos/${photo.id}`, { method: 'DELETE' })
    photos.value = photos.value.filter((item) => item.id !== photo.id)
    if (reviewPhotoId.value === photo.id) reviewPhotoId.value = null
  } catch (error) {
    actionError.value = playerboardErrorMessage(error, 'Das Foto konnte nicht gelöscht werden.')
  } finally {
    busyPhotoId.value = null
  }
}

const statusLabels: Record<PlayerboardPhoto['consentReviewStatus'], string> = { pending: 'Prüfung offen', approved: 'Geprüft', blocked: 'Gesperrt' }
function statusClass(photo: PlayerboardPhoto): string {
  if (photo.consentReviewStatus === 'approved') return 'bg-[#e4f1e7] text-forest'
  if (photo.consentReviewStatus === 'blocked') return 'bg-red-50 text-red-800'
  return 'bg-amber-100 text-amber-800'
}
</script>

<template>
  <section aria-labelledby="photos-heading" class="mt-8">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 id="photos-heading" class="font-display text-lg font-bold text-ink">Fotos</h2>
      <label v-if="canManage" class="focus-within:ring-2 focus-within:ring-forest inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-forest px-4 text-xs font-bold text-white">
        <ImagePlus :size="16" /> Fotos hinzufügen
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" @change="onFiles" />
      </label>
    </div>

    <p v-if="canManage" class="mb-3 text-xs text-[#6c756f]">
      Fotos sind zunächst nur intern sichtbar. Öffentlich werden sie erst nach deiner Prüfung: alle erkennbaren Personen ausgewählt, für jede eine gültige Einwilligung für die Website.
    </p>
    <p v-if="actionError" class="mb-3 text-sm font-semibold text-amber-800" role="alert">{{ actionError }}</p>
    <p v-if="loading" class="text-xs text-[#7b827d]">Fotos werden geladen …</p>
    <p v-else-if="loadError" class="text-sm text-amber-800">{{ loadError }}</p>
    <p v-else-if="photos.length === 0 && uploads.length === 0" class="card p-5 text-sm text-[#6c756f]">
      <Camera :size="16" class="mr-1 inline text-[#9aa096]" /> Noch keine Fotos zu diesem Training.
    </p>

    <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <li v-for="upload in uploads" :key="upload.id" class="card grid aspect-square place-items-center p-3 text-center text-xs text-[#6c756f]">
        <span><LoaderCircle :size="18" class="mx-auto mb-2 animate-spin" />{{ upload.name }}</span>
      </li>
      <li v-for="photo in photos" :key="photo.id" class="card overflow-hidden" :data-testid="`photo-${photo.id}`">
        <a :href="photo.url" target="_blank" rel="noopener" class="block aspect-square bg-[#eef1ea]">
          <img :src="photo.url" alt="Trainingsfoto" class="h-full w-full object-cover" loading="lazy" />
        </a>
        <div class="space-y-2 p-2">
          <div class="flex flex-wrap gap-1">
            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="statusClass(photo)">{{ statusLabels[photo.consentReviewStatus] }}</span>
            <span v-if="photo.public" class="inline-flex items-center gap-1 rounded-full bg-[#e4f1e7] px-2 py-0.5 text-[10px] font-bold text-forest"><Globe :size="10" /> öffentlich</span>
          </div>
          <div v-if="canManage" class="flex flex-wrap gap-1">
            <button type="button" class="focus-ring inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg border border-[#dfe0d9] px-2 text-[11px] font-semibold text-ink disabled:opacity-50" :disabled="busyPhotoId !== null" @click="startReview(photo)">
              <ShieldCheck :size="14" /> Prüfen
            </button>
            <button
              v-if="photo.consentReviewStatus === 'approved'"
              type="button"
              class="focus-ring inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg border border-[#dfe0d9] px-2 text-[11px] font-semibold text-ink disabled:opacity-50"
              :disabled="busyPhotoId !== null"
              :aria-pressed="!photo.public"
              @click="setPublic(photo, !photo.public)"
            >
              <template v-if="photo.public"><Lock :size="14" /> Nicht öffentlich</template>
              <template v-else><Globe :size="14" /> Öffentlich</template>
            </button>
            <button type="button" class="focus-ring grid min-h-11 w-11 place-items-center rounded-lg border border-[#dfe0d9] text-[#8a4b3c] disabled:opacity-50" :disabled="busyPhotoId !== null" aria-label="Foto löschen" @click="remove(photo)">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </li>
    </ul>

    <section v-if="reviewPhotoId" class="card mt-4 p-4 sm:p-5" aria-labelledby="review-heading">
      <h3 id="review-heading" class="font-display text-base font-bold text-ink">Foto prüfen</h3>
      <p class="mt-1 text-xs text-[#6c756f]">Wähle jede Person aus dem Kader, die auf dem Foto erkennbar ist. Ist jemand erkennbar, der nicht im Kader steht, gib das Foto nicht frei.</p>
      <p v-if="consents === null" class="mt-3 text-sm text-amber-800">Der Einwilligungsstand konnte nicht geladen werden; eine Freigabe ist deshalb gerade nicht möglich.</p>
      <ul class="mt-3 grid gap-1 sm:grid-cols-2">
        <li v-for="player in players" :key="player.id">
          <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-[#f6f8f3]">
            <input v-model="reviewPeople" type="checkbox" :value="player.id" class="h-5 w-5 accent-forest" />
            <span class="min-w-0 flex-1 truncate text-sm text-ink">{{ player.firstName }} {{ player.lastName }}</span>
            <span v-if="consentByPlayer.get(player.id)?.consentRecordId" class="text-[10px] font-semibold text-forest">Einwilligung liegt vor</span>
            <span v-else class="text-[10px] font-semibold text-amber-800">keine Einwilligung</span>
          </label>
        </li>
      </ul>
      <p v-if="reviewMissingConsent.length > 0" class="mt-3 text-sm font-semibold text-amber-800" role="alert">
        Ohne gültige Einwilligung: {{ reviewMissingConsent.map((player) => `${player.firstName} ${player.lastName}`).join(', ') }}. Das Foto bleibt intern; hole die Einwilligung unter „Einwilligungen“ ein.
      </p>
      <label class="mt-4 flex min-h-11 cursor-pointer items-center gap-3">
        <input v-model="reviewAllListed" type="checkbox" class="h-5 w-5 accent-forest" />
        <span class="text-sm text-ink">{{ reviewPeople.length === 0 ? 'Auf dem Foto ist keine Person erkennbar.' : 'Ich habe alle erkennbaren Personen ausgewählt.' }}</span>
      </label>
      <label class="flex min-h-11 cursor-pointer items-center gap-3">
        <input v-model="reviewMakePublic" type="checkbox" class="h-5 w-5 accent-forest" />
        <span class="text-sm text-ink">Auf der öffentlichen Mannschaftsseite zeigen (wenn dort Fotos eingeschaltet sind)</span>
      </label>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-forest px-5 text-xs font-bold text-white disabled:opacity-50"
          :disabled="!reviewAllListed || reviewMissingConsent.length > 0 || consents === null || busyPhotoId !== null"
          @click="submitReview"
        >
          <ShieldCheck :size="15" /> Prüfung speichern
        </button>
        <button type="button" class="focus-ring min-h-11 rounded-xl border border-[#dfe0d9] px-5 text-xs font-semibold text-ink" @click="reviewPhotoId = null">Abbrechen</button>
      </div>
    </section>
  </section>
</template>
