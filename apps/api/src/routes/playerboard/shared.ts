import { PlayerboardTrainingSchema } from '@vereinsfunk/contracts'
import {
  resolvePlayerboardSettings,
  type PlayerboardReplaceableField,
  type PlayerboardSettingsLevel,
  type PlayerboardStatsVisibility,
} from '@vereinsfunk/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PermissionScope } from '../../auth.js'
import type { ApiRouteContext } from '../context.js'

/**
 * Paket 052: gemeinsame Bausteine der PlayerBoard-Routen.
 *
 * Mannschaften werden ueber den Service-Client aufgeloest: teams_select_member verlangt eine
 * Abteilungsmitgliedschaft, ein Spieler (reines Mannschaftsmitglied) saehe seine eigene Mannschaft
 * sonst als "not found" (derselbe Fund wie in routes/modules.ts). Die Aufloesung liefert nur den
 * Scope-Pfad; Berechtigung pruefen requirePermission bzw. requireStatsAccess danach.
 */
export async function loadTeamScope(service: SupabaseClient, teamId: string): Promise<Required<PermissionScope> | null> {
  const team = await service.from('teams').select('organization_id, department_id').eq('id', teamId).maybeSingle()
  if (team.error) throw team.error
  if (!team.data) return null
  return { organizationId: team.data.organization_id as string, departmentId: team.data.department_id as string, teamId }
}

/**
 * Lesen der Kennzahlen einer Mannschaft: training.view ODER die wirksame stats_visibility
 * (authz.can_view_playerboard_stats). Kein requirePermission, weil ein Mitglied einer
 * Nachbarmannschaft training.view gerade nicht hat. Erst das Modul (403 module_disabled, wie
 * requirePermission), dann die Sicht (403 forbidden).
 */
export async function requireStatsAccess(
  context: ApiRouteContext,
  request: FastifyRequest,
  reply: FastifyReply,
  scope: Required<PermissionScope>,
): Promise<boolean> {
  const { enabled } = await context.moduleStatusProvider.modulesForScope(scope)
  if (!enabled.includes('playerboard')) {
    reply.code(403).send({ error: 'module_disabled', module: 'playerboard', correlationId: request.id })
    return false
  }
  const client = context.supabaseClients.forUser(request.auth!.accessToken)
  const allowed = await client.rpc('playerboard_can_view_stats', { target_team_id: scope.teamId })
  if (allowed.error) throw allowed.error
  if (allowed.data !== true) {
    reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    return false
  }
  return true
}

export const TRAINING_COLUMNS = 'id, organization_id, department_id, team_id, training_date, title, status, created_at'

/** Validiert eine Trainingszeile und die separat geladene, fuer den Nutzer sichtbare Notiz als API-Antwort. */
export function mapTrainingRow(row: Record<string, unknown>, note: string | null) {
  return PlayerboardTrainingSchema.parse({
    id: row.id, teamId: row.team_id, trainingDate: row.training_date, title: row.title ?? null,
    status: row.status, note, createdAt: row.created_at,
  })
}

// Fehler der Konsistenz-Trigger und RPCs (2026100802/2026100901) als fachliche 4xx statt 500.
const triggerErrors: Readonly<Record<string, number>> = {
  training_date_in_future: 422,
  player_not_in_training_team: 422,
  category_not_effective: 422,
  point_value_out_of_range: 422,
  invalid_entries: 400,
  playerboard_player_identity_immutable: 400,
  playerboard_training_identity_immutable: 400,
  photo_consent_invalid: 422,
  photo_consent_not_approved: 409,
  photo_upload_incomplete: 409,
  photo_size_exceeds_reservation: 409,
  invalid_upload_size: 409,
  recognizable_people_not_confirmed: 422,
  invalid_people: 400,
  photo_not_found: 404,
  training_not_found: 404,
  team_not_found: 404,
  insufficient_permission: 403,
}

/**
 * Sendet fuer bekannte Trigger-, RPC-, RLS- und Kontingentfehler eine fachliche HTTP-Fehlerantwort.
 * Liefert true bei gesendeter Antwort, sonst false zur weiteren Fehlerbehandlung durch den Aufrufer.
 */
export function sendDatabaseError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: { message?: string; code?: string; details?: string },
): boolean {
  const message = error.message ?? ''
  const known = Object.keys(triggerErrors).find((code) => message.includes(code))
  if (known) {
    const status = triggerErrors[known]!
    reply.code(status).send({ error: status === 403 ? 'forbidden' : known, correlationId: request.id })
    return true
  }
  // 42501 = RLS-Verletzung beim Schreiben: die Policy (Modul, Permission, team_categories_allowed)
  // laesst es nicht zu.
  if (error.code === '42501') {
    reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    return true
  }
  if (message.startsWith('storage_limit_reached')) {
    reply.code(409).send({ error: 'storage_limit_reached', detail: message, correlationId: request.id })
    return true
  }
  return false
}

export const SETTINGS_COLUMNS = 'scope, department_id, team_id, season_start, stats_visibility, overridable_fields, team_categories_allowed, public_sharing_allowed, public_points_enabled, public_veo_stats_enabled, public_photos_enabled, public_slug'

export interface PlayerboardSettingsRow {
  scope: 'organization' | 'department' | 'team'
  department_id: string | null
  team_id: string | null
  season_start: string | null
  stats_visibility: PlayerboardStatsVisibility | null
  overridable_fields: PlayerboardReplaceableField[]
  team_categories_allowed: boolean | null
  public_sharing_allowed: boolean | null
  public_points_enabled: boolean | null
  public_veo_stats_enabled: boolean | null
  public_photos_enabled: boolean | null
  public_slug: string | null
}

export interface OrganizationPlayerboardSettings {
  organization: PlayerboardSettingsRow | null
  departmentById: ReadonlyMap<string, PlayerboardSettingsRow>
  teamById: ReadonlyMap<string, PlayerboardSettingsRow>
}

/**
 * Alle Einstellungszeilen eines Vereins in einer Abfrage, ueber den Service-Client: die Policy
 * verlangt das aktive Modul je Zeile, die Aufrufer pruefen Modul und Mitgliedschaft vorher selbst.
 */
export async function loadOrganizationPlayerboardSettings(service: SupabaseClient, organizationId: string): Promise<OrganizationPlayerboardSettings> {
  const rows = await service.from('playerboard_settings').select(SETTINGS_COLUMNS).eq('organization_id', organizationId)
  if (rows.error) throw rows.error
  const typed = rows.data as unknown as PlayerboardSettingsRow[]
  return {
    organization: typed.find((row) => row.scope === 'organization') ?? null,
    departmentById: new Map(typed.filter((row) => row.scope === 'department').map((row) => [row.department_id!, row])),
    teamById: new Map(typed.filter((row) => row.scope === 'team').map((row) => [row.team_id!, row])),
  }
}

/** Uebertraegt vererbbare Datenbankfelder in eine Domain-Einstellungsebene; fehlende Zeilen ergeben null. */
export function toSettingsLevel(row: PlayerboardSettingsRow | null | undefined): PlayerboardSettingsLevel | null {
  if (!row) return null
  return {
    seasonStart: row.season_start, statsVisibility: row.stats_visibility, overridableFields: row.overridable_fields ?? [],
    teamCategoriesAllowed: row.team_categories_allowed, publicSharingAllowed: row.public_sharing_allowed,
  }
}

/**
 * Loest Einstellungen entlang des uebergebenen Vereins-, Abteilungs- und Mannschaftspfads auf.
 * Fuer eine Mannschaft muss der Scope auch deren Abteilungs-ID enthalten.
 */
export function resolveSettingsFor(settings: OrganizationPlayerboardSettings, scope: { departmentId?: string | null; teamId?: string | null }) {
  const target = scope.teamId ? 'team' : scope.departmentId ? 'department' : 'organization'
  return resolvePlayerboardSettings({
    organization: toSettingsLevel(settings.organization),
    department: scope.departmentId ? toSettingsLevel(settings.departmentById.get(scope.departmentId)) : null,
    team: scope.teamId ? toSettingsLevel(settings.teamById.get(scope.teamId)) : null,
  }, target)
}

/**
 * Modul aktiv im Scope? Fuer Routen ohne requirePermission (Lesen fuer alle Mitglieder).
 */
export async function requirePlayerboardModule(
  context: ApiRouteContext, request: FastifyRequest, reply: FastifyReply, scope: PermissionScope,
): Promise<boolean> {
  const { enabled } = await context.moduleStatusProvider.modulesForScope(scope)
  if (enabled.includes('playerboard')) return true
  reply.code(403).send({ error: 'module_disabled', module: 'playerboard', correlationId: request.id })
  return false
}
