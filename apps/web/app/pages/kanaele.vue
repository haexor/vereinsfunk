<script setup lang="ts">
import { z } from 'zod'
import {
  ChannelPolicySchema,
  OAuthPendingConnectionSchema,
  SocialConnectionSchema,
  type ChannelPolicy,
  type ChannelOwnerScope,
  type SocialConnection,
  type SocialPlatform,
} from '@vereinsfunk/contracts'

const DepartmentRowSchema = z.object({ id: z.string(), name: z.string() })
type DepartmentRow = z.infer<typeof DepartmentRowSchema>

const config = useRuntimeConfig()
const route = useRoute()
const scope = await useScope()
const organizationId = computed(() => scope.value?.organizationId ?? null)

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')
const channels = ref<SocialConnection[]>([])
const departments = ref<DepartmentRow[]>([])
const channelPolicy = ref<ChannelPolicy | null>(null)
const busyChannelId = ref<string | null>(null)

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  denied: 'Die Verbindung wurde bei Meta abgebrochen.',
  invalid_state: 'Der Verbindungsversuch ist abgelaufen oder ungültig. Bitte erneut starten.',
  meta_exchange_failed: 'Meta hat die Anfrage abgelehnt. Bitte erneut versuchen.',
  no_accounts: 'Für dieses Meta-Konto wurde keine verbindbare Seite bzw. kein Instagram-Business-Konto gefunden.',
  meta_not_configured: 'Meta ist auf diesem Server noch nicht eingerichtet.',
}
const oauthError = computed(() => {
  const code = route.query.oauthError
  return typeof code === 'string' ? (OAUTH_ERROR_MESSAGES[code] ?? 'Die Verbindung ist fehlgeschlagen.') : ''
})

async function load() {
  if (!organizationId.value) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const [channelsResponse, departmentsResult, policyResponse] = await Promise.all([
      $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/channels`, { headers }),
      useSupabaseClient().from('departments').select('id, name').eq('organization_id', organizationId.value).is('archived_at', null).order('name'),
      $fetch<unknown>(`${config.public.apiBase}/v1/organizations/${organizationId.value}/channel-policy`, { headers }),
    ])
    const parsedChannels = SocialConnectionSchema.array().safeParse(channelsResponse)
    const parsedDepartments = DepartmentRowSchema.array().safeParse(departmentsResult.data)
    const parsedPolicy = ChannelPolicySchema.safeParse(policyResponse)
    if (!parsedChannels.success || departmentsResult.error || !parsedDepartments.success || !parsedPolicy.success) {
      errorMessage.value = 'Die Kanäle konnten nicht geladen werden.'
      return
    }
    channels.value = parsedChannels.data
    departments.value = parsedDepartments.data
    channelPolicy.value = parsedPolicy.data
  } catch {
    errorMessage.value = 'Die Kanäle konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

watch(organizationId, () => { actionError.value = ''; void load() })

function departmentName(departmentId: string | null): string {
  if (!departmentId) return 'Verein'
  return departments.value.find((department) => department.id === departmentId)?.name ?? departmentId
}

const canManageOrganizationChannels = computed(() => useCan('social_account.manage', { organizationId: organizationId.value ?? '' }))
function canManageChannel(channel: SocialConnection): boolean {
  return useCan('social_account.manage', {
    organizationId: organizationId.value ?? '',
    ...(channel.ownerScope === 'department' && channel.ownerDepartmentId ? { departmentId: channel.ownerDepartmentId } : {}),
  })
}
function canManageDepartmentChannels(departmentId: string): boolean {
  return useCan('social_account.manage', { organizationId: organizationId.value ?? '', departmentId })
}

const STATUS_LABELS: Record<SocialConnection['status'], string> = {
  active: 'Aktiv',
  action_required: 'Handlung erforderlich',
  disconnected: 'Getrennt',
}
const STATUS_CLASSES: Record<SocialConnection['status'], string> = {
  active: 'bg-lime/30 text-forest',
  action_required: 'bg-amber-100 text-amber-800',
  disconnected: 'bg-[#eef0ea] text-[#7b827d]',
}

function tokenExpiryLabel(channel: SocialConnection): string | null {
  if (!channel.tokenExpiresAt) return null
  const days = Math.ceil((new Date(channel.tokenExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  if (days < 0) return 'Token ist abgelaufen'
  if (days === 0) return 'Token läuft heute ab'
  return `Token läuft in ${days} Tag${days === 1 ? '' : 'en'} ab`
}

// Verbinden: erst per fetch die Autorisierungs-URL holen (Authorization-Header noetig), dann selbst
// dorthin navigieren -- eine volle Seitennavigation traegt keinen Bearer-Token (Plan 012).
const connecting = ref<SocialPlatform | null>(null)
async function connect(platform: SocialPlatform, ownerScope: ChannelOwnerScope, ownerDepartmentId: string | null) {
  if (!organizationId.value) return
  connecting.value = platform
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<{ authorizationUrl: string }>(`${config.public.apiBase}/v1/channels/connect/${platform}/start`, {
      headers,
      query: { organizationId: organizationId.value, ownerScope, ownerDepartmentId },
    })
    window.location.href = response.authorizationUrl
  } catch {
    actionError.value = 'Die Verbindung konnte nicht gestartet werden.'
    connecting.value = null
  }
}

const connectDepartmentId = ref('')

// Pending-Auswahl nach dem Meta-Callback: die Seite laedt mit ?pending=<id> in der URL.
const PendingAccountSchema = OAuthPendingConnectionSchema
const pendingId = computed(() => (typeof route.query.pending === 'string' ? route.query.pending : null))
const pendingConnection = ref<z.infer<typeof PendingAccountSchema> | null>(null)
const pendingLoading = ref(false)
const pendingSelecting = ref<string | null>(null)

async function loadPending() {
  if (!pendingId.value) return
  pendingLoading.value = true
  try {
    const headers = await useAuthHeader()
    const response = await $fetch<unknown>(`${config.public.apiBase}/v1/oauth-pending/${pendingId.value}`, { headers })
    pendingConnection.value = PendingAccountSchema.parse(response)
  } catch {
    actionError.value = 'Die Auswahl ist nicht mehr verfügbar. Bitte die Verbindung erneut starten.'
  } finally {
    pendingLoading.value = false
  }
}
await loadPending()

async function selectPendingAccount(externalAccountId: string) {
  if (!pendingId.value) return
  pendingSelecting.value = externalAccountId
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/oauth-pending/${pendingId.value}/select`, { method: 'POST', headers, body: { externalAccountId } })
    pendingConnection.value = null
    await navigateTo('/kanaele')
    await load()
  } catch {
    actionError.value = 'Der Kanal konnte nicht verbunden werden.'
  } finally {
    pendingSelecting.value = null
  }
}

async function verifyChannel(channel: SocialConnection) {
  busyChannelId.value = channel.id
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/channels/${channel.id}/verify`, { method: 'POST', headers })
    await load()
  } catch {
    actionError.value = 'Die Prüfung ist fehlgeschlagen.'
  } finally {
    busyChannelId.value = null
  }
}

async function disconnectChannel(channel: SocialConnection) {
  if (!confirm(`"${channel.displayName}" wirklich trennen? Geplante Beiträge auf diesem Kanal können danach nicht mehr veröffentlicht werden.`)) return
  busyChannelId.value = channel.id
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/channels/${channel.id}`, { method: 'DELETE', headers })
    await load()
  } catch {
    actionError.value = 'Der Kanal konnte nicht getrennt werden.'
  } finally {
    busyChannelId.value = null
  }
}

async function updateChannel(channel: SocialConnection, patch: Record<string, unknown>) {
  busyChannelId.value = channel.id
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/channels/${channel.id}`, { method: 'PATCH', headers, body: patch })
    await load()
  } catch {
    actionError.value = 'Die Änderung konnte nicht gespeichert werden.'
  } finally {
    busyChannelId.value = null
  }
}

const purposeDraft = reactive<Record<string, string>>({})
function savePurpose(channel: SocialConnection) {
  const value = purposeDraft[channel.id] ?? ''
  if (value === (channel.purpose ?? '')) return
  void updateChannel(channel, { purpose: value.trim().length > 0 ? value.trim() : null })
}

// Zuordnungsmatrix: Abteilungen als Zeilen, Kanaele als Spalten (Plan 012, "Oberflaeche").
const scopeBusyKey = ref<string | null>(null)
function scopeAssignment(channel: SocialConnection, departmentId: string) {
  return channel.scopes.find((entry) => entry.scope === 'department' && entry.scopeId === departmentId)
}
async function toggleDepartmentScope(channel: SocialConnection, departmentId: string) {
  const key = `${channel.id}:${departmentId}`
  scopeBusyKey.value = key
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    const existing = scopeAssignment(channel, departmentId)
    if (existing) {
      await $fetch(`${config.public.apiBase}/v1/channel-scopes/${existing.id}`, { method: 'DELETE', headers })
    } else {
      await $fetch(`${config.public.apiBase}/v1/channels/${channel.id}/scopes`, { method: 'POST', headers, body: { scope: 'department', scopeId: departmentId, canSchedule: true } })
    }
    await load()
  } catch {
    actionError.value = 'Die Freigabe konnte nicht geändert werden.'
  } finally {
    scopeBusyKey.value = null
  }
}
function organizationScopeAssignment(channel: SocialConnection) {
  return channel.scopes.find((entry) => entry.scope === 'organization')
}
async function toggleOrganizationScope(channel: SocialConnection) {
  const key = `${channel.id}:organization`
  scopeBusyKey.value = key
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    const existing = organizationScopeAssignment(channel)
    if (existing) {
      await $fetch(`${config.public.apiBase}/v1/channel-scopes/${existing.id}`, { method: 'DELETE', headers })
    } else if (organizationId.value) {
      await $fetch(`${config.public.apiBase}/v1/channels/${channel.id}/scopes`, { method: 'POST', headers, body: { scope: 'organization', scopeId: organizationId.value, canSchedule: true } })
    }
    await load()
  } catch {
    actionError.value = 'Die Freigabe konnte nicht geändert werden.'
  } finally {
    scopeBusyKey.value = null
  }
}

const policyUpdating = ref<string | null>(null)
async function updateChannelPolicy(flag: 'allow_department_owned_channels' | 'require_channel_responsible', value: boolean) {
  if (!organizationId.value) return
  policyUpdating.value = flag
  actionError.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/policy-settings`, { method: 'PUT', headers, body: { scope: 'organization', scopeId: organizationId.value, flag, value } })
    await load()
  } catch {
    actionError.value = 'Die Richtlinie konnte nicht geändert werden.'
  } finally {
    policyUpdating.value = null
  }
}

const assignmentChannels = computed(() => channels.value.filter((channel) => channel.status !== 'disconnected'))
</script>

<template>
  <div class="mx-auto max-w-[980px] px-5 py-8 sm:px-10">
    <header class="mb-8">
      <div class="eyebrow mb-3">Verein</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Kanäle</h1>
      <p class="mt-2 text-sm text-[#727a75]">Instagram- und Facebook-Konten verbinden und festlegen, welche Abteilung sie bespielen darf.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <p v-else-if="errorMessage" class="text-sm text-amber-800">{{ errorMessage }}</p>
    <template v-else>
      <p v-if="oauthError" class="mb-4 rounded-xl bg-amber-100 p-3 text-sm text-amber-800">{{ oauthError }}</p>
      <p v-if="actionError" class="mb-4 text-sm text-amber-800">{{ actionError }}</p>

      <section v-if="pendingId" class="card mb-6 p-6">
        <h2 class="mb-3 font-display text-base font-bold">Konto auswählen</h2>
        <p v-if="pendingLoading" class="text-xs text-[#7b827d]">Wird geladen …</p>
        <template v-else-if="pendingConnection">
          <p class="mb-3 text-[13px] text-[#727a75]">Welche Seite bzw. welches Instagram-Business-Konto soll verbunden werden?</p>
          <ul class="space-y-2">
            <li v-for="account in pendingConnection.availableAccounts" :key="account.externalAccountId">
              <button
                type="button"
                :disabled="pendingSelecting !== null"
                class="focus-ring flex w-full items-center gap-3 rounded-xl border border-[#dfe0d9] p-3 text-left text-sm hover:border-forest disabled:opacity-60"
                @click="selectPendingAccount(account.externalAccountId)"
              >
                <PlatformIcon :platform="pendingConnection.platform" />
                <span class="flex-1 font-medium">{{ account.displayName }}</span>
                <span v-if="pendingSelecting === account.externalAccountId" class="text-[10px] text-[#9aa096]">Wird verbunden …</span>
              </button>
            </li>
          </ul>
        </template>
        <p v-else class="text-xs text-amber-800">Diese Auswahl ist nicht mehr verfügbar.</p>
      </section>

      <section v-if="canManageOrganizationChannels" class="card mb-6 p-6">
        <h2 class="mb-3 font-display text-base font-bold">Kanal verbinden</h2>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            :disabled="connecting !== null"
            class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"
            @click="connect('instagram', 'organization', null)"
          >
            Instagram verbinden (Verein)
          </button>
          <button
            type="button"
            :disabled="connecting !== null"
            class="focus-ring rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"
            @click="connect('facebook', 'organization', null)"
          >
            Facebook verbinden (Verein)
          </button>
        </div>

        <div v-if="channelPolicy?.allowDepartmentOwnedChannels" class="mt-4 border-t border-[#e8e9e2] pt-4">
          <p class="mb-2 text-[11px] font-semibold text-[#7b827d]">Eigener Abteilungskanal</p>
          <div class="flex flex-wrap items-center gap-2">
            <select v-model="connectDepartmentId" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-xs">
              <option value="">Abteilung wählen …</option>
              <option v-for="department in departments" :key="department.id" :value="department.id">{{ department.name }}</option>
            </select>
            <button
              type="button"
              :disabled="!connectDepartmentId || connecting !== null"
              class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold disabled:opacity-60"
              @click="connect('instagram', 'department', connectDepartmentId)"
            >
              Instagram
            </button>
            <button
              type="button"
              :disabled="!connectDepartmentId || connecting !== null"
              class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold disabled:opacity-60"
              @click="connect('facebook', 'department', connectDepartmentId)"
            >
              Facebook
            </button>
          </div>
        </div>

        <div class="mt-4 space-y-2 border-t border-[#e8e9e2] pt-4">
          <label class="flex items-center gap-2 text-[12px] text-[#43483f]">
            <input
              type="checkbox"
              :checked="channelPolicy?.allowDepartmentOwnedChannels ?? false"
              :disabled="policyUpdating !== null"
              @change="updateChannelPolicy('allow_department_owned_channels', ($event.target as HTMLInputElement).checked)"
            />
            Abteilungen dürfen eigene Kanäle mitbringen
          </label>
          <label class="flex items-center gap-2 text-[12px] text-[#43483f]">
            <input
              type="checkbox"
              :checked="channelPolicy?.requireChannelResponsible ?? false"
              :disabled="policyUpdating !== null"
              @change="updateChannelPolicy('require_channel_responsible', ($event.target as HTMLInputElement).checked)"
            />
            Kanal ohne verantwortliche Person kann nicht bespielt werden
          </label>
        </div>
      </section>

      <section v-for="channel in channels" :key="channel.id" class="card mb-4 p-6" :class="{ 'opacity-60': channel.status === 'disconnected' }">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3">
            <PlatformIcon :platform="channel.platform" />
            <div>
              <p class="font-display text-base font-bold">{{ channel.displayName }}</p>
              <p class="text-[11px] text-[#9aa096]">{{ departmentName(channel.ownerDepartmentId) }} · {{ channel.confidential ? 'Vertraulich' : 'Sichtbar' }}</p>
            </div>
          </div>
          <span class="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold" :class="STATUS_CLASSES[channel.status]">{{ STATUS_LABELS[channel.status] }}</span>
        </div>

        <p v-if="channel.status === 'action_required'" class="mt-3 rounded-lg bg-amber-100 p-2.5 text-[12px] font-medium text-amber-800">
          Verbindung erneuern: Token prüfen oder den Kanal neu verbinden.
        </p>
        <p v-if="tokenExpiryLabel(channel)" class="mt-2 text-[11px] text-[#7b827d]">{{ tokenExpiryLabel(channel) }}</p>
        <p v-if="channel.lastVerifiedAt" class="text-[11px] text-[#9aa096]">Zuletzt geprüft: {{ new Date(channel.lastVerifiedAt).toLocaleString('de-DE') }}</p>

        <template v-if="canManageChannel(channel)">
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <input
              v-model="purposeDraft[channel.id]"
              :placeholder="channel.purpose ?? 'Zweck, z. B. Hauptkanal'"
              class="focus-ring flex-1 rounded-lg border border-[#dfe0d9] p-2 text-xs"
              @blur="savePurpose(channel)"
              @keyup.enter="savePurpose(channel)"
            />
            <button
              type="button"
              :disabled="busyChannelId === channel.id"
              class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold disabled:opacity-60"
              @click="verifyChannel(channel)"
            >
              Verbindung prüfen
            </button>
            <button
              type="button"
              :disabled="busyChannelId === channel.id || channel.status === 'disconnected'"
              class="focus-ring rounded-lg border border-[#dfe0d9] px-3 py-2 text-[11px] font-semibold text-amber-800 disabled:opacity-60"
              @click="disconnectChannel(channel)"
            >
              Trennen
            </button>
          </div>
        </template>
      </section>

      <p v-if="!channels.length" class="p-8 text-center text-xs text-[#9aa096]">Noch ist kein Kanal verbunden. Ihr könnt Beiträge vorbereiten, aber nicht veröffentlichen.</p>

      <section v-if="assignmentChannels.length && departments.length" class="card mt-8 overflow-x-auto p-6">
        <h2 class="mb-1 font-display text-base font-bold">Zuordnung</h2>
        <p class="mb-4 text-[11px] text-[#7b827d]">Wer darf welchen Kanal bespielen? Vereinsweit freigegeben gilt für alle Abteilungen.</p>
        <table class="w-full min-w-[480px] border-collapse text-[12px]">
          <thead>
            <tr>
              <th class="p-2 text-left font-semibold text-[#7b827d]"></th>
              <th v-for="channel in assignmentChannels" :key="channel.id" class="p-2 text-left font-semibold text-[#7b827d]">
                <div class="flex items-center gap-1.5"><PlatformIcon :platform="channel.platform" /> {{ channel.displayName }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr class="border-t border-[#e8e9e2]">
              <td class="p-2 font-medium">Ganzer Verein</td>
              <td v-for="channel in assignmentChannels" :key="channel.id" class="p-2">
                <input
                  type="checkbox"
                  :checked="!!organizationScopeAssignment(channel)"
                  :disabled="!canManageChannel(channel) || scopeBusyKey === `${channel.id}:organization`"
                  @change="toggleOrganizationScope(channel)"
                />
              </td>
            </tr>
            <tr v-for="department in departments" :key="department.id" class="border-t border-[#e8e9e2]">
              <td class="p-2 font-medium">{{ department.name }}</td>
              <td v-for="channel in assignmentChannels" :key="channel.id" class="p-2">
                <input
                  type="checkbox"
                  :checked="!!organizationScopeAssignment(channel) || !!scopeAssignment(channel, department.id)"
                  :disabled="!!organizationScopeAssignment(channel) || !canManageChannel(channel) && !canManageDepartmentChannels(department.id) || scopeBusyKey === `${channel.id}:${department.id}`"
                  @change="toggleDepartmentScope(channel, department.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
