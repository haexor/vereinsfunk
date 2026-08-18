<script setup lang="ts">
import { AlertTriangle, Check, MessageSquareText, RefreshCw, ShieldCheck, X } from '@lucide/vue'
import { ApprovalStageSchema, StalledApprovalRequestSchema, type ApprovalStage, type MediaGateBlocker, type StalledApprovalRequest } from '@vereinsfunk/contracts'

// Paket 015: Medien-Gate-Blocker (evaluateMediaGate) je Stufe -- eine fehlende oder nicht
// passende Einwilligung ist jetzt sichtbar, statt nur beim Freigeben selbst zu scheitern.
const BLOCKER_LABELS: Record<MediaGateBlocker, string> = {
  scan_pending: 'Medien-Scan nicht abgeschlossen', people_review_pending: 'Foto noch nicht auf Personen geprüft',
  face_pending: 'Gesichter noch nicht entschieden',
  consent_invalid: 'Einwilligung ungültig (widerrufen, abgelaufen oder abgelöst)',
  consent_scope_mismatch: 'Einwilligung deckt diese Verwendung nicht ab',
  derivative_stale: 'Medien-Derivat nicht aktuell', minor_review_required: 'Minderjährigenprüfung fehlt noch',
  original_selected: 'Unbearbeitetes Originalbild ausgewählt', naming_not_allowed: 'Namentliche Nennung nicht erlaubt',
  sensitive_text_data: 'Möglicherweise sensible Angabe im Text',
}

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
  if (!organizationId.value) { stages.value = []; loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    // Auf den aktiven Verein begrenzt: wer in mehreren Vereinen prüft, soll hier nur die Freigaben
    // des gerade gewählten sehen.
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/approval-stages/mine`, {
      headers, query: { organizationId: organizationId.value },
    })
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

// Paket 024: festhaengende Freigaben der eigenen Ebene -- getrennt von "wartet auf mich" oben, weil
// eine verwaltende Person hier nicht zwingend selbst Pruefer ist. GET /v1/approval-requests/stalled
// liefert ueber RLS ohnehin nur, was die aufrufende Person sehen darf (department.manage genuegt);
// eine leere Liste ist deshalb der Normalfall fuer die meisten Mitglieder, kein Fehler.
const stalledRequests = ref<StalledApprovalRequest[]>([])
const reresolveReasonDraft = reactive<Record<string, string>>({})
const reresolveOpenId = ref<string | null>(null)
const reresolvingId = ref<string | null>(null)
const reresolveError = ref('')
const stalledError = ref('')

async function loadStalled() {
  if (!organizationId.value) { stalledRequests.value = []; return }
  stalledError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/approval-requests/stalled`, {
      headers, query: { organizationId: organizationId.value },
    })
    stalledRequests.value = StalledApprovalRequestSchema.array().parse(response)
  } catch {
    stalledRequests.value = []
    stalledError.value = 'Die festhängenden Freigaben konnten nicht geladen werden.'
  }
}
await loadStalled()
watch(organizationId, () => void loadStalled())

async function reresolve(item: StalledApprovalRequest) {
  const reason = reresolveReasonDraft[item.approvalRequestId]?.trim() ?? ''
  if (reason.length < 10) { reresolveError.value = 'Die Begründung muss mindestens 10 Zeichen lang sein.'; return }
  reresolvingId.value = item.approvalRequestId
  reresolveError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/approval-requests/${item.approvalRequestId}/reresolve`, {
      method: 'POST', headers, body: { reason },
    })
    reresolveOpenId.value = null
    delete reresolveReasonDraft[item.approvalRequestId]
    await Promise.all([loadStalled(), load()])
  } catch {
    reresolveError.value = 'Die Route konnte nicht neu aufgelöst werden.'
  } finally {
    reresolvingId.value = null
  }
}
</script>

<template>
  <div>
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
            <ShieldCheck :size="15" class="text-emerald-700" /> Diese Stufe ist unbefreibar.
          </div>
          <ul v-if="stageItem.mediaGateBlockers.length" class="my-4 space-y-1.5">
            <li v-for="blocker in stageItem.mediaGateBlockers" :key="blocker" class="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-[10px] font-medium text-amber-800">
              <AlertTriangle :size="14" class="shrink-0" /> {{ BLOCKER_LABELS[blocker] }}
            </li>
          </ul>
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

    <!-- Paket 024: festhaengende Freigaben der eigenen Ebene -- nur sichtbar, wenn tatsaechlich
         etwas haengt (leere Liste ist der Normalfall). stalledError bleibt sichtbar, auch wenn die
         Liste dadurch leer ist -- sonst ist ein Ladefehler von "nichts haengt fest" nicht zu
         unterscheiden. -->
    <p v-if="stalledError" class="mt-10 text-sm text-amber-800">{{ stalledError }}</p>
    <section v-if="stalledRequests.length" class="mt-10">
      <header class="mb-4">
        <h2 class="font-display text-xl font-bold tracking-[-.03em]">Festhängende Freigaben deiner Ebene</h2>
        <p class="mt-1 text-sm text-[#727a75]">Überfällig oder durch ein geändertes Medium ungültig geworden. Eine Neuauflösung ersetzt den Prüferkreis anhand der aktuellen Richtlinie.</p>
      </header>
      <p v-if="reresolveError" class="mb-4 text-sm text-amber-800">{{ reresolveError }}</p>
      <div class="grid gap-4 lg:grid-cols-2">
        <article v-for="item in stalledRequests" :key="item.approvalRequestId" class="card p-5">
          <div class="flex items-start justify-between gap-4">
            <h3 class="font-display text-sm font-bold">{{ item.postTitle || 'Ohne Titel' }}</h3>
            <div class="flex shrink-0 gap-1.5">
              <span v-if="item.isOverdue" class="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-800">Überfällig</span>
              <span v-if="item.invalidated" class="rounded-full bg-rose-100 px-3 py-1 text-[11px] font-bold text-rose-800">Medium geändert</span>
            </div>
          </div>
          <template v-if="reresolveOpenId === item.approvalRequestId">
            <label class="mt-4 mb-3 block"><span class="mb-1 block text-xs font-semibold">Begründung für die Neuauflösung (mind. 10 Zeichen, für den Autor sichtbar)</span>
              <input v-model="reresolveReasonDraft[item.approvalRequestId]" maxlength="2000" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" />
            </label>
            <div class="flex gap-2">
              <button
                type="button" class="focus-ring flex-1 rounded-xl border border-[#dfe0d9] px-3 py-2.5 text-xs font-semibold"
                @click="reresolveOpenId = null"
              >
                Abbrechen
              </button>
              <button
                type="button" :disabled="reresolvingId === item.approvalRequestId"
                class="focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl bg-forest px-3 py-2.5 text-xs font-bold text-white disabled:opacity-60"
                @click="reresolve(item)"
              >
                <RefreshCw :size="14" /> Route neu auflösen
              </button>
            </div>
          </template>
          <button
            v-else type="button"
            class="focus-ring mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[#dfe0d9] px-3 py-2.5 text-xs font-semibold"
            @click="reresolveOpenId = item.approvalRequestId"
          >
            <RefreshCw :size="14" /> Neu auflösen
          </button>
        </article>
      </div>
    </section>
  </div>
</template>
