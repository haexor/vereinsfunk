<script setup lang="ts">
import { ArrowLeft, CheckCircle2, Pencil, RotateCcw, Trash2 } from '@lucide/vue'
import {
  PlayerboardCategorySchema,
  PlayerboardPhotoConsentSchema,
  PlayerboardPlayerSchema,
  PlayerboardTrainingDetailSchema,
  type PlayerboardCategory,
  type PlayerboardPhotoConsent,
  type PlayerboardPlayer,
  type PlayerboardTrainingDetail,
} from '@vereinsfunk/contracts'
import { localDateKey } from '../../../utils/memberDates'
import { playerboardErrorMessage } from '../../../utils/playerboardErrors'

// Paket 052, PR 3: ein Training -- Kopf (Datum, Titel, Notiz, Entwurf/abgeschlossen), mobile
// Punkteeingabe und Fotos. Die Mannschaft ergibt sich aus dem Training, nicht aus der Auswahl:
// ein Link auf ein Training funktioniert unabhaengig vom gewaehlten Arbeitsbereich.
const route = useRoute()
const api = useApiClient()
const session = await useSession()
const trainingId = computed(() => String(route.params.id))

const detail = ref<PlayerboardTrainingDetail | null>(null)
const players = ref<PlayerboardPlayer[]>([])
const categories = ref<PlayerboardCategory[]>([])
const consents = ref<PlayerboardPhotoConsent[] | null>(null)
const loadError = ref('')
const actionError = ref('')

const teamPath = computed(() => {
  const teamId = detail.value?.training.teamId
  for (const organization of session.value?.scopes ?? []) {
    for (const department of organization.departments) {
      const team = department.teams.find((item) => item.id === teamId)
      if (team) return { organizationId: organization.organizationId, departmentId: department.id, teamId: team.id, teamName: team.name, timezone: organization.organizationTimezone }
    }
  }
  return null
})
const canManage = computed(() => (teamPath.value ? useCan('training.manage', teamPath.value) : false))
const activePlayers = computed(() => players.value.filter((player) => player.active))
const effectiveCategories = computed(() => categories.value.filter((category) => category.effective))
const missingConsent = computed(() => new Set((consents.value ?? []).filter((consent) => !consent.consentRecordId).map((consent) => consent.playerId)))

async function load() {
  loadError.value = ''
  try {
    detail.value = await api.request(`/v1/playerboard/trainings/${trainingId.value}`, {}, PlayerboardTrainingDetailSchema)
    const teamId = detail.value.training.teamId
    const [roster, teamCategories] = await Promise.all([
      api.request(`/v1/playerboard/teams/${teamId}/players`, {}, PlayerboardPlayerSchema.array()),
      api.request('/v1/playerboard/categories', { query: { scope: 'team', scopeId: teamId } }, PlayerboardCategorySchema.array()),
    ])
    players.value = roster
    categories.value = teamCategories
    consents.value = canManage.value
      ? await api.request(`/v1/playerboard/teams/${teamId}/photo-consents`, {}, PlayerboardPhotoConsentSchema.array()).catch(() => null)
      : null
  } catch (error) {
    loadError.value = playerboardErrorMessage(error, 'Das Training konnte nicht geladen werden.')
  }
}
await load()

// --- Kopf bearbeiten ---------------------------------------------------------------------------

const editing = ref(false)
const form = reactive({ trainingDate: '', title: '', note: '' })
const saving = ref(false)
const today = computed(() => localDateKey(new Date(), teamPath.value?.timezone ?? 'Europe/Berlin'))

function startEdit() {
  if (!detail.value) return
  form.trainingDate = detail.value.training.trainingDate
  form.title = detail.value.training.title ?? ''
  form.note = detail.value.training.note ?? ''
  editing.value = true
}

async function patch(body: Record<string, unknown>, fallback: string) {
  saving.value = true
  actionError.value = ''
  try {
    detail.value = await api.request(`/v1/playerboard/trainings/${trainingId.value}`, { method: 'PATCH', body }, PlayerboardTrainingDetailSchema)
    return true
  } catch (error) {
    actionError.value = playerboardErrorMessage(error, fallback)
    return false
  } finally {
    saving.value = false
  }
}

async function saveHead() {
  const saved = await patch({ trainingDate: form.trainingDate, title: form.title.trim() || null, note: form.note.trim() || null }, 'Die Änderungen konnten nicht gespeichert werden.')
  if (saved) editing.value = false
}

async function setStatus(status: 'draft' | 'saved') {
  await patch({ status }, status === 'saved' ? 'Das Training konnte nicht abgeschlossen werden.' : 'Das Training konnte nicht geöffnet werden.')
}

async function remove() {
  if (!window.confirm('Training mit allen Punkten und Fotos löschen?')) return
  saving.value = true
  try {
    await api.request(`/v1/playerboard/trainings/${trainingId.value}`, { method: 'DELETE' })
    await navigateTo('/playerboard/trainings')
  } catch (error) {
    actionError.value = playerboardErrorMessage(error, 'Das Training konnte nicht gelöscht werden.')
  } finally {
    saving.value = false
  }
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
const formattedDate = computed(() => (detail.value ? dateFormat.format(new Date(`${detail.value.training.trainingDate}T00:00:00Z`)) : ''))
</script>

<template>
  <div>
    <NuxtLink to="/playerboard/trainings" class="focus-ring mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg text-xs font-semibold text-[#6c756f]">
      <ArrowLeft :size="15" /> Alle Trainings
    </NuxtLink>

    <p v-if="loadError" class="card p-6 text-sm text-amber-800">{{ loadError }}</p>
    <template v-else-if="detail">
      <header class="mb-6">
        <div class="eyebrow mb-3">PlayerBoard · {{ teamPath?.teamName ?? 'Training' }}</div>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h1 class="font-display text-2xl font-extrabold tracking-[-.04em] text-ink sm:text-3xl">{{ formattedDate }}</h1>
            <p v-if="detail.training.title" class="mt-1 text-sm font-semibold text-[#5b625d]">{{ detail.training.title }}</p>
          </div>
          <span v-if="detail.training.status === 'draft'" class="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-800">Entwurf – nur für Trainer sichtbar</span>
          <span v-else class="rounded-full bg-[#e4f1e7] px-3 py-1 text-[11px] font-bold text-forest">Abgeschlossen – für die Mannschaft sichtbar</span>
        </div>
        <p v-if="detail.training.note && !editing" class="mt-3 whitespace-pre-line rounded-xl bg-white/70 p-3 text-sm text-[#435047]">{{ detail.training.note }}</p>

        <div v-if="canManage && !editing" class="mt-4 flex flex-wrap gap-2">
          <button v-if="detail.training.status === 'draft'" type="button" class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-forest px-4 text-xs font-bold text-white disabled:opacity-60" :disabled="saving" @click="setStatus('saved')">
            <CheckCircle2 :size="15" /> Abschließen und für die Mannschaft freigeben
          </button>
          <button v-else type="button" class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white px-4 text-xs font-semibold text-ink disabled:opacity-60" :disabled="saving" @click="setStatus('draft')">
            <RotateCcw :size="15" /> Wieder als Entwurf
          </button>
          <button type="button" class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white px-4 text-xs font-semibold text-ink" @click="startEdit">
            <Pencil :size="15" /> Bearbeiten
          </button>
          <button type="button" class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#dfe0d9] bg-white px-4 text-xs font-semibold text-[#8a4b3c] disabled:opacity-60" :disabled="saving" @click="remove">
            <Trash2 :size="15" /> Löschen
          </button>
        </div>

        <form v-if="editing" class="card mt-4 grid gap-3 p-4" @submit.prevent="saveHead">
          <label class="grid gap-1.5 text-xs font-semibold text-[#5b625d]">
            Datum
            <input v-model="form.trainingDate" type="date" required :max="today" class="focus-ring h-11 rounded-xl border border-[#dfe0d9] px-3 text-sm text-ink" />
          </label>
          <label class="grid gap-1.5 text-xs font-semibold text-[#5b625d]">
            Titel
            <input v-model="form.title" maxlength="120" class="focus-ring h-11 rounded-xl border border-[#dfe0d9] px-3 text-sm text-ink" />
          </label>
          <label class="grid gap-1.5 text-xs font-semibold text-[#5b625d]">
            Notiz
            <textarea v-model="form.note" maxlength="2000" rows="3" class="focus-ring rounded-xl border border-[#dfe0d9] p-3 text-sm text-ink" />
          </label>
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="focus-ring min-h-11 rounded-xl bg-forest px-5 text-xs font-bold text-white disabled:opacity-60" :disabled="saving">Speichern</button>
            <button type="button" class="focus-ring min-h-11 rounded-xl border border-[#dfe0d9] px-5 text-xs font-semibold text-ink" @click="editing = false">Abbrechen</button>
          </div>
        </form>
        <p v-if="actionError" class="mt-3 text-sm font-semibold text-amber-800" role="alert">{{ actionError }}</p>
      </header>

      <PlayerboardPointEntry
        :training-id="detail.training.id"
        :players="activePlayers"
        :categories="effectiveCategories"
        :entries="detail.entries"
        :can-edit="canManage"
        :missing-consent="missingConsent"
      />

      <PlayerboardTrainingPhotos :training-id="detail.training.id" :players="activePlayers" :consents="consents" :can-manage="canManage" />
    </template>
  </div>
</template>
