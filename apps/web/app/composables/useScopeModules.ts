import type { Permission } from '@vereinsfunk/authorization'
import { ScopeModulesSchema, type AppModule, type ScopeModules } from '@vereinsfunk/contracts'
import {
  anchorScopes,
  appModuleOrder,
  canUsePermission,
  canUsePermissionAtScope,
  moduleAvailability,
  scopeModulesFor,
} from '../modules/registry'

// Paket 051, PR 3: Modulauswahl aller Ebenen des aktiven Vereins (GET .../scope-modules), einmal
// je Verein geladen und app-weit geteilt. Komfort, keine Sicherheit -- die API lehnt Aufrufe eines
// abgeschalteten Moduls selbst mit 403 module_disabled ab. Deshalb gilt bis zum ersten Laden und
// nach einem Ladefehler "unbekannt" (enabled = null): die Shell zeigt dann alle Module, statt den
// Verein wegen eines Netzwerkfehlers aus seinen Seiten auszusperren.
export async function useScopeModules() {
  // Alle Composables vor dem ersten await -- danach ist der Nuxt-Kontext ausserhalb von
  // <script setup> nicht mehr verfuegbar (NUXT_E1001, siehe useScope()).
  const entries = useState<ScopeModules[] | null>('vf-scope-modules', () => null)
  const loadedFor = useState<string | null>('vf-scope-modules-organization', () => null)
  const refreshGeneration = useState<number>('vf-scope-modules-refresh-generation', () => 0)
  const api = useApiClient()
  const sessionPromise = useSession()
  const scopePromise = useScope()
  const [session, scope] = await Promise.all([sessionPromise, scopePromise])

  async function refresh(): Promise<void> {
    const organizationId = scope.value?.organizationId ?? null
    if (import.meta.server || !organizationId) return
    const generation = ++refreshGeneration.value
    // Do not let the previous organization's modules affect navigation while this request is
    // in flight. This also makes an organization switch fail open (unknown) as documented.
    entries.value = null
    try {
      const result = await api.request(
        `/v1/organizations/${organizationId}/scope-modules`,
        {},
        ScopeModulesSchema.array(),
      )
      // A late response for an earlier organization, or for an earlier A -> B -> A request,
      // must not overwrite the newest selection in the shared state.
      if (generation !== refreshGeneration.value || scope.value?.organizationId !== organizationId)
        return
      entries.value = result
    } catch {
      if (generation !== refreshGeneration.value || scope.value?.organizationId !== organizationId)
        return
      entries.value = null
    }
    if (generation !== refreshGeneration.value || scope.value?.organizationId !== organizationId)
      return
    loadedFor.value = organizationId
  }

  async function ensureLoaded(): Promise<void> {
    if (scope.value?.organizationId && loadedFor.value !== scope.value.organizationId) {
      entries.value = null
      await refresh()
    }
  }

  await ensureLoaded()

  const active = computed(() =>
    scope.value ? scopeModulesFor(entries.value ?? [], scope.value) : null,
  )

  // Paket 055: ausgewertet je Person -- auf den Ebenen, auf denen sie eine Rolle hat, und nur mit
  // einem Recht des Moduls (modules/registry.ts). Die Rechte haengen an der Sitzung und gelten
  // deshalb auch, solange die Modulliste unbekannt ist.
  const anchors = computed(() => {
    if (!scope.value) return []
    const membership =
      session.value?.scopes.find((item) => item.organizationId === scope.value?.organizationId) ??
      null
    return anchorScopes(membership, scope.value)
  })
  const availability = (module: AppModule) =>
    moduleAvailability(entries.value, anchors.value, module).state
  const isEnabled = (module: AppModule) => availability(module) === 'visible'
  const enabled = computed<AppModule[]>(() => appModuleOrder.filter((module) => isEnabled(module)))
  const canUse = (permission: Permission) =>
    canUsePermission(entries.value, anchors.value, permission)
  const canUseAtActiveScope = (permission: Permission) =>
    scope.value
      ? canUsePermissionAtScope(entries.value, anchors.value, scope.value, permission)
      : false
  // Fuer die Erklaerseite: warum ein Modul nicht sichtbar ist, und auf welcher Ebene.
  const explanation = (module: AppModule) =>
    moduleAvailability(entries.value, anchors.value, module)

  return {
    entries,
    active,
    enabled,
    isEnabled,
    availability,
    canUse,
    canUseAtActiveScope,
    explanation,
    refresh,
    ensureLoaded,
  }
}
