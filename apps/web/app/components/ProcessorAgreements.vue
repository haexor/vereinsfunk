<script setup lang="ts">
import { z } from 'zod'
import { ProcessorAgreementSchema, type ProcessorAgreement, type ProcessorAgreementStatus } from '@vereinsfunk/contracts'

const DocumentUrlSchema = z.object({ signedUrl: z.url() })

const props = defineProps<{ organizationId: string | null }>()
const api = useApiClient()
const agreements = ref<ProcessorAgreement[]>([])
const loading = ref(false)
const actionError = ref('')
const AGREEMENT_STATUS_LABELS: Record<ProcessorAgreementStatus, string> = { pending: 'Ausstehend', active: 'Aktiv', expired: 'Abgelaufen', terminated: 'Beendet' }
const AGREEMENT_STATUS_CLASSES: Record<ProcessorAgreementStatus, string> = { pending: 'bg-amber-100 text-amber-800', active: 'bg-emerald-100 text-emerald-800', expired: 'bg-red-100 text-red-800', terminated: 'bg-[#eef0ea] text-[#7b827d]' }
const AGREEMENT_STATUS_OPTIONS: ProcessorAgreementStatus[] = ['pending', 'active', 'expired', 'terminated']
const agreementForm = reactive({ processorName: '', purpose: '', signedAt: '', validUntil: '', status: 'pending' as ProcessorAgreementStatus, file: null as File | null })
const creatingAgreement = ref(false)
const changingAgreementId = ref<string | null>(null)
const viewingAgreementId = ref<string | null>(null)

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('de-DE') : 'nicht angegeben'
}
function resetForm() {
  Object.assign(agreementForm, { processorName: '', purpose: '', signedAt: '', validUntil: '', status: 'pending', file: null })
}
async function load() {
  if (!props.organizationId) { agreements.value = []; return }
  loading.value = true
  actionError.value = ''
  try {
    agreements.value = await api.request(`/v1/organizations/${props.organizationId}/processor-agreements`, {}, ProcessorAgreementSchema.array())
  } catch {
    actionError.value = 'Die Auftragsverarbeiter konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
async function createAgreement() {
  if (!props.organizationId) return
  creatingAgreement.value = true
  actionError.value = ''
  try {
    const body = agreementForm.file ? new FormData() : {
      processorName: agreementForm.processorName, purpose: agreementForm.purpose,
      signedAt: agreementForm.signedAt || undefined, validUntil: agreementForm.validUntil || undefined,
      status: agreementForm.status,
    }
    if (body instanceof FormData) {
      body.set('processorName', agreementForm.processorName)
      body.set('purpose', agreementForm.purpose)
      if (agreementForm.signedAt) body.set('signedAt', agreementForm.signedAt)
      if (agreementForm.validUntil) body.set('validUntil', agreementForm.validUntil)
      body.set('status', agreementForm.status)
      body.set('file', agreementForm.file!)
    }
    const agreement = await api.request(`/v1/organizations/${props.organizationId}/processor-agreements`, { method: 'POST', body }, ProcessorAgreementSchema)
    agreements.value = [...agreements.value, agreement]
    resetForm()
  } catch {
    actionError.value = 'Die Vereinbarung konnte nicht angelegt werden.'
  } finally {
    creatingAgreement.value = false
  }
}
async function changeAgreementStatus(agreement: ProcessorAgreement, status: ProcessorAgreementStatus) {
  if (status === agreement.status) return
  changingAgreementId.value = agreement.id
  actionError.value = ''
  try {
    const updated = await api.request(`/v1/processor-agreements/${agreement.id}`, { method: 'PATCH', body: { status } }, ProcessorAgreementSchema)
    agreements.value = agreements.value.map((item) => item.id === updated.id ? updated : item)
  } catch {
    actionError.value = 'Der Status konnte nicht geändert werden.'
  } finally {
    changingAgreementId.value = null
  }
}
async function viewAgreementDocument(agreement: ProcessorAgreement) {
  viewingAgreementId.value = agreement.id
  actionError.value = ''
  try {
    const response = await api.request(`/v1/processor-agreements/${agreement.id}/document-url`, {}, DocumentUrlSchema)
    window.open(response.signedUrl, '_blank', 'noopener')
  } catch {
    actionError.value = 'Das Dokument konnte nicht geöffnet werden.'
  } finally {
    viewingAgreementId.value = null
  }
}
watch(() => props.organizationId, () => { void load() }, { immediate: true })
</script>

<template>
  <section class="card mb-6 p-6">
    <h2 class="mb-1 font-display text-base font-bold">Auftragsverarbeiter</h2>
    <p class="mb-4 text-[11px] text-[#7b827d]">Supabase, Hosting, E-Mail-Versand, LLM-Anbieter, Meta und ggf. Quellsysteme — jeweils mit dem eigenen Vertrag, falls vorhanden.</p>
    <p v-if="actionError" class="mb-3 text-xs text-amber-800">{{ actionError }}</p>
    <p v-if="loading" class="mb-3 text-xs text-[#7b827d]">Wird geladen …</p>
    <ul v-else class="mb-4 space-y-2">
      <li v-for="agreement in agreements" :key="agreement.id" class="rounded-lg bg-[#f7f8f4] px-3 py-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2"><div><p class="text-sm font-semibold">{{ agreement.processorName }}</p><p class="text-[11px] text-[#9aa096]">{{ agreement.purpose }}</p></div><span class="rounded-full px-2.5 py-1 text-[10px] font-bold" :class="AGREEMENT_STATUS_CLASSES[agreement.status]">{{ AGREEMENT_STATUS_LABELS[agreement.status] }}</span></div>
        <p class="mt-1.5 text-[11px] text-[#9aa096]">Unterzeichnet: {{ formatDate(agreement.signedAt) }} · Gültig bis: {{ formatDate(agreement.validUntil) }} · {{ agreement.hasDocument ? 'Dokument hinterlegt' : 'Kein Dokument hinterlegt' }}</p>
        <label class="mt-2 inline-flex items-center gap-2 text-[11px]"><span class="font-semibold">Status ändern:</span><select :value="agreement.status" :disabled="changingAgreementId === agreement.id" class="focus-ring rounded-lg border border-[#dfe0d9] p-1.5 text-[11px]" @change="changeAgreementStatus(agreement, ($event.target as HTMLSelectElement).value as typeof agreement.status)"><option v-for="option in AGREEMENT_STATUS_OPTIONS" :key="option" :value="option">{{ AGREEMENT_STATUS_LABELS[option] }}</option></select></label>
        <button v-if="agreement.hasDocument" type="button" :disabled="viewingAgreementId === agreement.id" class="focus-ring ml-3 mt-2 rounded-lg border border-[#dfe0d9] px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50" @click="viewAgreementDocument(agreement)">{{ viewingAgreementId === agreement.id ? 'Öffnet …' : 'Dokument ansehen' }}</button>
      </li>
      <li v-if="!agreements.length" class="text-xs text-[#9aa096]">Noch kein Auftragsverarbeiter erfasst.</li>
    </ul>
    <h3 class="mb-3 mt-4 text-xs font-bold uppercase tracking-wide text-[#7b827d]">Neu anlegen</h3>
    <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="createAgreement">
      <label><span class="mb-1 block text-xs font-semibold">Name</span><input v-model="agreementForm.processorName" required maxlength="200" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Zweck</span><input v-model="agreementForm.purpose" required maxlength="300" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Unterzeichnet am</span><input v-model="agreementForm.signedAt" type="date" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Gültig bis</span><input v-model="agreementForm.validUntil" type="date" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Status</span><select v-model="agreementForm.status" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm"><option v-for="option in AGREEMENT_STATUS_OPTIONS" :key="option" :value="option">{{ AGREEMENT_STATUS_LABELS[option] }}</option></select></label>
      <label><span class="mb-1 block text-xs font-semibold">Vertragsdokument (PDF oder DOCX, optional)</span><input type="file" accept=".pdf,.docx" class="focus-ring w-full text-xs" @change="agreementForm.file = ($event.target as HTMLInputElement).files?.[0] ?? null" /></label>
      <div class="sm:col-span-2"><button type="submit" :disabled="creatingAgreement" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">{{ creatingAgreement ? 'Wird angelegt …' : 'Anlegen' }}</button></div>
    </form>
  </section>
</template>
