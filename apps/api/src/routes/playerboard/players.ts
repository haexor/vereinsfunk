import { hasPermission } from '@vereinsfunk/authorization'
import {
  CreatePlayerboardPlayerRequestSchema,
  InvitePlayerboardPlayerRequestSchema,
  PlayerboardPlayerSchema,
  UpdatePlayerboardPlayerRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { deriveIsMinor } from '@vereinsfunk/member-directory'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createInvitation, InvitationCreationError } from '../../services/invitations.js'
import type { ApiRouteContext } from '../context.js'
import { createAuditRecorder } from '../shared.js'
import { loadTeamScope, requireStatsAccess, sendDatabaseError } from './shared.js'

type RosterRow = {
  player_id: string; directory_person_id: string; first_name: string; last_name: string
  jersey_number: number | null; position: string | null; active: boolean; has_account: boolean
}

async function loadRoster(client: SupabaseClient, teamId: string): Promise<RosterRow[]> {
  const roster = await client.rpc('playerboard_team_roster', { target_team_id: teamId })
  if (roster.error) throw roster.error
  return (roster.data ?? []) as RosterRow[]
}

function mapRosterRow(teamId: string, row: RosterRow, email?: string | null) {
  return PlayerboardPlayerSchema.parse({
    id: row.player_id, teamId, directoryPersonId: row.directory_person_id, firstName: row.first_name, lastName: row.last_name,
    jerseyNumber: row.jersey_number, position: row.position, active: row.active, hasAccount: row.has_account,
    ...(email !== undefined ? { email } : {}),
  })
}

export function registerPlayerboardPlayerRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, roleProvider, environment } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // Einzelner Kader-Eintrag fuer Schreibrouten: Mannschaft ueber den Service-Client (siehe
  // loadTeamScope), Recht danach per requirePermission.
  async function loadPlayer(request: FastifyRequest, reply: FastifyReply, playerId: string) {
    const player = await supabaseClients.forService().from('playerboard_players')
      .select('id, organization_id, department_id, team_id, directory_person_id').eq('id', playerId).maybeSingle()
    if (player.error) throw player.error
    if (!player.data) {
      reply.code(404).send({ error: 'not_found', correlationId: request.id })
      return null
    }
    return {
      id: player.data.id as string,
      directoryPersonId: player.data.directory_person_id as string,
      scope: { organizationId: player.data.organization_id as string, departmentId: player.data.department_id as string, teamId: player.data.team_id as string },
    }
  }

  async function playerResponse(request: FastifyRequest, teamId: string, playerId: string) {
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const row = (await loadRoster(client, teamId)).find((candidate) => candidate.player_id === playerId)
    if (!row) throw new Error('player not visible after write')
    const person = await supabaseClients.forService().from('directory_people').select('email').eq('id', row.directory_person_id).maybeSingle()
    if (person.error) throw person.error
    return mapRosterRow(teamId, row, (person.data?.email as string | null | undefined) ?? null)
  }

  app.get('/v1/playerboard/teams/:teamId/players', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ teamId: UuidSchema }).parse(request.params)
    const scope = await loadTeamScope(supabaseClients.forService(), params.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requireStatsAccess(context, request, reply, scope))) return
    const rows = await loadRoster(supabaseClients.forUser(request.auth!.accessToken), params.teamId)
    // E-Mail-Adressen nur fuer Trainer: Spieler und Mitlesende sehen Namen und Rueckennummern.
    const canManage = hasPermission(await roleProvider.rolesForScope(request.auth!, scope), 'training.manage')
    if (!canManage) return reply.code(200).send(rows.map((row) => mapRosterRow(params.teamId, row)))
    const emails = new Map<string, string | null>()
    if (rows.length > 0) {
      const people = await supabaseClients.forService().from('directory_people').select('id, email').in('id', rows.map((row) => row.directory_person_id))
      if (people.error) throw people.error
      for (const person of people.data) emails.set(person.id as string, (person.email as string | null) ?? null)
    }
    return reply.code(200).send(rows.map((row) => mapRosterRow(params.teamId, row, emails.get(row.directory_person_id) ?? null)))
  })

  app.post('/v1/playerboard/players', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreatePlayerboardPlayerRequestSchema.parse(request.body)
    const scope = await loadTeamScope(supabaseClients.forService(), input.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'training.manage', scope))) return

    let playerId: string
    if ('directoryPersonId' in input) {
      // Vorhandene Person: mit dem Nutzer-Client, damit die Insert-Policy greift -- sie verlangt,
      // dass der Trainer die Person ueber seine eigene RLS lesen darf (directory.read in ihrem Scope).
      const insert = await supabaseClients.forUser(request.auth!.accessToken).from('playerboard_players').insert({
        organization_id: scope.organizationId, department_id: scope.departmentId, team_id: scope.teamId,
        directory_person_id: input.directoryPersonId, jersey_number: input.jerseyNumber ?? null, position: input.position ?? null,
        created_by: request.auth!.userId,
      }).select('id').single()
      if (insert.error) {
        if (insert.error.code === '23505') return reply.code(409).send({ error: 'player_already_in_team', correlationId: request.id })
        if (insert.error.code === '23503') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
        if (sendDatabaseError(request, reply, insert.error)) return
        throw insert.error
      }
      playerId = insert.data.id as string
    } else {
      // Neue Person: Verzeichnisperson und Kader-Eintrag in einer Transaktion. is_minor leitet der
      // Server aus dem Geburtsjahr her (wie POST .../directory-people).
      const birthYear = input.birthYear ?? null
      const created = await supabaseClients.forService().rpc('playerboard_create_player', {
        target_team_id: scope.teamId, target_first_name: input.firstName, target_last_name: input.lastName,
        target_birth_year: birthYear, target_is_minor: birthYear !== null ? deriveIsMinor(birthYear, new Date().getFullYear()) : false,
        target_email: input.email ?? null, target_jersey_number: input.jerseyNumber ?? null, target_position: input.position ?? null,
        target_created_by: request.auth!.userId,
      })
      if (created.error) {
        if (sendDatabaseError(request, reply, created.error)) return
        throw created.error
      }
      playerId = (created.data as { id: string }).id
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'playerboard_player.created', entityType: 'playerboard_players', entityId: playerId,
      metadata: { teamId: scope.teamId, existingPerson: 'directoryPersonId' in input },
    })
    return reply.code(201).send(await playerResponse(request, scope.teamId, playerId))
  })

  app.patch('/v1/playerboard/players/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdatePlayerboardPlayerRequestSchema.parse(request.body)
    const player = await loadPlayer(request, reply, params.id)
    if (!player) return
    if (!(await requirePermission(request, reply, 'training.manage', player.scope))) return

    const update: Record<string, unknown> = {}
    if (input.jerseyNumber !== undefined) update.jersey_number = input.jerseyNumber
    if (input.position !== undefined) update.position = input.position
    if (input.active !== undefined) update.active = input.active
    if (Object.keys(update).length > 0) {
      const result = await supabaseClients.forUser(request.auth!.accessToken).from('playerboard_players').update(update).eq('id', params.id).select('id')
      if (result.error) {
        if (sendDatabaseError(request, reply, result.error)) return
        throw result.error
      }
      if (result.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    // Die E-Mail gehoert der Verzeichnisperson (Paket 054). Der Trainer pflegt seinen Kader und darf
    // sie fuer Personen seines Kaders ergaenzen -- auch ohne directory.read auf deren Scope.
    if (input.email !== undefined) {
      const person = await supabaseClients.forService().from('directory_people')
        .update({ email: input.email, source_updated_at: new Date().toISOString() }).eq('id', player.directoryPersonId)
      if (person.error) throw person.error
    }
    await recordAuditEvent(request, {
      organizationId: player.scope.organizationId, action: 'playerboard_player.updated', entityType: 'playerboard_players', entityId: params.id,
      metadata: { fields: [...Object.keys(update), ...(input.email !== undefined ? ['email'] : [])] },
    })
    return reply.code(200).send(await playerResponse(request, player.scope.teamId, params.id))
  })

  // Entfernen nur ohne Punkte: Kader-Eintraege mit Punkten nehmen ueber "on delete cascade" ihre
  // Punkte mit -- dafuer gibt es "inaktiv".
  app.delete('/v1/playerboard/players/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const player = await loadPlayer(request, reply, params.id)
    if (!player) return
    if (!(await requirePermission(request, reply, 'training.manage', player.scope))) return
    const points = await supabaseClients.forService().from('playerboard_point_entries').select('id', { count: 'exact', head: true }).eq('player_id', params.id)
    if (points.error) throw points.error
    if ((points.count ?? 0) > 0) return reply.code(409).send({ error: 'player_has_points', correlationId: request.id })
    const result = await supabaseClients.forUser(request.auth!.accessToken).from('playerboard_players').delete().eq('id', params.id).select('id')
    if (result.error) throw result.error
    if (result.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: player.scope.organizationId, action: 'playerboard_player.removed', entityType: 'playerboard_players', entityId: params.id,
    })
    return reply.code(204).send()
  })

  // Einladung aus dem Kader: Adresse aus dem Verzeichnis. Eine hier angegebene Adresse wird an der
  // Person gespeichert und gilt dann (der Trainer pflegt die Angaben seines Kaders).
  app.post('/v1/playerboard/players/:id/invite', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = InvitePlayerboardPlayerRequestSchema.parse(request.body ?? {})
    const player = await loadPlayer(request, reply, params.id)
    if (!player) return
    if (!(await requirePermission(request, reply, 'training.manage', player.scope))) return
    if (!(await requirePermission(request, reply, 'member.invite', player.scope))) return

    const service = supabaseClients.forService()
    const person = await service.from('directory_people').select('email, profile_id').eq('id', player.directoryPersonId).single()
    if (person.error) throw person.error
    if (person.data.profile_id) return reply.code(409).send({ error: 'player_has_account', correlationId: request.id })
    const email = input.email ?? (person.data.email as string | null)
    if (!email) return reply.code(422).send({ error: 'email_required', correlationId: request.id })
    if (input.email && input.email !== person.data.email) {
      const saved = await service.from('directory_people').update({ email: input.email, source_updated_at: new Date().toISOString() }).eq('id', player.directoryPersonId)
      if (saved.error) throw saved.error
    }

    try {
      const created = await createInvitation(
        supabaseClients.forUser(request.auth!.accessToken), service,
        { ...player.scope, email, role: 'player', directoryPersonId: player.directoryPersonId },
        environment.WEB_BASE_URL ?? 'http://localhost:4200',
      )
      if (!created.emailDelivered) request.log.error({ err: created.emailError, correlationId: request.id }, 'Supabase invitation email delivery failed')
      await recordAuditEvent(request, {
        organizationId: player.scope.organizationId, action: 'invitation.created', entityType: 'invitations', entityId: created.invitation.id,
        metadata: { email, role: 'player', teamId: player.scope.teamId, directoryPersonId: player.directoryPersonId, emailDelivered: created.emailDelivered },
      })
      return reply.code(201).send({ ...created.invitation, emailDelivered: created.emailDelivered })
    } catch (error) {
      if (error instanceof InvitationCreationError) {
        const status = error.code === 'already_a_member' || error.code === 'invitation_already_open' ? 409 : error.code === 'resend_limit_reached' || error.code === 'resend_rate_limited' ? 429 : error.code === 'invite_not_allowed' ? 403 : 400
        return reply.code(status).send({ error: error.code, correlationId: request.id })
      }
      throw error
    }
  })
}
