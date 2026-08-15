import type { ApiEnvironment } from '@vereinsfunk/config'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Supabase caps a response at max_rows=1000. Every multi-page read must have a stable order,
// otherwise concurrent writes can make page boundaries repeat or skip rows.
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1)
    if (page.error) throw page.error
    const data = page.data ?? []
    rows.push(...data)
    if (data.length < pageSize) break
  }
  return rows
}

// An unbounded .in() list is encoded in the PostgREST request URL. Keep each request below the
// gateway/header limit and still page every batch so max_rows cannot truncate a result silently.
export async function fetchAllRowsForIds<T>(
  ids: readonly string[],
  fetchPage: (batch: readonly string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const batchSize = 100
  const rows: T[] = []
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize)
    rows.push(...(await fetchAllRows<T>((from, to) => fetchPage(batch, from, to))))
  }
  return rows
}

export function createUserClient(environment: ApiEnvironment, accessToken: string): SupabaseClient {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required to create a user client')
  }
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ADR-002: API and worker share the same service_role credential, so Postgres grants cannot tell
// them apart. This gate is the enforced boundary: the outbox/run lifecycle is worker-only.
const WORKER_ONLY_RPCS = new Set([
  'claim_workflow_outbox', 'acknowledge_workflow_outbox', 'release_workflow_outbox',
  'begin_workflow_run', 'finish_workflow_run',
])

export function withWorkerOnlyRpcGate(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'rpc') {
        return (...args: Parameters<SupabaseClient['rpc']>) => {
          const [fn] = args
          if (WORKER_ONLY_RPCS.has(fn)) throw new Error(`worker-only RPC "${fn}" is not callable from the API service client`)
          return target.rpc(...args)
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

// RLS-umgehender Zugriff. Jeder Aufruf muss einen eigenen Audit-Eintrag erzeugen.
export function createServiceClient(environment: ApiEnvironment): SupabaseClient {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to create a service client')
  }
  return withWorkerOnlyRpcGate(createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }))
}
