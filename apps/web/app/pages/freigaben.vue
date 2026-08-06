<script setup lang="ts">
import { Check, MessageSquareText, ShieldCheck, X } from '@lucide/vue'
import { ApprovalStageSchema, type ApprovalStage } from '@vereinsfunk/contracts'

// Paket 011: ersetzt die zwei erfundenen Beiträge durch die echten Stufen, die auf die
// anfragende Person warten (GET /v1/approval-stages/mine). Ohne Paket 005/006 (Inhalts-Pipeline)
// entstehen noch keine echten Beiträge -- die Liste bleibt deshalb ehrlich leer, bis dort ein
// Beitrag den Status "awaiting_approval" erreicht.
const config = useRuntimeConfig()
const scope = await useScope()
const organizationId = computed(() => scope.value?.organizationId ?? null)

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')
const stages = ref<ApprovalStage[]>([])
const reasonDraft = reactive<Record<string, string>>({})
const decidingStageId = ref<string | null>(null)

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/approval-stages/mine`, { headers })
    stages.value = ApprovalStageSchema.array().parse(response)
  } catch {
    errorMessage.value = 'Die offenen Freigaben konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()
watch(organizationId, () => void load())

async function decide(stage: ApprovalStage, decision: 'approved' | 'changes_requested' | 'rejected') {
  decidingStageId.value = stage.id
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/approval-stages/${stage.id}/decide`, {
      method: 'POST', headers, body: { decision, reason: reasonDraft[stage.id]?.trim() || null },
    })
    await load()
  } catch {
    actionError.value = 'Die Entscheidung konnte nicht gespeichert werden.'
  } finally {
    decidingStageId.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-[1180px] px-5 py-8 sm:px-10">
    <header class="mb-8">
      <div class="eyebrow mb-3">Qualitätssicherung</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Offene Freigaben</h1>
      <p class="mt-2 text-sm text-[#727a75]">Beiträge, die auf deine Entscheidung warten.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else>
      <p v-if="actionError" class="mb-4 text-sm text-amber-800">{{ actionError }}</p>
      <div v-if="stages.length" class="grid gap-6 lg:grid-cols-2">
        <article v-for="stageItem in stages" :key="stageItem.id" class="card p-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="font-display text-base font-bold">{{ stageItem.label }}</h2>
              <p class="mt-1 text-[11px] text-[#7b827d]">Stufe {{ stageItem.position }} · mindestens {{ stageItem.minimumApprovals }} Freigabe(n)</p>
            </div>
            <span v-if="stageItem.isOverdue" class="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-800">Überfällig</span>
          </div>
          <div v-if="stageItem.isMinorStage" class="my-4 flex items-center gap-2 rounded-xl bg-[#f1f4ed] p-3 text-[10px] font-medium text-[#58635b]">
            <ShieldCheck :size="15" class="text-emerald-700" /> Minderjährigenschutz — diese Stufe ist unbefreibar.
          </div>
          <label class="mb-3 block"><span class="mb-1 block text-xs font-semibold">Begründung (bei Änderung/Ablehnung sichtbar für den Autor)</span>
            <input v-model="reasonDraft[stageItem.id]" maxlength="2000" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" />
          </label>
          <div class="flex gap-2">
            <button
              type="button" :disabled="decidingStageId === stageItem.id"
              class="focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#dfe0d9] px-3 py-2.5 text-xs font-semibold disabled:opacity-60"
              @click="decide(stageItem, 'changes_requested')"
            >
              <MessageSquareText :size="14" /> Änderung
            </button>
            <button
              type="button" :disabled="decidingStageId === stageItem.id"
              class="focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#dfe0d9] px-3 py-2.5 text-xs font-semibold text-amber-800 disabled:opacity-60"
              @click="decide(stageItem, 'rejected')"
            >
              <X :size="14" /> Ablehnen
            </button>
            <button
              type="button" :disabled="decidingStageId === stageItem.id"
              class="focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl bg-forest px-3 py-2.5 text-xs font-bold text-white disabled:opacity-60"
              @click="decide(stageItem, 'approved')"
            >
              <Check :size="14" /> Freigeben
            </button>
          </div>
        </article>
      </div>
      <div v-else class="card overflow-hidden">
        <div class="p-12 text-center text-sm text-[#7b827d]">Keine Freigaben warten derzeit auf dich.</div>
      </div>
    </template>
  </div>
</template>
