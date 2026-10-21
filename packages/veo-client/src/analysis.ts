import { z } from 'zod'
import { parseOrChanged, veoApi } from './client.js'
import { VeoError } from './errors.js'
import { VEO_RAS_HOST, veoRequest, type VeoHttpOptions } from './http.js'

// Spec 002 (research.md R-01): Abrufe fuer die Spielanalyse, genau die Endpunkte und Bodies, die die
// Veo-Web-App selbst nutzt (im Testabruf vom 2026-10-21 belegt). Jede Antwort laeuft durch ein
// Zod-Schema; eine geaenderte Form ergibt upstream_changed. Liefert Veo einen Teil fuer ein Spiel
// nicht (404), ist das Ergebnis null -- der Abgleich vermerkt den Teil dann als nicht verfuegbar.

const MES_BASE = 'https://app.veo.co/api/mes/v2'
const RAS_BASE = `https://${VEO_RAS_HOST}/recordings`
// Veos eigene Glaettung der Spieler-Heatmaps (Inventar §4.2.2).
const HEATMAP_SMOOTHING = 1.5

const enc = encodeURIComponent

/** GET/POST mit Token; 404 ergibt null, andere Fehlerstatus upstream_error. */
async function optionalApi<T>(accessToken: string, url: string, init: RequestInit, schema: z.ZodType<T>, what: string, options: VeoHttpOptions): Promise<T | null> {
  const result = await veoApi(accessToken, url, init, options)
  if (result.status === 404) return null
  if (result.status >= 300) throw new VeoError('upstream_error', `Veo ${what} request failed -> ${result.status}`, result.status)
  return parseOrChanged(schema, result.json, what)
}

/**
 * RAS (CloudFront) ohne Authorization-Header: mit Bearer-Token antwortet CloudFront mit 403, weil es
 * den Header als eigene Signatur deutet (research.md R-12). 404 ergibt null.
 */
async function optionalRas<T>(path: string, schema: z.ZodType<T>, what: string, options: VeoHttpOptions): Promise<T | null> {
  const response = await veoRequest(`${RAS_BASE}/${path}`, { headers: { accept: 'application/json' } }, options)
  if (response.status === 404) return null
  if (!response.ok) throw new VeoError('upstream_error', `Veo RAS ${what} request failed -> ${response.status}`, response.status)
  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new VeoError('upstream_changed', `Veo RAS returned no JSON: ${what}`)
  }
  return parseOrChanged(schema, json, what)
}

/** Rueckennummer aus Veos Zeichenkette; leer, -1 oder unbrauchbar ergibt null. */
function jerseyOf(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const number = typeof value === 'number' ? value : /^\d+$/.test(value) ? Number.parseInt(value, 10) : Number.NaN
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

// --- Spiel und Halbzeiten -------------------------------------------------------------------------

const MatchDetailSchema = z.object({
  identifier: z.string().min(1),
  slug: z.string().min(1),
  recordings: z.array(z.object({ identifier: z.string().min(1) })),
  team: z.object({
    id: z.string().min(1),
    hsr_threshold_kmh: z.number().nullable().optional(),
    sprint_threshold_kmh: z.number().nullable().optional(),
  }).nullable(),
})

export interface VeoMatchDetail {
  veoMatchId: string
  slug: string
  // RAS kennt das Spiel unter der ID seiner ersten Aufnahme.
  recordingId: string | null
  hsrThresholdKmh: number | null
  sprintThresholdKmh: number | null
}

export async function fetchMatchDetail(accessToken: string, veoMatchId: string, options: VeoHttpOptions = {}): Promise<VeoMatchDetail | null> {
  const detail = await optionalApi(accessToken, `/matches/${enc(veoMatchId)}/`, {}, MatchDetailSchema, 'match detail', options)
  if (!detail) return null
  return {
    veoMatchId: detail.identifier,
    slug: detail.slug,
    recordingId: detail.recordings[0]?.identifier ?? null,
    hsrThresholdKmh: detail.team?.hsr_threshold_kmh ?? null,
    sprintThresholdKmh: detail.team?.sprint_threshold_kmh ?? null,
  }
}

const PeriodsSchema = z.array(z.object({
  timeframe: z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
  own_side: z.enum(['left', 'right']),
  is_confirmed: z.boolean().optional(),
}))

export interface VeoPeriod {
  number: number
  startS: number
  endS: number
  // Seite, auf der die eigene Mannschaft in dieser Halbzeit verteidigt (Kamerasicht).
  ownSide: 'left' | 'right'
  // Nur zur Anzeige: Veo liefert Analysen auch bei false (research.md, Befund).
  confirmed: boolean
}

/** Halbzeiten nach Beginn sortiert und ab 1 nummeriert; Veos Nummern in Ereignissen folgen derselben Reihenfolge. */
export async function fetchPeriods(accessToken: string, slug: string, options: VeoHttpOptions = {}): Promise<VeoPeriod[]> {
  const periods = await optionalApi(accessToken, `/matches/${enc(slug)}/periods/`, {}, PeriodsSchema, 'periods', options)
  return (periods ?? [])
    .slice()
    .sort((a, b) => a.timeframe[0] - b.timeframe[0])
    .map((period, index) => ({ number: index + 1, startS: period.timeframe[0], endS: period.timeframe[1], ownSide: period.own_side, confirmed: period.is_confirmed ?? false }))
}

const ProcessingStatusSchema = z.object({
  analytics: z.string().nullable().optional(),
  ai_detection: z.string().nullable().optional(),
  match_report: z.object({ available: z.boolean() }).nullable().optional(),
})

export interface VeoProcessingStatus {
  // 'completed', 'processing', 'pending', 'error' oder 'not-purchased' (Inventar §1a.0.2).
  analytics: string | null
  aiDetection: string | null
  matchReportAvailable: boolean
}

export async function fetchProcessingStatus(accessToken: string, slug: string, options: VeoHttpOptions = {}): Promise<VeoProcessingStatus | null> {
  const status = await optionalApi(accessToken, `/matches/${enc(slug)}/feature-processing-status/`, {}, ProcessingStatusSchema, 'processing status', options)
  if (!status) return null
  return { analytics: status.analytics ?? null, aiDetection: status.ai_detection ?? null, matchReportAvailable: status.match_report?.available ?? false }
}

export type VeoAnalyticsVersion = '1' | '1.1' | '2'

/** Analyseversion wie die Veo-App sie aus dem RAS-Status ableitet (Inventar §1a.0.3). */
export function analyticsVersionOf(parts: Readonly<Record<string, string>>): VeoAnalyticsVersion {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(parts, key)
  if (!has('ball-tracking') || !has('match-details') || !has('shot-details')) return '1'
  return has('match-report') ? '2' : '1.1'
}

export interface VeoRasStatus {
  analyticsVersion: VeoAnalyticsVersion
  // Je RAS-Teil der Stand, z. B. { 'player-tracking': 'completed' }.
  parts: Record<string, string>
}

export async function fetchRasStatus(recordingId: string, options: VeoHttpOptions = {}): Promise<VeoRasStatus | null> {
  const status = await optionalRas(`${enc(recordingId)}/analytics`, z.record(z.string(), z.unknown()), 'analytics status', options)
  if (!status) return null
  const parts: Record<string, string> = {}
  for (const [key, value] of Object.entries(status)) if (key !== 'id' && typeof value === 'string') parts[key] = value
  return { analyticsVersion: analyticsVersionOf(parts), parts }
}

// --- Ereignisse -----------------------------------------------------------------------------------

const EventSchema = z.object({
  id: z.string().min(1),
  team: z.enum(['Own', 'Opponent']),
  eventType: z.string().min(1),
  playerJersey: z.string().nullable().optional(),
  periodId: z.number().int().min(1).nullable().optional(),
  periodTimeMs: z.number().int(),
  videoTimeMs: z.number().int(),
  x: z.number().nullable().optional(),
  z: z.number().nullable().optional(),
  outcome: z.number().int().nullable().optional(),
  attributes: z.array(z.object({ label: z.string(), value: z.unknown() })).nullable().optional(),
})

export interface VeoEvent {
  veoEventId: string
  team: 'own' | 'opponent'
  eventType: string
  jerseyNumber: number | null
  periodNumber: number | null
  periodTimeMs: number
  videoTimeMs: number
  // Rohwerte in Kamerasicht, Laenge x und Breite z, etwa 0..1 (Veo liefert auch knapp darueber).
  x: number | null
  z: number | null
  outcome: number | null
  // Nur bei Paessen: Ziel und Empfaenger.
  receiver: { x: number; z: number; jerseyNumber: number | null } | null
  assistJerseyNumber: number | null
}

function attribute(attributes: readonly { label: string; value: unknown }[] | null | undefined, label: string): unknown {
  return attributes?.find((entry) => entry.label === label)?.value
}

/** Uebersetzt die Ereignisliste; exportiert fuer Tests ohne Netz. */
export function parseMatchEvents(json: unknown): VeoEvent[] {
  return parseOrChanged(z.object({ events: z.array(EventSchema) }), json, 'match events').events.map((event) => {
    const receiverX = attribute(event.attributes, 'receiver_x')
    const receiverZ = attribute(event.attributes, 'receiver_z')
    const receiverJersey = attribute(event.attributes, 'receiver_jersey')
    const assist = attribute(event.attributes, 'FootballAssist')
    const hasLocation = typeof event.x === 'number' && typeof event.z === 'number'
    return {
      veoEventId: event.id,
      team: event.team === 'Own' ? 'own' : 'opponent',
      eventType: event.eventType,
      jerseyNumber: jerseyOf(event.playerJersey),
      periodNumber: event.periodId ?? null,
      periodTimeMs: event.periodTimeMs,
      videoTimeMs: event.videoTimeMs,
      x: hasLocation ? event.x! : null,
      z: hasLocation ? event.z! : null,
      outcome: event.outcome ?? null,
      receiver: typeof receiverX === 'number' && typeof receiverZ === 'number'
        ? { x: receiverX, z: receiverZ, jerseyNumber: typeof receiverJersey === 'number' || typeof receiverJersey === 'string' ? jerseyOf(receiverJersey) : null }
        : null,
      // Die Vorlage nennt Veo als Spieler-ID (type uuid) oder als Rueckennummer; nur die Nummer ist zuordenbar.
      assistJerseyNumber: typeof assist === 'number' || (typeof assist === 'string' && /^\d+$/.test(assist)) ? jerseyOf(assist) : null,
    }
  })
}

/** Alle Ereignisse beider Mannschaften; Zweikaempfe zusammengefasst wie in der Veo-App. */
export async function fetchMatchEvents(accessToken: string, veoMatchId: string, options: VeoHttpOptions = {}): Promise<VeoEvent[] | null> {
  const result = await veoApi(accessToken, `${MES_BASE}/${enc(veoMatchId)}/match-events?aggregatedDuels=true`, {}, options)
  if (result.status === 404) return null
  if (result.status >= 300) throw new VeoError('upstream_error', `Veo match events request failed -> ${result.status}`, result.status)
  return parseMatchEvents(result.json)
}

// --- Spieler-Heatmaps -----------------------------------------------------------------------------

const HeatmapsSchema = z.object({
  items: z.array(z.object({
    player: z.object({ jersey_number: z.string().nullable().optional() }),
    matrix: z.object({
      values: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      direction_of_play: z.enum(['leftToRight', 'rightToLeft']),
    }),
    average_position: z.object({ x: z.number(), z: z.number() }).nullable().optional(),
  })),
})

export interface VeoPlayerHeatmap {
  jerseyNumber: number
  width: number
  height: number
  // Zeilenweise, je Spieler auf 0..255 normiert (research.md R-05).
  cells: Uint8Array
  directionOfPlay: 'leftToRight' | 'rightToLeft'
  averagePosition: { x: number; z: number } | null
}

export function parsePlayerHeatmaps(json: unknown): VeoPlayerHeatmap[] {
  const heatmaps: VeoPlayerHeatmap[] = []
  for (const item of parseOrChanged(HeatmapsSchema, json, 'player heatmaps').items) {
    const jerseyNumber = jerseyOf(item.player.jersey_number)
    if (jerseyNumber === null) continue
    const cells = new Uint8Array(Buffer.from(item.matrix.values, 'base64'))
    if (cells.length !== item.matrix.width * item.matrix.height) throw new VeoError('upstream_changed', 'Unexpected Veo player heatmap size')
    heatmaps.push({ jerseyNumber, width: item.matrix.width, height: item.matrix.height, cells, directionOfPlay: item.matrix.direction_of_play, averagePosition: item.average_position ?? null })
  }
  return heatmaps
}

/** Heatmaps aller eigenen Spieler fuer ein Zeitfenster in Videosekunden. */
export async function fetchPlayerHeatmaps(
  accessToken: string,
  params: { veoTeamId: string; veoMatchId: string; startS: number; endS: number },
  options: VeoHttpOptions = {},
): Promise<VeoPlayerHeatmap[] | null> {
  const result = await veoApi(accessToken, '/analysis/player-heatmaps/', {
    method: 'POST',
    body: JSON.stringify({ type: 'match_all_players', match_id: params.veoMatchId, team_id: params.veoTeamId, start_time: params.startS, end_time: params.endS, smoothing: HEATMAP_SMOOTHING }),
  }, options)
  if (result.status === 404) return null
  if (result.status >= 300) throw new VeoError('upstream_error', `Veo player heatmaps request failed -> ${result.status}`, result.status)
  return parsePlayerHeatmaps(result.json)
}

// --- Paesse und Ballbesitz (RAS) ------------------------------------------------------------------

const LeftRight = <T extends z.ZodType>(schema: T) => z.object({ L: schema, R: schema })
const Thirds = z.object({ defensive: z.number().nonnegative(), middle: z.number().nonnegative(), attacking: z.number().nonnegative() })

const MatchDetailsSchema = z.array(z.object({
  start: z.number(),
  end: z.number(),
  stats: z.object({
    PossessionSeconds: LeftRight(z.number().nonnegative()),
    PassesCompleted: LeftRight(z.number().nonnegative()),
    PossessionWon: LeftRight(z.number().nonnegative()),
  }),
  // [Kettenlaenge, Anzahl, Szenen]; die Szenen braucht Vereinsfunk nicht.
  passStrings: LeftRight(z.array(z.tuple([z.number().int().positive(), z.number().int().nonnegative()]).rest(z.unknown()))),
  passLocations: LeftRight(z.array(z.object({ x: z.number(), y: z.number() }))),
  possessionLocations: LeftRight(Thirds),
}))

export interface VeoSideValues<T> { L: T; R: T }

export interface VeoPassPossessionPeriod {
  startS: number
  endS: number
  // L/R = Mannschaft, die in dieser Halbzeit links bzw. rechts verteidigt (Kamerasicht).
  possessionSeconds: VeoSideValues<number>
  passesCompleted: VeoSideValues<number>
  possessionWon: VeoSideValues<number>
  passStrings: VeoSideValues<[length: number, count: number][]>
  passLocations: VeoSideValues<{ x: number; y: number }[]>
  possessionLocations: VeoSideValues<{ defensive: number; middle: number; attacking: number }>
}

export function parseMatchDetails(json: unknown): VeoPassPossessionPeriod[] {
  return parseOrChanged(MatchDetailsSchema, json, 'match details').map((period) => ({
    startS: period.start,
    endS: period.end,
    possessionSeconds: period.stats.PossessionSeconds,
    passesCompleted: period.stats.PassesCompleted,
    possessionWon: period.stats.PossessionWon,
    passStrings: { L: period.passStrings.L.map(([length, count]) => [length, count]), R: period.passStrings.R.map(([length, count]) => [length, count]) },
    passLocations: period.passLocations,
    possessionLocations: period.possessionLocations,
  }))
}

/** Paesse und Ballbesitz je Halbzeit; ohne Halbzeiten antwortet RAS mit 400, deshalb vorher pruefen. */
export async function fetchMatchDetails(recordingId: string, periods: readonly { startS: number; endS: number }[], options: VeoHttpOptions = {}): Promise<VeoPassPossessionPeriod[] | null> {
  if (periods.length === 0) return null
  const filters = periods.map((period) => `filters=${period.startS},${period.endS}`).join('&')
  const details = await optionalRas(`${enc(recordingId)}/match-details?${filters}`, z.unknown(), 'match details', options)
  return details === null ? null : parseMatchDetails(details)
}

// --- Spielverlauf und Passnetz --------------------------------------------------------------------

export async function fetchMomentum(accessToken: string, veoMatchId: string, options: VeoHttpOptions = {}): Promise<[number, number | null][] | null> {
  return optionalApi(accessToken, `${MES_BASE}/${enc(veoMatchId)}/match-momentum`, {}, z.array(z.tuple([z.number(), z.number().nullable()])), 'match momentum', options)
}

const PassingNetworkSchema = z.object({
  directionOfPlay: z.enum(['leftToRight', 'rightToLeft']),
  nodes: z.array(z.object({ jerseyNumber: z.string(), averageTouchLocation: z.object({ x: z.number(), z: z.number() }), passesMade: z.number().int(), passesReceived: z.number().int() })),
  edges: z.array(z.object({ fromJersey: z.string(), toJersey: z.string(), completedPasses: z.number().int().nonnegative() })),
})

export interface VeoPassingNetwork {
  // Spielrichtung der Durchschnittspositionen; rightToLeft muss gespiegelt werden.
  directionOfPlay: 'leftToRight' | 'rightToLeft'
  nodes: { jerseyNumber: number; x: number; z: number; passesMade: number; passesReceived: number }[]
  edges: { fromJersey: number; toJersey: number; completedPasses: number }[]
}

/** Passnetz der eigenen Mannschaft; `periods` mit Halbzeitnummer und Seite (research.md R-01). */
export async function fetchPassingNetwork(
  accessToken: string,
  veoMatchId: string,
  periods: readonly { number: number; ownSide: 'left' | 'right' }[],
  options: VeoHttpOptions = {},
): Promise<VeoPassingNetwork | null> {
  if (periods.length === 0) return null
  const network = await optionalApi(accessToken, `${MES_BASE}/${enc(veoMatchId)}/passing-network`, {
    method: 'POST',
    body: JSON.stringify({ team: 'Own', periods: periods.map((period) => ({ periodId: period.number, ownSide: period.ownSide })) }),
  }, PassingNetworkSchema, 'passing network', options)
  if (!network) return null
  const nodes = network.nodes.flatMap((node) => {
    const jerseyNumber = jerseyOf(node.jerseyNumber)
    return jerseyNumber === null ? [] : [{ jerseyNumber, x: node.averageTouchLocation.x, z: node.averageTouchLocation.z, passesMade: node.passesMade, passesReceived: node.passesReceived }]
  })
  const edges = network.edges.flatMap((edge) => {
    const fromJersey = jerseyOf(edge.fromJersey)
    const toJersey = jerseyOf(edge.toJersey)
    return fromJersey === null || toJersey === null ? [] : [{ fromJersey, toJersey, completedPasses: edge.completedPasses }]
  })
  return { directionOfPlay: network.directionOfPlay, nodes, edges }
}

// --- Positionsdaten -------------------------------------------------------------------------------

const TrackingWindowSchema = z.record(z.string().regex(/^\d+(\.\d+)?$/), z.array(z.array(z.number()).min(7)))

export interface VeoTrackingSample {
  // Videozeit in Sekunden.
  t: number
  trackId: number
  // 0 Torwart links, 1 Feldspieler links, 2 Torwart rechts, 3 Feldspieler rechts, 4 Schiedsrichter, 6 Ball.
  category: number
  x: number
  y: number
  jerseyNumber: number | null
}

export function parseTrackingWindow(json: unknown): VeoTrackingSample[] {
  const samples: VeoTrackingSample[] = []
  for (const [time, objects] of Object.entries(parseOrChanged(TrackingWindowSchema, json, 'player tracking'))) {
    const t = Number.parseFloat(time)
    for (const [trackId, category, x, y, jersey] of objects) {
      samples.push({ t, trackId: trackId!, category: category!, x: x!, y: y!, jerseyNumber: jersey! >= 0 ? jersey! : null })
    }
  }
  return samples.sort((a, b) => a.t - b.t || a.trackId - b.trackId)
}

/** Ein 30-s-Fenster Positionsdaten ab `startS` (Videosekunden), etwa 2,5 Bilder je Sekunde. */
export async function fetchTrackingWindow(accessToken: string, veoMatchId: string, startS: number, options: VeoHttpOptions = {}): Promise<VeoTrackingSample[]> {
  const result = await veoApi(accessToken, `${MES_BASE}/${enc(veoMatchId)}/player-tracking?start=${Math.max(0, Math.floor(startS))}`, {}, options)
  if (result.status === 404) return []
  if (result.status >= 300) throw new VeoError('upstream_error', `Veo player tracking request failed -> ${result.status}`, result.status)
  return parseTrackingWindow(result.json)
}
