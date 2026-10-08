import {
  PlayerboardRankingQuerySchema,
  PublicPlayerboardPhotoSchema,
  PublicPlayerboardRankingEntrySchema,
  PublicPlayerboardTeamSchema,
} from '@vereinsfunk/contracts'
import { currentSeasonStart } from '@vereinsfunk/domain'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from '../context.js'
import { loadResolvedBrandColors } from '../imageStyle.js'
import { checkRateLimit } from '../shared.js'
import { PLAYERBOARD_PHOTO_BUCKET } from './photos.js'
import { loadOrganizationPlayerboardSettings, resolveSettingsFor } from './shared.js'

const SlugSchema = z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const ParamsSchema = z.object({ orgSlug: SlugSchema, teamSlug: SlugSchema })
// Kurzlebig: die oeffentliche Seite laedt die Fotos beim Oeffnen, ein geteilter Link soll nicht
// dauerhaft auf die Datei zeigen (Muster Medien-Grant, Paket 025).
const PUBLIC_PHOTO_URL_SECONDS = 300

/**
 * Paket 052: oeffentliche Mannschaftsseite ohne Anmeldung (Muster oeffentliches Impressum, Paket 020).
 * Alles laeuft ueber security-definer-Funktionen, die nur service_role ausfuehren darf; sie pruefen
 * Schalter, public_sharing_allowed und Modul selbst und geben Spieler nur als "#7 M. K." aus.
 */
export function registerPlayerboardPublicRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { supabaseClients } = context

  /**
   * Prueft IP-Rate-Limit und Slugs und laedt die oeffentlich freigegebene Mannschaft per RPC.
   * Sendet bei Ablehnung 429 bzw. 404 und liefert null.
   */
  async function loadTeam(request: FastifyRequest, reply: FastifyReply) {
    if (!checkRateLimit(`playerboard-public:${request.ip}`, 120, 60_000)) {
      reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
      return null
    }
    const params = ParamsSchema.safeParse(request.params)
    if (!params.success) {
      reply.code(404).send({ error: 'not_found', correlationId: request.id })
      return null
    }
    const info = await supabaseClients.forService().rpc('playerboard_public_team_info', { org_slug: params.data.orgSlug, team_slug: params.data.teamSlug })
    if (info.error) throw info.error
    const row = (info.data as { organization_name: string; team_name: string; points_enabled: boolean; veo_stats_enabled: boolean; photos_enabled: boolean }[] | null)?.[0]
    if (!row) {
      reply.code(404).send({ error: 'not_found', correlationId: request.id })
      return null
    }
    return { ...params.data, row }
  }

  /**
   * Saisonanfang und Vereinsfarben einer bereits als oeffentlich bestaetigten Mannschaft. Die IDs
   * bleiben in der API; nach aussen gehen nur das Datum und zwei Farben.
   */
  async function loadTeamPresentation(orgSlug: string, teamSlug: string) {
    const service = supabaseClients.forService()
    const organization = await service.from('organizations').select('id, timezone').eq('slug', orgSlug).single()
    if (organization.error) throw organization.error
    const organizationId = organization.data.id as string
    const settings = await loadOrganizationPlayerboardSettings(service, organizationId)
    const team = [...settings.teamById.values()].find((row) => row.public_slug === teamSlug)
    if (!team?.team_id || !team.department_id) throw new Error('public team without settings row')
    const scope = { departmentId: team.department_id, teamId: team.team_id }
    const brand = await loadResolvedBrandColors(service, organizationId, scope.departmentId, scope.teamId)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: (organization.data.timezone as string | null) ?? 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    return { seasonFrom: currentSeasonStart(resolveSettingsFor(settings, scope).seasonStart, today), brand }
  }

  app.get('/v1/public/playerboard/:orgSlug/:teamSlug', async (request, reply) => {
    const team = await loadTeam(request, reply)
    if (!team) return
    const presentation = await loadTeamPresentation(team.orgSlug, team.teamSlug)
    return reply.code(200).send(PublicPlayerboardTeamSchema.parse({
      organizationName: team.row.organization_name, teamName: team.row.team_name,
      tabs: { points: team.row.points_enabled, veoStats: team.row.veo_stats_enabled, photos: team.row.photos_enabled },
      ...presentation,
    }))
  })

  app.get('/v1/public/playerboard/:orgSlug/:teamSlug/ranking', async (request, reply) => {
    const team = await loadTeam(request, reply)
    if (!team) return
    if (!team.row.points_enabled) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const query = PlayerboardRankingQuerySchema.parse(request.query)
    const ranking = await supabaseClients.forService().rpc('playerboard_public_ranking', {
      org_slug: team.orgSlug, team_slug: team.teamSlug, from_date: query.from ?? null, to_date: query.to ?? null,
    })
    if (ranking.error) throw ranking.error
    const rows = (ranking.data ?? []) as { rank: number; label: string; total: number; category_totals: { category: string; points: number }[] }[]
    return reply.code(200).send(rows.map((row) => PublicPlayerboardRankingEntrySchema.parse({
      rank: Number(row.rank), label: row.label, total: Number(row.total),
      categories: (row.category_totals ?? []).map((entry) => ({ category: entry.category, points: Number(entry.points) })),
    })))
  })

  app.get('/v1/public/playerboard/:orgSlug/:teamSlug/photos', async (request, reply) => {
    const team = await loadTeam(request, reply)
    if (!team) return
    if (!team.row.photos_enabled) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const query = PlayerboardRankingQuerySchema.parse(request.query)
    const service = supabaseClients.forService()
    const photos = await service.rpc('playerboard_public_photos', {
      org_slug: team.orgSlug, team_slug: team.teamSlug, from_date: query.from ?? null, to_date: query.to ?? null,
    })
    if (photos.error) throw photos.error
    const rows = (photos.data ?? []) as { storage_path: string; training_date: string }[]
    if (rows.length === 0) return reply.code(200).send([])
    const signed = await service.storage.from(PLAYERBOARD_PHOTO_BUCKET).createSignedUrls(rows.map((row) => row.storage_path), PUBLIC_PHOTO_URL_SECONDS)
    if (signed.error) throw signed.error
    const urlByPath = new Map(signed.data.map((entry) => [entry.path, entry.signedUrl]))
    return reply.code(200).send(rows.flatMap((row) => {
      const url = urlByPath.get(row.storage_path)
      return url ? [PublicPlayerboardPhotoSchema.parse({ url, trainingDate: row.training_date })] : []
    }))
  })
}
