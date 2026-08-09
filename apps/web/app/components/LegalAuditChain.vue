<script setup lang="ts">
import {
  AuditChainVerificationSchema,
  SignAuditChainResponseSchema,
  type AuditChainVerification,
  type SignAuditChainResponse,
} from '@vereinsfunk/contracts'

const props = defineProps<{ organizationId: string | null }>()
const api = useApiClient()
const auditVerification = ref<AuditChainVerification | null>(null)
const auditSignResult = ref<SignAuditChainResponse | null>(null)
const auditVerifying = ref(false)
const auditSigning = ref(false)
const auditVerifyError = ref('')
const auditSignError = ref('')

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('de-DE') : 'nicht angegeben'
}

async function verifyAuditChain() {
  if (!props.organizationId) return
  auditVerifying.value = true
  auditVerifyError.value = ''
  try {
    auditVerification.value = await api.request(`/v1/organizations/${props.organizationId}/audit-chain/verify`, {}, AuditChainVerificationSchema)
  } catch {
    auditVerifyError.value = 'Die Kette konnte nicht geprüft werden.'
  } finally {
    auditVerifying.value = false
  }
}

async function signAuditChain() {
  if (!props.organizationId) return
  auditSigning.value = true
  auditSignError.value = ''
  try {
    auditSignResult.value = await api.request(`/v1/organizations/${props.organizationId}/audit-chain/sign`, { method: 'POST' }, SignAuditChainResponseSchema)
    await verifyAuditChain()
  } catch {
    auditSignError.value = 'Die Kette konnte nicht signiert werden.'
  } finally {
    auditSigning.value = false
  }
}
</script>

<template>
  <section class="card p-6">
    <h2 class="mb-1 font-display text-base font-bold">Manipulationssicherer Audit-Trail</h2>
    <p class="mb-4 text-[11px] text-[#7b827d]">Rollen- und Mitgliedschaftsänderungen sind als Hash-Kette verkettet. Signieren macht den aktuellen Kettenkopf mit einem Schlüssel außerhalb der Datenbank nachweisbar.</p>
    <div class="flex flex-wrap gap-2">
      <button type="button" :disabled="auditVerifying" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold disabled:opacity-60" @click="verifyAuditChain">{{ auditVerifying ? 'Wird geprüft …' : 'Kette prüfen' }}</button>
      <button type="button" :disabled="auditSigning" class="focus-ring rounded-lg bg-forest px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60" @click="signAuditChain">{{ auditSigning ? 'Wird signiert …' : 'Jetzt signieren' }}</button>
    </div>
    <p v-if="auditVerifyError" class="mt-3 text-xs text-amber-800">{{ auditVerifyError }}</p>
    <p v-if="auditSignError" class="mt-3 text-xs text-amber-800">{{ auditSignError }}</p>
    <div v-if="auditVerification" class="mt-4 rounded-xl p-4" :class="auditVerification.tamperedCount > 0 ? 'bg-red-50' : 'bg-[#f4f5ef]'">
      <p v-if="auditVerification.tamperedCount > 0" class="text-sm font-bold text-red-800">Manipulation erkannt: {{ auditVerification.tamperedCount }} von {{ auditVerification.checkedCount }} geprüften Ereignissen weichen von der erwarteten Kette ab.</p>
      <p v-else class="text-sm font-semibold text-ink">Keine Manipulation erkannt — {{ auditVerification.checkedCount }} Ereignisse geprüft.</p>
      <p v-if="auditVerification.unlinkedCount > 0" class="mt-1 text-[11px] text-[#7b827d]">{{ auditVerification.unlinkedCount }} Ereignisse sind nicht verkettet — das ist nach einer regulären Aufbewahrungslöschung normal und kein Alarmsignal für sich.</p>
      <p class="mt-1 text-[11px] text-[#9aa096]">Zuletzt signiert: {{ formatDateTime(auditVerification.lastSignedAt) }}</p>
    </div>
    <div v-if="auditSignResult" class="mt-4 rounded-xl bg-[#f4f5ef] p-4 text-[11px] text-[#43483f]">
      <p class="font-semibold text-ink">Signatur hinterlegt</p>
      <p class="mt-1">{{ auditSignResult.eventCount }} Ereignisse, Schlüsselversion {{ auditSignResult.keyVersion }}, signiert am {{ formatDateTime(auditSignResult.signedAt) }}.</p>
    </div>
  </section>
</template>
