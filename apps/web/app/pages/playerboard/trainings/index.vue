<script setup lang="ts">
import { Check, ChevronRight, Clipboard, ClipboardList, Plus } from '@lucide/vue'
import { PlayerboardTrainingSchema, ScopePlayerboardSettingsSchema, type PlayerboardTraining, type ScopePlayerboardSettings } from '@vereinsfunk/contracts'
import { playerboardErrorMessage } from '../../../utils/playerboardErrors'

// Paket 052, PR 3: Trainings der gewaehlten Mannschaft, neueste zuerst. Entwuerfe sehen nur
// Trainer (RLS); Spieler sehen abgeschlossene Trainings.
const api = useApiClient()
const { team, teamId, organizationId, canManage } = await usePlayerboardTeam()

const trainings = ref<PlayerboardTraining[]>([])
const loading = ref(false)
const errorMessage = ref('')

const { ready } = useScopedLoad(() => teamId.value, async (requestedTeamId, isLatest) => {
  trainings.value = []
  errorMessage.value = ''
  if (!requestedTeamId) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await api.request(`/v1/playerboard/teams/${requestedTeamId}/trainings`, {}, PlayerboardTrainingSchema.array())
    if (isLatest()) trainings.value = result
  } catch (error) {
    if (isLatest()) errorMessage.value = playerboardErrorMessage(error, 'Die Trainings konnten nicht geladen werden.')
  } finally {
    if (isLatest()) loading.value = false
  }
})

const publicSettings = ref<ScopePlayerboardSettings | null>(null)
const publicSettingsError = ref('')
const { ready: publicSettingsReady } = useScopedLoad(() => `${organizationId.value}:${teamId.value}`, async (_scopeKey, isLatest) => {
  publicSettings.value = null
  publicSettingsError.value = ''
  if (!organizationId.value || !teamId.value) return
  try {
    const entries = await api.request(`/v1/organizations/${organizationId.value}/playerboard/settings`, {}, ScopePlayerboardSettingsSchema.array())
    const entry = entries.find((candidate) => candidate.scope === 'team' && candidate.scopeId === teamId.value) ?? null
    if (isLatest()) publicSettings.value = entry
  } catch (error) {
    if (isLatest()) publicSettingsError.value = playerboardErrorMessage(error, 'Der öffentliche Trainingslink konnte nicht geladen werden.')
  }
})
await Promise.all([ready, publicSettingsReady])

const dateFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
function formatDate(value: string): string {
  return dateFormat.format(new Date(`${value}T00:00:00Z`))
}

const publicTrainingPath = computed(() => (
  publicSettings.value?.effective.publicSharingAllowed === true
  && publicSettings.value.own.publicTrainingsEnabled === true
  ? publicSettings.value.publicPath
  : null
))
const copiedTrainingId = ref<string | null>(null)
const copyError = ref('')
function publicTrainingUrl(training: PlayerboardTraining): string {
  if (!publicTrainingPath.value || !import.meta.client) return ''
  const url = new URL(publicTrainingPath.value, window.location.origin)
  url.searchParams.set('training', training.id)
  return url.toString()
}
async function copyPublicLink(training: PlayerboardTraining) {
  const url = publicTrainingUrl(training)
  if (!url || training.status !== 'saved') return
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(url)
    copiedTrainingId.value = training.id
    setTimeout(() => { if (copiedTrainingId.value === training.id) copiedTrainingId.value = null }, 2000)
  } catch {
    copyError.value = 'Der öffentliche Link konnte nicht in die Zwischenablage kopiert werden.'
  }
}
</script>

<template>
  <div>
    <header class="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="eyebrow mb-3">PlayerBoard</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">Trainings</h1>
      </div>
      <PlayerboardTeamPicker />
    </header>

    <PlayerboardTeamEmpty v-if="!team" />
    <template v-else>
      <NuxtLink v-if="canManage" to="/playerboard/trainings/neu" class="focus-ring mb-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-forest px-5 text-xs font-bold text-white">
        <Plus :size="16" /> Training anlegen
      </NuxtLink>

      <p v-if="loading" class="text-xs text-[#7b827d]">Wird geladen …</p>
      <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
      <p v-else-if="publicSettingsError" class="mb-3 text-sm text-amber-800" role="alert">{{ publicSettingsError }}</p>
      <p v-if="copyError" class="mb-3 text-sm text-amber-800" role="alert">{{ copyError }}</p>
      <section v-if="!loading && !errorMessage && trainings.length === 0" class="card p-8 text-center text-sm text-[#6c756f]">
        <ClipboardList :size="20" class="mx-auto mb-2 text-[#9aa096]" />
        Noch kein Training erfasst.
      </section>
      <ul v-else-if="!loading && !errorMessage" class="card divide-y divide-[#ecece5]">
        <li v-for="training in trainings" :key="training.id">
          <div class="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-[#f6f8f3]">
            <NuxtLink :to="`/playerboard/trainings/${training.id}`" class="focus-ring flex min-w-0 flex-1 items-center gap-3">
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-semibold text-ink">{{ formatDate(training.trainingDate) }}</span>
                <span v-if="training.title" class="block truncate text-xs text-[#6c756f]">{{ training.title }}</span>
              </span>
              <span v-if="training.status === 'draft'" class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Entwurf</span>
              <ChevronRight :size="16" class="shrink-0 text-[#9aa096]" />
            </NuxtLink>
            <button
              type="button"
              class="focus-ring inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[#dfe0d9] bg-white px-3 text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="training.status !== 'saved' || !publicTrainingPath"
              :title="training.status !== 'saved' ? 'Entwürfe können nicht öffentlich geteilt werden.' : !publicTrainingPath ? 'Öffentliche Trainings sind nicht aktiviert.' : 'Öffentlichen Link kopieren'"
              @click="copyPublicLink(training)"
            >
              <Check v-if="copiedTrainingId === training.id" :size="14" />
              <Clipboard v-else :size="14" />
              {{ copiedTrainingId === training.id ? 'Kopiert' : 'Link kopieren' }}
            </button>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
