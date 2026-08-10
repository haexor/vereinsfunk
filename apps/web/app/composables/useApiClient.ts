import { createApiClient, type ApiRequestOptions } from '../utils/apiClient'

// Gemeinsame Browser-Grenze zur privilegierten API: zentralisiert Basis-URL, Bearer-Token und
// Response-Validierung, ohne den Supabase-Client oder serverseitige Secrets in Komponenten zu
// verstecken. Öffentliche Token-Seiten setzen authenticate: false explizit.
export function useApiClient() {
  const config = useRuntimeConfig()
  return createApiClient({
    getAuthHeaders: useAuthHeader,
    fetch: (path, options) => $fetch<unknown>(`${config.public.apiBase}${path}`, options as ApiRequestOptions),
  })
}
