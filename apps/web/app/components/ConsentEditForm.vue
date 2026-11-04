<script setup lang="ts">
import { ConsentRecordSchema, type ConsentRecord } from '@vereinsfunk/contracts'
import { ApiRequestError } from '../utils/apiClient'
import { CONSENT_PURPOSE_OPTIONS, PURPOSE_REQUIRED_MESSAGE } from '../utils/consentPurposes'

// Bearbeiten einer Papiererklaerung = Abloesung (POST /v1/consents/:id/supersede): die bisherige
// Zeile bleibt als Nachweis unveraendert, die API legt eine neue Version an und verkettet beide.
const props = defineProps<{ consent: ConsentRecord }>()
const emit = defineEmits<{ saved: [successor: ConsentRecord]; cancel: [] }>()

const api = useApiClient()
const original = props.consent.scopeStructured
const form = reactive({
  purposes: [...original.purposes] as string[], mediaKinds: [...original.mediaKinds] as string[], namingAllowed: original.namingAllowed,
  signedAt: props.consent.signedAt ?? '', signerName: props.consent.signerName ?? '',
  signerRole: props.consent.signerRole ?? 'guardian', guardianConfirmed: props.consent.guardianConfirmed,
})
const submitting = ref(false)
const errorMessage = ref('')

async function save() {
  if (form.purposes.length === 0) { errorMessage.value = PURPOSE_REQUIRED_MESSAGE; return }
  submitting.value = true
  errorMessage.value = ''
  try {
    const successor = await api.request(`/v1/consents/${props.consent.id}/supersede`, {
      method: 'POST',
      body: {
        // Plattformen, Anlaesse und Abteilungen bietet das Formular nicht an -- sie bleiben wie in der
        // bisherigen Version, statt beim Speichern stillschweigend zu "alle" zu werden.
        scopeStructured: { ...original, purposes: form.purposes, mediaKinds: form.mediaKinds, namingAllowed: form.namingAllowed },
        signedAt: form.signedAt,
        signerName: form.signerName.trim() || undefined,
        signerRole: form.signerRole,
        guardianConfirmed: form.signerRole === 'guardian' && form.guardianConfirmed,
      },
    }, ConsentRecordSchema)
    emit('saved', successor)
  } catch (error) {
    const code = error instanceof ApiRequestError ? error.code : undefined
    errorMessage.value = code === 'guardian_required_for_minor'
      ? 'Diese Person ist minderjährig. Eine Einwilligung muss von einer erziehungsberechtigten Person erteilt werden.'
      : code === 'already_superseded' || code === 'already_revoked'
        ? 'Diese Einwilligung wurde inzwischen geändert oder widerrufen. Bitte die Seite neu laden.'
        : 'Die Änderung konnte nicht gespeichert werden.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="mt-3 grid gap-3 rounded-xl border border-[#e8e9e2] p-4" @submit.prevent="save">
    <fieldset class="flex flex-wrap gap-3 text-xs"
      :aria-invalid="errorMessage === PURPOSE_REQUIRED_MESSAGE && form.purposes.length === 0"
      :aria-describedby="errorMessage ? `consent-edit-error-${consent.id}` : undefined">
      <legend class="mb-1 block text-xs font-semibold">Zweck</legend>
      <label v-for="purpose in CONSENT_PURPOSE_OPTIONS" :key="purpose.value" class="flex items-center gap-1.5"><input v-model="form.purposes" type="checkbox" :value="purpose.value" /> {{ purpose.label }}</label>
    </fieldset>
    <div class="flex flex-wrap gap-3 text-xs">
      <label class="flex items-center gap-1.5"><input v-model="form.mediaKinds" type="checkbox" value="photo" /> Foto</label>
      <label class="flex items-center gap-1.5"><input v-model="form.mediaKinds" type="checkbox" value="video" /> Video</label>
      <label class="flex items-center gap-1.5"><input v-model="form.namingAllowed" type="checkbox" /> Namentliche Nennung erlaubt</label>
    </div>
    <label><span class="mb-1 block text-xs font-semibold">Unterschriftsdatum</span>
      <input v-model="form.signedAt" type="date" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
    </label>
    <label><span class="mb-1 block text-xs font-semibold">Unterzeichnet von <span class="font-normal text-[#7b827d]">(optional)</span></span>
      <input v-model="form.signerName" maxlength="160" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
    </label>
    <div class="flex items-center gap-3 text-xs">
      <label class="flex items-center gap-1.5"><input v-model="form.signerRole" type="radio" :name="`signerRole-${consent.id}`" value="self" /> Person selbst</label>
      <label class="flex items-center gap-1.5"><input v-model="form.signerRole" type="radio" :name="`signerRole-${consent.id}`" value="guardian" /> Erziehungsberechtigte:r</label>
    </div>
    <label v-if="form.signerRole === 'guardian'" class="flex items-center gap-1.5 text-xs">
      <input v-model="form.guardianConfirmed" type="checkbox" required /> Erziehungsberechtigung bestätigt
    </label>
    <p v-if="errorMessage" :id="`consent-edit-error-${consent.id}`" class="text-xs text-amber-800" role="alert">{{ errorMessage }}</p>
    <div class="flex flex-wrap gap-2">
      <button type="submit" :disabled="submitting" class="focus-ring rounded-xl bg-forest px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
        {{ submitting ? 'Wird gespeichert …' : 'Änderung speichern' }}
      </button>
      <button type="button" class="focus-ring rounded-xl border border-[#dfe0d9] px-4 py-2 text-xs font-semibold" @click="emit('cancel')">Abbrechen</button>
    </div>
  </form>
</template>
