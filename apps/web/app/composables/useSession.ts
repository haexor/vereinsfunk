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
  organizationRoles: readonly Role[]
  departments: readonly SessionDepartment[]
}

export interface SessionState {
  userId: string
  displayName: string
  avatarPath: string | null
  scopes: readonly SessionScope[]
}

function useSessionState() {
  return useState<SessionState | null>('vf-session', () => null)
}

function useSessionLoaded() {
  return useState('vf-session-loaded', () => false)
}

// Laedt authz.membership_scopes() einmal pro Sitzung und haelt das Ergebnis in useState.
// Der Supabase-Client existiert nur im Browser (supabase.client.ts); serverseitig bleibt
// die Sitzung leer, bis die Seite im Client neu ausgewertet wird.
export async function useSession() {
  const state = useSessionState()
  if (import.meta.server) return state
  const loaded = useSessionLoaded()
  if (loaded.value) return state
  loaded.value = true

  const supabase = useSupabaseClient()
  const { data: userResult } = await supabase.auth.getUser()
  if (!userResult.user) {
    state.value = null
    return state
  }

  const [profileResult, scopesResult] = await Promise.all([
    supabase.from('profiles').select('display_name, avatar_path').eq('id', userResult.user.id).single(),
    supabase.schema('authz').rpc('membership_scopes'),
  ])

  // membership_scopes() ueberquert die Grenze DB-RPC -> Client; ein unerwartet geformtes
  // Ergebnis soll hier laut werden statt still als kaputte Sidebar in useScope.ts aufzufallen.
  state.value = {
    userId: userResult.user.id,
    displayName: profileResult.data?.display_name ?? userResult.user.email ?? '',
    avatarPath: profileResult.data?.avatar_path ?? null,
    scopes: MembershipScopesSchema.parse(scopesResult.data ?? []) as SessionScope[],
  }
  return state
}

export async function signOut() {
  const supabase = useSupabaseClient()
  await supabase.auth.signOut()
  useSessionState().value = null
  useSessionLoaded().value = false
}
