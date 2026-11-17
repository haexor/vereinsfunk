import {
  PlayerboardRankingQuerySchema,
  PublicPlayerboardTrainingSchema,
  PublicPlayerboardTrainingSummarySchema,
  PublicPlayerboardPhotoSchema,
  PublicPlayerboardRankingEntrySchema,
  PublicPlayerboardTeamSchema,
  PublicPlayerboardVeoMatchSchema,
  PublicTeamAddressSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { currentSeasonStart, localDateKey } from '@vereinsfunk/domain'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from '../context.js'
import { loadResolvedBrandColors } from '../../services/brandResolution.js'
import { signPhotoUrls } from './photos.js'
import { loadOrganizationPlayerboardSettings, resolveSettingsFor } from './shared.js'

// Verein, Abteilung und Mannschaft: /mannschaft/{verein}/{abteilung}/{mannschaft} (ADR-014).
const PUBLIC_TEAM_API = '/v1/public/playerboard/:orgSlug/:departmentSlug/:teamSlug'
// Kurzlebig: die oeffentliche Seite laedt die Fotos beim Oeffnen, ein geteilter Link soll nicht
// dauerhaft auf die Datei zeigen (Muster Medien-Grant, Paket 025).
const PUBLIC_PHOTO_URL_SECONDS = 300

/** Argumente der oeffentlichen RPCs: dieselben drei Slugs wie in der URL. */
function rpcAddress(address: z.infer<typeof PublicTeamAddressSchema>) {
  return { org_slug: address.orgSlug, department_slug: address.departmentSlug, team_slug: address.teamSlug }
}

/**
 * Paket 052: oeffentliche Mannschaftsseite ohne Anmeldung (Muster oeffentliches Impressum, Paket 020).
 * Alles laeuft ueber security-definer-Funktionen, die nur service_role ausfuehren darf; sie pruefen
 * Schalter, public_sharing_allowed und Modul selbst und geben Spielernamen im eingestellten Format
 * aus, ohne weitere Personenfelder offenzulegen.
 */
export function registerPlayerboardPublicRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { supabaseClients, checkRateLimit } = context

  /**
   * Prueft IP-Rate-Limit und die drei Slugs und laedt die oeffentlich freigegebene Mannschaft per RPC.
   * Die Datenbank loest Verein, Abteilung und Mannschaft gemeinsam auf; jede Abweichung ergibt
   * dieselbe 404-Antwort. Sendet bei Ablehnung 429 bzw. 404 und liefert null.
   */
  async function loadTeam(request: FastifyRequest, reply: FastifyReply) {
    if (!checkRateLimit(`playerboard-public:${request.ip}`, 120, 60_000)) {
      reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
      return null
    }
    const address = PublicTeamAddressSchema.safeParse(request.params)
    if (!address.success) {
      reply.code(404).send({ error: 'not_found', correlationId: request.id })
      return null
    }
    const info = await supabaseClients.forService().rpc('playerboard_public_team_info', rpcAddress(address.data))
    if (info.error) throw info.error
    const row = z.array(z.object({
      organization_name: z.string(),
      team_name: z.string(),
      points_enabled: z.boolean(),
      trainings_enabled: z.boolean(),
      veo_stats_enabled: z.boolean(),
      photos_enabled: z.boolean(),
      // Nur fuer die API: Vereinsfarben und Saisonbeginn werden ueber die IDs geladen, nach aussen gehen sie nie.
      organization_id: UuidSchema,
      department_id: UuidSchema,
      team_id: UuidSchema,
    })).nullable().parse(info.data)?.[0]
    if (!row) {
      reply.code(404).send({ error: 'not_found', correlationId: request.id })
      return null
    }
    return { address: address.data, row }
  }

  /**
   * Saisonanfang und Vereinsfarben einer bereits als oeffentlich bestaetigten Mannschaft. Die IDs
   * bleiben in der API; nach aussen gehen nur das Datum und zwei Farben.
   */
  async function loadTeamPresentation(ids: { organization_id: string; department_id: string; team_id: string }) {
    const service = supabaseClients.forService()
    const organization = await service.from('organizations').select('timezone').eq('id', ids.organization_id).single()
    if (organization.error) throw organization.error
    const settings = await loadOrganizationPlayerboardSettings(service, ids.organization_id)
    const scope = { departmentId: ids.department_id, teamId: ids.team_id }
    const brand = await loadResolvedBrandColors(service, ids.organization_id, scope.departmentId, scope.teamId)
    const timezone = (organization.data.timezone as string | null) ?? 'Europe/Berlin'
    const today = localDateKey(new Date(), timezone)
    return { seasonFrom: currentSeasonStart(resolveSettingsFor(settings, scope).seasonStart, today), brand, timezone }
  }

  app.get(PUBLIC_TEAM_API, async (request, reply) => {
    const team = await loadTeam(request, reply)
    if (!team) return
    const presentation = await loadTeamPresentation(team.row)
    return reply.code(200).send(PublicPlayerboardTeamSchema.parse({
      organizationName: team.row.organization_name, teamName: team.row.team_name,
      tabs: { points: team.row.points_enabled, trainings: team.row.trainings_enabled, veoStats: team.row.veo_stats_enabled, photos: team.row.photos_enabled },
      ...presentation,
    }))
  })

  app.get(`${PUBLIC_TEAM_API}/trainings`, async (request, reply) => {
    const team = await loadTeam(request, reply)
    if (!team) return
    if (!team.row.trainings_enabled) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const trainings = await supabaseClients.forService().rpc('playerboard_public_trainings', {
      ...rpcAddress(team.address),
    })
    if (trainings.error) throw trainings.error
    return reply.code(200).send((trainings.data ?? []).map((row: { training_id: string; training_date: string }) =>
      PublicPlayerboardTrainingSummarySchema.parse({ id: row.training_id, trainingDate: row.training_date }),
    ))
  })

  app.get(`${PUBLIC_TEAM_API}/trainings/:trainingId`, async (request, reply) => {
    const team = await loadTeam(request, reply)
    if (!team) return
    if (!team.row.trainings_enabled) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const params = z.object({ trainingId: UuidSchema }).safeParse(request.params)
    if (!params.success) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const training = await supabaseClients.forService().rpc('playerboard_public_training', {
      ...rpcAddress(team.address), target_training_id: params.data.trainingId,
    })
    if (training.error) throw training.error
    if (!training.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return reply.code(200).send(PublicPlayerboardTrainingSchema.parse(training.data))
  })

  app.get(`${PUBLIC_TEAM_API}/ranking`, async (request, reply) => {
    const team = await loadTeam(request, reply)
    if (!team) return
    if (!team.row.points_enabled) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const query = PlayerboardRankingQuerySchema.parse(request.query)
    const ranking = await supabaseClients.forService().rpc('playerboard_public_ranking', {
      ...rpcAddress(team.address), from_date: query.from ?? null, to_date: query.to ?? null,
    })
    if (ranking.error) throw ranking.error
    const rows = (ranking.data ?? []) as { rank: number; label: string; total: number; category_totals: { category: string; points: number }[] }[]
    return reply.code(200).send(rows.map((row) => PublicPlayerboardRankingEntrySchema.parse({
      rank: Number(row.rank), label: row.label, total: Number(row.total),
      categories: (row.category_totals ?? []).map((entry) => ({ category: entry.category, points: Number(entry.points) })),
    })))
  })

  // Paket 053: Spiele mit Mannschafts- und Spielerwerten im teambezogenen Namensformat.
  app.get(`${PUBLIC_TEAM_API}/veo`, async (request, reply) => {
    const team = await loadTeam(request, reply)
    if (!team) return
    if (!team.row.veo_stats_enabled) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const query = PlayerboardRankingQuerySchema.parse(request.query)
    const matches = await supabaseClients.forService().rpc('playerboard_public_veo_stats', {
      ...rpcAddress(team.address), from_date: query.from ?? null, to_date: query.to ?? null,
    })
    if (matches.error) throw matches.error
    return reply.code(200).send(z.array(PublicPlayerboardVeoMatchSchema).parse(matches.data ?? []))
  })

  app.get(`${PUBLIC_TEAM_API}/photos`, async (request, reply) => {
    const team = await loadTeam(request, reply)
    if (!team) return
    if (!team.row.photos_enabled) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const query = PlayerboardRankingQuerySchema.parse(request.query)
    const service = supabaseClients.forService()
    const photos = await service.rpc('playerboard_public_photos', {
      ...rpcAddress(team.address), from_date: query.from ?? null, to_date: query.to ?? null,
    })
    if (photos.error) throw photos.error
    const rows = (photos.data ?? []) as { storage_path: string; training_date: string }[]
    if (rows.length === 0) return reply.code(200).send([])
    const urlByPath = await signPhotoUrls(service, rows.map((row) => row.storage_path), PUBLIC_PHOTO_URL_SECONDS)
    return reply.code(200).send(rows.flatMap((row) => {
      const url = urlByPath.get(row.storage_path)
      return url ? [PublicPlayerboardPhotoSchema.parse({ url, trainingDate: row.training_date })] : []
    }))
  })

  // Die fruehere zweiteilige Adresse (und jede andere nicht mehr vergebene Form) liefert dieselbe
  // 404-Antwort wie eine unbekannte Mannschaft: keine Daten, keine Weiterleitung, kein RPC.
  // Der Wildcard-Pfad hat die niedrigste Prioritaet und verdeckt keine dreiteilige Adresse, auch
  // keine Mannschaft mit dem Slug trainings, ranking, veo oder photos.
  app.get('/v1/public/playerboard/*', async (request, reply) => reply.code(404).send({ error: 'not_found', correlationId: request.id }))
}
