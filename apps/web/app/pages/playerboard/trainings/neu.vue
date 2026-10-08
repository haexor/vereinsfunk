<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import { PlayerboardTrainingDetailSchema } from '@vereinsfunk/contracts'
import { localDateKey } from '../../../utils/memberDates'
import { playerboardErrorMessage } from '../../../utils/playerboardErrors'

// Paket 052, PR 3: neues Training -- Datum (heute vorbelegt, nie in der Zukunft), optional Titel
// und Notiz. Danach direkt zur Punkteeingabe.
const api = useApiClient()
const { team, teamId, canManage, organizationTimezone } = await usePlayerboardTeam()

const today = computed(() => localDateKey(new Date(), organizationTimezone.value))
const form = reactive({ trainingDate: today.value, title: '', note: '' })
const submitting = ref(false)
const errorMessage = ref('')

async function create() {
  if (!teamId.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    const created = await api.request('/v1/playerboard/trainings', {
      method: 'POST',
      body: { teamId: teamId.value, trainingDate: form.trainingDate, title: form.title.trim() || null, note: form.note.trim() || null },
    }, PlayerboardTrainingDetailSchema)
    await navigateTo(`/playerboard/trainings/${created.training.id}`)
  } catch (error) {
    errorMessage.value = playerboardErrorMessage(error, 'Das Training konnte nicht angelegt werden.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-xl">
    <NuxtLink to="/playerboard/trainings" class="focus-ring mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg text-xs font-semibold text-[#6c756f]">
      <ArrowLeft :size="15" /> Alle Trainings
    </NuxtLink>
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="eyebrow mb-3">PlayerBoard</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.045em] text-ink">Training anlegen</h1>
      </div>
      <PlayerboardTeamPicker />
    </header>

    <PlayerboardTeamEmpty v-if="!team" />
    <p v-else-if="!canManage" class="card p-6 text-sm text-[#6c756f]">Trainings legen die Trainer dieser Mannschaft an.</p>
    <form v-else class="card grid gap-4 p-5" @submit.prevent="create">
      <label class="grid gap-1.5 text-xs font-semibold text-[#5b625d]">
        Datum
        <input v-model="form.trainingDate" type="date" required :max="today" class="focus-ring h-11 rounded-xl border border-[#dfe0d9] px-3 text-sm text-ink" />
      </label>
      <label class="grid gap-1.5 text-xs font-semibold text-[#5b625d]">
        Titel <span class="font-normal text-[#9aa096]">optional, z. B. „Abschluss und Pressing“</span>
        <input v-model="form.title" maxlength="120" class="focus-ring h-11 rounded-xl border border-[#dfe0d9] px-3 text-sm text-ink" />
      </label>
      <label class="grid gap-1.5 text-xs font-semibold text-[#5b625d]">
        Notiz <span class="font-normal text-[#9aa096]">optional, sieht nur die Mannschaft</span>
        <textarea v-model="form.note" maxlength="2000" rows="4" class="focus-ring rounded-xl border border-[#dfe0d9] p-3 text-sm text-ink" />
      </label>
      <p v-if="errorMessage" class="text-sm font-semibold text-amber-800" role="alert">{{ errorMessage }}</p>
      <button type="submit" class="focus-ring min-h-11 rounded-xl bg-forest px-5 text-sm font-bold text-white disabled:opacity-60" :disabled="submitting">
        {{ submitting ? 'Wird angelegt …' : 'Anlegen und Punkte erfassen' }}
      </button>
    </form>
  </div>
</template>
