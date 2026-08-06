<script setup lang="ts">
import { canAssignRole, type Role } from '@vereinsfunk/authorization'
import {
  InvitationSchema,
  MemberSchema,
  PolicySettingSchema,
  rolesForScopeLevel,
  type AssignableRole,
  type Invitation,
  type Member,
  type MemberRoleEntry,
  type PolicySetting,
  type ScopeLevel,
} from '@vereinsfunk/contracts'

const config = useRuntimeConfig()
const session = await useSession()
const scope = await useScope()

const organizationId = computed(() => scope.value?.organizationId ?? null)
const organization = computed(() => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')
const members = ref<Member[]>([])
const invitations = ref<Invitation[]>([])
const policySettings = ref<PolicySetting[]>([])

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
    const headers = await useAuthHeader()
    const [membersResponse, invitationsResponse, policySettingsResponse] = await Promise.all([
      $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/members`, { headers }),
      $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/invitations`, { headers }),
      $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/policy-settings`, { headers }),
    ])
    members.value = MemberSchema.array().parse(membersResponse)
    // Der Invitations-Endpunkt filtert nur accepted_at/revoked_at -- eine abgelaufene, aber noch
    // offene Einladung wuerde sonst weiter unter "Offene Einladungen" erscheinen, obwohl
    // "Erneut senden"/"Widerrufen" nichts mehr an ihr aendern koennen (beim Review gefunden).
    invitations.value = InvitationSchema.array().parse(invitationsResponse).filter((invitation) => new Date(invitation.expiresAt) > new Date())
    policySettings.value = PolicySettingSchema.array().parse(policySettingsResponse)
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
  if (!organizationId.value || !inviteRole.value) return
  inviteSubmitting.value = true
  inviteError.value = ''
  inviteSuccess.value = false
  try {
    const headers = await useAuthHeader()
    // Eine Team-Einladung muss die ELTERN-Abteilung mitschicken: CreateInvitationRequestSchema
    // verlangt departmentId zusammen mit teamId, und resolveInvitationScope() in apps/api prueft
    // beide gegeneinander. Ohne die Abteilung schlug jede Team-Einladung mit 400 fehl.
    const response = await $fetch<{ emailDelivered?: boolean }>(`${config.public.apiBase}/v1/invitations`, {
      method: 'POST',
      headers,
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
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/memberships/${membershipId}`, { method: 'DELETE', headers, query: { scope: scopeLevel } })
    await load()
  } catch {
    actionError.value = 'Die Mitgliedschaft konnte nicht entfernt werden.'
  }
}

// Aufklappbare Detailebene je Mitgliedschaft (Plan 023, "Umsetzung 2."): Rolle, Befristung und
// Einladungsrecht statt eines separaten Rollen-Editors. canChangeRole/canRemove/canSetExpiry
// kommen fertig aus der API -- die Oberflaeche leitet die Berechtigung nicht selbst her.
const expandedMembershipId = ref<string | null>(null)
const roleDraft = reactive<Record<string, AssignableRole | ''>>({})
const expiryDraft = reactive<Record<string, string>>({})
const roleChangeError = ref('')
const roleChangeSubmitting = ref<string | null>(null)
const expirySubmitting = ref<string | null>(null)

function toggleExpanded(entry: MemberRoleEntry) {
  if (expandedMembershipId.value === entry.membershipId) {
    expandedMembershipId.value = null
    return
  }
  expandedMembershipId.value = entry.membershipId
  roleDraft[entry.membershipId] = entry.role as AssignableRole
  expiryDraft[entry.membershipId] = entry.expiresAt ? entry.expiresAt.slice(0, 10) : ''
  roleChangeError.value = ''
}

function availableRolesFor(entry: MemberRoleEntry): AssignableRole[] {
  const actorRoles = actorRolesFor(entry.scope, entry.scopeId)
  return rolesForScopeLevel(entry.scope).filter((role) => canAssignRole(actorRoles, role))
}

async function changeRole(entry: MemberRoleEntry) {
  const nextRole = roleDraft[entry.membershipId]
  if (!nextRole || nextRole === entry.role) return
  roleChangeSubmitting.value = entry.membershipId
  roleChangeError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/memberships/${entry.membershipId}`, {
      method: 'PATCH', headers, query: { scope: entry.scope }, body: { role: nextRole },
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
    const headers = await useAuthHeader()
    const draft = expiryDraft[entry.membershipId]
    await $fetch(`${config.public.apiBase}/v1/memberships/${entry.membershipId}/expiry`, {
      method: 'PATCH', headers, query: { scope: entry.scope },
      body: { expiresAt: draft ? new Date(`${draft}T00:00:00Z`).toISOString() : null },
    })
    await load()
  } catch {
    roleChangeError.value = 'Die Befristung konnte nicht geändert werden.'
  } finally {
    expirySubmitting.value = null
  }
}

async function resendInvitation(id: string) {
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<{ emailDelivered?: boolean }>(`${config.public.apiBase}/v1/invitations/${id}/resend`, { method: 'POST', headers })
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
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/invitations/${id}/revoke`, { method: 'POST', headers })
    await load()
  } catch {
    actionError.value = 'Die Einladung konnte nicht widerrufen werden.'
  }
}

const canInviteHere = computed(() => availableInviteScopes.value.length > 0)
</script>

<template>
  <div class="mx-auto max-w-[980px] px-5 py-8 sm:px-10">
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
            <select v-model="inviteScope" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" @change="inviteScopeId = ''; inviteRole = ''">
              <option v-for="scopeOption in availableInviteScopes" :key="scopeOption.value" :value="scopeOption.value">{{ scopeOption.label }}</option>
            </select>
          </label>
          <label v-if="inviteScope === 'department'"><span class="mb-1 block text-xs font-semibold">Abteilung</span>
            <select v-model="inviteScopeId" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm">
              <option v-for="dept in invitableDepartments" :key="dept.id" :value="dept.id">{{ dept.name }}</option>
            </select>
          </label>
          <label v-if="inviteScope === 'team'"><span class="mb-1 block text-xs font-semibold">Team</span>
            <select v-model="inviteScopeId" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm">
              <option v-for="team in invitableTeams" :key="team.id" :value="team.id">{{ team.label }}</option>
            </select>
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Rolle</span>
            <select v-model="inviteRole" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm">
              <option value="" disabled>Rolle wählen</option>
              <option v-for="role in availableRolesForInvite" :key="role" :value="role">{{ roleLabels[role] ?? role }}</option>
            </select>
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

      <section class="card mb-6 divide-y divide-[#e8e9e2]">
        <div v-for="member in members" :key="member.userId" class="flex items-start gap-4 p-4 sm:px-6">
          <span class="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#dce6d8] text-xs font-bold">
            {{ member.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() }}
          </span>
          <div class="flex-1">
            <div class="text-sm font-semibold">{{ member.displayName }}</div>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              <span
                v-for="entry in member.roles"
                :key="entry.membershipId"
                class="inline-flex items-center gap-1.5 rounded-full bg-[#eef1ea] px-2.5 py-1 text-[10px] font-semibold text-[#3d453f]"
              >
                <button
                  v-if="entry.canChangeRole || entry.canSetExpiry"
                  type="button"
                  class="focus-ring"
                  @click="toggleExpanded(entry)"
                >
                  {{ roleLabels[entry.role] ?? entry.role }} · {{ scopeName(entry.scope, entry.scopeId) }}
                </button>
                <span v-else>{{ roleLabels[entry.role] ?? entry.role }} · {{ scopeName(entry.scope, entry.scopeId) }}</span>
                <button
                  v-if="entry.canRemove"
                  type="button"
                  :aria-label="`${roleLabels[entry.role] ?? entry.role} in ${scopeName(entry.scope, entry.scopeId)} entfernen`"
                  class="focus-ring text-[#8a9186] hover:text-amber-800"
                  @click="removeMembership(entry.membershipId, entry.scope)"
                >
                  ×
                </button>
              </span>
            </div>
            <div
              v-for="entry in member.roles.filter((item) => item.membershipId === expandedMembershipId)"
              :key="`${entry.membershipId}-detail`"
              class="mt-3 grid gap-3 rounded-xl border border-[#e8e9e2] bg-[#f7f8f4] p-3 sm:grid-cols-2"
            >
              <label v-if="entry.canChangeRole"><span class="mb-1 block text-xs font-semibold">Rolle in {{ scopeName(entry.scope, entry.scopeId) }}</span>
                <div class="flex gap-2">
                  <select v-model="roleDraft[entry.membershipId]" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs">
                    <option v-for="role in availableRolesFor(entry)" :key="role" :value="role">{{ roleLabels[role] ?? role }}</option>
                  </select>
                  <button
                    type="button"
                    :disabled="roleChangeSubmitting === entry.membershipId || roleDraft[entry.membershipId] === entry.role"
                    class="focus-ring shrink-0 rounded-lg bg-forest px-3 py-2 text-[10px] font-bold text-white disabled:opacity-60"
                    @click="changeRole(entry)"
                  >
                    Ändern
                  </button>
                </div>
              </label>
              <label v-if="entry.canSetExpiry"><span class="mb-1 block text-xs font-semibold">Befristet bis</span>
                <div class="flex gap-2">
                  <input v-model="expiryDraft[entry.membershipId]" type="date" class="focus-ring w-full rounded-lg border border-[#dfe0d9] p-2 text-xs" />
                  <button
                    type="button"
                    :disabled="expirySubmitting === entry.membershipId"
                    class="focus-ring shrink-0 rounded-lg border border-[#dfe0d9] px-3 py-2 text-[10px] font-semibold disabled:opacity-60"
                    @click="setExpiry(entry)"
                  >
                    Speichern
                  </button>
                </div>
              </label>
              <p v-if="roleChangeError" class="text-xs text-amber-800 sm:col-span-2">{{ roleChangeError }}</p>
            </div>
          </div>
        </div>
        <p v-if="!members.length" class="p-8 text-center text-xs text-[#9aa096]">Noch seid ihr allein hier.</p>
      </section>

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
