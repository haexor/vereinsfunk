import type { ZodType } from 'zod'

type ApiRequestOptions = {
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  query?: Record<string, string | number | boolean | null | undefined>
  // $fetch akzeptiert JSON-Records oder native BodyInit-Werte (FormData für Uploads). `any`
  // entspricht hier bewusst der Nitro-Grenze; die fachliche Form wird in der API mit Zod geprüft.
  body?: Record<string, any> | BodyInit | null
  headers?: Record<string, string>
  authenticate?: boolean
}

// Gemeinsame Browser-Grenze zur privilegierten API: zentralisiert Basis-URL, Bearer-Token und
// Response-Validierung, ohne den Supabase-Client oder serverseitige Secrets in Komponenten zu
// verstecken. Öffentliche Token-Seiten setzen authenticate: false explizit.
export function useApiClient() {
  const config = useRuntimeConfig()

  async function request<T>(
    path: string,
    options: ApiRequestOptions = {},
    schema?: ZodType<T>,
  ): Promise<T> {
    const { authenticate = true, headers: extraHeaders, ...fetchOptions } = options
    const headers = {
      ...(authenticate ? await useAuthHeader() : {}),
      ...extraHeaders,
    }
    const response = await $fetch<unknown>(`${config.public.apiBase}${path}`, {
      ...fetchOptions,
      headers,
    })
    return schema ? schema.parse(response) : response as T
  }

  return { request }
}
