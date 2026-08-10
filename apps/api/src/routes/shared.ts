import type { ScopeLevel } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PermissionScope } from '../auth.js'

// Von mehreren Route-Modulen und dem verbleibenden app.ts benoetigt (Richtlinien/Freigaben,
// Kanaele und Mitglieder/Einladungen loesen alle scope+scopeId oder ein Membership-Tripel auf) --
// hier zentral statt in jedem Modul dupliziert, damit spaetere Extraktionen (Paket 027) diese
// Funktionen nicht erneut abschreiben muessen.

// supabase/config.toml caps a single response at max_rows=1000 -- a plain select() on a large
// organization's membership table would silently truncate the roster. Pages through range()
// until a page comes back short.
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

// Ein .in() mit unbegrenzt vielen IDs traegt die gesamte Liste in der Anfrage-URL -- dieselbe
// Grenze wie bei den Profil-Bloecken in GET /members und dem Retention-Lauf. Batcht in Chunks von
// 100, statt die Ergebnisse einer einzelnen Anfrage zu verwerfen.
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

// Loest scope+scopeId (aus CreateMembershipRequestSchema) in einen PermissionScope auf --
// organizationId muss fuer department/team erst nachgeschlagen werden, damit requirePermission
// und canAssignRole (beide brauchen den vollen Scope-Pfad) korrekt kaskadieren koennen.
export async function resolveMembershipScope(
  client: SupabaseClient,
  scope: ScopeLevel,
  scopeId: string,
): Promise<PermissionScope | null> {
  if (scope === 'organization') return { organizationId: scopeId }
  if (scope === 'department') {
    const department = await client.from('departments').select('organization_id').eq('id', scopeId).maybeSingle()
    if (department.error) throw department.error
    return department.data ? { organizationId: department.data.organization_id as string, departmentId: scopeId } : null
  }
  const team = await client.from('teams').select('organization_id, department_id').eq('id', scopeId).maybeSingle()
  if (team.error) throw team.error
  return team.data ? { organizationId: team.data.organization_id as string, departmentId: team.data.department_id as string, teamId: scopeId } : null
}

// exactOptionalPropertyTypes verbietet departmentId/teamId: undefined -- die Schluessel muessen
// bei Abwesenheit ganz fehlen statt explizit auf undefined gesetzt zu sein.
export function toPermissionScope(organizationId: string, departmentId?: string | null, teamId?: string | null): PermissionScope {
  return { organizationId, ...(departmentId ? { departmentId } : {}), ...(teamId ? { teamId } : {}) }
}
