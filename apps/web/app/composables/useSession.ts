import type { Role } from '@vereinsfunk/authorization'
import { MembershipScopesSchema } from '@vereinsfunk/contracts'

export interface SessionTeam {
  id: string
  name: string
  roles: readonly Role[]
}

export interface SessionDepartment {
  id: string
  name: string
  roles: readonly Role[]
  teams: readonly SessionTeam[]
}

export interface SessionScope {
  organizationId: string
  organizationName: string
  organizationTimezone: string
  organizationRoles: readonly Role[]
  departments: readonly SessionDepartment[]
}

export interface SessionState {
  userId: string
  displayName: string
  avatarPath: string | null
  scopes: readonly SessionScope[]
  isPlatformAdmin: boolean
  isDefaultAdmin: boolean
}

// Additiv, nicht sicherheitskritisch fuer normale Vereinsnutzer: platform_admins verweigert
// authenticated jeglichen Direktzugriff, deshalb geht das nur ueber die API. Ein API-Ausfall
// darf aber nicht den gesamten Session-Load fuer alle Nutzer blockieren -- fail-closed statt
// fail-loud, anders als bei membership_scopes() unten.
async function loadPlatformAdminStatus(): Promise<{ isPlatformAdmin: boolean; isDefaultAdmin: boolean }> {
  try {
    const config = useRuntimeConfig()
    const headers = await useAuthHeader()
    return await $fetch<{ isPlatformAdmin: boolean; isDefaultAdmin: boolean }>(`${config.public.apiBase}/v1/me/platform-admin-status`, { headers })
  } catch {
    return { isPlatformAdmin: false, isDefaultAdmin: false }
  }
}

function useSessionState() {
  return useState<SessionState | null>('vf-session', () => null)
}

function useSessionLoad() {
  return useState<Promise<void> | null>('vf-session-load', () => null)
}

async function loadSession(state: ReturnType<typeof useSessionState>) {
  const supabase = useSupabaseClient()
  const { data: userResult, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userResult.user) {
    state.value = null
    return
  }

  const [profileResult, scopesResult, platformAdminStatus] = await Promise.all([
    supabase.from('profiles').select('display_name, avatar_path').eq('id', userResult.user.id).single(),
    supabase.schema('authz').rpc('membership_scopes'),
    loadPlatformAdminStatus(),
  ])
  if (scopesResult.error) throw scopesResult.error

  // membership_scopes() crosses the DB-RPC -> client boundary; an unexpectedly shaped
  // result must fail loudly here instead of silently showing a broken sidebar in useScope.ts.
  state.value = {
    userId: userResult.user.id,
    displayName: profileResult.data?.display_name ?? userResult.user.email ?? '',
    avatarPath: profileResult.data?.avatar_path ?? null,
    scopes: MembershipScopesSchema.parse(scopesResult.data ?? []) as SessionScope[],
    isPlatformAdmin: platformAdminStatus.isPlatformAdmin,
    isDefaultAdmin: platformAdminStatus.isDefaultAdmin,
  }
}

// Loads authz.membership_scopes() once per session and keeps the result in useState.
// The Supabase client only exists in the browser (supabase.client.ts); the server
// always returns the empty state until the page re-evaluates on the client.
export async function useSession() {
  const state = useSessionState()
  if (import.meta.server) return state
  const load = useSessionLoad()
  if (!load.value) {
    // Shared in-flight load: concurrent callers await the same request instead of
    // observing an intermediate empty state. On failure the load is reset so the
    // next call retries instead of permanently caching a transient error as "logged out".
    load.value = loadSession(state).catch((error) => {
      load.value = null
      throw error
    })
  }
  await load.value
  return state
}

// Forces a fresh membership_scopes() load. Needed right after create_organization(), since
// useSession() otherwise keeps serving the cached pre-onboarding state (no scopes) for the
// rest of the client session.
export async function refreshSession() {
  useSessionLoad().value = null
  return useSession()
}

export async function signOut() {
  const supabase = useSupabaseClient()
  await supabase.auth.signOut()
  useSessionState().value = null
  useSessionLoad().value = null
}
