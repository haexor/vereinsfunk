import type { ZodType } from 'zod'

export type ApiRequestOptions = {
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  query?: Record<string, string | number | boolean | null | undefined>
  body?: Record<string, unknown> | BodyInit | null
  headers?: Record<string, string>
  signal?: AbortSignal
  authenticate?: boolean
}

type ApiFetch = (path: string, options: Omit<ApiRequestOptions, 'authenticate'> & { headers: Record<string, string> }) => Promise<unknown>

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode?: number,
    readonly data: { error: string, message?: string } = { error: code },
  ) {
    super(code)
  }
}

function apiError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error
  const response = error as { data?: { error?: string, message?: string }; statusCode?: number; status?: number }
  const code = response.data?.error ?? 'api_request_failed'
  return new ApiRequestError(code, response.statusCode ?? response.status, { ...response.data, error: code })
}

// Framework-unabhängiger Kern: hält die Browser-Grenze testbar und sorgt dafür, dass alle
// Seiten Header, Fehlercodes und Zod-Validierung identisch behandeln.
export function createApiClient(input: {
  fetch: ApiFetch
  getAuthHeaders: () => Promise<Record<string, string>>
}) {
  async function request<T>(
    path: string,
    options: ApiRequestOptions = {},
    schema?: ZodType<T>,
  ): Promise<T> {
    const { authenticate = true, headers: extraHeaders, ...fetchOptions } = options
    let response: unknown
    try {
      response = await input.fetch(path, {
        ...fetchOptions,
        headers: {
          ...(authenticate ? await input.getAuthHeaders() : {}),
          ...extraHeaders,
        },
      })
    } catch (error) {
      throw apiError(error)
    }
    return schema ? schema.parse(response) : response as T
  }

  return { request }
}
