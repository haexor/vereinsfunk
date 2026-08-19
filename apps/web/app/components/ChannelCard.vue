<script setup lang="ts">
import type { Member, SocialConnection } from '@vereinsfunk/contracts'

const props = defineProps<{
  channel: SocialConnection
  members: Member[]
  busy: boolean
  canManage: boolean
  departmentName: (departmentId: string | null) => string
  editorialSaving: boolean
  editorialError: string | undefined
}>()

const purposeDraft = defineModel<string>('purposeDraft', { required: true })
const maxCharactersDraft = defineModel<string>('maxCharactersDraft', { required: true })
const editorialImprintUrlDraft = defineModel<string>('editorialImprintUrlDraft', { required: true })
const editorialPrivacyUrlDraft = defineModel<string>('editorialPrivacyUrlDraft', { required: true })
const editorialResponsibleProfileIdDraft = defineModel<string>('editorialResponsibleProfileIdDraft', { required: true })
const editorialResponsibleNoteDraft = defineModel<string>('editorialResponsibleNoteDraft', { required: true })

const editorialResponsibleProfileIdModel = computed({
  get: () => editorialResponsibleProfileIdDraft.value || '__none__',
  set: (v: string) => { editorialResponsibleProfileIdDraft.value = v === '__none__' ? '' : v },
})

const emit = defineEmits<{
  verify: []
  disconnect: []
  savePurpose: []
  saveMaxCharacters: []
  saveEditorial: []
}>()

const statusLabels: Record<SocialConnection['status'], string> = {
  active: 'Aktiv', action_required: 'Handlung erforderlich', disconnected: 'Getrennt',
}
const statusClasses: Record<SocialConnection['status'], string> = {
  active: 'bg-lime/30 text-forest', action_required: 'bg-amber-100 text-amber-800', disconnected: 'bg-[#eef0ea] text-[#7b827d]',
}
function tokenExpiryLabel(): string | null {
  if (!props.channel.tokenExpiresAt) return null
  const days = Math.ceil((new Date(props.channel.tokenExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  if (days < 0) return 'Token ist abgelaufen'
  if (days === 0) return 'Token läuft heute ab'
  return `Token läuft in ${days} Tag${days === 1 ? '' : 'en'} ab`
}
</script>

<template>
  <section class="card mb-4 p-6" :class="{ 'opacity-60': channel.status === 'disconnected' }">
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-3">
        <PlatformIcon :platform="channel.platform" />
        <div>
          <p class="font-display text-base font-bold">{{ channel.displayName }}</p>
          <p class="text-[11px] text-[#9aa096]">{{ departmentName(channel.ownerDepartmentId) }} · {{ channel.confidential ? 'Vertraulich' : 'Sichtbar' }}</p>
          <p v-if="channel.websiteUrl"><a :href="channel.websiteUrl" target="_blank" rel="noopener noreferrer" class="focus-ring text-[11px] text-[#7b827d] underline">{{ channel.websiteUrl }}</a></p>
        </div>
      </div>
      <span class="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold" :class="statusClasses[channel.status]">{{ statusLabels[channel.status] }}</span>
    </div>
    <p v-if="channel.status === 'action_required'" class="mt-3 rounded-lg bg-amber-100 p-2.5 text-[12px] font-medium text-amber-800">Verbindung erneuern: Token prüfen oder den Kanal neu verbinden.</p>
    <p v-if="tokenExpiryLabel()" class="mt-2 text-[11px] text-[#7b827d]">{{ tokenExpiryLabel() }}</p>
    <p v-if="channel.lastVerifiedAt" class="text-[11px] text-[#9aa096]">Zuletzt geprüft: {{ new Date(channel.lastVerifiedAt).toLocaleString('de-DE') }}</p>

    <template v-if="canManage">
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <input v-model="purposeDraft" placeholder="Zweck, z. B. Hauptkanal" class="focus-ring flex-1 rounded-lg border border-[#dfe0d9] p-2 text-xs" @blur="emit('savePurpose')" @keyup.enter="emit('savePurpose')" />
        <button v-if="channel.platform !== 'website'" type="button" :disabled="busy" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold disabled:opacity-60" @click="emit('verify')">Verbindung prüfen</button>
        <button type="button" :disabled="busy || channel.status === 'disconnected'" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold text-amber-800 disabled:opacity-60" @click="emit('disconnect')">Trennen</button>
      </div>
      <div v-if="channel.platform === 'website'" class="mt-3 flex items-center gap-2">
        <label class="flex items-center gap-2 text-[11px] font-semibold text-[#7b827d]">Maximale Länge
          <input v-model="maxCharactersDraft" type="number" min="100" max="10000" placeholder="Vorgabe der Plattform" class="focus-ring w-32 rounded-lg border border-[#dfe0d9] p-2 text-xs font-normal" @blur="emit('saveMaxCharacters')" @keyup.enter="emit('saveMaxCharacters')" />
        </label>
      </div>
      <div class="mt-4 border-t border-[#e8e9e2] pt-4">
        <p class="mb-2 text-[11px] font-semibold text-[#7b827d]">Presserechtliche Pflichtangaben</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <label><span class="mb-1 block text-[11px] font-semibold">Impressum-URL</span><input v-model="editorialImprintUrlDraft" type="url" placeholder="https://…" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" /></label>
          <label><span class="mb-1 block text-[11px] font-semibold">Datenschutz-URL</span><input v-model="editorialPrivacyUrlDraft" type="url" placeholder="https://…" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" /></label>
          <label><span class="mb-1 block text-[11px] font-semibold">Redaktionell verantwortliche Person (§ 18 MStV)</span><Select v-model="editorialResponsibleProfileIdModel"><SelectTrigger class="rounded-lg p-2 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Keine benannt</SelectItem><SelectItem v-for="member in members" :key="member.userId" :value="member.userId">{{ member.displayName }}</SelectItem></SelectContent></Select></label>
          <label><span class="mb-1 block text-[11px] font-semibold">Notiz</span><input v-model="editorialResponsibleNoteDraft" maxlength="500" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" /></label>
        </div>
        <p v-if="editorialError" class="mt-2 text-[11px] text-amber-800">{{ editorialError }}</p>
        <button type="button" :disabled="editorialSaving" class="focus-ring mt-2 rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold disabled:opacity-60" @click="emit('saveEditorial')">{{ editorialSaving ? 'Wird gespeichert …' : 'Pflichtangaben speichern' }}</button>
      </div>
    </template>
  </section>
</template>
