import { hasPermission } from '@vereinsfunk/authorization'
import {
  AppModuleSchema,
  ScopeModulesSchema,
  UpdateScopeModulesRequestSchema,
  UuidSchema,
  type ScopeLevel,
} from '@vereinsfunk/contracts'
import { appModules, resolveEnabledModules, type AppModule } from '@vereinsfunk/domain'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { permissionScopeKey } from '../auth.js'
import { loadOrganizationModuleSettings, moduleLayersFor, parseBlockingPublications, type OrganizationModuleSettings } from '../moduleStatus.js'
import type { ApiRouteContext } from './context.js'
import {
  createAuditRecorder,
  isAnyMemberOfOrganization,
  POLICY_MANAGE_PERMISSION,
  resolveMembershipScope,
  resolveRolesForScopes,
  toPermissionScope,
} from './shared.js'

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
  const own: readonly AppModule[] | null =
    scope === 'organization' ? settings.organization
      : scope === 'department' ? (settings.departmentById.get(scopeId) ?? null)
        : (settings.teamById.get(scopeId) ?? null)
  const { enabled, blockedBy } = resolveEnabledModules(moduleLayersFor(settings, { departmentId, teamId }))
  return ScopeModulesSchema.parse({
    scope, scopeId, name, departmentId,
    own: own ? [...own] : null,
    modules: appModules.map((module) => ({ module, enabled: enabled.includes(module), blockedBy: blockedBy[module] ?? null })),
    canEdit,
  })
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
    // aber sehen und setzen.
    const service = supabaseClients.forService()
    const organization = await service.from('organizations').select('name').eq('id', params.id).maybeSingle()
    if (organization.error) throw organization.error
    if (!organization.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const [departments, teams, settings] = await Promise.all([
      // Die RLS-Policies fuer departments/teams erlauben einem reinen Teammitglied keinen
      // Struktur-Select (sie pruefen die Abteilungsmitgliedschaft). Der Endpunkt ist aber
      // vereinsweit lesbar und soll auch fuer diese Mitglieder alle Ebenen samt effektivem
      // Modulstatus liefern. Die Vereinsmitgliedschaft ist oben bereits mit dem User-Client
      // bestaetigt; Schreibrechte werden weiter unten separat ueber Rollen und die RPC geprueft.
      service.from('departments').select('id, name').eq('organization_id', params.id).order('name'),
      service.from('teams').select('id, name, department_id').eq('organization_id', params.id).order('name'),
      loadOrganizationModuleSettings(service, params.id),
    ])
    if (departments.error) throw departments.error
    if (teams.error) throw teams.error

    const scopes = [
      toPermissionScope(params.id),
      ...departments.data.map((department) => toPermissionScope(params.id, department.id as string)),
      ...teams.data.map((team) => toPermissionScope(params.id, team.department_id as string, team.id as string)),
    ]
    const rolesByScopeKey = await resolveRolesForScopes(roleProvider, request.auth!, scopes)
    /** Prueft das Verwaltungsrecht einer Ebene anhand der bereits geladenen Scope-Rollen. */
    const canEditFor = (scope: ScopeLevel, departmentId: string | null, teamId: string | null) =>
      hasPermission(rolesByScopeKey.get(permissionScopeKey(toPermissionScope(params.id, departmentId, teamId))) ?? [], POLICY_MANAGE_PERMISSION[scope])

    return reply.code(200).send([
      buildScopeModules(settings, 'organization', params.id, organization.data.name as string, null, canEditFor('organization', null, null)),
      ...departments.data.map((department) =>
        buildScopeModules(settings, 'department', department.id as string, department.name as string, department.id as string, canEditFor('department', department.id as string, null)),
      ),
      ...teams.data.map((team) =>
        buildScopeModules(settings, 'team', team.id as string, team.name as string, team.department_id as string, canEditFor('team', team.department_id as string, team.id as string)),
      ),
    ])
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
    const nameQuery =
      input.scope === 'organization'
        ? await service.from('organizations').select('name').eq('id', scope.organizationId).single()
        : input.scope === 'department'
          ? await service.from('departments').select('name').eq('id', scope.departmentId!).single()
          : await service.from('teams').select('name').eq('id', scope.teamId!).single()
    if (nameQuery.error) throw nameQuery.error
    const settings = await loadOrganizationModuleSettings(service, scope.organizationId)
    // canEdit ist hier immer true: requirePermission oben hat genau diese Ebene bestaetigt.
    return reply.code(200).send(
      buildScopeModules(settings, input.scope, input.scopeId, nameQuery.data.name as string, scope.departmentId ?? null, true),
    )
  })
}
