import { hasPermission, type Role } from '@vereinsfunk/authorization'
import {
  AppModuleSchema,
  ScopeModulesSchema,
  UpdateScopeModulesRequestSchema,
  UuidSchema,
  type ScopeLevel,
} from '@vereinsfunk/contracts'
import { appModules, resolveEnabledModules } from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { permissionScopeKey, type PermissionScope, type RoleProvider } from '../auth.js'
import { loadOrganizationModuleSettings, moduleLayersFor, ownScopeLevelValue, parseBlockingPublications, type OrganizationModuleSettings } from '../moduleStatus.js'
import { parseSupabaseData } from '../supabase.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder } from './shared.js'
import { isAnyMemberOfOrganization, POLICY_MANAGE_PERMISSION, resolveMembershipScope, resolveRolesForScopes, toPermissionScope } from '../services/scopeAuthorization.js'

/** Baut und validiert die Scope-Antwort mit eigener Auswahl, wirksamen Modulen und Schreibrecht. */
function buildScopeModules(
  settings: OrganizationModuleSettings,
  scope: ScopeLevel,
  scopeId: string,
  name: string,
  departmentId: string | null,
  canEdit: boolean,
) {
  const teamId = scope === 'team' ? scopeId : null
  const own = ownScopeLevelValue(settings, scope, scopeId)
  const { enabled, blockedBy } = resolveEnabledModules(moduleLayersFor(settings, { departmentId, teamId }))
  return ScopeModulesSchema.parse({
    scope, scopeId, name, departmentId,
    own: own ? [...own] : null,
    modules: appModules.map((module) => ({ module, enabled: enabled.includes(module), blockedBy: blockedBy[module] ?? null })),
    canEdit,
  })
}

export interface OrganizationLevel {
  scope: ScopeLevel
  scopeId: string
  name: string
  departmentId: string | null
  teamId: string | null
  /** Rollen des Anfragenden auf genau dieser Ebene (samt uebergeordneter Ebenen). */
  roles: readonly Role[]
}

const OrganizationRowSchema = z.object({ name: z.string(), slug: z.string() })
const DepartmentRowsSchema = z.array(z.object({ id: UuidSchema, name: z.string() }))
const TeamRowsSchema = z.array(z.object({ id: UuidSchema, name: z.string(), department_id: UuidSchema }))

/**
 * Alle Ebenen eines Vereins mit Namen und den Rollen des Anfragenden je Ebene -- Grundlage der
 * Uebersichten je Ebene (Module, PlayerBoard-Einstellungen). Ueber den Service-Client, weil ein
 * reines Mannschaftsmitglied Abteilungen und Mannschaften per RLS nicht sieht; die
 * Vereinsmitgliedschaft prueft der Aufrufer vorher. Archivierte Abteilungen und Mannschaften
 * gehoeren dazu: ihre Daten bleiben lesbar, und ihre Modulauswahl und Einstellungen wirken weiter.
 * Liefert null, wenn es den Verein nicht gibt.
 */
export async function loadOrganizationLevels(
  service: SupabaseClient,
  roleProvider: RoleProvider,
  auth: { userId: string; accessToken: string },
  organizationId: string,
): Promise<{ organization: z.infer<typeof OrganizationRowSchema>; levels: OrganizationLevel[] } | null> {
  const [organization, departments, teams] = await Promise.all([
    service.from('organizations').select('name, slug').eq('id', organizationId).maybeSingle(),
    service.from('departments').select('id, name').eq('organization_id', organizationId).order('name'),
    service.from('teams').select('id, name, department_id').eq('organization_id', organizationId).order('name'),
  ])
  if (organization.error) throw organization.error
  if (departments.error) throw departments.error
  if (teams.error) throw teams.error
  if (!organization.data) return null
  const organizationRow = parseSupabaseData(OrganizationRowSchema, organization.data)
  const levels: Omit<OrganizationLevel, 'roles'>[] = [
    { scope: 'organization', scopeId: organizationId, name: organizationRow.name, departmentId: null, teamId: null },
    ...parseSupabaseData(DepartmentRowsSchema, departments.data).map((department) => (
      { scope: 'department' as const, scopeId: department.id, name: department.name, departmentId: department.id, teamId: null })),
    ...parseSupabaseData(TeamRowsSchema, teams.data).map((team) => (
      { scope: 'team' as const, scopeId: team.id, name: team.name, departmentId: team.department_id, teamId: team.id })),
  ]
  const scopeOf = (level: Omit<OrganizationLevel, 'roles'>) => toPermissionScope(organizationId, level.departmentId, level.teamId)
  const rolesByScopeKey = await resolveRolesForScopes(roleProvider, auth, levels.map(scopeOf))
  return {
    organization: organizationRow,
    levels: levels.map((level) => ({ ...level, roles: rolesByScopeKey.get(permissionScopeKey(scopeOf(level))) ?? [] })),
  }
}

/** Name genau einer Ebene ueber den Service-Client; der Scope muss bereits aufgeloest sein. */
export async function loadScopeName(service: SupabaseClient, level: ScopeLevel, scope: PermissionScope): Promise<string> {
  const row = await (level === 'organization'
    ? service.from('organizations').select('name').eq('id', scope.organizationId)
    : service.from(level === 'department' ? 'departments' : 'teams').select('name').eq('organization_id', scope.organizationId)
      .eq('id', level === 'department' ? scope.departmentId! : scope.teamId!)).single()
  if (row.error) throw row.error
  return parseSupabaseData(z.object({ name: z.string() }), row.data).name
}

/**
 * Liest schema-validiertes JSON aus dem DETAIL einer RPC-Exception.
 * Liefert bei fehlendem, ungueltigem oder schemafremdem JSON undefined fuer den Fehlercode-Fallback.
 */
function parseDetail<T>(schema: z.ZodType<T>, details: string | undefined): T | undefined {
  try {
    const result = schema.safeParse(JSON.parse(details ?? ''))
    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}

/**
 * Registriert Lesen und Aendern der Modulauswahl je Ebene, auch bei deaktiviertem social_media.
 * Mitglieder lesen alle Ebenen; Schreiben erfordert POLICY_MANAGE_PERMISSION im Ziel-Scope
 * und die Freigabe der RPC. Erfolgreiche Aenderungen werden auditiert.
 */
export function registerModuleRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, roleProvider } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // Wie GET /v1/organizations/:id/policy-settings: jedes Mitglied sieht die Auswahl aller Ebenen
  // (policy_settings ist vereinsweit lesbar) und damit auch, welche Module in seinem Kontext aktiv
  // sind -- daraus baut die Oberflaeche die Navigation (PR 3).
  app.get('/v1/organizations/:id/scope-modules', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    // Service-Client fuer Vereinsname und Tarif aus demselben Grund wie in routes/policies.ts:
    // ein reiner Abteilungs- oder Mannschaftsadmin hat keine Organisationsrolle, darf seine Ebene
    // aber sehen und setzen. Schreibrechte prueft PUT separat ueber Rollen und die RPC.
    const service = supabaseClients.forService()
    const [overview, settings] = await Promise.all([
      loadOrganizationLevels(service, roleProvider, request.auth!, params.id),
      loadOrganizationModuleSettings(service, params.id),
    ])
    if (!overview) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return reply.code(200).send(overview.levels.map((level) =>
      buildScopeModules(settings, level.scope, level.scopeId, level.name, level.departmentId, hasPermission(level.roles, POLICY_MANAGE_PERMISSION[level.scope]))))
  })

  app.put('/v1/scope-modules', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UpdateScopeModulesRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // Ein reines Teammitglied kann die Teamzeile wegen der bestehenden RLS-Policy nicht ueber
    // den User-Client lesen. Die Aufloesung liefert nur den Scope-Pfad; die nachfolgende
    // Rollenpruefung und set_scope_enabled_modules() bleiben die unabhaengigen Autorisierungstore.
    const scope = await resolveMembershipScope(supabaseClients.forService(), input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return
    const rpc = await client.rpc('set_scope_enabled_modules', {
      target_organization_id: scope.organizationId,
      target_scope: input.scope,
      target_department_id: scope.departmentId ?? null,
      target_team_id: scope.teamId ?? null,
      target_modules: input.enabledModules,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('module_not_available')) {
        const modules = parseDetail(z.array(AppModuleSchema), rpc.error.details) ?? []
        return reply.code(422).send({ error: 'module_not_available', modules, correlationId: request.id })
      }
      if (rpc.error.message.includes('module_has_active_publications')) {
        const publications = parseBlockingPublications(rpc.error.details)
        return reply.code(409).send({ error: 'module_has_active_publications', publications, correlationId: request.id })
      }
      throw rpc.error
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'scope_modules.changed',
      entityType: 'policy_settings',
      entityId: (rpc.data as { id: string }).id,
      metadata: { scope: input.scope, scopeId: input.scopeId, enabledModules: input.enabledModules },
    })

    const service = supabaseClients.forService()
    const [name, settings] = await Promise.all([
      loadScopeName(service, input.scope, scope),
      loadOrganizationModuleSettings(service, scope.organizationId),
    ])
    // canEdit ist hier immer true: requirePermission oben hat genau diese Ebene bestaetigt.
    return reply.code(200).send(buildScopeModules(settings, input.scope, input.scopeId, name, scope.departmentId ?? null, true))
  })
}
