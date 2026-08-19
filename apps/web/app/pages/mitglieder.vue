<script setup lang="ts">
import { canAssignRole, type Role } from '@vereinsfunk/authorization'
import {
  InvitationSchema,
  MemberReviewTrustSchema,
  MemberSchema,
  PolicySettingSchema,
  rolesForScopeLevel,
  type AssignableRole,
  type Invitation,
  type Member,
  type MemberRoleEntry,
  type MemberReviewTrust,
  type PolicySetting,
  type ReviewRequirement,
  type ScopeLevel,
} from '@vereinsfunk/contracts'
import { endOfDayIso, localDateKey } from '../utils/memberDates'

const api = useApiClient()
const session = await useSession()
const scope = await useScope()

const organizationId = computed(() => scope.value?.organizationId ?? null)
const organization = computed(() => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)
const timezone = computed(() => organization.value?.organizationTimezone ?? 'Europe/Berlin')

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')
const members = ref<Member[]>([])
const invitations = ref<Invitation[]>([])
const policySettings = ref<PolicySetting[]>([])
const memberReviewTrust = ref<MemberReviewTrust[]>([])

const inviteScope = ref<ScopeLevel>('organization')
const inviteScopeId = ref('')
const inviteEmail = ref('')
const inviteRole = ref<AssignableRole | ''>('')
const inviteSubmitting = ref(false)
const inviteError = ref('')
const inviteSuccess = ref(false)
const inviteEmailDelivered = ref(true)

function scopeName(scopeLevel: ScopeLevel, scopeId: string): string {
  if (!organization.value) return ''
  if (scopeLevel === 'organization') return organization.value.organizationName
  const department = organization.value.departments.find((item) => item.id === scopeId)
  if (scopeLevel === 'department') return department?.name ?? ''
  for (const dept of organization.value.departments) {
    const team = dept.teams.find((item) => item.id === scopeId)
    if (team) return team.name
  }
  return ''
}

function actorRolesFor(scopeLevel: ScopeLevel, scopeId: string): Role[] {
  if (!organization.value) return []
  const roles: Role[] = [...organization.value.organizationRoles]
  if (scopeLevel === 'organization') return roles
  const department = organization.value.departments.find((item) => item.id === scopeId || item.teams.some((team) => team.id === scopeId))
  if (!department) return roles
  roles.push(...department.roles)
  if (scopeLevel === 'team') {
    const team = department.teams.find((item) => item.id === scopeId)
    if (team) roles.push(...team.roles)
  }
  return roles
}

// Fuer useCan() im Template und fuer die Einladungs-Payload: departmentId muss bei einem
// Team-Scope die ID der ELTERN-Abteilung sein, nicht die Team-ID selbst -- sonst pruefte useCan
// faelschlich gegen ein Team, das als Abteilung behandelt wird (beim Review dieses Pakets
// gefunden).
function departmentIdFor(scopeLevel: ScopeLevel, scopeId: string): string | undefined {
  if (scopeLevel === 'organization') return undefined
  if (scopeLevel === 'department') return scopeId
  return organization.value?.departments.find((item) => item.teams.some((team) => team.id === scopeId))?.id
}

// Ob eine Ebene ueberhaupt einladen darf, kommt jetzt aus zwei unabhaengigen Quellen: der eigenen
// Rolle (useCan, wie bisher) UND policy_settings.invite_allowed (Paket 023) -- eine Abteilung
// kann das Einladungsrecht fuer sich selbst sperren, unabhaengig davon, wer dort
// department_admin ist. Der effektive Wert kommt fertig berechnet aus der API
// (GET .../policy-settings), nicht aus einer zweiten Herleitung hier.
function inviteAllowedFor(scopeLevel: ScopeLevel, scopeId: string): boolean {
  return policySettings.value.find((entry) => entry.scope === scopeLevel && entry.scopeId === scopeId)?.inviteAllowed.effective ?? true
}

// member.invite gilt je Ebene: ein department_admin oder team_manager hat es in seinem eigenen
// Bereich, aber nicht vereinsweit (siehe authz.has_department_permission/has_team_permission).
// Die Auswahl zeigt deshalb nur die Ebenen und Bereiche, in denen der Handelnde wirklich
// einladen darf -- eine reine Vereins-Pruefung blendete das Formular fuer beide komplett aus,
// obwohl API und RLS ihre Einladungen erlauben (im Nachfolge-Review dieses PRs gefunden).
const invitableDepartments = computed(() =>
  (organization.value?.departments ?? []).filter((department) =>
    useCan('member.invite', { organizationId: organizationId.value ?? '', departmentId: department.id }) && inviteAllowedFor('department', department.id),
  ),
)
const invitableTeams = computed(() =>
  (organization.value?.departments ?? []).flatMap((department) =>
    department.teams
      .filter((team) =>
        useCan('member.invite', { organizationId: organizationId.value ?? '', departmentId: department.id, teamId: team.id }) && inviteAllowedFor('team', team.id),
      )
      .map((team) => ({ id: team.id, label: `${department.name} · ${team.name}` })),
  ),
)
const availableInviteScopes = computed(() => {
  const scopes: { value: ScopeLevel; label: string }[] = []
  if (useCan('member.invite', { organizationId: organizationId.value ?? '' }) && inviteAllowedFor('organization', organizationId.value ?? '')) {
    scopes.push({ value: 'organization', label: 'Ganzer Verein' })
  }
  if (invitableDepartments.value.length > 0) scopes.push({ value: 'department', label: 'Abteilung' })
  if (invitableTeams.value.length > 0) scopes.push({ value: 'team', label: 'Team' })
  return scopes
})

// v-model braucht einen Wert, der auch als <option> existiert -- sonst zeigt die Ebenen-Auswahl
// fuer jemanden ohne vereinsweites member.invite leer an.
watch(
  availableInviteScopes,
  (scopes) => {
    if (scopes.length > 0 && !scopes.some((item) => item.value === inviteScope.value)) {
      inviteScope.value = scopes[0]!.value
      inviteScopeId.value = ''
      inviteRole.value = ''
    }
  },
  { immediate: true },
)

const availableRolesForInvite = computed(() => {
  if (!inviteScopeId.value && inviteScope.value !== 'organization') return []
  const candidates = rolesForScopeLevel(inviteScope.value)
  const actorRoles = actorRolesFor(inviteScope.value, inviteScope.value === 'organization' ? (organizationId.value ?? '') : inviteScopeId.value)
  return candidates.filter((role) => canAssignRole(actorRoles, role))
})

async function load() {
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const [membersResponse, invitationsResponse] = await Promise.all([
      api.request(`/v1/organizations/${organizationId.value}/members`, {}, MemberSchema.array()),
      api.request(`/v1/organizations/${organizationId.value}/invitations`, {}, InvitationSchema.array()),
    ])
    members.value = membersResponse
    // Der Invitations-Endpunkt filtert nur accepted_at/revoked_at -- eine abgelaufene, aber noch
    // offene Einladung wuerde sonst weiter unter "Offene Einladungen" erscheinen, obwohl
    // "Erneut senden"/"Widerrufen" nichts mehr an ihr aendern koennen (beim Review gefunden).
    invitations.value = invitationsResponse.filter((invitation) => new Date(invitation.expiresAt) > new Date())
    // Die Richtlinien sind sekundaer: ohne sie bleibt die Mitgliederliste bedienbar, und
    // inviteAllowedFor() faellt auf "erlaubt" zurueck. Die API entscheidet ohnehin endgueltig.
    try {
      policySettings.value = await api.request(`/v1/organizations/${organizationId.value}/policy-settings`, {}, PolicySettingSchema.array())
    } catch {
      policySettings.value = []
    }
    // Vertrauen ist ebenfalls sekundaer -- ohne sichtbare Eintraege gilt fuer jede Person "geerbt"
    // (Paket 011).
    try {
      memberReviewTrust.value = await api.request(`/v1/organizations/${organizationId.value}/member-review-trust`, {}, MemberReviewTrustSchema.array())
    } catch {
      memberReviewTrust.value = []
    }
  } catch {
    errorMessage.value = 'Mitglieder und Einladungen konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

// Ein Wechsel des aktiven Vereins in der Sidebar aktualisierte diese Seite bisher nicht -- load()
// lief nur einmal beim Setup (beim Review dieses Pakets gefunden).
watch(organizationId, () => {
  inviteScopeId.value = ''
  inviteRole.value = ''
  inviteSuccess.value = false
  void load()
})

async function sendInvitation() {
  if (!organizationId.value) return
  // Ohne natives required (die shadcn-Select-Komponente rendert kein validierendes <select>)
  // waere ein Klick auf "Einladen" mit leerer Auswahl sonst wirkungslos und unkommentiert.
  inviteSuccess.value = false
  if (inviteScope.value !== 'organization' && !inviteScopeId.value) {
    inviteError.value = inviteScope.value === 'department' ? 'Bitte eine Abteilung wählen.' : 'Bitte ein Team wählen.'
    return
  }
  if (!inviteRole.value) { inviteError.value = 'Bitte eine Rolle wählen.'; return }
  inviteSubmitting.value = true
  inviteError.value = ''
  inviteSuccess.value = false
  try {
    // Eine Team-Einladung muss die ELTERN-Abteilung mitschicken: CreateInvitationRequestSchema
    // verlangt departmentId zusammen mit teamId, und resolveInvitationScope() in apps/api prueft
    // beide gegeneinander. Ohne die Abteilung schlug jede Team-Einladung mit 400 fehl.
    const response = await api.request<{ emailDelivered?: boolean }>('/v1/invitations', {
      method: 'POST',
      body: {
        organizationId: organizationId.value,
        departmentId: departmentIdFor(inviteScope.value, inviteScopeId.value),
        teamId: inviteScope.value === 'team' ? inviteScopeId.value : undefined,
        email: inviteEmail.value,
        role: inviteRole.value,
      },
    })
    // Die Einladung existiert auch dann, wenn der SMTP-Versand fehlschlug (die API antwortet
    // dafuer mit 201 und emailDelivered: false) -- ein pauschales "Einladung versendet" waere
    // dort schlicht falsch.
    inviteEmailDelivered.value = response?.emailDelivered !== false
    inviteSuccess.value = true
    inviteEmail.value = ''
    inviteRole.value = ''
    await load()
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    inviteError.value =
      code === 'already_a_member'
        ? 'Diese Person ist in diesem Bereich bereits Mitglied.'
        : code === 'invitation_already_open'
          ? 'Für diese Adresse liegt in diesem Bereich schon eine offene Einladung vor.'
          : code === 'resend_limit_reached'
            ? 'An diese Adresse wurden bereits zu viele Einladungen versendet.'
            : code === 'resend_rate_limited'
              ? 'Bitte warte etwas, bevor du an diese Adresse erneut eine Einladung sendest.'
              : 'Die Einladung konnte nicht versendet werden.'
  } finally {
    inviteSubmitting.value = false
  }
}

async function removeMembership(membershipId: string, scopeLevel: ScopeLevel) {
  if (!confirm('Mitgliedschaft wirklich entfernen?')) return
  actionError.value = ''
  try {
    await api.request(`/v1/memberships/${membershipId}`, { method: 'DELETE', query: { scope: scopeLevel } })
    await load()
  } catch {
    actionError.value = 'Die Mitgliedschaft konnte nicht entfernt werden.'
  }
}

// Aufklappbare Detailebene je Mitgliedschaft (Plan 023, "Umsetzung 2."): Rolle, Befristung und
// Einladungsrecht statt eines separaten Rollen-Editors. canChangeRole/canRemove/canSetExpiry
// kommen fertig aus der API -- die Oberflaeche leitet die Berechtigung nicht selbst her.
const expandedMembershipId = ref<string | null>(null)
const roleDraft = ref<AssignableRole | ''>('')
const expiryDraft = ref('')
const roleChangeError = ref('')
const roleChangeSubmitting = ref<string | null>(null)
const expirySubmitting = ref<string | null>(null)

function toggleExpanded(entry: MemberRoleEntry, userId: string) {
  if (expandedMembershipId.value === entry.membershipId) {
    expandedMembershipId.value = null
    return
  }
  expandedMembershipId.value = entry.membershipId
  roleDraft.value = entry.role as AssignableRole
  expiryDraft.value = entry.expiresAt ? localDateKey(new Date(entry.expiresAt), timezone.value) : ''
  roleChangeError.value = ''
  initTrustDraft(entry, userId)
}

function availableRolesFor(entry: MemberRoleEntry): AssignableRole[] {
  const actorRoles = actorRolesFor(entry.scope, entry.scopeId)
  return rolesForScopeLevel(entry.scope).filter((role) => canAssignRole(actorRoles, role))
}

async function changeRole(entry: MemberRoleEntry) {
  const nextRole = roleDraft.value
  if (!nextRole || nextRole === entry.role) return
  roleChangeSubmitting.value = entry.membershipId
  roleChangeError.value = ''
  try {
    await api.request(`/v1/memberships/${entry.membershipId}`, {
      method: 'PATCH', query: { scope: entry.scope }, body: { role: nextRole },
    })
    expandedMembershipId.value = null
    await load()
  } catch {
    roleChangeError.value = 'Die Rolle konnte nicht geändert werden.'
  } finally {
    roleChangeSubmitting.value = null
  }
}

async function setExpiry(entry: MemberRoleEntry) {
  expirySubmitting.value = entry.membershipId
  roleChangeError.value = ''
  try {
    const draft = expiryDraft.value
    await api.request(`/v1/memberships/${entry.membershipId}/expiry`, {
      method: 'PATCH', query: { scope: entry.scope },
      body: { expiresAt: draft ? endOfDayIso(draft, timezone.value) : null },
    })
    await load()
  } catch {
    roleChangeError.value = 'Die Befristung konnte nicht geändert werden.'
  } finally {
    expirySubmitting.value = null
  }
}

// Vertrauen je Mitglied (Paket 011): liegt bewusst hier, nicht in einstellungen.vue -- dort wird
// eine Person gesucht, nicht eine Ebene konfiguriert. Sichtbar nur fuer wer diese Ebene ohnehin
// verwalten darf (dieselbe Berechtigung wie fuer die Richtlinienseite selbst).
function canManageTrust(entry: MemberRoleEntry): boolean {
  const permission = entry.scope === 'organization' ? 'organization.manage' : entry.scope === 'department' ? 'department.manage' : 'team.manage'
  return useCan(permission, { organizationId: organizationId.value ?? '', ...(departmentIdFor(entry.scope, entry.scopeId) ? { departmentId: departmentIdFor(entry.scope, entry.scopeId) } : {}), ...(entry.scope === 'team' ? { teamId: entry.scopeId } : {}) })
}

function trustFor(entry: MemberRoleEntry, userId: string): MemberReviewTrust | undefined {
  return memberReviewTrust.value.find((record) => record.scope === entry.scope && record.scopeId === entry.scopeId && record.userId === userId)
}

const trustSubmitAllowedDraft = ref(true)
const trustRequirementDraft = ref<ReviewRequirement>('inherit')
const trustReasonDraft = ref('')
const trustExpiryDraft = ref('')
const trustSubmitting = ref<string | null>(null)
const trustError = ref('')

function initTrustDraft(entry: MemberRoleEntry, userId: string) {
  const existing = trustFor(entry, userId)
  trustSubmitAllowedDraft.value = existing?.submitAllowed ?? true
  trustRequirementDraft.value = existing?.reviewRequirement ?? 'inherit'
  trustReasonDraft.value = existing?.reason ?? ''
  trustExpiryDraft.value = existing?.expiresAt ? localDateKey(new Date(existing.expiresAt), timezone.value) : ''
}

async function saveTrust(entry: MemberRoleEntry, userId: string) {
  trustSubmitting.value = entry.membershipId
  trustError.value = ''
  try {
    await api.request('/v1/member-review-trust', {
      method: 'PUT',
      body: {
        scope: entry.scope, scopeId: entry.scopeId, userId,
        submitAllowed: trustSubmitAllowedDraft.value,
        reviewRequirement: trustRequirementDraft.value,
        reason: trustReasonDraft.value.trim() || null,
        expiresAt: trustExpiryDraft.value ? endOfDayIso(trustExpiryDraft.value, timezone.value) : null,
      },
    })
    await load()
  } catch {
    trustError.value = 'Das Vertrauen konnte nicht gespeichert werden.'
  } finally {
    trustSubmitting.value = null
  }
}

async function resendInvitation(id: string) {
  actionError.value = ''
  try {
    const response = await api.request<{ emailDelivered?: boolean }>(`/v1/invitations/${id}/resend`, { method: 'POST' })
    // Siehe sendInvitation(): ein fehlgeschlagener SMTP-Versand ist kein Fehlerstatus, muss aber
    // sichtbar sein -- sonst wartet die eingeladene Person auf eine Mail, die nie ankam.
    if (response?.emailDelivered === false) {
      actionError.value = 'Die Einladung wurde erneuert, aber die E-Mail konnte nicht versendet werden.'
    }
    await load()
  } catch {
    actionError.value = 'Die Einladung konnte nicht erneut versendet werden.'
  }
}

async function revokeInvitation(id: string) {
  if (!confirm('Einladung wirklich widerrufen?')) return
  actionError.value = ''
  try {
    await api.request(`/v1/invitations/${id}/revoke`, { method: 'POST' })
    await load()
  } catch {
    actionError.value = 'Die Einladung konnte nicht widerrufen werden.'
  }
}

const canInviteHere = computed(() => availableInviteScopes.value.length > 0)
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Zugänge</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Mitglieder</h1>
      <p class="mt-2 text-sm text-[#727a75]">Rollen gelten immer für Verein, Abteilung oder Team.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else>
      <p v-if="actionError" class="mb-4 text-sm text-amber-800">{{ actionError }}</p>

      <section v-if="canInviteHere" class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Person einladen</h2>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="sendInvitation">
          <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">E-Mail</span>
            <input v-model="inviteEmail" type="email" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Ebene</span>
            <Select :model-value="inviteScope" @update:model-value="(value: unknown) => { inviteScope = value as ScopeLevel; inviteScopeId = ''; inviteRole = '' }">
              <SelectTrigger class="p-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="scopeOption in availableInviteScopes" :key="scopeOption.value" :value="scopeOption.value">{{ scopeOption.label }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label v-if="inviteScope === 'department'"><span class="mb-1 block text-xs font-semibold">Abteilung</span>
            <Select v-model="inviteScopeId" required>
              <SelectTrigger class="p-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="dept in invitableDepartments" :key="dept.id" :value="dept.id">{{ dept.name }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label v-if="inviteScope === 'team'"><span class="mb-1 block text-xs font-semibold">Team</span>
            <Select v-model="inviteScopeId" required>
              <SelectTrigger class="p-2.5 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="team in invitableTeams" :key="team.id" :value="team.id">{{ team.label }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Rolle</span>
            <Select v-model="inviteRole" required>
              <SelectTrigger class="p-2.5 text-sm"><SelectValue placeholder="Rolle wählen" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="role in availableRolesForInvite" :key="role" :value="role">{{ roleLabels[role] ?? role }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <div class="sm:col-span-2">
            <p v-if="inviteError" class="mb-2 text-xs text-amber-800">{{ inviteError }}</p>
            <p v-if="inviteSuccess" class="mb-2 text-xs" :class="inviteEmailDelivered ? 'text-emerald-700' : 'text-amber-800'">
              {{ inviteEmailDelivered ? 'Einladung versendet.' : 'Einladung angelegt, die E-Mail konnte aber nicht versendet werden. Bitte unten erneut senden.' }}
            </p>
            <button type="submit" :disabled="inviteSubmitting" class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
              {{ inviteSubmitting ? 'Wird gesendet …' : 'Einladen' }}
            </button>
          </div>
        </form>
      </section>

      <MemberList
        :members="members"
        :expanded-membership-id="expandedMembershipId"
        v-model:role-draft="roleDraft"
        v-model:expiry-draft="expiryDraft"
        :role-change-error="roleChangeError"
        :role-change-submitting="roleChangeSubmitting"
        :expiry-submitting="expirySubmitting"
        v-model:trust-submit-allowed-draft="trustSubmitAllowedDraft"
        v-model:trust-requirement-draft="trustRequirementDraft"
        v-model:trust-reason-draft="trustReasonDraft"
        v-model:trust-expiry-draft="trustExpiryDraft"
        :trust-submitting="trustSubmitting"
        :trust-error="trustError"
        :scope-name="scopeName"
        :can-manage-trust="canManageTrust"
        :toggle-expanded="toggleExpanded"
        :remove-membership="removeMembership"
        :available-roles-for="availableRolesFor"
        :change-role="changeRole"
        :set-expiry="setExpiry"
        :save-trust="saveTrust"
      />

      <section v-if="invitations.length" class="card p-6">
        <h2 class="mb-4 font-display text-base font-bold">Offene Einladungen</h2>
        <div class="divide-y divide-[#e8e9e2]">
          <div v-for="invitation in invitations" :key="invitation.id" class="flex items-center justify-between gap-4 py-3">
            <div>
              <div class="text-sm font-medium">{{ invitation.email }}</div>
              <div class="mt-1 text-[10px] text-[#7b827d]">
                {{ roleLabels[invitation.role] ?? invitation.role }} ·
                {{ scopeName(invitation.teamId ? 'team' : invitation.departmentId ? 'department' : 'organization', invitation.teamId ?? invitation.departmentId ?? organizationId ?? '') }}
                · läuft ab am {{ new Date(invitation.expiresAt).toLocaleDateString('de-DE') }}
              </div>
            </div>
            <div class="flex shrink-0 gap-2">
              <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[10px] font-semibold" @click="resendInvitation(invitation.id)">
                Erneut senden
              </button>
              <button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-1.5 text-[10px] font-semibold text-amber-800" @click="revokeInvitation(invitation.id)">
                Widerrufen
              </button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
