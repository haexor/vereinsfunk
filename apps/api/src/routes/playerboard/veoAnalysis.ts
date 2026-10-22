import { PlayerboardVeoMatchAnalysisSchema, PlayerboardVeoMatchTracksSchema, UuidSchema } from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from '../context.js'
import { loadTeamScope, requireStatsAccess, sendDatabaseError } from './shared.js'

// Spec 002, PR 2: Spielauswertung eines Veo-Spiels (contracts/veo-analysis.md). Erst das Modul, dann
// die Sicht auf die Kennzahlen der Mannschaft; ein unbekanntes Spiel und eines einer anderen
// Mannschaft geben dasselbe 404. Gelesen wird ueber den Nutzer-Client, die Funktionen pruefen die
// Sicht ein zweites Mal.

const ParamsSchema = z.object({ teamId: UuidSchema, fixtureId: UuidSchema })

/** Registriert Auswertung und Positionsdaten eines Spiels. */
export function registerPlayerboardVeoAnalysisRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, supabaseClients } = context

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
}
