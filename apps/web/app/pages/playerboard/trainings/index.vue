<script setup lang="ts">
import { ChevronRight, ClipboardList, Plus } from '@lucide/vue'
import { PlayerboardTrainingSchema, type PlayerboardTraining } from '@vereinsfunk/contracts'
import { playerboardErrorMessage } from '../../../utils/playerboardErrors'

// Paket 052, PR 3: Trainings der gewaehlten Mannschaft, neueste zuerst. Entwuerfe sehen nur
// Trainer (RLS); Spieler sehen abgeschlossene Trainings.
const api = useApiClient()
const { team, teamId, canManage } = await usePlayerboardTeam()

const trainings = ref<PlayerboardTraining[]>([])
const loading = ref(false)
const errorMessage = ref('')

async function load() {
  trainings.value = []
  errorMessage.value = ''
  const requestedTeamId = teamId.value
  if (!requestedTeamId) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await api.request(`/v1/playerboard/teams/${requestedTeamId}/trainings`, {}, PlayerboardTrainingSchema.array())
    if (teamId.value === requestedTeamId) trainings.value = result
  } catch (error) {
    if (teamId.value === requestedTeamId) errorMessage.value = playerboardErrorMessage(error, 'Die Trainings konnten nicht geladen werden.')
  } finally {
    if (teamId.value === requestedTeamId) loading.value = false
  }
}
await load()
watch(teamId, () => { void load() })

const dateFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
function formatDate(value: string): string {
  return dateFormat.format(new Date(`${value}T00:00:00Z`))
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
      <section v-else-if="trainings.length === 0" class="card p-8 text-center text-sm text-[#6c756f]">
        <ClipboardList :size="20" class="mx-auto mb-2 text-[#9aa096]" />
        Noch kein Training erfasst.
      </section>
      <ul v-else class="card divide-y divide-[#ecece5]">
        <li v-for="training in trainings" :key="training.id">
          <NuxtLink :to="`/playerboard/trainings/${training.id}`" class="focus-ring flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-[#f6f8f3]">
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold text-ink">{{ formatDate(training.trainingDate) }}</span>
              <span v-if="training.title" class="block truncate text-xs text-[#6c756f]">{{ training.title }}</span>
            </span>
            <span v-if="training.status === 'draft'" class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Entwurf</span>
            <ChevronRight :size="16" class="shrink-0 text-[#9aa096]" />
          </NuxtLink>
        </li>
      </ul>
    </template>
  </div>
</template>
