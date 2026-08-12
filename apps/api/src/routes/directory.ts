import {
  CreateDirectoryPersonRequestSchema,
  DirectoryPersonGuardianContactSchema,
  DirectoryPersonStatusSchema,
  ProfileSchema,
  UpdateDirectoryPersonRequestSchema,
  UpdateProfileRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { deriveIsMinor } from '@vereinsfunk/member-directory'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { DIRECTORY_PERSON_COLUMNS, mapDirectoryPersonRow } from '../apiMappers.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, fetchAllRows, isAnyMemberOfOrganization, resolveDirectoryScope, toPermissionScope } from './shared.js'

/**
 * `isMinor` aus der Anfrage darf den Schutz nur anheben, nie senken. Ohne diese Klammer koennte
 * ein Aufrufer eine Person mit Geburtsjahr 2015 als `isMinor: false` anlegen und damit sowohl den
 * CHECK auf einen Elternkontakt als auch die strengere Freigaberoute umgehen -- derselbe
 * wiederkehrende Fund wie bei den security-definer-RPCs aus 011/012: sicherheitsrelevante Werte
 * leitet der Server selbst her, statt sie vom Aufrufer zu uebernehmen. Ohne bekanntes Geburtsjahr
 * gibt es nichts herzuleiten, dann zaehlt die Angabe.
 */
function resolveIsMinor(requested: boolean | undefined, birthYear: number | null, referenceYear: number): boolean {
  const derived = birthYear != null ? deriveIsMinor(birthYear, referenceYear) : false
  return derived || (requested ?? false)
}

export function registerDirectoryRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // --- Paket 014: Mitgliederverzeichnis ------------------------------------------------------

  app.get('/v1/organizations/:id/directory-people', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z
      .object({
        departmentId: UuidSchema.optional(), teamId: UuidSchema.optional(), status: DirectoryPersonStatusSchema.optional(),
        // z.stringbool() statt z.coerce.boolean(): letzteres ist Boolean(value), und damit ist
        // jeder nicht-leere String wahr -- '?isMinor=false' haette genau die Minderjaehrigen
        // geliefert, die es ausschliessen sollte.
        isMinor: z.stringbool().optional(), missingGuardian: z.stringbool().optional(),
      })
      .parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    let builder = client
      .from('directory_people')
      .select(DIRECTORY_PERSON_COLUMNS)
      .eq('organization_id', params.id)
    if (query.departmentId) builder = builder.eq('department_id', query.departmentId)
    if (query.teamId) builder = builder.eq('team_id', query.teamId)
    if (query.status) builder = builder.eq('status', query.status)
    if (query.isMinor !== undefined) builder = builder.eq('is_minor', query.isMinor)
    const rows = await builder.order('last_name').order('first_name')
    if (rows.error) throw rows.error
    let visible = rows.data
    if (query.missingGuardian) {
      // guardian_email ist fuer authenticated nicht selektierbar (Spaltenrechte, Migration
      // 2026080703) -- der Filter braucht deshalb die Service Role. Gefiltert wird aber erst
      // NACH der sichtbarkeitsbeschraenkten Abfrage, auf deren Ergebnis: die IDs gehen nie als
      // Query-String in eine zweite Abfrage (`.in('id', …)` mit einer unbegrenzten Liste
      // scheiterte ab einigen hundert Personen an der URL-Laenge und wurde zusaetzlich von
      // PostgREST' max_rows stillschweigend gekappt).
      const missing = await fetchAllRows<{ id: string }>((from, to) =>
        supabaseClients.forService().from('directory_people').select('id').eq('organization_id', params.id).is('guardian_email', null).range(from, to),
      )
      const missingIds = new Set(missing.map((row) => row.id))
      visible = visible.filter((row) => missingIds.has(row.id as string))
    }
    return reply.code(200).send(visible.map(mapDirectoryPersonRow))
  })

  app.post('/v1/organizations/:id/directory-people', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateDirectoryPersonRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveDirectoryScope(client, params.id, input.departmentId ?? null, input.teamId ?? null)
    if (scope === null) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'directory.read', scope))) return
    const touchesGuardianContact = input.guardianName !== undefined || input.guardianEmail !== undefined
    if (touchesGuardianContact && !(await requirePermission(request, reply, 'department.manage', scope))) return
    if (input.profileId && !(await isAnyMemberOfOrganization(client, input.profileId, params.id))) {
      return reply.code(400).send({ error: 'profile_not_a_member', correlationId: request.id })
    }
    const referenceYear = new Date().getFullYear()
    const isMinor = resolveIsMinor(input.isMinor, input.birthYear ?? null, referenceYear)
    const status = input.status ?? 'active'
    const insert = await supabaseClients
      .forService()
      .from('directory_people')
      .insert({
        organization_id: params.id, department_id: input.departmentId ?? null, team_id: input.teamId ?? null,
        first_name: input.firstName, last_name: input.lastName, birth_year: input.birthYear ?? null,
        is_minor: isMinor, status, joined_at: input.joinedAt ?? null,
        guardian_name: input.guardianName ?? null, guardian_email: input.guardianEmail ?? null, profile_id: input.profileId ?? null,
      })
      .select(DIRECTORY_PERSON_COLUMNS)
      .single()
    if (insert.error) {
      if (insert.error.code === '23514') return reply.code(400).send({ error: 'guardian_contact_required', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, {
      organizationId: params.id, action: 'directory_person.created', entityType: 'directory_people', entityId: insert.data.id as string,
      metadata: { departmentId: input.departmentId ?? null, teamId: input.teamId ?? null },
    })
    return reply.code(201).send(mapDirectoryPersonRow(insert.data))
  })

  app.patch('/v1/directory-people/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateDirectoryPersonRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('directory_people').select('organization_id, department_id, team_id, birth_year').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const currentScope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, 'directory.read', currentScope))) return

    let targetScope = currentScope
    if (input.departmentId !== undefined || input.teamId !== undefined) {
      const targetDepartmentId = input.departmentId !== undefined ? input.departmentId : (existing.data.department_id as string | null)
      const targetTeamId = input.teamId !== undefined ? input.teamId : (existing.data.team_id as string | null)
      const resolved = await resolveDirectoryScope(client, existing.data.organization_id as string, targetDepartmentId, targetTeamId)
      if (resolved === null) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      if (!(await requirePermission(request, reply, 'directory.read', resolved))) return
      targetScope = resolved
    }
    const touchesGuardianContact = input.guardianName !== undefined || input.guardianEmail !== undefined
    if (touchesGuardianContact) {
      if (!(await requirePermission(request, reply, 'department.manage', currentScope))) return
      if (targetScope !== currentScope && !(await requirePermission(request, reply, 'department.manage', targetScope))) return
    }
    if (input.profileId && !(await isAnyMemberOfOrganization(client, input.profileId, existing.data.organization_id as string))) {
      return reply.code(400).send({ error: 'profile_not_a_member', correlationId: request.id })
    }

    const referenceYear = new Date().getFullYear()
    const update: Record<string, unknown> = {}
    if (input.firstName !== undefined) update.first_name = input.firstName
    if (input.lastName !== undefined) update.last_name = input.lastName
    if (input.departmentId !== undefined) update.department_id = input.departmentId
    if (input.teamId !== undefined) update.team_id = input.teamId
    if (input.birthYear !== undefined) update.birth_year = input.birthYear
    if (input.status !== undefined) update.status = input.status
    if (input.leftAt !== undefined) update.left_at = input.leftAt
    if (input.joinedAt !== undefined) update.joined_at = input.joinedAt
    if (input.guardianName !== undefined) update.guardian_name = input.guardianName
    if (input.guardianEmail !== undefined) update.guardian_email = input.guardianEmail
    if (input.profileId !== undefined) update.profile_id = input.profileId
    // Massgeblich ist das Geburtsjahr nach dieser Aenderung, nicht die Angabe des Aufrufers --
    // siehe resolveIsMinor. Bleibt das Geburtsjahr unberuehrt, zaehlt das gespeicherte.
    const effectiveBirthYear = input.birthYear !== undefined ? input.birthYear : (existing.data.birth_year as number | null)
    if (input.isMinor !== undefined || input.birthYear !== undefined) {
      update.is_minor = resolveIsMinor(input.isMinor, effectiveBirthYear, referenceYear)
    }

    // createPeopleMatchStrategy.localUpdatedAtOf (packages/member-directory) vergleicht
    // source_updated_at, nicht updated_at -- sonst wuerde ein frischer Sync-Lauf (der
    // updated_at ueber den generischen Trigger ebenfalls anhebt) faelschlich als "lokal neuer"
    // gelten, obwohl nur die Quelle selbst geschrieben hat. Eine manuelle Aenderung an einem der
    // von planSync verglichenen Felder muss deshalb selbst source_updated_at auf jetzt setzen,
    // sonst gewinnt beim naechsten Sync-Lauf stillschweigend wieder die (aeltere) Quelle gegen die
    // gerade erst korrigierten Daten (beim adversarialen Review gefunden).
    const touchesSyncedField = ['first_name', 'last_name', 'birth_year', 'department_id', 'team_id', 'status'].some((field) => field in update)
    if (touchesSyncedField) update.source_updated_at = new Date().toISOString()

    const result = await supabaseClients
      .forService()
      .from('directory_people')
      .update(update)
      .eq('id', params.id)
      .select(DIRECTORY_PERSON_COLUMNS)
      .maybeSingle()
    if (result.error) {
      if (result.error.code === '23514') return reply.code(400).send({ error: 'guardian_contact_required', correlationId: request.id })
      throw result.error
    }
    if (!result.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: existing.data.organization_id as string, action: 'directory_person.updated', entityType: 'directory_people', entityId: params.id, metadata: { fields: Object.keys(update) },
    })
    return reply.code(200).send(mapDirectoryPersonRow(result.data))
  })

  app.get('/v1/directory-people/:id/guardian-contact', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('directory_people').select('organization_id, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, 'department.manage', scope))) return
    const guardian = await supabaseClients.forService().from('directory_people').select('guardian_name, guardian_email').eq('id', params.id).single()
    if (guardian.error) throw guardian.error
    await recordAuditEvent(request, { organizationId: scope.organizationId, action: 'directory_person.guardian_read', entityType: 'directory_people', entityId: params.id })
    return reply.code(200).send(DirectoryPersonGuardianContactSchema.parse({ guardianName: guardian.data.guardian_name, guardianEmail: guardian.data.guardian_email }))
  })

  // --- Paket 014: eigenes Profil (Selbstbedienung, keine Vereinsdaten) -----------------------

  app.get('/v1/me/profile', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const profile = await client.from('profiles').select('id, display_name, avatar_path').eq('id', request.auth!.userId).single()
    if (profile.error) throw profile.error
    return reply.code(200).send(ProfileSchema.parse({ id: profile.data.id, displayName: profile.data.display_name, avatarPath: profile.data.avatar_path }))
  })

  app.patch('/v1/me/profile', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UpdateProfileRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const update: Record<string, unknown> = {}
    if (input.displayName !== undefined) update.display_name = input.displayName
    const result = await client.from('profiles').update(update).eq('id', request.auth!.userId).select('id, display_name, avatar_path').single()
    if (result.error) throw result.error
    return reply.code(200).send(ProfileSchema.parse({ id: result.data.id, displayName: result.data.display_name, avatarPath: result.data.avatar_path }))
  })
}
