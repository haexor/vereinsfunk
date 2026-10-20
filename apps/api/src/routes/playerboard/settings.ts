import { hasPermission } from '@vereinsfunk/authorization'
import {
  ScopePlayerboardSettingsSchema,
  UpdatePlayerboardSettingsRequestSchema,
  UuidSchema,
  type ScopeLevel,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ownScopeLevelValue } from '../../moduleStatus.js'
import type { ApiRouteContext } from '../context.js'
import { loadOrganizationLevels, loadScopeName } from '../modules.js'
import { createAuditRecorder, isAnyMemberOfOrganization, resolveMembershipScope } from '../shared.js'
import {
  loadOrganizationPlayerboardSettings,
  requirePlayerboardModule,
  resolveSettingsFor,
  sendDatabaseError,
  type OrganizationPlayerboardSettings,
} from './shared.js'

/** Validiert eigene, wirksame und gesperrte Einstellungen einer Ebene samt uebergebenem Bearbeitungsrecht. */
function buildEntry(
  settings: OrganizationPlayerboardSettings,
  scope: ScopeLevel,
  scopeId: string,
  name: string,
  departmentId: string | null,
  canEdit: boolean,
  organizationSlug: string,
) {
  const teamId = scope === 'team' ? scopeId : null
  const own = ownScopeLevelValue(settings, scope, scopeId)
  const resolved = resolveSettingsFor(settings, { departmentId, teamId })
  return ScopePlayerboardSettingsSchema.parse({
    scope, scopeId, name, departmentId,
    own: {
      seasonStart: own?.season_start ?? null,
      statsVisibility: own?.stats_visibility ?? null,
      overridableFields: own?.overridable_fields ?? [],
      teamCategoriesAllowed: own?.team_categories_allowed ?? null,
      publicSharingAllowed: own?.public_sharing_allowed ?? null,
      publicPointsEnabled: own?.public_points_enabled ?? null,
      publicVeoStatsEnabled: own?.public_veo_stats_enabled ?? null,
      publicPhotosEnabled: own?.public_photos_enabled ?? null,
      publicSlug: own?.public_slug ?? null,
    },
    effective: {
      seasonStart: resolved.seasonStart, statsVisibility: resolved.statsVisibility,
      teamCategoriesAllowed: resolved.teamCategoriesAllowed, publicSharingAllowed: resolved.publicSharingAllowed,
    },
    locked: resolved.locked,
    canEdit,
    publicPath: scope === 'team' && own?.public_slug ? `/mannschaft/${organizationSlug}/${own.public_slug}` : null,
  })
}

const patchColumns: Readonly<Record<string, string>> = {
  seasonStart: 'season_start',
  statsVisibility: 'stats_visibility',
  overridableFields: 'overridable_fields',
  teamCategoriesAllowed: 'team_categories_allowed',
  publicSharingAllowed: 'public_sharing_allowed',
  publicPointsEnabled: 'public_points_enabled',
  publicVeoStatsEnabled: 'public_veo_stats_enabled',
  publicPhotosEnabled: 'public_photos_enabled',
  publicSlug: 'public_slug',
}

/**
 * Paket 052: vererbbare PlayerBoard-Einstellungen je Ebene, Muster GET .../scope-modules.
 */
export function registerPlayerboardSettingsRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, roleProvider } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.get('/v1/organizations/:id/playerboard/settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await isAnyMemberOfOrganization(supabaseClients.forUser(request.auth!.accessToken), request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    if (!(await requirePlayerboardModule(context, request, reply, { organizationId: params.id }))) return
    // Service-Client fuer Struktur und Einstellungen aus demselben Grund wie in routes/modules.ts:
    // ein reines Mannschaftsmitglied sieht Abteilungen und Mannschaften per RLS nicht.
    const service = supabaseClients.forService()
    const [overview, settings] = await Promise.all([
      loadOrganizationLevels(service, roleProvider, request.auth!, params.id),
      loadOrganizationPlayerboardSettings(service, params.id),
    ])
    if (!overview) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return reply.code(200).send(overview.levels.map((level) =>
      buildEntry(settings, level.scope, level.scopeId, level.name, level.departmentId, hasPermission(level.roles, 'playerboard.manage'), overview.organization.slug)))
  })

  app.put('/v1/playerboard/settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UpdatePlayerboardSettingsRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const scope = await resolveMembershipScope(service, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'playerboard.manage', scope))) return

    const values: Record<string, unknown> = { updated_by: request.auth!.userId }
    for (const [field, column] of Object.entries(patchColumns)) {
      const value = input.patch[field as keyof typeof input.patch]
      if (value !== undefined) values[column] = value
    }
    // Die Zeile einer Ebene ist eindeutig (Unique-Indizes je Ebene). Suchen ueber den Service-Client,
    // schreiben mit dem Nutzer-Client, damit die Policy (playerboard.manage auf genau dieser Ebene)
    // als zweite Pruefung greift.
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const writeLevelRow = async () => {
      let existingQuery = service.from('playerboard_settings').select('id').eq('organization_id', scope.organizationId).eq('scope', input.scope)
      existingQuery = scope.teamId ? existingQuery.eq('team_id', scope.teamId)
        : scope.departmentId ? existingQuery.eq('department_id', scope.departmentId)
          : existingQuery
      const existing = await existingQuery.maybeSingle()
      if (existing.error) throw existing.error
      return existing.data
        ? await client.from('playerboard_settings').update(values).eq('id', existing.data.id as string).select('id')
        : await client.from('playerboard_settings').insert({
            organization_id: scope.organizationId, scope: input.scope, department_id: scope.departmentId ?? null, team_id: scope.teamId ?? null, ...values,
          }).select('id')
    }
    // 23505 kommt vom Slug (playerboard_settings_organization_id_public_slug_key) oder vom
    // Unique-Index der Ebene. Letzteres heisst: eine gleichzeitige erste Speicherung hat die Zeile
    // eben angelegt -- dann in diese schreiben, statt faelschlich "Slug vergeben" zu melden.
    const isSlugConflict = (error: { code?: string; message?: string }) => error.code === '23505' && (error.message ?? '').includes('public_slug')
    let write = await writeLevelRow()
    if (write.error?.code === '23505' && !isSlugConflict(write.error)) write = await writeLevelRow()
    if (write.error) {
      if (isSlugConflict(write.error)) return reply.code(409).send({ error: 'public_slug_taken', correlationId: request.id })
      if (sendDatabaseError(request, reply, write.error)) return
      throw write.error
    }
    if (write.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'playerboard_settings.changed', entityType: 'playerboard_settings', entityId: write.data[0]!.id as string,
      metadata: { scope: input.scope, scopeId: input.scopeId, patch: input.patch },
    })

    const [organization, name, settings] = await Promise.all([
      service.from('organizations').select('slug').eq('id', scope.organizationId).single(),
      loadScopeName(service, input.scope, scope),
      loadOrganizationPlayerboardSettings(service, scope.organizationId),
    ])
    if (organization.error) throw organization.error
    return reply.code(200).send(buildEntry(settings, input.scope, input.scopeId, name, scope.departmentId ?? null, true, organization.data.slug as string))
  })
}
