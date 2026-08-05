<script setup lang="ts">
import { canAssignRole, type Role } from '@vereinsfunk/authorization'
import {
  InvitationSchema,
  MemberSchema,
  type AssignableRole,
  type Invitation,
  type Member,
  type ScopeLevel,
} from '@vereinsfunk/contracts'

const ORG_ROLES: readonly AssignableRole[] = ['organization_admin', 'social_manager', 'billing_admin', 'organization_viewer']
const DEPARTMENT_ROLES: readonly AssignableRole[] = ['department_admin', 'editor', 'approver', 'contributor', 'viewer']
const TEAM_ROLES: readonly AssignableRole[] = ['team_manager', 'contributor', 'viewer']

const config = useRuntimeConfig()
const session = await useSession()
const scope = await useScope()

const organizationId = computed(() => scope.value?.organizationId ?? null)
const organization = computed(() => session.value?.scopes.find((item) => item.organizationId === organizationId.value) ?? null)

const loading = ref(true)
const errorMessage = ref('')
const members = ref<Member[]>([])
const invitations = ref<Invitation[]>([])

const inviteScope = ref<ScopeLevel>('organization')
const inviteScopeId = ref('')
const inviteEmail = ref('')
const inviteRole = ref<AssignableRole | ''>('')
const inviteSubmitting = ref(false)
const inviteError = ref('')
const inviteSuccess = ref(false)

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

const availableRolesForInvite = computed(() => {
  if (!inviteScopeId.value && inviteScope.value !== 'organization') return []
  const candidates = inviteScope.value === 'organization' ? ORG_ROLES : inviteScope.value === 'department' ? DEPARTMENT_ROLES : TEAM_ROLES
  const actorRoles = actorRolesFor(inviteScope.value, inviteScope.value === 'organization' ? (organizationId.value ?? '') : inviteScopeId.value)
  return candidates.filter((role) => canAssignRole(actorRoles, role))
})

async function load() {
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const [membersResponse, invitationsResponse] = await Promise.all([
      $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/members`, { headers }),
      $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/invitations`, { headers }),
    ])
    members.value = MemberSchema.array().parse(membersResponse)
    invitations.value = InvitationSchema.array().parse(invitationsResponse)
  } catch {
    errorMessage.value = 'Mitglieder und Einladungen konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

async function sendInvitation() {
  if (!organizationId.value || !inviteRole.value) return
  inviteSubmitting.value = true
  inviteError.value = ''
  inviteSuccess.value = false
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/invitations`, {
      method: 'POST',
      headers,
      body: {
        organizationId: organizationId.value,
        departmentId: inviteScope.value === 'department' ? inviteScopeId.value : undefined,
        teamId: inviteScope.value === 'team' ? inviteScopeId.value : undefined,
        email: inviteEmail.value,
        role: inviteRole.value,
      },
    })
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
          : 'Die Einladung konnte nicht versendet werden.'
  } finally {
    inviteSubmitting.value = false
  }
}

async function removeMembership(membershipId: string, scopeLevel: ScopeLevel) {
  if (!confirm('Mitgliedschaft wirklich entfernen?')) return
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/memberships/${membershipId}`, { method: 'DELETE', headers, query: { scope: scopeLevel } })
    await load()
  } catch {
    errorMessage.value = 'Die Mitgliedschaft konnte nicht entfernt werden.'
  }
}

async function resendInvitation(id: string) {
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/invitations/${id}/resend`, { method: 'POST', headers })
    await load()
  } catch {
    errorMessage.value = 'Die Einladung konnte nicht erneut versendet werden.'
  }
}

async function revokeInvitation(id: string) {
  if (!confirm('Einladung wirklich widerrufen?')) return
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/invitations/${id}/revoke`, { method: 'POST', headers })
    await load()
  } catch {
    errorMessage.value = 'Die Einladung konnte nicht widerrufen werden.'
  }
}

const canInviteHere = computed(() => useCan('member.invite', { organizationId: organizationId.value ?? '' }))
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
      <section v-if="canInviteHere" class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Person einladen</h2>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="sendInvitation">
          <label class="sm:col-span-2"><span class="mb-1 block text-xs font-semibold">E-Mail</span>
            <input v-model="inviteEmail" type="email" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" />
          </label>
          <label><span class="mb-1 block text-xs font-semibold">Ebene</span>
            <select v-model="inviteScope" class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm" @change="inviteScopeId = ''; inviteRole = ''">
              <option value="organization">Ganzer Verein</option>
              <option value="department">Abteilung</option>
              <option value="team">Team</option>
            </select>
          </label>
          <label v-if="inviteScope === 'department'"><span class="mb-1 block text-xs font-semibold">Abteilung</span>
            <select v-model="inviteScopeId" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm">
              <option v-for="dept in organization?.departments ?? []" :key="dept.id" :value="dept.id">{{ dept.name }}</option>
            </select>
          </label>
          <label v-if="inviteScope === 'team'"><span class="mb-1 block text-xs font-semibold">Team</span>
            <select v-model="inviteScopeId" required class="focus-ring w-full rounded-xl border border-[#dfe0d9] p-2.5 text-sm">
              <template v-for="dept in organization?.departments ?? []" :key="dept.id">
                <option v-for="team in dept.teams" :key="team.id" :value="team.id">{{ dept.name }} · {{ team.name }}</option>
              </template>
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
            <p v-if="inviteSuccess" class="mb-2 text-xs text-emerald-700">Einladung versendet.</p>
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
                {{ roleLabels[entry.role] ?? entry.role }} · {{ scopeName(entry.scope, entry.scopeId) }}
                <button
                  v-if="useCan('member.remove', { organizationId: organizationId ?? '', departmentId: entry.scope !== 'organization' ? entry.scopeId : undefined, teamId: entry.scope === 'team' ? entry.scopeId : undefined })"
                  type="button"
                  class="focus-ring text-[#8a9186] hover:text-amber-800"
                  @click="removeMembership(entry.membershipId, entry.scope)"
                >
                  ×
                </button>
              </span>
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
