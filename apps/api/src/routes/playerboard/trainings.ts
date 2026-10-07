import {
  CreatePlayerboardTrainingRequestSchema,
  PlayerboardPointEntrySchema,
  PlayerboardRankingEntrySchema,
  PlayerboardRankingQuerySchema,
  PlayerboardTrainingDetailSchema,
  SetPlayerboardTrainingPointsRequestSchema,
  UpdatePlayerboardTrainingRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from '../context.js'
import { createAuditRecorder } from '../shared.js'
import { loadTeamScope, mapTrainingRow, requireStatsAccess, sendDatabaseError, TRAINING_COLUMNS } from './shared.js'

const PHOTO_BUCKET = 'playerboard-training-photos'

type EntryRow = { player_id: string; category_id: string; value: number }

function mapEntries(rows: readonly EntryRow[]) {
  return rows.map((row) => PlayerboardPointEntrySchema.parse({ playerId: row.player_id, categoryId: row.category_id, value: row.value }))
}

// Notizen kommen ueber den Nutzer-Client: die Policy liefert sie nur mannschaftsintern
// (training.view), nie an Mitlesende ueber stats_visibility.
async function loadNotes(client: SupabaseClient, trainingIds: readonly string[]): Promise<Map<string, string>> {
  if (trainingIds.length === 0) return new Map()
  const notes = await client.from('playerboard_training_notes').select('training_id, note').in('training_id', trainingIds)
  if (notes.error) throw notes.error
  return new Map(notes.data.map((row) => [row.training_id as string, row.note as string]))
}

export function registerPlayerboardTrainingRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  async function loadTraining(request: FastifyRequest, reply: FastifyReply, trainingId: string) {
    const training = await supabaseClients.forService().from('playerboard_trainings').select('id, team_id').eq('id', trainingId).maybeSingle()
    if (training.error) throw training.error
    const scope = training.data ? await loadTeamScope(supabaseClients.forService(), training.data.team_id as string) : null
    if (!scope) {
      reply.code(404).send({ error: 'not_found', correlationId: request.id })
      return null
    }
    return scope
  }

  async function trainingDetail(client: SupabaseClient, trainingId: string) {
    const [training, entries, notes] = await Promise.all([
      client.from('playerboard_trainings').select(TRAINING_COLUMNS).eq('id', trainingId).maybeSingle(),
      client.from('playerboard_point_entries').select('player_id, category_id, value').eq('training_id', trainingId),
      loadNotes(client, [trainingId]),
    ])
    if (training.error) throw training.error
    if (entries.error) throw entries.error
    if (!training.data) return null
    return PlayerboardTrainingDetailSchema.parse({
      training: mapTrainingRow(training.data, notes.get(trainingId) ?? null),
      entries: mapEntries(entries.data as EntryRow[]),
    })
  }

  app.get('/v1/playerboard/teams/:teamId/trainings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ teamId: UuidSchema }).parse(request.params)
    const query = PlayerboardRankingQuerySchema.parse(request.query)
    const scope = await loadTeamScope(supabaseClients.forService(), params.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requireStatsAccess(context, request, reply, scope))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    let builder = client.from('playerboard_trainings').select(TRAINING_COLUMNS).eq('team_id', params.teamId)
    if (query.from) builder = builder.gte('training_date', query.from)
    if (query.to) builder = builder.lte('training_date', query.to)
    const trainings = await builder.order('training_date', { ascending: false }).order('created_at', { ascending: false })
    if (trainings.error) throw trainings.error
    const notes = await loadNotes(client, trainings.data.map((row) => row.id as string))
    return reply.code(200).send(trainings.data.map((row) => mapTrainingRow(row, notes.get(row.id as string) ?? null)))
  })

  app.post('/v1/playerboard/trainings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreatePlayerboardTrainingRequestSchema.parse(request.body)
    const scope = await loadTeamScope(supabaseClients.forService(), input.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'training.manage', scope))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const insert = await client.from('playerboard_trainings').insert({
      organization_id: scope.organizationId, department_id: scope.departmentId, team_id: scope.teamId,
      training_date: input.trainingDate, title: input.title ?? null, status: 'draft', created_by: request.auth!.userId,
    }).select('id').single()
    if (insert.error) {
      if (sendDatabaseError(request, reply, insert.error)) return
      throw insert.error
    }
    const trainingId = insert.data.id as string
    if (input.note) {
      const note = await client.from('playerboard_training_notes').insert({
        organization_id: scope.organizationId, training_id: trainingId, note: input.note, updated_by: request.auth!.userId,
      })
      if (note.error) throw note.error
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'playerboard_training.created', entityType: 'playerboard_trainings', entityId: trainingId,
      metadata: { teamId: scope.teamId, trainingDate: input.trainingDate },
    })
    return reply.code(201).send(await trainingDetail(client, trainingId))
  })

  app.get('/v1/playerboard/trainings/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const scope = await loadTraining(request, reply, params.id)
    if (!scope) return
    if (!(await requireStatsAccess(context, request, reply, scope))) return
    // Ein Entwurf ist fuer Mitlesende per RLS unsichtbar -- dann wie nicht vorhanden.
    const detail = await trainingDetail(supabaseClients.forUser(request.auth!.accessToken), params.id)
    if (!detail) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return reply.code(200).send(detail)
  })

  app.patch('/v1/playerboard/trainings/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdatePlayerboardTrainingRequestSchema.parse(request.body)
    const scope = await loadTraining(request, reply, params.id)
    if (!scope) return
    if (!(await requirePermission(request, reply, 'training.manage', scope))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const update: Record<string, unknown> = {}
    if (input.trainingDate !== undefined) update.training_date = input.trainingDate
    if (input.title !== undefined) update.title = input.title
    if (input.status !== undefined) update.status = input.status
    if (Object.keys(update).length > 0) {
      const result = await client.from('playerboard_trainings').update(update).eq('id', params.id).select('id')
      if (result.error) {
        if (sendDatabaseError(request, reply, result.error)) return
        throw result.error
      }
      if (result.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    if (input.note !== undefined) {
      const note = input.note
        ? await client.from('playerboard_training_notes').upsert({
            organization_id: scope.organizationId, training_id: params.id, note: input.note, updated_by: request.auth!.userId, updated_at: new Date().toISOString(),
          }, { onConflict: 'training_id' })
        : await client.from('playerboard_training_notes').delete().eq('training_id', params.id)
      if (note.error) throw note.error
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'playerboard_training.updated', entityType: 'playerboard_trainings', entityId: params.id,
      metadata: { fields: [...Object.keys(update), ...(input.note !== undefined ? ['note'] : [])] },
    })
    return reply.code(200).send(await trainingDetail(client, params.id))
  })

  app.delete('/v1/playerboard/trainings/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const scope = await loadTraining(request, reply, params.id)
    if (!scope) return
    if (!(await requirePermission(request, reply, 'training.manage', scope))) return
    const service = supabaseClients.forService()
    // Die Fotozeilen fallen per "on delete cascade" mit dem Training, die Dateien im Bucket nicht --
    // ihre Pfade deshalb vorher merken und danach entfernen.
    const photos = await service.from('playerboard_training_photos').select('storage_path').eq('training_id', params.id)
    if (photos.error) throw photos.error
    const result = await supabaseClients.forUser(request.auth!.accessToken).from('playerboard_trainings').delete().eq('id', params.id).select('id')
    if (result.error) throw result.error
    if (result.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    if (photos.data.length > 0) {
      const removed = await service.storage.from(PHOTO_BUCKET).remove(photos.data.map((row) => row.storage_path as string))
      if (removed.error) request.log.error({ err: removed.error, correlationId: request.id }, 'playerboard photo cleanup failed')
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'playerboard_training.deleted', entityType: 'playerboard_trainings', entityId: params.id,
      metadata: { photos: photos.data.length },
    })
    return reply.code(204).send()
  })

  // Mobile Punkteeingabe: alle Werte eines Trainings in einem Schritt, alles oder nichts
  // (playerboard_set_training_points, security invoker -- RLS und Konsistenz-Trigger greifen).
  app.put('/v1/playerboard/trainings/:id/points', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = SetPlayerboardTrainingPointsRequestSchema.parse(request.body)
    const scope = await loadTraining(request, reply, params.id)
    if (!scope) return
    if (!(await requirePermission(request, reply, 'training.manage', scope))) return
    const result = await supabaseClients.forUser(request.auth!.accessToken).rpc('playerboard_set_training_points', {
      target_training_id: params.id, entries: input.entries,
    })
    if (result.error) {
      if (sendDatabaseError(request, reply, result.error)) return
      throw result.error
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'playerboard_points.saved', entityType: 'playerboard_trainings', entityId: params.id,
      metadata: { entries: input.entries.length },
    })
    return reply.code(200).send(mapEntries((result.data ?? []) as EntryRow[]))
  })

  app.get('/v1/playerboard/teams/:teamId/ranking', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ teamId: UuidSchema }).parse(request.params)
    const query = PlayerboardRankingQuerySchema.parse(request.query)
    const scope = await loadTeamScope(supabaseClients.forService(), params.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requireStatsAccess(context, request, reply, scope))) return
    const ranking = await supabaseClients.forUser(request.auth!.accessToken).rpc('playerboard_team_ranking', {
      target_team_id: params.teamId, from_date: query.from ?? null, to_date: query.to ?? null,
    })
    if (ranking.error) throw ranking.error
    const rows = (ranking.data ?? []) as {
      player_id: string; first_name: string; last_name: string; jersey_number: number | null; rank: number; total: number; category_totals: Record<string, number>
    }[]
    return reply.code(200).send(rows.map((row) => PlayerboardRankingEntrySchema.parse({
      playerId: row.player_id, firstName: row.first_name, lastName: row.last_name, jerseyNumber: row.jersey_number,
      rank: Number(row.rank), total: Number(row.total), categoryTotals: row.category_totals ?? {},
    })))
  })
}
