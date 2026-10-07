import { hasPermission } from '@vereinsfunk/authorization'
import {
  CreatePlayerboardCategoryRequestSchema,
  PlayerboardCategorySchema,
  ScopeLevelSchema,
  UpdatePlayerboardCategoryRequestSchema,
  UuidSchema,
  type ScopeLevel,
} from '@vereinsfunk/contracts'
import { isPlayerboardCategoryEffective } from '@vereinsfunk/domain'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from '../context.js'
import { createAuditRecorder, isAnyMemberOfOrganization, resolveMembershipScope } from '../shared.js'
import { loadOrganizationPlayerboardSettings, requirePlayerboardModule, resolveSettingsFor, sendDatabaseError } from './shared.js'

const CATEGORY_COLUMNS = 'id, organization_id, scope, department_id, team_id, name, active, sort_order, value_min, value_max'
type CategoryRow = {
  id: string; organization_id: string; scope: ScopeLevel; department_id: string | null; team_id: string | null
  name: string; active: boolean; sort_order: number; value_min: number; value_max: number
}

/** Liefert die ID der Vereins-, Abteilungs- oder Mannschaftsebene einer Kategorie. */
function scopeIdOf(row: CategoryRow): string {
  return row.scope === 'organization' ? row.organization_id : row.scope === 'department' ? row.department_id! : row.team_id!
}

/** Registriert das Lesen eigener und geerbter Kategorien sowie deren berechtigungsgepruefte Pflege. */
export function registerPlayerboardCategoryRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, roleProvider } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // Kategorien auf dem Pfad einer Ebene (Verein, Abteilung, Mannschaft): eigene und geerbte.
  // Vereinsweit lesbar wie die Tabelle selbst; bei einer Mannschaft mit "wirksam" je Kategorie.
  app.get('/v1/playerboard/categories', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ scope: ScopeLevelSchema, scopeId: UuidSchema }).parse(request.query)
    const service = supabaseClients.forService()
    const scope = await resolveMembershipScope(service, query.scope, query.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await isAnyMemberOfOrganization(supabaseClients.forUser(request.auth!.accessToken), request.auth!.userId, scope.organizationId))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    if (!(await requirePlayerboardModule(context, request, reply, scope))) return

    let builder = service.from('playerboard_point_categories').select(CATEGORY_COLUMNS).eq('organization_id', scope.organizationId)
    const onPath = ['scope.eq.organization']
    if (scope.departmentId) onPath.push(`and(scope.eq.department,department_id.eq.${scope.departmentId})`)
    if (scope.teamId) onPath.push(`and(scope.eq.team,team_id.eq.${scope.teamId})`)
    builder = builder.or(onPath.join(','))
    const rows = await builder.order('sort_order').order('name')
    if (rows.error) throw rows.error

    const teamCategoriesAllowed = scope.teamId
      ? resolveSettingsFor(await loadOrganizationPlayerboardSettings(service, scope.organizationId), scope).teamCategoriesAllowed
      : true
    const canManageHere = hasPermission(await roleProvider.rolesForScope(request.auth!, scope), 'playerboard.manage')
    const levelRank: Record<ScopeLevel, number> = { organization: 0, department: 1, team: 2 }
    const categories = (rows.data as unknown as CategoryRow[])
      .sort((a, b) => levelRank[a.scope] - levelRank[b.scope] || a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((row) => {
        const inherited = row.scope !== query.scope
        const effective = scope.teamId
          ? isPlayerboardCategoryEffective({ scope: row.scope, departmentId: row.department_id, teamId: row.team_id, active: row.active },
            { departmentId: scope.departmentId!, teamId: scope.teamId }, teamCategoriesAllowed)
          : row.active
        return PlayerboardCategorySchema.parse({
          id: row.id, scope: row.scope, scopeId: scopeIdOf(row), name: row.name, active: row.active, sortOrder: row.sort_order,
          valueMin: row.value_min, valueMax: row.value_max, effective, inherited, canEdit: !inherited && canManageHere,
        })
      })
    return reply.code(200).send(categories)
  })

  app.post('/v1/playerboard/categories', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreatePlayerboardCategoryRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const scope = await resolveMembershipScope(service, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'playerboard.manage', scope))) return
    if (scope.teamId && !resolveSettingsFor(await loadOrganizationPlayerboardSettings(service, scope.organizationId), scope).teamCategoriesAllowed) {
      return reply.code(409).send({ error: 'team_categories_not_allowed', correlationId: request.id })
    }
    const insert = await supabaseClients.forUser(request.auth!.accessToken).from('playerboard_point_categories').insert({
      organization_id: scope.organizationId, scope: input.scope, department_id: scope.departmentId ?? null, team_id: scope.teamId ?? null,
      name: input.name, sort_order: input.sortOrder ?? 0, value_min: input.valueMin, value_max: input.valueMax,
    }).select(CATEGORY_COLUMNS).single()
    if (insert.error) {
      if (sendDatabaseError(request, reply, insert.error)) return
      throw insert.error
    }
    const row = insert.data as unknown as CategoryRow
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'playerboard_category.created', entityType: 'playerboard_point_categories', entityId: row.id,
      metadata: { scope: input.scope, scopeId: input.scopeId, name: input.name },
    })
    return reply.code(201).send(PlayerboardCategorySchema.parse({
      id: row.id, scope: row.scope, scopeId: scopeIdOf(row), name: row.name, active: row.active, sortOrder: row.sort_order,
      valueMin: row.value_min, valueMax: row.value_max, effective: row.active, inherited: false, canEdit: true,
    }))
  })

  /**
   * Laedt Kategorie und Berechtigungsscope per Service-Client; liefert null bei fehlender Kategorie.
   * Die aufrufende Route prueft anschliessend die Schreibberechtigung.
   */
  async function loadCategoryScope(categoryId: string) {
    const row = await supabaseClients.forService().from('playerboard_point_categories').select(CATEGORY_COLUMNS).eq('id', categoryId).maybeSingle()
    if (row.error) throw row.error
    if (!row.data) return null
    const category = row.data as unknown as CategoryRow
    return {
      category,
      scope: { organizationId: category.organization_id, ...(category.department_id ? { departmentId: category.department_id } : {}), ...(category.team_id ? { teamId: category.team_id } : {}) },
    }
  }

  app.patch('/v1/playerboard/categories/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdatePlayerboardCategoryRequestSchema.parse(request.body)
    const loaded = await loadCategoryScope(params.id)
    if (!loaded) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'playerboard.manage', loaded.scope))) return
    const nextMin = input.valueMin ?? loaded.category.value_min
    const nextMax = input.valueMax ?? loaded.category.value_max
    if (nextMin >= nextMax) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
    const update: Record<string, unknown> = {}
    if (input.name !== undefined) update.name = input.name
    if (input.active !== undefined) update.active = input.active
    if (input.sortOrder !== undefined) update.sort_order = input.sortOrder
    if (input.valueMin !== undefined) update.value_min = input.valueMin
    if (input.valueMax !== undefined) update.value_max = input.valueMax
    const result = await supabaseClients.forUser(request.auth!.accessToken).from('playerboard_point_categories').update(update).eq('id', params.id).select(CATEGORY_COLUMNS)
    if (result.error) {
      if (sendDatabaseError(request, reply, result.error)) return
      throw result.error
    }
    if (result.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const row = result.data[0] as unknown as CategoryRow
    await recordAuditEvent(request, {
      organizationId: row.organization_id, action: 'playerboard_category.updated', entityType: 'playerboard_point_categories', entityId: row.id,
      metadata: { fields: Object.keys(update) },
    })
    return reply.code(200).send(PlayerboardCategorySchema.parse({
      id: row.id, scope: row.scope, scopeId: scopeIdOf(row), name: row.name, active: row.active, sortOrder: row.sort_order,
      valueMin: row.value_min, valueMax: row.value_max, effective: row.active, inherited: false, canEdit: true,
    }))
  })

  // Loeschen nur ohne Punkte (Fremdschluessel "on delete restrict"); sonst deaktivieren.
  app.delete('/v1/playerboard/categories/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const loaded = await loadCategoryScope(params.id)
    if (!loaded) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'playerboard.manage', loaded.scope))) return
    const result = await supabaseClients.forUser(request.auth!.accessToken).from('playerboard_point_categories').delete().eq('id', params.id).select('id')
    if (result.error) {
      if (result.error.code === '23503') return reply.code(409).send({ error: 'category_in_use', correlationId: request.id })
      throw result.error
    }
    if (result.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: loaded.category.organization_id, action: 'playerboard_category.deleted', entityType: 'playerboard_point_categories', entityId: params.id,
    })
    return reply.code(204).send()
  })
}
