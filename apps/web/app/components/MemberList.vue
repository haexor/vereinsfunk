<script setup lang="ts">
import type { AssignableRole, Member, MemberRoleEntry, ReviewRequirement, ScopeLevel } from '@vereinsfunk/contracts'
import { roleLabels } from '../composables/roleLabels'

defineProps<{
  members: Member[]
  expandedMembershipId: string | null
  roleChangeError: string
  roleChangeSubmitting: string | null
  expirySubmitting: string | null
  trustSubmitting: string | null
  trustError: string
  scopeName: (scope: ScopeLevel, scopeId: string) => string
  canManageTrust: (entry: MemberRoleEntry) => boolean
  toggleExpanded: (entry: MemberRoleEntry, userId: string) => void
  removeMembership: (membershipId: string, scope: ScopeLevel) => Promise<void>
  availableRolesFor: (entry: MemberRoleEntry) => AssignableRole[]
  changeRole: (entry: MemberRoleEntry) => Promise<void>
  setExpiry: (entry: MemberRoleEntry) => Promise<void>
  saveTrust: (entry: MemberRoleEntry, userId: string) => Promise<void>
}>()

const roleDraft = defineModel<AssignableRole | ''>('roleDraft', { required: true })
const expiryDraft = defineModel<string>('expiryDraft', { required: true })
const trustSubmitAllowedDraft = defineModel<boolean>('trustSubmitAllowedDraft', { required: true })
const trustRequirementDraft = defineModel<ReviewRequirement>('trustRequirementDraft', { required: true })
const trustReasonDraft = defineModel<string>('trustReasonDraft', { required: true })
const trustExpiryDraft = defineModel<string>('trustExpiryDraft', { required: true })
</script>

<template>
  <section class="card mb-6 divide-y divide-[#e8e9e2]">
    <div v-for="member in members" :key="member.userId" class="flex items-start gap-4 p-4 sm:px-6">
      <span class="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#dce6d8] text-xs font-bold">
        {{ member.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() }}
      </span>
      <div class="flex-1">
        <div class="text-sm font-semibold">{{ member.displayName }}</div>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <span v-for="entry in member.roles" :key="entry.membershipId" class="inline-flex items-center gap-1.5 rounded-full bg-[#eef1ea] px-2.5 py-1 text-[10px] font-semibold text-[#3d453f]">
            <button v-if="entry.canChangeRole || entry.canSetExpiry || canManageTrust(entry)" type="button" :aria-expanded="expandedMembershipId === entry.membershipId" :aria-controls="`membership-detail-${entry.membershipId}`" class="focus-ring" @click="toggleExpanded(entry, member.userId)">
              {{ roleLabels[entry.role] ?? entry.role }} · {{ scopeName(entry.scope, entry.scopeId) }}
            </button>
            <span v-else>{{ roleLabels[entry.role] ?? entry.role }} · {{ scopeName(entry.scope, entry.scopeId) }}</span>
            <button v-if="entry.canRemove" type="button" :aria-label="`${roleLabels[entry.role] ?? entry.role} in ${scopeName(entry.scope, entry.scopeId)} entfernen`" class="focus-ring text-[#8a9186] hover:text-amber-800" @click="removeMembership(entry.membershipId, entry.scope)">×</button>
          </span>
        </div>
        <div v-for="entry in member.roles.filter((item) => item.membershipId === expandedMembershipId)" :key="`${entry.membershipId}-detail`" :id="`membership-detail-${entry.membershipId}`" class="mt-3 grid gap-3 rounded-xl border border-[#e8e9e2] bg-[#f7f8f4] p-3 sm:grid-cols-2">
          <label v-if="entry.canChangeRole"><span class="mb-1 block text-xs font-semibold">Rolle in {{ scopeName(entry.scope, entry.scopeId) }}</span>
            <div class="flex gap-2">
              <select v-model="roleDraft" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs"><option v-for="role in availableRolesFor(entry)" :key="role" :value="role">{{ roleLabels[role] ?? role }}</option></select>
              <button type="button" :disabled="roleChangeSubmitting === entry.membershipId || roleDraft === entry.role" class="focus-ring shrink-0 rounded-lg bg-forest px-3 py-2 text-[10px] font-bold text-white disabled:opacity-60" @click="changeRole(entry)">Ändern</button>
            </div>
          </label>
          <label v-if="entry.canSetExpiry"><span class="mb-1 block text-xs font-semibold">Befristet bis</span>
            <div class="flex gap-2">
              <input v-model="expiryDraft" type="date" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" />
              <button type="button" :disabled="expirySubmitting === entry.membershipId" class="focus-ring shrink-0 rounded-lg border border-[#dfe0d9] px-3 py-2 text-[10px] font-semibold disabled:opacity-60" @click="setExpiry(entry)">Speichern</button>
            </div>
          </label>
          <p v-if="roleChangeError" class="text-xs text-amber-800 sm:col-span-2">{{ roleChangeError }}</p>
          <div v-if="canManageTrust(entry)" class="grid gap-3 border-t border-[#e8e9e2] pt-3 sm:col-span-2 sm:grid-cols-2">
            <p class="text-xs font-semibold sm:col-span-2">Vertrauen in {{ scopeName(entry.scope, entry.scopeId) }}</p>
            <label class="flex items-center gap-2"><input v-model="trustSubmitAllowedDraft" type="checkbox" /> <span class="text-xs">Darf einreichen</span></label>
            <label><span class="mb-1 block text-xs font-semibold">Prüfung</span><select v-model="trustRequirementDraft" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs"><option value="inherit">geerbt</option><option value="always">immer erforderlich</option><option value="waived">befreit (außer Minderjährigenstufe)</option></select></label>
            <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">Begründung</span><input v-model="trustReasonDraft" maxlength="500" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" /></label>
            <label><span class="mb-1 block text-xs font-semibold">Befristet bis</span><input v-model="trustExpiryDraft" type="date" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" /></label>
            <div class="flex items-end"><button type="button" :disabled="trustSubmitting === entry.membershipId" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[10px] font-semibold disabled:opacity-60" @click="saveTrust(entry, member.userId)">{{ trustSubmitting === entry.membershipId ? 'Wird gespeichert …' : 'Speichern' }}</button></div>
            <p v-if="trustError" class="text-xs text-amber-800 sm:col-span-2">{{ trustError }}</p>
          </div>
        </div>
      </div>
    </div>
    <p v-if="!members.length" class="p-8 text-center text-xs text-[#9aa096]">Noch seid ihr allein hier.</p>
  </section>
</template>
