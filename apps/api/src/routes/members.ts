import {
  AcceptInvitationRequestSchema,
  AcceptInvitationResponseSchema,
  CreateInvitationRequestSchema,
  CreateMembershipRequestSchema,
  InvitationSchema,
  MemberRoleEntrySchema,
  MemberSchema,
  rolesForScopeLevel,
  ScopeLevelSchema,
  UpdateMembershipExpiryRequestSchema,
  UpdateMembershipRequestSchema,
  UuidSchema,
  type ScopeLevel,
} from '@vereinsfunk/contracts'
import { canAssignRole, canRemoveRole, hasPermission, type Role } from '@vereinsfunk/authorization'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapInvitationRow, membershipTableFor } from '../apiMappers.js'
import { buildInvitationEmail, generateInvitationToken } from '../invitations.js'
import type { PermissionScope } from '../auth.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, fetchAllRows, resolveMembershipScope, toPermissionScope } from './shared.js'

// POST /v1/invitations nimmt organizationId/departmentId/teamId direkt vom Client entgegen.
// Ungeprueft wuerde requirePermission auf einer Scope-Kette pruefen, die client-seitig frei
// kombinierbar ist (z. B. eine fremde organizationId zusammen mit der eigenen departmentId) --
// beim Mandantentrennung-Review gefunden, dort nur zufaellig durch den FK-Constraint auf
// invitations abgefangen. Hier wird departmentId/teamId serverseitig gegen ihre echte
// organization_id/department_id verifiziert, bevor irgendeine Berechtigung geprueft wird.
async function resolveInvitationScope(
  client: SupabaseClient,
  input: { organizationId: string; departmentId?: string | null | undefined; teamId?: string | null | undefined },
): Promise<{ scope: PermissionScope; scopeName: string } | null> {
  if (input.teamId) {
    const team = await client.from('teams').select('organization_id, department_id, name').eq('id', input.teamId).maybeSingle()
    if (team.error) throw team.error
    if (!team.data || team.data.organization_id !== input.organizationId || team.data.department_id !== input.departmentId) return null
    return {
      scope: { organizationId: team.data.organization_id as string, departmentId: team.data.department_id as string, teamId: input.teamId },
      scopeName: team.data.name as string,
    }
  }
  if (input.departmentId) {
    const department = await client.from('departments').select('organization_id, name').eq('id', input.departmentId).maybeSingle()
    if (department.error) throw department.error
    if (!department.data || department.data.organization_id !== input.organizationId) return null
    return { scope: { organizationId: department.data.organization_id as string, departmentId: input.departmentId }, scopeName: department.data.name as string }
  }
  return { scope: { organizationId: input.organizationId }, scopeName: '' }
}

// Fuer Routen, die den Scope bereits aus einer vertrauenswuerdigen Quelle kennen (z. B. der
// invitations-Zeile selbst bei /resend) -- reine Namensauskunft, keine erneute Verifikation.
async function resolveScopeName(client: SupabaseClient, scope: PermissionScope, organizationName: string): Promise<string> {
  if (scope.teamId) {
    const team = await client.from('teams').select('name').eq('id', scope.teamId).single()
    if (team.error) throw team.error
    return team.data.name as string
  }
  if (scope.departmentId) {
    const department = await client.from('departments').select('name').eq('id', scope.departmentId).single()
    if (department.error) throw department.error
    return department.data.name as string
  }
  return organizationName
}

export function registerMemberRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, roleProvider, emailSender, environment } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.get('/v1/organizations/:id/members', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const [orgRows, deptRows, teamRows] = await Promise.all([
      fetchAllRows<{ id: string; user_id: string; role: string; expires_at: string | null }>((from, to) =>
        client.from('organization_memberships').select('id, user_id, role, expires_at').eq('organization_id', params.id).order('id', { ascending: true }).range(from, to),
      ),
      fetchAllRows<{ id: string; user_id: string; role: string; expires_at: string | null; department_id: string }>((from, to) =>
        client.from('department_memberships').select('id, user_id, role, expires_at, department_id').eq('organization_id', params.id).order('id', { ascending: true }).range(from, to),
      ),
      fetchAllRows<{ id: string; user_id: string; role: string; expires_at: string | null; team_id: string; department_id: string }>((from, to) =>
        client.from('team_memberships').select('id, user_id, role, expires_at, team_id, department_id').eq('organization_id', params.id).order('id', { ascending: true }).range(from, to),
      ),
    ])

    const userIds = new Set<string>()
    for (const row of [...orgRows, ...deptRows, ...teamRows]) userIds.add(row.user_id)
    // Ein einzelnes .in() mit allen Nutzer-IDs waere doppelt begrenzt: max_rows=1000 kappt die
    // Antwort (derselbe Grund wie bei fetchAllRows oben), und die IDs stehen als Query-String in
    // der URL, die schon bei einigen hundert UUIDs die Header-Grenze des Gateways reisst. Ohne
    // Bloecke fielen betroffene Mitglieder still auf "Unbekannt" zurueck.
    const allUserIds = Array.from(userIds)
    const displayNameById = new Map<string, string>()
    for (let offset = 0; offset < allUserIds.length; offset += 100) {
      const profiles = await client.from('profiles').select('id, display_name').in('id', allUserIds.slice(offset, offset + 100))
      if (profiles.error) throw profiles.error
      for (const row of profiles.data) displayNameById.set(row.id as string, row.display_name as string)
    }

    // Capability-Felder (Paket 023): fuer jede eindeutige Ebene in dieser Antwort einmal die
    // Rollen DES ANFRAGENDEN nachschlagen (nicht die des jeweiligen Mitglieds), dann daraus fuer
    // jede Zeile ableiten, ob er sie aendern/entfernen/befristen darf -- dieselben Funktionen, die
    // PATCH/DELETE /v1/memberships selbst durchsetzen. Eine Ebene wird dabei nur einmal
    // nachgeschlagen, auch wenn mehrere Mitglieder ihr angehoeren.
    const rolesByScopeKey = new Map<string, readonly Role[]>()
    rolesByScopeKey.set('organization', await roleProvider.rolesForScope(request.auth!, { organizationId: params.id }))
    const uniqueDepartmentIds = new Set(deptRows.map((row) => row.department_id))
    const uniqueTeams = new Map(teamRows.map((row) => [row.team_id, row.department_id]))
    await Promise.all([
      ...Array.from(uniqueDepartmentIds).map(async (departmentId) => {
        rolesByScopeKey.set(`department:${departmentId}`, await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId }))
      }),
      ...Array.from(uniqueTeams.entries()).map(async ([teamId, departmentId]) => {
        rolesByScopeKey.set(`team:${teamId}`, await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId, teamId }))
      }),
    ])
    function capabilitiesFor(scope: ScopeLevel, scopeId: string, role: string) {
      const actorRoles = rolesByScopeKey.get(scope === 'organization' ? 'organization' : `${scope}:${scopeId}`) ?? []
      const canRemoveTarget = canRemoveRole(actorRoles, role as Role)
      return {
        canChangeRole: hasPermission(actorRoles, 'member.invite') && canRemoveTarget,
        canSetExpiry: hasPermission(actorRoles, 'member.invite') && canRemoveTarget,
        canRemove: hasPermission(actorRoles, 'member.remove') && canRemoveTarget,
      }
    }

    const membersById = new Map<string, { userId: string; displayName: string; roles: unknown[] }>()
    const addRole = (userId: string, entry: unknown) => {
      const existing = membersById.get(userId)
      if (existing) existing.roles.push(entry)
      else membersById.set(userId, { userId, displayName: displayNameById.get(userId) ?? 'Unbekannt', roles: [entry] })
    }
    for (const row of orgRows) {
      addRole(row.user_id, { membershipId: row.id, scope: 'organization', scopeId: params.id, role: row.role, expiresAt: row.expires_at, ...capabilitiesFor('organization', params.id, row.role) })
    }
    for (const row of deptRows) {
      addRole(row.user_id, { membershipId: row.id, scope: 'department', scopeId: row.department_id, role: row.role, expiresAt: row.expires_at, ...capabilitiesFor('department', row.department_id, row.role) })
    }
    for (const row of teamRows) {
      addRole(row.user_id, { membershipId: row.id, scope: 'team', scopeId: row.team_id, role: row.role, expiresAt: row.expires_at, ...capabilitiesFor('team', row.team_id, row.role) })
    }

    return reply.code(200).send(Array.from(membersById.values()).map((member) => MemberSchema.parse(member)))
  })

  app.post('/v1/memberships', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateMembershipRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    const roles = await roleProvider.rolesForScope(request.auth!, scope)
    if (!canAssignRole(roles, input.role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const table = membershipTableFor(input.scope)
    const row: Record<string, unknown> = { organization_id: scope.organizationId, user_id: input.userId, role: input.role }
    if (input.scope === 'department') row.department_id = input.scopeId
    if (input.scope === 'team') {
      row.department_id = scope.departmentId
      row.team_id = input.scopeId
    }
    const insert = await client.from(table).insert(row).select('id, user_id, role, expires_at').single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'already_a_member', correlationId: request.id })
      if (insert.error.code === '22P02') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      // Anders als die Organisations- und Einladungsroute schreibt diese hier direkt in die
      // Tabelle, laeuft also unmittelbar in den Trigger aus
      // 2026080602_platform_admin_separation.sql.
      if (insert.error.message.includes('platform_admin_cannot_hold_membership')) {
        return reply.code(409).send({ error: 'platform_admin_cannot_hold_membership', correlationId: request.id })
      }
      // requirePermission oben prueft nur die Rolle, nicht `policy_settings.invite_allowed`
      // (Paket 023) -- das ist ausschliesslich in der *_memberships_insert-Policy selbst
      // verdrahtet und kann deshalb erst hier, als abgelehntes Insert, sichtbar werden.
      if (insert.error.code === '42501') return reply.code(403).send({ error: 'invite_not_allowed', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'membership.created',
      entityType: table,
      entityId: insert.data.id as string,
      metadata: { userId: input.userId, role: input.role, scope: input.scope, scopeId: input.scopeId },
    })
    const canRemoveNewRole = canRemoveRole(roles, insert.data.role as Role)
    return reply.code(201).send(
      MemberRoleEntrySchema.parse({
        membershipId: insert.data.id, scope: input.scope, scopeId: input.scopeId, role: insert.data.role, expiresAt: insert.data.expires_at,
        canChangeRole: hasPermission(roles, 'member.invite') && canRemoveNewRole,
        canSetExpiry: hasPermission(roles, 'member.invite') && canRemoveNewRole,
        canRemove: hasPermission(roles, 'member.remove') && canRemoveNewRole,
      }),
    )
  })

  app.patch('/v1/memberships/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z.object({ scope: ScopeLevelSchema }).parse(request.query)
    const input = UpdateMembershipRequestSchema.parse(request.body)
    // UpdateMembershipRequestSchema traegt scope nicht im Body (das kommt aus der Query) und kann
    // Rolle-gegen-Scope deshalb nicht selbst per superRefine pruefen (anders als
    // CreateMembershipRequestSchema) -- ohne diesen Check waere eine falsche Kombination erst am
    // Enum-Cast beim Insert als ungehandelter 500 sichtbar geworden.
    if (!rolesForScopeLevel(query.scope).includes(input.role)) {
      return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
    }
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const table = membershipTableFor(query.scope)
    const existing = await client.from(table).select('organization_id, department_id, team_id, user_id, role').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    const roles = await roleProvider.rolesForScope(request.auth!, scope)
    // Ein Rollenwechsel ist intern Delete+Insert (siehe Plan 010) -- ohne canRemoveRole gegen die
    // AKTUELLE Rolle koennte z. B. ein organization_admin einen organization_owner degradieren,
    // obwohl canAssignRole eine Neuzuweisung von organization_owner korrekt verweigert (beim
    // Rechte-Review dieses Pakets gefunden).
    if (!canRemoveRole(roles, existing.data.role as Role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    if (!canAssignRole(roles, input.role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    // Delete+Insert als zwei getrennte PostgREST-Aufrufe war nicht atomar: ein fehlschlagender
    // Insert liess die bereits geloeschte alte Mitgliedschaft verloren zurueck, ein durch RLS
    // still gefiltertes Delete fuehrte zu zwei gleichzeitigen Mitgliedschaften (beim
    // Vertraege-Review dieses Pakets gefunden). change_membership_role fuehrt beide Schritte in
    // einer Transaktion aus und wiederholt dieselben Berechtigungs-/Rang-Checks server-seitig.
    const rpc = await client.rpc('change_membership_role', {
      target_scope: query.scope,
      target_membership_id: params.id,
      target_role: input.role,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('cannot be removed')) return reply.code(409).send({ error: 'cannot_remove_last_owner', correlationId: request.id })
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw rpc.error
    }
    const result = rpc.data as { membershipId: string; userId: string; role: string; expiresAt: string | null; fromRole: string }
    const scopeId = query.scope === 'organization' ? scope.organizationId : query.scope === 'department' ? scope.departmentId! : (existing.data.team_id as string)
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'membership.role_changed',
      entityType: table,
      entityId: result.membershipId,
      metadata: { userId: result.userId, fromRole: result.fromRole, toRole: result.role, scope: query.scope, scopeId },
    })
    const canRemoveNewRole = canRemoveRole(roles, result.role as Role)
    return reply.code(200).send(
      MemberRoleEntrySchema.parse({
        membershipId: result.membershipId, scope: query.scope, scopeId, role: result.role, expiresAt: result.expiresAt,
        canChangeRole: hasPermission(roles, 'member.invite') && canRemoveNewRole,
        canSetExpiry: hasPermission(roles, 'member.invite') && canRemoveNewRole,
        canRemove: hasPermission(roles, 'member.remove') && canRemoveNewRole,
      }),
    )
  })

  // Getrennt von PATCH /v1/memberships/:id (Paket 023): eine Befristung zu setzen erfordert nicht
  // die can_assign_role-Pruefung einer neuen Rolle, siehe public.set_membership_expiry().
  app.patch('/v1/memberships/:id/expiry', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z.object({ scope: ScopeLevelSchema }).parse(request.query)
    const input = UpdateMembershipExpiryRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const table = membershipTableFor(query.scope)
    const existing = await client.from(table).select('organization_id, department_id, team_id, user_id, role').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    const roles = await roleProvider.rolesForScope(request.auth!, scope)
    const canRemoveTarget = canRemoveRole(roles, existing.data.role as Role)
    if (!canRemoveTarget) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const rpc = await client.rpc('set_membership_expiry', {
      target_scope: query.scope,
      target_membership_id: params.id,
      target_expires_at: input.expiresAt,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('cannot be removed')) return reply.code(409).send({ error: 'cannot_remove_last_owner', correlationId: request.id })
      throw rpc.error
    }
    const result = rpc.data as { membershipId: string; expiresAt: string | null }
    const scopeId = query.scope === 'organization' ? scope.organizationId : query.scope === 'department' ? scope.departmentId! : (existing.data.team_id as string)
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'membership.expiry_changed',
      entityType: table,
      entityId: result.membershipId,
      metadata: { userId: existing.data.user_id, expiresAt: result.expiresAt, scope: query.scope, scopeId },
    })
    return reply.code(200).send(
      MemberRoleEntrySchema.parse({
        membershipId: result.membershipId, scope: query.scope, scopeId, role: existing.data.role, expiresAt: result.expiresAt,
        canChangeRole: hasPermission(roles, 'member.invite') && canRemoveTarget,
        canSetExpiry: hasPermission(roles, 'member.invite') && canRemoveTarget,
        canRemove: hasPermission(roles, 'member.remove') && canRemoveTarget,
      }),
    )
  })

  app.delete('/v1/memberships/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z.object({ scope: ScopeLevelSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const table = membershipTableFor(query.scope)
    const existing = await client.from(table).select('organization_id, department_id, team_id, user_id, role').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'member.remove', scope))) return
    // Siehe PATCH oben: derselbe Rang-gegen-aktuelle-Rolle-Check, sonst kann ein Akteur mit
    // member.remove jemanden entfernen, der maechtiger ist als er selbst.
    const roles = await roleProvider.rolesForScope(request.auth!, scope)
    if (!canRemoveRole(roles, existing.data.role as Role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    // Die verantwortliche Person muss nur ihre Organisationsmitgliedschaft behalten (Paket 009) --
    // dieser Guard darf ein Verlassen/Entfernen aus einem Team oder einer Abteilung nicht
    // blockieren, nur den Austritt aus dem Verein selbst (beim Vertraege-Review gefunden).
    if (query.scope === 'organization') {
      const profile = await client.from('organization_profiles').select('responsible_person_profile_id').eq('organization_id', scope.organizationId).maybeSingle()
      if (profile.error) throw profile.error
      if (profile.data?.responsible_person_profile_id === existing.data.user_id) {
        return reply.code(409).send({ error: 'responsible_person_cannot_be_removed', correlationId: request.id })
      }
    }
    // Presserechtliche Verantwortung (Paket 020) ausserhalb des organization-Zweigs: anders als
    // responsible_person_profile_id gibt es fuer editorial_responsible_profile_id keinen Trigger,
    // der eine Vereinsmitgliedschaft erzwingt -- PATCH /v1/channels/:id akzeptiert jede Person mit
    // IRGENDEINER Mitgliedschaft im Verein (isAnyMemberOfOrganization), auch eine rein
    // abteilungs- oder mannschaftsgebundene. Ein Schutz, der nur beim Entfernen der
    // Vereinsmitgliedschaft greift, liesse genau diese Person ungeschuetzt aus ihrer Abteilung
    // oder Mannschaft entfernen, waehrend sie weiterhin als presserechtlich verantwortlich auf
    // einem Kanal benannt bleibt (adversariale Pruefung) -- deshalb unabhaengig vom angefragten
    // Scope. Service-Client: die RLS-Sichtbarkeit von social_connections darf hier keine Rolle
    // spielen, sonst waere der Schutz per fehlender Kanal-Berechtigung umgehbar.
    const editorialResponsible = await supabaseClients
      .forService()
      .from('social_connections')
      .select('id')
      .eq('organization_id', scope.organizationId)
      .eq('editorial_responsible_profile_id', existing.data.user_id)
      // Ein getrennter/archivierter Kanal veroeffentlicht nichts mehr und traegt keine
      // presserechtliche Verantwortung -- ohne diesen Filter bliebe die benannte Person
      // dauerhaft unentfernbar, weil DELETE /v1/channels/:id die Zeile bewusst stehen laesst.
      .is('archived_at', null)
      .limit(1)
    if (editorialResponsible.error) throw editorialResponsible.error
    if (editorialResponsible.data.length > 0) {
      return reply.code(409).send({ error: 'editorial_responsible_cannot_be_removed', correlationId: request.id })
    }
    const del = await client.from(table).delete().eq('id', params.id).select('id')
    if (del.error) {
      if (del.error.message.includes('cannot be removed')) return reply.code(409).send({ error: 'cannot_remove_last_owner', correlationId: request.id })
      throw del.error
    }
    if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'membership.removed',
      entityType: table,
      entityId: params.id,
      metadata: { userId: existing.data.user_id, role: existing.data.role, scope: query.scope },
    })
    return reply.code(204).send()
  })

  app.get('/v1/organizations/:id/invitations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    // Optionale Scope-Parameter: die RLS-Policy invitations_select_admin erlaubt einem
    // department_admin/team_manager bereits, offene Einladungen der eigenen Abteilung/des
    // eigenen Teams zu sehen -- ohne diese Parameter verlangte diese Route immer
    // organisationsweites member.invite, sodass ein Abteilungsverantwortlicher seine eigenen
    // offenen Einladungen nie auflisten konnte (beim Review dieses Pakets gefunden). Ohne
    // Parameter bleibt das Verhalten unveraendert organisationsweit.
    const query = z.object({ departmentId: UuidSchema.optional(), teamId: UuidSchema.optional() }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // Dieselbe serverseitige Verifikation der Scope-Kette wie in POST /v1/invitations: ohne sie
    // pruefte requirePermission auf einer frei vom Client zusammengesetzten Kette (fremde
    // organizationId plus eigene departmentId) und liess den Aufruf durch. Ein Leck entstand
    // dadurch nur nicht, weil der zusammengesetzte Fremdschluessel auf invitations eine solche
    // Kombination ohnehin auf null Zeilen filtert -- die Sicherheit haengt damit an einem
    // Fremdschluessel statt an einer Pruefung (im Nachfolge-Review dieses PRs gefunden).
    const resolved = await resolveInvitationScope(client, {
      organizationId: params.id,
      departmentId: query.departmentId ?? null,
      teamId: query.teamId ?? null,
    })
    if (!resolved) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'member.invite', resolved.scope))) return
    let invitationsQuery = client
      .from('invitations')
      .select('id, organization_id, department_id, team_id, email, role, invited_by, expires_at, accepted_at, revoked_at, last_sent_at, send_count, created_at')
      .eq('organization_id', params.id)
      .is('accepted_at', null)
      .is('revoked_at', null)
    if (query.teamId) invitationsQuery = invitationsQuery.eq('team_id', query.teamId)
    else if (query.departmentId) invitationsQuery = invitationsQuery.eq('department_id', query.departmentId)
    const result = await invitationsQuery.order('created_at', { ascending: false })
    if (result.error) throw result.error
    return reply.code(200).send(result.data.map((row) => InvitationSchema.parse(mapInvitationRow(row))))
  })

  app.post('/v1/invitations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateInvitationRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const resolved = await resolveInvitationScope(client, input)
    if (!resolved) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const { scope } = resolved
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    const roles = await roleProvider.rolesForScope(request.auth!, scope)
    if (!canAssignRole(roles, input.role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const alreadyMember = await client.rpc('email_has_membership', {
      target_organization_id: scope.organizationId,
      target_department_id: scope.departmentId ?? null,
      target_team_id: scope.teamId ?? null,
      target_email: input.email,
    })
    if (alreadyMember.error) throw alreadyMember.error
    if (alreadyMember.data) return reply.code(409).send({ error: 'already_a_member', correlationId: request.id })

    const { rawToken, tokenHash } = generateInvitationToken()
    // create_invitation() ist eine security-definer-RPC statt eines direkten Inserts: sie
    // invalidiert eine abgelaufene, aber noch offene Einladung fuer dieselbe Adresse/denselben
    // Scope in derselben Transaktion (sonst blockiert invitations_open_unique eine neue
    // Einladung bis zum manuellen Widerruf, beim Vertraege-Review gefunden) und prueft
    // zusaetzlich das adressbezogene Rate-Limit ueber alle Einladungs-Zeilen hinweg (schliesst
    // eine Umgehung per revoke()+erneutem create(), siehe Plan 010 "Risiken").
    const rpc = await client.rpc('create_invitation', {
      target_organization_id: scope.organizationId,
      target_department_id: scope.departmentId ?? null,
      target_team_id: scope.teamId ?? null,
      target_email: input.email,
      target_role: input.role,
      target_token_hash: tokenHash,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('invitation_already_open')) return reply.code(409).send({ error: 'invitation_already_open', correlationId: request.id })
      if (rpc.error.message.includes('resend_limit_reached')) return reply.code(429).send({ error: 'resend_limit_reached', correlationId: request.id })
      if (rpc.error.message.includes('resent at most once per hour')) return reply.code(429).send({ error: 'resend_rate_limited', correlationId: request.id })
      // requirePermission oben kennt nur die Rollen des Anfragenden, nicht
      // `policy_settings.invite_allowed` (Paket 023) -- create_invitation() prueft das zusaetzlich
      // selbst und wirft dieselbe Meldung wie ein fehlendes member.invite, weil beides fuer den
      // Aufrufer gleich aussieht: er darf hier gerade niemanden einladen.
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'invite_not_allowed', correlationId: request.id })
      if (rpc.error.code === '23514' || rpc.error.code === '23503') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw rpc.error
    }
    const insertData = rpc.data as Record<string, unknown>

    const organization = await client.from('organizations').select('name').eq('id', scope.organizationId).single()
    if (organization.error) throw organization.error
    const organizationName = organization.data.name as string
    const acceptUrl = `${environment.WEB_BASE_URL ?? 'http://localhost:4200'}/einladung?token=${rawToken}`
    let emailDelivered = true
    try {
      await emailSender.send(
        buildInvitationEmail({ to: input.email, organizationName, scopeName: resolved.scopeName || organizationName, acceptUrl }),
      )
    } catch (error) {
      // Die Einladung besteht bereits in der Datenbank -- ein SMTP-Fehler soll den Request nicht
      // mit 500 scheitern lassen, sondern nur den Versandstatus sichtbar machen (beim
      // Stabilitaets-Review dieses Pakets gefunden: bisher lief der Versand ungefangen).
      emailDelivered = false
      request.log.error({ err: error, correlationId: request.id }, 'invitation email delivery failed')
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'invitation.created',
      entityType: 'invitations',
      entityId: insertData.id as string,
      metadata: { email: input.email, role: input.role, departmentId: scope.departmentId ?? null, teamId: scope.teamId ?? null, emailDelivered },
    })

    return reply.code(201).send({ ...InvitationSchema.parse(mapInvitationRow(insertData)), emailDelivered })
  })

  app.post('/v1/invitations/:id/resend', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client
      .from('invitations')
      .select('organization_id, department_id, team_id, email, send_count, accepted_at, revoked_at')
      .eq('id', params.id)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data || existing.data.accepted_at || existing.data.revoked_at) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    if ((existing.data.send_count as number) >= 10) return reply.code(429).send({ error: 'resend_limit_reached', correlationId: request.id })
    const { rawToken, tokenHash } = generateInvitationToken()
    // resend_invitation() ist eine security-definer-RPC: sie prueft und erhoeht dasselbe
    // adressbezogene Rate-Limit wie create_invitation() atomar mit dem Update selbst (siehe dort).
    const rpc = await client.rpc('resend_invitation', { target_invitation_id: params.id, target_token_hash: tokenHash })
    if (rpc.error) {
      if (rpc.error.message.includes('resend_limit_reached')) return reply.code(429).send({ error: 'resend_limit_reached', correlationId: request.id })
      if (rpc.error.message.includes('resent at most once per hour')) return reply.code(429).send({ error: 'resend_rate_limited', correlationId: request.id })
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw rpc.error
    }
    const updateData = rpc.data as Record<string, unknown>
    const organization = await client.from('organizations').select('name').eq('id', scope.organizationId).single()
    if (organization.error) throw organization.error
    const organizationName = organization.data.name as string
    const scopeName = await resolveScopeName(client, scope, organizationName)
    const acceptUrl = `${environment.WEB_BASE_URL ?? 'http://localhost:4200'}/einladung?token=${rawToken}`
    let emailDelivered = true
    try {
      await emailSender.send(buildInvitationEmail({ to: existing.data.email as string, organizationName, scopeName, acceptUrl }))
    } catch (error) {
      emailDelivered = false
      request.log.error({ err: error, correlationId: request.id }, 'invitation email delivery failed')
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'invitation.resent',
      entityType: 'invitations',
      entityId: params.id,
      metadata: { email: existing.data.email, emailDelivered },
    })
    return reply.code(200).send({ ...InvitationSchema.parse(mapInvitationRow(updateData)), emailDelivered })
  })

  app.post('/v1/invitations/:id/revoke', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client
      .from('invitations')
      .select('organization_id, department_id, team_id, email, accepted_at, revoked_at')
      .eq('id', params.id)
      .maybeSingle()
    if (existing.error) throw existing.error
    // Dieselbe Bedingung wie /resend: nur eine offene Einladung ist widerrufbar. Ein Widerruf auf
    // einer bereits angenommenen Zeile aendert nichts an der entstandenen Mitgliedschaft, setzte
    // aber revoked_at und schrieb einen irrefuehrenden Audit-Eintrag; ein zweiter Widerruf
    // erzeugte nur Rauschen (im Nachfolge-Review dieses PRs gefunden).
    if (!existing.data || existing.data.accepted_at || existing.data.revoked_at) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    const update = await client
      .from('invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', params.id)
      .select('id, organization_id, department_id, team_id, email, role, invited_by, expires_at, accepted_at, revoked_at, last_sent_at, send_count, created_at')
      .single()
    if (update.error) throw update.error
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'invitation.revoked',
      entityType: 'invitations',
      entityId: params.id,
      metadata: { email: existing.data.email },
    })
    return reply.code(200).send(InvitationSchema.parse(mapInvitationRow(update.data)))
  })

  app.post('/v1/invitations/accept', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = AcceptInvitationRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('accept_invitation', { raw_token: input.token })
    if (rpc.error) {
      if (rpc.error.message.includes('invitation_not_found_or_expired')) return reply.code(410).send({ error: 'invitation_not_found_or_expired', correlationId: request.id })
      if (rpc.error.message.includes('invitation_email_mismatch')) return reply.code(403).send({ error: 'invitation_email_mismatch', correlationId: request.id })
      if (rpc.error.message.includes('platform_admin_cannot_hold_membership')) return reply.code(409).send({ error: 'platform_admin_cannot_hold_membership', correlationId: request.id })
      throw rpc.error
    }
    const data = rpc.data as { organizationId: string; departmentId: string | null; teamId: string | null; role: string }
    return reply.code(200).send(AcceptInvitationResponseSchema.parse(data))
  })
}
