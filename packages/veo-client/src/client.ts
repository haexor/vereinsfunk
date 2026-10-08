import { z } from 'zod'
import { VeoError } from './errors.js'
import { veoRequest, type VeoHttpOptions } from './http.js'

// Paket 053, PR 1 (aus playerboard app/server/utils/veo/client.ts, mapStats.ts, mapPlayerStats.ts):
// Aufrufe der inoffiziellen Veo-Web-API mit einem Zugriffstoken. Jede Antwort laeuft durch ein
// Zod-Schema; passt sie nicht, endet der Aufruf mit upstream_changed, statt falsche Werte zu liefern.

const API_BASE = 'https://app.veo.co/api/app'

/** GET/POST gegen die Veo-API; 401/403 bedeuten ein abgelaufenes Token, andere Fehler upstream_error. */
async function veoApi(accessToken: string, path: string, init: RequestInit, options: VeoHttpOptions): Promise<{ status: number; json: unknown }> {
  const response = await veoRequest(`${API_BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...init.headers },
  }, options)
  if (response.status === 401 || response.status === 403) {
    throw new VeoError('auth_expired', `Veo API rejected the token: ${init.method ?? 'GET'} ${path.split('?')[0]}`, response.status)
  }
  if (!response.ok) {
    return { status: response.status, json: null }
  }
  try {
    return { status: response.status, json: await response.json() }
  } catch {
    throw new VeoError('upstream_changed', `Veo API returned no JSON: ${path.split('?')[0]}`)
  }
}

/** Wie veoApi, wirft aber bei jedem Fehlerstatus. */
async function veoApiOk(accessToken: string, path: string, init: RequestInit, options: VeoHttpOptions): Promise<unknown> {
  const result = await veoApi(accessToken, path, init, options)
  if (result.status >= 300) throw new VeoError('upstream_error', `Veo API request failed: ${init.method ?? 'GET'} ${path.split('?')[0]} -> ${result.status}`, result.status)
  return result.json
}

/** Prueft eine Antwort gegen ihr Schema; eine geaenderte Form ergibt upstream_changed. */
function parseOrChanged<T>(schema: z.ZodType<T>, json: unknown, what: string): T {
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new VeoError('upstream_changed', `Unexpected Veo ${what} response shape`)
  return parsed.data
}

// --- Vereine und Mannschaften (nur fuer das Verbinden) ------------------------------------------

const SlugNameSchema = z.object({ slug: z.string().min(1), name: z.string() })
export type VeoClub = z.infer<typeof SlugNameSchema>
export type VeoTeam = z.infer<typeof SlugNameSchema>

/** Alle Veo-Vereine, denen der angemeldete Veo-Nutzer angehoert. */
export async function listOwnClubs(accessToken: string, options: VeoHttpOptions = {}): Promise<VeoClub[]> {
  const query = new URLSearchParams({ page_size: '500', filter: 'own' })
  for (const field of ['slug', 'name']) query.append('fields', field)
  return parseOrChanged(z.array(SlugNameSchema), await veoApiOk(accessToken, `/clubs/?${query}`, {}, options), 'clubs')
}

/** Alle Mannschaften eines Veo-Vereins. */
export async function listClubTeams(accessToken: string, clubSlug: string, options: VeoHttpOptions = {}): Promise<VeoTeam[]> {
  const query = new URLSearchParams()
  for (const field of ['slug', 'name']) query.append('fields', field)
  return parseOrChanged(z.array(SlugNameSchema), await veoApiOk(accessToken, `/clubs/${encodeURIComponent(clubSlug)}/teams/?${query}`, {}, options), 'teams')
}

// --- Spiele -------------------------------------------------------------------------------------

const MatchListItemSchema = z.object({
  identifier: z.string().min(1),
  start: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'unparseable start'),
  title: z.string(),
  opponent_team_name: z.string(),
  has_analytics_enabled: z.boolean(),
  own_team_home_or_away: z.enum(['home', 'away']),
  // Verschachtelt, nicht team__id: Veo ignoriert die fields-Auswahl inzwischen (playerboard,
  // Live-Fehler vom 2026-09-25).
  team: z.object({ id: z.string().min(1) }),
  info: z.object({
    stats: z.object({
      score_aggregated: z.object({ own: z.number().int().nullable(), opponent: z.number().int().nullable() }),
    }).nullable().optional(),
  }).nullable().optional(),
})

export interface VeoMatch {
  veoMatchId: string
  veoTeamId: string
  // ISO-Zeitpunkt des Anstosses laut Veo.
  start: string
  title: string
  opponentName: string
  homeOrAway: 'home' | 'away'
  hasAnalytics: boolean
  // Endstand aus Sicht der eigenen Mannschaft; null, solange Veo keinen vollstaendigen Stand kennt.
  score: { own: number; opponent: number } | null
}

/** Uebersetzt eine rohe Spieleliste; exportiert, damit Tests sie ohne Netz pruefen koennen. */
export function parseMatchList(json: unknown): VeoMatch[] {
  return parseOrChanged(z.array(MatchListItemSchema), json, 'matches').map((item) => {
    const aggregated = item.info?.stats?.score_aggregated
    return {
      veoMatchId: item.identifier,
      veoTeamId: item.team.id,
      start: new Date(item.start).toISOString(),
      title: item.title,
      opponentName: item.opponent_team_name,
      homeOrAway: item.own_team_home_or_away,
      hasAnalytics: item.has_analytics_enabled,
      score: aggregated && aggregated.own !== null && aggregated.opponent !== null ? { own: aggregated.own, opponent: aggregated.opponent } : null,
    }
  })
}

const MATCH_LIST_FIELDS = ['identifier', 'start', 'title', 'opponent_team_name', 'has_analytics_enabled', 'own_team_home_or_away', 'team', 'info']

/**
 * Alle Spiele einer Veo-Mannschaft, neueste zuerst. Der erste Sync importiert die ganze Historie
 * (playerboard 003 FR-005), playerboard las aber nur die ersten 50. Deshalb wird seitenweise
 * gelesen, bis eine Seite kuerzer ist, nichts Neues bringt oder Veo die Seite nicht kennt -- ob
 * Veo "page" auswertet, ist unbelegt; wird es ignoriert, endet die Schleife nach der ersten Seite.
 */
export async function listMatches(
  accessToken: string,
  params: { veoClubSlug: string; veoTeamSlug: string },
  options: VeoHttpOptions & { pageSize?: number; maxPages?: number } = {},
): Promise<VeoMatch[]> {
  const pageSize = options.pageSize ?? 50
  const maxPages = options.maxPages ?? 40
  const seen = new Map<string, VeoMatch>()
  for (let page = 1; page <= maxPages; page += 1) {
    const query = new URLSearchParams({
      team: params.veoTeamSlug, club: params.veoClubSlug, ordering: '-created', page_size: String(pageSize), page: String(page), analytics_version: '2',
    })
    for (const field of MATCH_LIST_FIELDS) query.append('fields', field)
    const result = await veoApi(accessToken, `/matches/?${query}`, {}, options)
    // Eine Seite hinter dem Ende beantwortet Django REST Framework mit 404.
    if (page > 1 && result.status === 404) break
    if (result.status >= 300) throw new VeoError('upstream_error', `Veo matches request failed -> ${result.status}`, result.status)
    const matches = parseMatchList(result.json)
    const fresh = matches.filter((match) => !seen.has(match.veoMatchId))
    for (const match of fresh) seen.set(match.veoMatchId, match)
    if (matches.length < pageSize || fresh.length === 0) break
    if (page === maxPages) {
      throw new VeoError('upstream_error', `Veo matches history exceeds the configured page limit (${maxPages})`)
    }
  }
  return [...seen.values()]
}

// --- Mannschaftswerte je Spiel --------------------------------------------------------------------

const TeamStatsSchema = z.object({
  items: z.array(z.object({
    match_id: z.string().min(1),
    team_association: z.enum(['own', 'opponent']),
    stats: z.array(z.object({
      type: z.string().min(1),
      category: z.object({ id: z.string().min(1) }),
      value: z.number().int(),
      periods: z.array(z.object({ period: z.number().int(), value: z.number() })),
    })),
  })),
})

export interface VeoTeamStat {
  veoMatchId: string
  teamAssociation: 'own' | 'opponent'
  statType: string
  category: string
  value: number
  periodValues: { period: number; value: number }[]
}

/** Mannschaftswerte aus analysis/stats (group_by team_association); nur, was Veo liefert. */
export function parseTeamStats(json: unknown): VeoTeamStat[] {
  return parseOrChanged(TeamStatsSchema, json, 'team stats').items.flatMap((item) =>
    item.stats.map((stat) => ({
      veoMatchId: item.match_id,
      teamAssociation: item.team_association,
      statType: stat.type,
      category: stat.category.id,
      value: stat.value,
      periodValues: stat.periods,
    })))
}

/** POST analysis/stats fuer mehrere Spiele einer Veo-Mannschaft, je Spiel und Mannschaftsseite. */
export async function fetchTeamStats(accessToken: string, params: { veoTeamId: string; veoMatchIds: readonly string[] }, options: VeoHttpOptions = {}): Promise<VeoTeamStat[]> {
  const json = await veoApiOk(accessToken, '/analysis/stats/', {
    method: 'POST',
    body: JSON.stringify({ type: 'team_match', team_id: params.veoTeamId, match_ids: params.veoMatchIds, group_by: 'team_association' }),
  }, options)
  return parseTeamStats(json)
}

// --- Spielerwerte je Spiel ------------------------------------------------------------------------

// Die gespeicherten Spielerwerte (playerboard 004, research.md §3); alles andere wird verworfen. Veo
// liefert je Wert keine Kategorie mehr, sie wird hier zugeordnet.
export const CURATED_PLAYER_STATS: Readonly<Record<string, 'physical' | 'attacking'>> = {
  distance_total_meters: 'physical',
  sprints_total: 'physical',
  top_speed_kmh: 'physical',
  average_speed_kmh: 'physical',
  high_intensity_runs_total: 'physical',
  seconds_played_total: 'physical',
  football_shots_total: 'attacking',
  football_goal_total: 'attacking',
  football_goal_involvement_total: 'attacking',
}

const PlayerStatsSchema = z.object({
  items: z.array(z.object({
    // Rueckennummer als Ziffernfolge; das negative Lookahead verhindert, dass "$" vor einem
    // Zeilenumbruch passt.
    jersey_number: z.string().regex(/^\d+(?![\s\S])/),
    stats: z.array(z.object({ type: z.string(), value: z.number() })),
  })),
})

export interface VeoPlayerStats {
  jerseyNumber: number
  stats: { statType: string; category: 'physical' | 'attacking'; value: number }[]
}

/**
 * Spielerwerte aus analysis/stats (group_by player) nach Rueckennummer. Nur die kuratierten Werte;
 * doppelte Eintraege derselben Nummer und desselben Werts behalten das erste Vorkommen. Die
 * Zuordnung zum Kader ist Sache des Syncs (Rueckennummer kann unbekannt sein).
 */
export function parsePlayerStats(json: unknown): VeoPlayerStats[] {
  const byJersey = new Map<number, Map<string, VeoPlayerStats['stats'][number]>>()
  for (const item of parseOrChanged(PlayerStatsSchema, json, 'player stats').items) {
    const jerseyNumber = Number.parseInt(item.jersey_number, 10)
    if (!Number.isSafeInteger(jerseyNumber)) continue
    const stats = byJersey.get(jerseyNumber) ?? new Map()
    for (const stat of item.stats) {
      const category = Object.prototype.hasOwnProperty.call(CURATED_PLAYER_STATS, stat.type) ? CURATED_PLAYER_STATS[stat.type] : undefined
      if (!category || stats.has(stat.type)) continue
      stats.set(stat.type, { statType: stat.type, category, value: stat.value })
    }
    byJersey.set(jerseyNumber, stats)
  }
  return [...byJersey.entries()].map(([jerseyNumber, stats]) => ({ jerseyNumber, stats: [...stats.values()] }))
}

/**
 * POST analysis/stats je Spieler fuer genau ein Spiel. Veo fasst bei group_by player ueber alle
 * uebergebenen Spiele zusammen ("cross_match"); fuer Werte je Spiel deshalb ein Aufruf je Spiel.
 * team_id ist Pflicht (sonst 400, playerboard 2026-09-25).
 */
export async function fetchPlayerStats(accessToken: string, params: { veoTeamId: string; veoMatchId: string }, options: VeoHttpOptions = {}): Promise<VeoPlayerStats[]> {
  const json = await veoApiOk(accessToken, '/analysis/stats/', {
    method: 'POST',
    body: JSON.stringify({ type: 'cross_match', team_id: params.veoTeamId, group_by: 'player', match_ids: [params.veoMatchId] }),
  }, options)
  return parsePlayerStats(json)
}
