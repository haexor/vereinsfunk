<script setup lang="ts">
import type { Member, OrganizationProfile } from '@vereinsfunk/contracts'

defineProps<{
  organizationId: string | null
  members: Member[]
  legalForms: { id: NonNullable<OrganizationProfile['legalForm']>; label: string }[]
  saving: boolean
  error: string
}>()

const profileDraft = defineModel<{
  legalName: string; legalForm: '' | NonNullable<OrganizationProfile['legalForm']>; registerCourt: string; registerNumber: string
  street: string; houseNumber: string; postalCode: string; city: string; countryCode: string; contactEmail: string
  contactPhone: string; websiteUrl: string; foundedYear: string; responsiblePersonProfileId: string; imprintPublished: boolean
}>('profileDraft', { required: true })

const emit = defineEmits<{ save: [] }>()
</script>

<template>
  <section class="card mb-6 p-6">
    <h2 class="mb-1 font-display text-base font-bold">Impressumsangaben des Vereins</h2>
    <p class="mb-4 text-[11px] text-[#7b827d]">Diese Angaben erscheinen im öffentlichen Impressum dieses Vereins — <NuxtLink v-if="organizationId" :to="`/impressum/${organizationId}`" target="_blank" class="font-semibold text-forest">/impressum/{{ organizationId }}</NuxtLink>, verlinkbar aus eurer Instagram- oder Facebook-Bio. Nicht ausgefüllte Felder erscheinen dort ehrlich als „nicht angegeben“, nicht als erfundener Platzhalter.</p>
    <label class="mb-4 flex items-center gap-2"><input v-model="profileDraft.imprintPublished" type="checkbox" /><span class="text-xs font-semibold">Öffentliches Impressum veröffentlichen</span></label>
    <p v-if="!profileDraft.imprintPublished" class="mb-4 text-[11px] text-[#7b827d]">Solange diese Freigabe nicht gesetzt ist, liefert die Impressumsseite „nicht gefunden“ — die Angaben unten bleiben intern.</p>
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Name (rechtlich)</span><input v-model="profileDraft.legalName" maxlength="160" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Rechtsform</span><select v-model="profileDraft.legalForm" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm"><option value="">Keine Angabe</option><option v-for="item in legalForms" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
      <label><span class="mb-1 block text-xs font-semibold">Land (2-stelliger Code)</span><input v-model="profileDraft.countryCode" required maxlength="2" pattern="[A-Za-z]{2}" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Registergericht</span><input v-model="profileDraft.registerCourt" maxlength="160" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Registernummer</span><input v-model="profileDraft.registerNumber" maxlength="80" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Straße</span><input v-model="profileDraft.street" maxlength="160" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Hausnummer</span><input v-model="profileDraft.houseNumber" maxlength="20" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Postleitzahl</span><input v-model="profileDraft.postalCode" maxlength="20" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Ort</span><input v-model="profileDraft.city" maxlength="120" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Kontakt-E-Mail</span><input v-model="profileDraft.contactEmail" type="email" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Telefon</span><input v-model="profileDraft.contactPhone" maxlength="40" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Website</span><input v-model="profileDraft.websiteUrl" type="url" placeholder="https://…" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label><span class="mb-1 block text-xs font-semibold">Gründungsjahr</span><input v-model="profileDraft.foundedYear" type="number" min="1800" max="2100" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm" /></label>
      <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Verantwortlich für den Inhalt (§ 18 Abs. 2 MStV)</span><select v-model="profileDraft.responsiblePersonProfileId" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-sm"><option value="">Keine benannt</option><option v-for="member in members" :key="member.userId" :value="member.userId">{{ member.displayName }}</option></select></label>
    </div>
    <p v-if="error" class="mt-3 text-xs text-amber-800">{{ error }}</p>
    <button type="button" :disabled="saving" class="focus-ring mt-4 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="emit('save')">{{ saving ? 'Wird gespeichert …' : 'Speichern' }}</button>
  </section>
</template>
