import {
  PlayerboardVeoMatchAnalysisSchema,
  PlayerboardVeoMatchTracksSchema,
  PlayerboardVeoPlayerHeatmapSchema,
  PlayerboardVeoPlayerHeatmapsQuerySchema,
  PlayerboardVeoPlayerSeasonMatchSchema,
  PlayerboardVeoSeasonMatchSchema,
  PlayerboardVeoSeasonQuerySchema,
  PlayerboardVeoTeamViewsSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from '../context.js'
import { createAuditRecorder } from '../shared.js'
import { loadTeamScope, requireStatsAccess, sendDatabaseError } from './shared.js'

// Spec 002, PR 2: Spielauswertung eines Veo-Spiels (contracts/veo-analysis.md). Erst das Modul, dann
// die Sicht auf die Kennzahlen der Mannschaft; ein unbekanntes Spiel und eines einer anderen
// Mannschaft geben dasselbe 404. Gelesen wird ueber den Nutzer-Client, die Funktionen pruefen die
// Sicht ein zweites Mal.

const ParamsSchema = z.object({ teamId: UuidSchema, fixtureId: UuidSchema })
const TeamParamsSchema = z.object({ teamId: UuidSchema })

/** Registriert Auswertung und Positionsdaten eines Spiels sowie Saison und Ansichten (Veo Analytics). */
export function registerPlayerboardVeoAnalysisRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  for (const [path, rpc, schema] of [
    ['analysis', 'playerboard_veo_match_analysis', PlayerboardVeoMatchAnalysisSchema],
    ['tracks', 'playerboard_veo_match_tracks', PlayerboardVeoMatchTracksSchema],
  ] as const) {
    app.get(`/v1/playerboard/teams/:teamId/veo/matches/:fixtureId/${path}`, async (request, reply) => {
      if (!(await requireAuth(request, reply))) return
      const params = ParamsSchema.parse(request.params)
      const scope = await loadTeamScope(supabaseClients.forService(), params.teamId)
      if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      if (!(await requireStatsAccess(context, request, reply, scope))) return
      const loaded = await supabaseClients.forUser(request.auth!.accessToken).rpc(rpc, {
        target_team_id: params.teamId, target_fixture_id: params.fixtureId,
      })
      if (loaded.error) {
        if (sendDatabaseError(request, reply, loaded.error)) return
        throw loaded.error
      }
      const body = loaded.data === null ? null : schema.parse(loaded.data)
      // Ohne gespeicherte Positionsdaten gibt es nichts zu zeigen; die Seite nutzt dann die Matrizen (R-05).
      if (body === null || ('tracks' in body && body.tracks.length === 0)) {
        return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      }
      return reply.send(body)
    })
  }

  // Spec 002, PR 4: Saison der Mannschaft fuer Veo Analytics; die Kennzahlen rechnet das Web mit packages/domain.
  app.get('/v1/playerboard/teams/:teamId/veo/season', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = TeamParamsSchema.parse(request.params)
    const query = PlayerboardVeoSeasonQuerySchema.parse(request.query)
    const scope = await loadTeamScope(supabaseClients.forService(), params.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requireStatsAccess(context, request, reply, scope))) return
    const season = await supabaseClients.forUser(request.auth!.accessToken).rpc('playerboard_veo_team_season', {
      target_team_id: params.teamId, from_date: query.from ?? null, to_date: query.to ?? null,
      kinds: query.kinds ?? null, fixture_ids: query.fixtureIds ?? null, last_n: query.last ?? null,
    })
    if (season.error) {
      if (sendDatabaseError(request, reply, season.error)) return
      throw season.error
    }
    return reply.send(z.array(PlayerboardVeoSeasonMatchSchema).parse(season.data ?? []))
  })

  // Spec 002, PR 5: Spielerwerte je Spiel und Heatmaps eines Spielers fuer den Reiter Spieler.
  app.get('/v1/playerboard/teams/:teamId/veo/season/players', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = TeamParamsSchema.parse(request.params)
    const query = PlayerboardVeoSeasonQuerySchema.parse(request.query)
    const scope = await loadTeamScope(supabaseClients.forService(), params.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requireStatsAccess(context, request, reply, scope))) return
    const season = await supabaseClients.forUser(request.auth!.accessToken).rpc('playerboard_veo_player_season', {
      target_team_id: params.teamId, from_date: query.from ?? null, to_date: query.to ?? null,
      kinds: query.kinds ?? null, fixture_ids: query.fixtureIds ?? null, last_n: query.last ?? null,
    })
    if (season.error) {
      if (sendDatabaseError(request, reply, season.error)) return
      throw season.error
    }
    return reply.send(z.array(PlayerboardVeoPlayerSeasonMatchSchema).parse(season.data ?? []))
  })

  app.get('/v1/playerboard/teams/:teamId/veo/season/heatmaps', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = TeamParamsSchema.parse(request.params)
    const query = PlayerboardVeoPlayerHeatmapsQuerySchema.parse(request.query)
    const scope = await loadTeamScope(supabaseClients.forService(), params.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requireStatsAccess(context, request, reply, scope))) return
    const heatmaps = await supabaseClients.forUser(request.auth!.accessToken).rpc('playerboard_veo_player_heatmaps', {
      target_team_id: params.teamId, target_player_id: query.playerId ?? null, target_jersey_number: query.jerseyNumber ?? null,
      from_date: query.from ?? null, to_date: query.to ?? null,
      kinds: query.kinds ?? null, fixture_ids: query.fixtureIds ?? null, last_n: query.last ?? null,
    })
    if (heatmaps.error) {
      if (sendDatabaseError(request, reply, heatmaps.error)) return
      throw heatmaps.error
    }
    return reply.send(z.array(PlayerboardVeoPlayerHeatmapSchema).parse(heatmaps.data ?? []))
  })

  app.get('/v1/playerboard/teams/:teamId/veo/views', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = TeamParamsSchema.parse(request.params)
    const scope = await loadTeamScope(supabaseClients.forService(), params.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requireStatsAccess(context, request, reply, scope))) return
    const views = await supabaseClients.forUser(request.auth!.accessToken).rpc('playerboard_veo_team_views', { target_team_id: params.teamId })
    if (views.error) {
      if (sendDatabaseError(request, reply, views.error)) return
      throw views.error
    }
    return reply.send(PlayerboardVeoTeamViewsSchema.parse(views.data))
  })

  // Kennzahlen und Radar speichern: Trainer mit training.manage, wie die Zuordnung der Rueckennummern.
  app.put('/v1/playerboard/teams/:teamId/veo/views', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = TeamParamsSchema.parse(request.params)
    const input = PlayerboardVeoTeamViewsSchema.safeParse(request.body)
    if (!input.success) return reply.code(422).send({ error: 'invalid_metric', correlationId: request.id })
    const scope = await loadTeamScope(supabaseClients.forService(), params.teamId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'training.manage', scope))) return
    const saved = await supabaseClients.forUser(request.auth!.accessToken).rpc('playerboard_veo_save_team_views', {
      target_team_id: params.teamId, p_key_metrics: input.data.keyMetrics, p_radar: input.data.radar,
    })
    if (saved.error) {
      if (saved.error.message?.includes('comparing_team_not_available')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      if (sendDatabaseError(request, reply, saved.error)) return
      throw saved.error
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'playerboard.veo_views_changed', entityType: 'team', entityId: params.teamId,
      metadata: { keyMetrics: input.data.keyMetrics, radar: input.data.radar },
    })
    return reply.send(PlayerboardVeoTeamViewsSchema.parse(saved.data))
  })
}
