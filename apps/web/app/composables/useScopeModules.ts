import { ScopeModulesSchema, type AppModule, type ScopeModules } from '@vereinsfunk/contracts'
import { enabledModulesOf, scopeModulesFor } from '../modules/registry'

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
  const api = useApiClient()
  const scope = await useScope()

  async function refresh(): Promise<void> {
    const organizationId = scope.value?.organizationId ?? null
    if (import.meta.server || !organizationId) return
    try {
      const result = await api.request(`/v1/organizations/${organizationId}/scope-modules`, {}, ScopeModulesSchema.array())
      // Ein spaet zurueckkehrender Lauf fuer einen inzwischen verlassenen Verein darf nichts setzen.
      if (scope.value?.organizationId !== organizationId) return
      entries.value = result
    } catch {
      if (scope.value?.organizationId !== organizationId) return
      entries.value = null
    }
    loadedFor.value = organizationId
  }

  async function ensureLoaded(): Promise<void> {
    if (scope.value?.organizationId && loadedFor.value !== scope.value.organizationId) {
      entries.value = null
      await refresh()
    }
  }

  await ensureLoaded()

  const active = computed(() => (scope.value ? scopeModulesFor(entries.value ?? [], scope.value) : null))
  const enabled = computed<AppModule[] | null>(() => (entries.value === null ? null : enabledModulesOf(active.value)))
  const isEnabled = (module: AppModule) => enabled.value === null || enabled.value.includes(module)

  return { entries, active, enabled, isEnabled, refresh, ensureLoaded }
}
