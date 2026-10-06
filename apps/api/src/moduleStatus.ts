import { AppModuleSchema } from '@vereinsfunk/contracts'
import { resolveEnabledModules, type AppModule, type ModuleLayers, type ResolvedModules } from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { PermissionScope } from './auth.js'

// Paket 051, PR 2: die Modulauswahl eines Vereins in einem Rutsch -- Tarif plus alle
// policy_settings-Zeilen mit enabled_modules. Aufgeloest wird in TS (resolveEnabledModules), damit
// die Oberflaeche zusaetzlich erfaehrt, WO ein Modul abgeschaltet wurde. SQL-Gegenstueck fuer RLS
// und fuer den Claim einer Veroeffentlichung ist authz.module_enabled(); beide folgen derselben
// Regel (Tarif ∩ Verein ∩ Abteilung ∩ Mannschaft, kein Abo = Tarif schraenkt nichts ein).
export interface OrganizationModuleSettings {
  planModules: readonly AppModule[] | null
  organization: readonly AppModule[] | null
  departmentById: ReadonlyMap<string, readonly AppModule[]>
  teamById: ReadonlyMap<string, readonly AppModule[]>
}

const ModuleListSchema = z.array(AppModuleSchema)
const SubscriptionRowSchema = z.object({ subscription_plans: z.object({ included_modules: ModuleListSchema }) })
const ModuleRowSchema = z.object({
  scope: z.enum(['organization', 'department', 'team']),
  department_id: z.string().nullable(),
  team_id: z.string().nullable(),
  enabled_modules: ModuleListSchema,
})

export async function loadOrganizationModuleSettings(client: SupabaseClient, organizationId: string): Promise<OrganizationModuleSettings> {
  const [subscription, rows] = await Promise.all([
    client.from('organization_subscriptions').select('subscription_plans(included_modules)').eq('organization_id', organizationId).maybeSingle(),
    client.from('policy_settings').select('scope, department_id, team_id, enabled_modules').eq('organization_id', organizationId).not('enabled_modules', 'is', null),
  ])
  if (subscription.error) throw subscription.error
  if (rows.error) throw rows.error
  const moduleRows = z.array(ModuleRowSchema).parse(rows.data)
  return {
    planModules: subscription.data ? SubscriptionRowSchema.parse(subscription.data).subscription_plans.included_modules : null,
    organization: moduleRows.find((row) => row.scope === 'organization')?.enabled_modules ?? null,
    departmentById: new Map(moduleRows.filter((row) => row.scope === 'department').map((row) => [row.department_id!, row.enabled_modules])),
    teamById: new Map(moduleRows.filter((row) => row.scope === 'team').map((row) => [row.team_id!, row.enabled_modules])),
  }
}

// Die Schichten einer Ebene. Eine Mannschaft braucht ihre Abteilung, sonst fehlte deren Auswahl.
export function moduleLayersFor(settings: OrganizationModuleSettings, scope: { departmentId?: string | null; teamId?: string | null }): ModuleLayers {
  return {
    planModules: settings.planModules,
    organization: settings.organization,
    department: scope.departmentId ? (settings.departmentById.get(scope.departmentId) ?? null) : null,
    team: scope.teamId ? (settings.teamById.get(scope.teamId) ?? null) : null,
  }
}

export interface ModuleStatusProvider {
  modulesForScope(scope: PermissionScope): Promise<ResolvedModules>
}

// Ueber den Service-Client wie SupabasePlatformAdminProvider: organization_subscriptions ist fuer
// Abteilungs- und Mannschaftsrollen nicht lesbar, die Modulpruefung muss fuer sie aber genauso
// greifen. Aufgerufen wird erst, nachdem requirePermission die Rolle im Scope bestaetigt hat.
export class SupabaseModuleStatusProvider implements ModuleStatusProvider {
  constructor(private readonly forService: () => SupabaseClient) {}

  async modulesForScope(scope: PermissionScope): Promise<ResolvedModules> {
    const client = this.forService()
    let departmentId = scope.departmentId ?? null
    if (scope.teamId && !departmentId) {
      const team = await client.from('teams').select('department_id').eq('id', scope.teamId).eq('organization_id', scope.organizationId).maybeSingle()
      if (team.error) throw team.error
      departmentId = (team.data?.department_id as string | undefined) ?? null
    }
    const settings = await loadOrganizationModuleSettings(client, scope.organizationId)
    return resolveEnabledModules(moduleLayersFor(settings, { departmentId, teamId: scope.teamId ?? null }))
  }
}
