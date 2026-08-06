import type { Role } from '@vereinsfunk/authorization'
import { MembershipScopesSchema, PlatformAdminStatusSchema } from '@vereinsfunk/contracts'

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

// platform_admins verweigert authenticated jeglichen Direktzugriff, der Status geht deshalb
// nur ueber die API. Ein Ausfall wird hier bewusst nicht geworfen, sondern als "unbekannt"
// (null) zurueckgegeben -- ob das folgenlos ist, entscheidet loadSession() unten anhand der
// Vereins-Scopes.
async function loadPlatformAdminStatus(): Promise<{ isPlatformAdmin: boolean; isDefaultAdmin: boolean } | null> {
  try {
    const config = useRuntimeConfig()
    const headers = await useAuthHeader()
    const response = await $fetch(`${config.public.apiBase}/v1/me/platform-admin-status`, { headers })
    return PlatformAdminStatusSchema.parse(response)
  } catch {
    return null
  }
}

function useSessionState() {
  return useState<SessionState | null>('vf-session', () => null)
}

function useSessionLoad() {
  return useState<Promise<void> | null>('vf-session-load', () => null)
}

// Bumped by refreshSession() so a load already in flight at that point can recognize it has
// been superseded and must not overwrite the newer state once it resolves.
function useSessionGeneration() {
  return useState<number>('vf-session-generation', () => 0)
}

async function loadSession(state: ReturnType<typeof useSessionState>, generation: ReturnType<typeof useSessionGeneration>, expectedGeneration: number) {
  const supabase = useSupabaseClient()
  const { data: userResult, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userResult.user) {
    if (generation.value === expectedGeneration) state.value = null
    return
  }

  const [profileResult, scopesResult, platformAdminStatus] = await Promise.all([
    supabase.from('profiles').select('display_name, avatar_path').eq('id', userResult.user.id).single(),
    supabase.schema('authz').rpc('membership_scopes'),
    loadPlatformAdminStatus(),
  ])
  if (scopesResult.error) throw scopesResult.error
  if (generation.value !== expectedGeneration) return

  // membership_scopes() crosses the DB-RPC -> client boundary; an unexpectedly shaped
  // result must fail loudly here instead of silently showing a broken sidebar in useScope.ts.
  const scopes = MembershipScopesSchema.parse(scopesResult.data ?? []) as SessionScope[]

  // Ohne Vereins-Scope entscheidet allein dieses Flag, wohin der Nutzer gehoert: Onboarding-
  // Wizard oder Betreiberbereich (middleware/auth.global.ts). Ein stilles `false` waere hier
  // geraten -- der Betreiber landete im Wizard "Verein anlegen", den sein Konto seit
  // 2026080602_platform_admin_separation.sql gar nicht abschliessen kann, und zwar
  // ununterscheidbar davon, dass er wirklich kein Admin ist. Wer dagegen einen Verein hat,
  // merkt vom fehlenden Status nichts: fuer ihn aendert das Flag nichts an der Navigation,
  // und ein API-Ausfall darf ihm nicht die ganze Anwendung nehmen.
  if (!platformAdminStatus && scopes.length === 0) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Der Kontostatus konnte nicht geladen werden. Bitte lade die Seite neu.',
      fatal: true,
    })
  }

  state.value = {
    userId: userResult.user.id,
    displayName: profileResult.data?.display_name ?? userResult.user.email ?? '',
    avatarPath: profileResult.data?.avatar_path ?? null,
    scopes,
    isPlatformAdmin: platformAdminStatus?.isPlatformAdmin ?? false,
    isDefaultAdmin: platformAdminStatus?.isDefaultAdmin ?? false,
  }
}

// Loads authz.membership_scopes() once per session and keeps the result in useState.
// The Supabase client only exists in the browser (supabase.client.ts); the server
// always returns the empty state until the page re-evaluates on the client.
export async function useSession() {
  const state = useSessionState()
  if (import.meta.server) return state
  const load = useSessionLoad()
  const generation = useSessionGeneration()
  if (!load.value) {
    const expectedGeneration = generation.value
    // Shared in-flight load: concurrent callers await the same request instead of
    // observing an intermediate empty state. On failure the load is reset so the
    // next call retries instead of permanently caching a transient error as "logged out".
    load.value = loadSession(state, generation, expectedGeneration).catch((error) => {
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
  useSessionGeneration().value += 1
  useSessionLoad().value = null
  return useSession()
}

export async function signOut() {
  const supabase = useSupabaseClient()
  await supabase.auth.signOut()
  useSessionState().value = null
  useSessionLoad().value = null
}
