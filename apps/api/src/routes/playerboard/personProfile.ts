import { hasPermission } from '@vereinsfunk/authorization'
import { PersonProfileQuerySchema, PersonProfileSchema, UuidSchema } from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { permissionScopeKey } from '../../auth.js'
import type { ApiRouteContext } from '../context.js'
import { resolveRolesForScopes } from '../shared.js'
import { loadTeamScope } from './shared.js'

// Rueckgabe von public.person_profile (2026101701_person_profile.sql). An dieser Grenze validiert,
// damit eine abweichende Datenbankantwort nie als halbes Profil beim Browser ankommt.
const ProfileRowSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  status: z.string(),
  teams: z.array(z.object({
    teamId: UuidSchema,
    teamName: z.string(),
    playerId: UuidSchema,
    jerseyNumber: z.number().nullable(),
    position: z.string().nullable(),
    active: z.boolean(),
    isSelf: z.boolean(),
    rank: z.number().nullable(),
    total: z.number(),
    categoryTotals: z.record(z.string(), z.number()),
  })),
})

const SCOPE_RANK: Readonly<Record<string, number>> = { organization: 0, department: 1, team: 2 }

/**
 * Spielerprofil auf Vereinsebene. Absichtlich keine Scope-Vorabpruefung: jede Pruefung anhand der
 * Person verriete, ob es sie gibt. Die Datenbankfunktion liefert null fuer "unbekannt" und
 * "nicht sichtbar" gleichermassen, die Route antwortet in beiden Faellen mit demselben 404.
 */
export function registerPersonProfileRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, supabaseClients, roleProvider } = context

  app.get('/v1/people/:id/profile', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = PersonProfileQuerySchema.parse(request.query)
    // Personenbezogen: weder Browser noch Zwischenspeicher duerfen die Antwort behalten.
    reply.header('Cache-Control', 'private, no-store')

    const result = await supabaseClients.forUser(request.auth!.accessToken).rpc('person_profile', { target_person_id: params.id, period: query.period })
    if (result.error) throw result.error
    if (result.data === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    // safeParse statt parse: ein ZodError wuerde der Fehlerhandler als 400 (Eingabefehler) melden, die
    // Abweichung liegt hier aber bei der Datenbankantwort und ist ein 500.
    const row = ProfileRowSchema.safeParse(result.data)
    if (!row.success) throw new Error('person_profile returned an unexpected shape', { cause: row.error })
    const profile = row.data
    const service = supabaseClients.forService()

    // Namen und Reihenfolge der Kategorien: auch bereits deaktivierte mit Punkten im Zeitraum, damit die
    // Kategorien zur Summe passen (wie die Rangliste). Die Ids stammen aus der eigenen Antwort.
    const categoryIds = [...new Set(profile.teams.flatMap((team) => Object.keys(team.categoryTotals)))]
    const names = new Map<string, { name: string; order: [number, number, string] }>()
    if (categoryIds.length > 0) {
      const categories = await service.from('playerboard_point_categories')
        .select('id, name, scope, sort_order').eq('organization_id', profile.organizationId).in('id', categoryIds)
      if (categories.error) throw categories.error
      for (const row of categories.data as { id: string; name: string; scope: string; sort_order: number }[]) {
        names.set(row.id, { name: row.name, order: [SCOPE_RANK[row.scope] ?? 2, row.sort_order, row.name] })
      }
    }
    const byOrder = (a: [number, number, string], b: [number, number, string]) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2])

    // Verwaltungsangaben wie im Kader (GET .../players): nur mit training.manage in mindestens einer der
    // sichtbaren Mannschaften der Person. Nur diese beiden Spalten -- nie das Geburtsjahr.
    const scopes = (await Promise.all(profile.teams.map((team) => loadTeamScope(service, team.teamId)))).flatMap((scope) => (scope ? [scope] : []))
    const roles = await resolveRolesForScopes(roleProvider, request.auth!, scopes)
    const canManage = scopes.some((scope) => hasPermission(roles.get(permissionScopeKey(scope)) ?? [], 'training.manage'))
    let management: { email: string | null; hasAccount: boolean } | null = null
    if (canManage) {
      const person = await service.from('directory_people').select('email, profile_id').eq('id', profile.id).maybeSingle()
      if (person.error) throw person.error
      if (person.data) management = { email: (person.data.email as string | null) ?? null, hasAccount: person.data.profile_id !== null }
    }

    return reply.code(200).send(PersonProfileSchema.parse({
      id: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      status: profile.status,
      teams: profile.teams.map((team) => ({
        teamId: team.teamId,
        teamName: team.teamName,
        playerId: team.playerId,
        jerseyNumber: team.jerseyNumber,
        position: team.position,
        active: team.active,
        isSelf: team.isSelf,
        rank: team.rank,
        total: team.total,
        categories: Object.entries(team.categoryTotals)
          .flatMap(([id, points]) => { const category = names.get(id); return category ? [{ name: category.name, order: category.order, points }] : [] })
          .sort((a, b) => byOrder(a.order, b.order))
          .map(({ name, points }) => ({ name, points })),
      })),
      ...(management ?? {}),
    }))
  })
}
