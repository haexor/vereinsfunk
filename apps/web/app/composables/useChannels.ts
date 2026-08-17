import { z } from 'zod'
import {
  ChannelPolicySchema,
  MemberSchema,
  OAuthPendingConnectionSchema,
  SocialConnectionSchema,
  type ChannelOwnerScope,
  type SocialConnection,
  type SocialPlatform,
} from '@vereinsfunk/contracts'

const DepartmentRowSchema = z.object({ id: z.string(), name: z.string() })
const AuthorizationUrlSchema = z.object({ authorizationUrl: z.url() })

export async function useChannels() {
  const api = useApiClient()
  const route = useRoute()
  const scope = await useScope()
  const organizationId = computed(() => scope.value?.organizationId ?? null)

  const loading = ref(true)
  const errorMessage = ref('')
  const actionError = ref('')
  const channels = ref<SocialConnection[]>([])
  const departments = ref<z.infer<typeof DepartmentRowSchema>[]>([])
  const channelPolicy = ref<z.infer<typeof ChannelPolicySchema> | null>(null)
  const members = ref<z.infer<typeof MemberSchema>[]>([])
  const busyChannelId = ref<string | null>(null)

  const oauthErrorMessages: Record<string, string> = {
    denied: 'Die Verbindung wurde beim Anbieter abgebrochen.',
    invalid_state: 'Der Verbindungsversuch ist abgelaufen oder ungültig. Bitte erneut starten.',
    no_accounts: 'Für dieses Konto wurde keine verbindbare Seite bzw. kein Konto gefunden.',
    meta_exchange_failed: 'Meta hat die Anfrage abgelehnt. Bitte erneut versuchen.',
    meta_not_configured: 'Meta ist auf diesem Server noch nicht eingerichtet.',
    twitter_exchange_failed: 'X hat die Anfrage abgelehnt. Bitte erneut versuchen.',
    twitter_not_configured: 'X ist auf diesem Server noch nicht eingerichtet.',
    linkedin_exchange_failed: 'LinkedIn hat die Anfrage abgelehnt. Bitte erneut versuchen.',
    linkedin_not_configured: 'LinkedIn ist auf diesem Server noch nicht eingerichtet.',
  }
  const oauthError = computed(() => {
    const code = route.query.oauthError
    return typeof code === 'string' ? (oauthErrorMessages[code] ?? 'Die Verbindung ist fehlgeschlagen.') : ''
  })

  async function load() {
    if (!organizationId.value) { loading.value = false; return }
    loading.value = true
    errorMessage.value = ''
    try {
      const [channelsResponse, departmentsResult, policyResponse, membersResponse] = await Promise.all([
        api.request(`/v1/organizations/${organizationId.value}/channels`, {}, SocialConnectionSchema.array()),
        useSupabaseClient().from('departments').select('id, name').eq('organization_id', organizationId.value).is('archived_at', null).order('name'),
        api.request(`/v1/organizations/${organizationId.value}/channel-policy`, {}, ChannelPolicySchema),
        api.request(`/v1/organizations/${organizationId.value}/members`, {}, MemberSchema.array()),
      ])
      const parsedDepartments = DepartmentRowSchema.array().safeParse(departmentsResult.data)
      if (departmentsResult.error || !parsedDepartments.success) {
        errorMessage.value = 'Die Kanäle konnten nicht geladen werden.'
        return
      }
      channels.value = channelsResponse
      departments.value = parsedDepartments.data
      channelPolicy.value = policyResponse
      members.value = membersResponse
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

  const connecting = ref<SocialPlatform | null>(null)
  async function connect(platform: SocialPlatform, ownerScope: ChannelOwnerScope, ownerDepartmentId: string | null) {
    if (!organizationId.value) return
    connecting.value = platform
    actionError.value = ''
    try {
      const response = await api.request(`/v1/channels/connect/${platform}/start`, {
        query: { organizationId: organizationId.value, ownerScope, ownerDepartmentId },
      }, AuthorizationUrlSchema)
      window.location.href = response.authorizationUrl
    } catch {
      actionError.value = 'Die Verbindung konnte nicht gestartet werden.'
      connecting.value = null
    }
  }

  const connectDepartmentId = ref('')

  const websiteForm = reactive({ displayName: '', url: '', maxCharacters: '' })
  const creatingWebsite = ref(false)
  // Teilt sich connectDepartmentId mit den OAuth-Verbinden-Knoepfen oben (Plan 039, PR 2 Step 5):
  // ist eine Abteilung dort gewaehlt, entsteht auch der Website-Kanal in ihrem Besitz, sonst
  // vereinsweit -- dieselbe Auswahl, ein Kanal wie jeder andere.
  async function createWebsiteChannel() {
    if (!organizationId.value || !websiteForm.displayName.trim() || !websiteForm.url.trim()) return
    creatingWebsite.value = true
    actionError.value = ''
    try {
      const ownerScope: ChannelOwnerScope = connectDepartmentId.value ? 'department' : 'organization'
      const trimmedMax = websiteForm.maxCharacters.trim()
      await api.request('/v1/channels', {
        method: 'POST',
        body: {
          organizationId: organizationId.value,
          platform: 'website',
          displayName: websiteForm.displayName.trim(),
          websiteUrl: websiteForm.url.trim(),
          ownerScope,
          ownerDepartmentId: ownerScope === 'department' ? connectDepartmentId.value : null,
          ...(trimmedMax ? { maxCharacters: Number(trimmedMax) } : {}),
        },
      })
      websiteForm.displayName = ''
      websiteForm.url = ''
      websiteForm.maxCharacters = ''
      await load()
    } catch (error) {
      actionError.value = errorCodeOf(error) === 'website_url_already_connected'
        ? 'Diese Adresse ist bereits als Kanal verbunden.'
        : 'Der Kanal konnte nicht angelegt werden. Bitte Adresse prüfen.'
    } finally {
      creatingWebsite.value = false
    }
  }
  const pendingId = computed(() => (typeof route.query.pending === 'string' ? route.query.pending : null))
  const pendingConnection = ref<z.infer<typeof OAuthPendingConnectionSchema> | null>(null)
  const pendingLoading = ref(false)
  const pendingSelecting = ref<string | null>(null)

  async function loadPending() {
    if (!pendingId.value) return
    pendingLoading.value = true
    try {
      pendingConnection.value = await api.request(`/v1/oauth-pending/${pendingId.value}`, {}, OAuthPendingConnectionSchema)
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
      await api.request(`/v1/oauth-pending/${pendingId.value}/select`, { method: 'POST', body: { externalAccountId } })
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
      await api.request(`/v1/channels/${channel.id}/verify`, { method: 'POST' })
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
      await api.request(`/v1/channels/${channel.id}`, { method: 'DELETE' })
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
      await api.request(`/v1/channels/${channel.id}`, { method: 'PATCH', body: patch })
      await load()
    } catch {
      actionError.value = 'Die Änderung konnte nicht gespeichert werden.'
    } finally {
      busyChannelId.value = null
    }
  }

  // Nur fuer Website-Kanaele bedienbar (ChannelCard.vue): Instagram/Facebook bleiben von der
  // globalen Plattform-Vorgabe des Betreibers gesteuert (Entwurfsentscheidung 3, Plan 039).
  const maxCharactersDraft = reactive<Record<string, string>>({})
  watch(channels, (list) => {
    for (const channel of list) {
      if (maxCharactersDraft[channel.id] === undefined) maxCharactersDraft[channel.id] = channel.maxCharacters !== null ? String(channel.maxCharacters) : ''
    }
  }, { immediate: true })
  function saveMaxCharacters(channel: SocialConnection) {
    const raw = (maxCharactersDraft[channel.id] ?? '').trim()
    const value = raw === '' ? null : Number(raw)
    if (value === channel.maxCharacters) return
    if (value !== null && (!Number.isInteger(value) || value < 100 || value > 10_000)) return
    void updateChannel(channel, { maxCharacters: value })
  }

  const purposeDraft = reactive<Record<string, string>>({})
  watch(channels, (list) => {
    for (const channel of list) {
      if (purposeDraft[channel.id] === undefined) purposeDraft[channel.id] = channel.purpose ?? ''
    }
  }, { immediate: true })
  function savePurpose(channel: SocialConnection) {
    const value = (purposeDraft[channel.id] ?? '').trim()
    if (value === (channel.purpose ?? '')) return
    void updateChannel(channel, { purpose: value.length > 0 ? value : null })
  }

  function errorCodeOf(error: unknown): string | undefined {
    return (error as { data?: { error?: string } })?.data?.error
  }
  const editorialImprintUrlDraft = reactive<Record<string, string>>({})
  const editorialPrivacyUrlDraft = reactive<Record<string, string>>({})
  const editorialResponsibleProfileIdDraft = reactive<Record<string, string>>({})
  const editorialResponsibleNoteDraft = reactive<Record<string, string>>({})
  watch(channels, (list) => {
    for (const channel of list) {
      if (editorialImprintUrlDraft[channel.id] === undefined) editorialImprintUrlDraft[channel.id] = channel.imprintUrl ?? ''
      if (editorialPrivacyUrlDraft[channel.id] === undefined) editorialPrivacyUrlDraft[channel.id] = channel.privacyUrl ?? ''
      if (editorialResponsibleProfileIdDraft[channel.id] === undefined) editorialResponsibleProfileIdDraft[channel.id] = channel.editorialResponsibleProfileId ?? ''
      if (editorialResponsibleNoteDraft[channel.id] === undefined) editorialResponsibleNoteDraft[channel.id] = channel.editorialResponsibleNote ?? ''
    }
  }, { immediate: true })
  const editorialSavingId = ref<string | null>(null)
  const editorialErrorByChannel = reactive<Record<string, string>>({})
  async function saveEditorialFields(channel: SocialConnection) {
    editorialSavingId.value = channel.id
    editorialErrorByChannel[channel.id] = ''
    try {
      await api.request(`/v1/channels/${channel.id}`, {
        method: 'PATCH',
        body: {
          imprintUrl: (editorialImprintUrlDraft[channel.id] ?? '').trim() || null,
          privacyUrl: (editorialPrivacyUrlDraft[channel.id] ?? '').trim() || null,
          editorialResponsibleProfileId: editorialResponsibleProfileIdDraft[channel.id] || null,
          editorialResponsibleNote: (editorialResponsibleNoteDraft[channel.id] ?? '').trim() || null,
        },
      })
      await load()
    } catch (error) {
      editorialErrorByChannel[channel.id] = errorCodeOf(error) === 'editorial_responsible_not_a_member'
        ? 'Diese Person ist kein Mitglied dieses Vereins.'
        : 'Die presserechtlichen Angaben konnten nicht gespeichert werden.'
    } finally {
      editorialSavingId.value = null
    }
  }

  const scopeBusyKey = ref<string | null>(null)
  function scopeAssignment(channel: SocialConnection, departmentId: string) {
    return channel.scopes.find((entry) => entry.scope === 'department' && entry.scopeId === departmentId)
  }
  function organizationScopeAssignment(channel: SocialConnection) {
    return channel.scopes.find((entry) => entry.scope === 'organization')
  }
  async function toggleDepartmentScope(channel: SocialConnection, departmentId: string) {
    const key = `${channel.id}:${departmentId}`
    scopeBusyKey.value = key
    actionError.value = ''
    try {
      const existing = scopeAssignment(channel, departmentId)
      if (existing) await api.request(`/v1/channel-scopes/${existing.id}`, { method: 'DELETE' })
      else await api.request(`/v1/channels/${channel.id}/scopes`, { method: 'POST', body: { scope: 'department', scopeId: departmentId, canSchedule: true } })
      await load()
    } catch {
      actionError.value = 'Die Freigabe konnte nicht geändert werden.'
    } finally {
      scopeBusyKey.value = null
    }
  }
  async function toggleOrganizationScope(channel: SocialConnection) {
    const key = `${channel.id}:organization`
    scopeBusyKey.value = key
    actionError.value = ''
    try {
      const existing = organizationScopeAssignment(channel)
      if (existing) await api.request(`/v1/channel-scopes/${existing.id}`, { method: 'DELETE' })
      else if (organizationId.value) await api.request(`/v1/channels/${channel.id}/scopes`, { method: 'POST', body: { scope: 'organization', scopeId: organizationId.value, canSchedule: true } })
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
      await api.request('/v1/policy-settings', { method: 'PUT', body: { scope: 'organization', scopeId: organizationId.value, flag, value } })
      await load()
    } catch {
      actionError.value = 'Die Richtlinie konnte nicht geändert werden.'
    } finally {
      policyUpdating.value = null
    }
  }

  const assignmentChannels = computed(() => channels.value.filter((channel) => channel.status !== 'disconnected'))

  return {
    actionError, assignmentChannels, busyChannelId, canManageChannel, canManageOrganizationChannels,
    channelPolicy, channels, connect, connectDepartmentId, connecting, creatingWebsite, createWebsiteChannel, departmentName, departments,
    editorialErrorByChannel, editorialImprintUrlDraft, editorialPrivacyUrlDraft, editorialResponsibleNoteDraft,
    editorialResponsibleProfileIdDraft, editorialSavingId, errorMessage, loading, maxCharactersDraft, members, oauthError,
    organizationId, pendingConnection, pendingId, pendingLoading, pendingSelecting, policyUpdating,
    purposeDraft, saveEditorialFields, saveMaxCharacters, savePurpose, scopeAssignment, scopeBusyKey, selectPendingAccount,
    toggleDepartmentScope, toggleOrganizationScope, updateChannelPolicy, verifyChannel, disconnectChannel,
    organizationScopeAssignment, websiteForm,
  }
}
