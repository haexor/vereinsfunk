import {
  PlayerboardVeoAnalysisWriteSchema,
  type PlayerboardVeoAnalysisPart,
  type PlayerboardVeoAnalysisWrite,
  type PlayerboardVeoAvailability,
  type PlayerboardVeoAvailabilityReason,
  type PlayerboardVeoPassPossession,
} from '@vereinsfunk/contracts'
import { downsampleTracks, encodeTrackSamples, normalizeEventLocation, normalizeHeatmapCells, thirdOf, type PitchSide, type TrackSample } from '@vereinsfunk/domain'
import {
  fetchMatchDetail,
  fetchMatchDetails,
  fetchMatchEvents,
  fetchMatchReport,
  fetchMomentum,
  fetchPassingNetwork,
  fetchPeriods,
  fetchPlayerHeatmaps,
  fetchProcessingStatus,
  fetchRasStatus,
  fetchTrackingWindow,
  type VeoHttpOptions,
  type VeoPassPossessionPeriod,
  type VeoPeriod,
  type VeoPlayerStats,
} from '@vereinsfunk/veo-client'

// Spec 002 (research.md R-01 bis R-06): das Analysepaket eines Veo-Spiels. Jeder Teil kommt mit den
// Endpunkten und Bodies der Veo-Web-App, wird hier normiert (die jeweilige Mannschaft greift nach
// rechts an) und vor dem Schreiben gegen PlayerboardVeoAnalysisWriteSchema geprueft. Liefert Veo
// einen Teil nicht, steht er mit Grund in `availability`; ein Abruffehler wirft und der Abgleich
// laesst das ganze Paket fuer diesen Lauf weg (R-04).

// Freischaltfelder wie has_tracking_data sind laut Testabruf unzuverlaessig; massgeblich sind die
// Antworten selbst. Diese Ereignistypen zeigt Veo nicht eigenstaendig an (Gegenstuecke, Ballbesitz).
const IGNORED_EVENT_TYPES = new Set(['possession'])
const TRACKING_WINDOW_S = 30
// Veo-Analysestatus, bei denen die Analyse noch kommt (Inventar §1a.0.2).
const PROCESSING = new Set(['pending', 'processing'])

export interface VeoAnalysisDeps {
  // Ein Veo-Abruf mit der Wiederholungsregel des Abgleichs.
  retry: <T>(attempt: () => Promise<T>) => Promise<T>
  // Pause zwischen den Fensterabrufen der Positionsdaten (Betreiberentscheidung 2026-10-21: Veo nicht belasten).
  pause: () => Promise<void>
  http: VeoHttpOptions
}

export interface VeoAnalysisRequest {
  accessToken: string
  veoMatchId: string
  veoTeamId: string
  // Positionsdaten nur, wenn fuer das Spiel noch keine gespeichert sind (research.md R-05).
  fetchTracks: boolean
  // Spielerwerte desselben Laufs, fuer die Spielsekunden der Heatmaps.
  players: readonly VeoPlayerStats[]
}

/** Holt das Analysepaket eines Spiels; wirft bei Abruffehlern (VeoError), damit der Abgleich das Paket weglaesst. */
export async function buildVeoAnalysis(request: VeoAnalysisRequest, deps: VeoAnalysisDeps): Promise<PlayerboardVeoAnalysisWrite> {
  const { accessToken, veoMatchId } = request
  const call = <T>(attempt: () => Promise<T>) => deps.retry(attempt)
  const detail = await call(() => fetchMatchDetail(accessToken, veoMatchId, deps.http))
  if (!detail) return unavailable(null, 'not_provided')

  const [ras, processing, periods] = await Promise.all([
    detail.recordingId ? call(() => fetchRasStatus(detail.recordingId!, deps.http)) : Promise.resolve(null),
    call(() => fetchProcessingStatus(accessToken, detail.slug, deps.http)),
    call(() => fetchPeriods(accessToken, detail.slug, deps.http)),
  ])
  const analyticsVersion = ras?.analyticsVersion ?? '1'
  if (processing?.analytics && PROCESSING.has(processing.analytics)) return pending(detail.slug, analyticsVersion, periods, 'veo_processing')
  if (periods.length === 0) return pending(detail.slug, analyticsVersion, periods, 'periods_missing')

  const availability: PlayerboardVeoAvailability = {}
  const mark = (part: PlayerboardVeoAnalysisPart, present: boolean) => {
    availability[part] = present ? { status: 'available' } : { status: 'unavailable', reason: analyticsVersion === '2' ? 'not_provided' : 'older_analytics_version' }
  }

  const rawEvents = await call(() => fetchMatchEvents(accessToken, veoMatchId, deps.http))
  const events = (rawEvents ?? []).flatMap((event) => {
    if (IGNORED_EVENT_TYPES.has(event.eventType) || event.eventType.endsWith('_target')) return []
    const period = periods.find((entry) => entry.number === event.periodNumber)
    if (!period) return []
    const location = normalizeEventLocation({ x: event.x, z: event.z }, event.team, period.ownSide)
    const target = event.receiver ? normalizeEventLocation({ x: event.receiver.x, z: event.receiver.z }, event.team, period.ownSide) : null
    return [{
      veoEventId: event.veoEventId,
      teamAssociation: event.team,
      eventType: event.eventType,
      jerseyNumber: event.jerseyNumber,
      periodNumber: period.number,
      periodTimeMs: Math.max(0, event.periodTimeMs),
      videoTimeMs: Math.max(0, event.videoTimeMs),
      x: location?.x ?? null,
      y: location?.y ?? null,
      endX: target?.x ?? null,
      endY: target?.y ?? null,
      outcome: event.outcome,
      receiverJerseyNumber: event.receiver?.jerseyNumber ?? null,
      assistJerseyNumber: event.assistJerseyNumber,
    }]
  })
  mark('events', rawEvents !== null)
  mark('shots', events.some((event) => event.eventType === 'FootballShot' || event.eventType === 'FootballGoal'))

  const heatmaps = await fetchHeatmaps(request, periods, deps)
  mark('heatmaps', heatmaps.length > 0)

  const passPossession = detail.recordingId ? mapPassPossession(await call(() => fetchMatchDetails(detail.recordingId!, periods, deps.http)), periods) : null
  mark('passes', passPossession !== null)
  mark('possession', passPossession !== null)
  mark('passStrings', passPossession !== null)

  const momentum = await call(() => fetchMomentum(accessToken, veoMatchId, deps.http))
  mark('momentum', momentum !== null && momentum.length > 0)

  const passingNetwork = await fetchNetworks(accessToken, veoMatchId, periods, deps)
  mark('passingNetwork', passingNetwork.length > 0)

  const report = processing?.matchReportAvailable ? await call(() => fetchMatchReport(accessToken, veoMatchId, deps.http)) : null
  mark('report', report !== null)

  // tracks = null behaelt die gespeicherten Spuren; sie gelten dann weiter als vorhanden.
  const tracks = request.fetchTracks ? await fetchTracks(accessToken, veoMatchId, periods, deps) : null
  mark('tracking', tracks === null || tracks.length > 0)

  return PlayerboardVeoAnalysisWriteSchema.parse({
    veoMatchSlug: detail.slug,
    status: 'complete',
    analyticsVersion,
    periods,
    availability,
    passPossession,
    momentum,
    passingNetwork: passingNetwork.length > 0 ? passingNetwork : null,
    report,
    events,
    heatmaps,
    tracks,
  })
}

const ALL_PARTS: readonly PlayerboardVeoAnalysisPart[] = ['events', 'shots', 'heatmaps', 'tracking', 'passes', 'possession', 'passStrings', 'momentum', 'passingNetwork', 'report']

/** Ein Paket ohne Inhalte, in dem jeder Teil denselben Stand und Grund traegt. */
function emptyPackage(
  status: 'pending' | 'unavailable', slug: string | null, analyticsVersion: '1' | '1.1' | '2', periods: readonly VeoPeriod[], reason: PlayerboardVeoAvailabilityReason,
): PlayerboardVeoAnalysisWrite {
  const availability = Object.fromEntries(ALL_PARTS.map((part) => [part, { status: status === 'pending' ? 'pending' : 'unavailable', reason }]))
  return PlayerboardVeoAnalysisWriteSchema.parse({
    veoMatchSlug: slug, status, analyticsVersion, periods, availability, passPossession: null,
    momentum: null, passingNetwork: null, report: null, events: [], heatmaps: [], tracks: null,
  })
}

const unavailable = (slug: string | null, reason: PlayerboardVeoAvailabilityReason) => emptyPackage('unavailable', slug, '1', [], reason)
// Veo rechnet noch oder kennt keine Halbzeiten: ohne Halbzeiten laesst sich kein Ort normieren.
const pending = (slug: string, analyticsVersion: '1' | '1.1' | '2', periods: readonly VeoPeriod[], reason: PlayerboardVeoAvailabilityReason) =>
  emptyPackage('pending', slug, analyticsVersion, periods, reason)

/** Spieler-Heatmaps je Halbzeit und fuers ganze Spiel (periodNumber 0), nach "leftToRight" gedreht. */
async function fetchHeatmaps(request: VeoAnalysisRequest, periods: readonly VeoPeriod[], deps: VeoAnalysisDeps): Promise<PlayerboardVeoAnalysisWrite['heatmaps']> {
  const windows = [
    { periodNumber: 0, startS: periods[0]!.startS, endS: periods.at(-1)!.endS },
    ...periods.map((period) => ({ periodNumber: period.number, startS: period.startS, endS: period.endS })),
  ]
  const secondsPlayed = (jerseyNumber: number, periodNumber: number) => {
    const stat = request.players.find((player) => player.jerseyNumber === jerseyNumber)?.stats.find((entry) => entry.statType === 'seconds_played_total')
    if (!stat) return null
    const value = periodNumber === 0 ? stat.value : stat.periodValues.find((entry) => entry.period === periodNumber)?.value
    return value === undefined ? null : Math.max(0, Math.round(value))
  }
  const result: PlayerboardVeoAnalysisWrite['heatmaps'] = []
  for (const window of windows) {
    const heatmaps = await deps.retry(() => fetchPlayerHeatmaps(request.accessToken, { veoTeamId: request.veoTeamId, veoMatchId: request.veoMatchId, startS: window.startS, endS: window.endS }, deps.http))
    for (const heatmap of heatmaps ?? []) {
      const cells = normalizeHeatmapCells(heatmap.cells, heatmap.width, heatmap.height, heatmap.directionOfPlay)
      const average = heatmap.averagePosition
      const flip = heatmap.directionOfPlay === 'rightToLeft'
      result.push({
        jerseyNumber: heatmap.jerseyNumber,
        periodNumber: window.periodNumber,
        width: heatmap.width,
        height: heatmap.height,
        cells: Buffer.from(cells).toString('base64'),
        averageX: average ? clamp01(flip ? 1 - average.x : average.x) : null,
        averageY: average ? clamp01(flip ? 1 - average.z : average.z) : null,
        secondsPlayed: secondsPlayed(heatmap.jerseyNumber, window.periodNumber),
      })
    }
  }
  return result
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** RAS-Werte je Halbzeit auf eigene Mannschaft und Gegner abgebildet (Inventar §1a.3, `Et`/`Mt`/`kt`). */
export function mapPassPossession(details: readonly VeoPassPossessionPeriod[] | null, periods: readonly VeoPeriod[]): PlayerboardVeoPassPossession | null {
  if (!details) return null
  const mapped = periods.flatMap((period) => {
    // Veo ordnet RAS-Halbzeiten ueber exakt gleiche Grenzen zu.
    const entry = details.find((detail) => detail.startS === period.startS && detail.endS === period.endS)
    if (!entry) return []
    const ownKey = period.ownSide === 'left' ? 'L' : 'R'
    const otherKey = ownKey === 'L' ? 'R' : 'L'
    const team = (key: 'L' | 'R') => {
      const side: PitchSide = key === 'L' ? 'left' : 'right'
      const passThirds = { defensive: 0, middle: 0, attacking: 0 }
      for (const pass of entry.passLocations[key]) passThirds[thirdOf(side === 'right' ? 1 - pass.x : pass.x)] += 1
      return {
        possessionSeconds: entry.possessionSeconds[key],
        passesCompleted: Math.round(entry.passesCompleted[key]),
        possessionWon: Math.round(entry.possessionWon[key]),
        passStrings: entry.passStrings[key],
        passThirds,
        possessionThirds: entry.possessionLocations[key],
      }
    }
    return [{ periodNumber: period.number, durationS: Math.max(0, period.endS - period.startS), own: team(ownKey), opponent: team(otherKey) }]
  })
  return mapped.length > 0 ? mapped : null
}

/** Passnetz fuers ganze Spiel (periodNumber 0) und je Halbzeit, Durchschnittspositionen nach rechts angreifend. */
async function fetchNetworks(accessToken: string, veoMatchId: string, periods: readonly VeoPeriod[], deps: VeoAnalysisDeps): Promise<NonNullable<PlayerboardVeoAnalysisWrite['passingNetwork']>> {
  const selections = [{ periodNumber: 0, periods }, ...periods.map((period) => ({ periodNumber: period.number, periods: [period] }))]
  const result: NonNullable<PlayerboardVeoAnalysisWrite['passingNetwork']> = []
  for (const selection of selections) {
    const network = await deps.retry(() => fetchPassingNetwork(accessToken, veoMatchId, selection.periods, deps.http))
    if (!network) continue
    const flip = network.directionOfPlay === 'rightToLeft'
    result.push({
      periodNumber: selection.periodNumber,
      nodes: network.nodes.map((node) => ({
        jerseyNumber: node.jerseyNumber, x: clamp01(flip ? 1 - node.x : node.x), y: clamp01(flip ? 1 - node.z : node.z),
        passesMade: Math.max(0, node.passesMade), passesReceived: Math.max(0, node.passesReceived),
      })),
      edges: network.edges,
    })
  }
  return result
}

/** Positionsdaten aller Halbzeiten in 30-s-Fenstern mit Pause, verdichtet auf 1 Hz je Spur. */
async function fetchTracks(accessToken: string, veoMatchId: string, periods: readonly VeoPeriod[], deps: VeoAnalysisDeps): Promise<NonNullable<PlayerboardVeoAnalysisWrite['tracks']>> {
  const samples: TrackSample[] = []
  for (const period of periods) {
    for (let start = period.startS; start < period.endS; start += TRACKING_WINDOW_S) {
      const window = await deps.retry(() => fetchTrackingWindow(accessToken, veoMatchId, start, deps.http))
      samples.push(...window.filter((sample) => sample.t >= period.startS && sample.t <= period.endS))
      await deps.pause()
    }
  }
  return downsampleTracks(samples).map((track) => ({
    veoTrackId: track.veoTrackId,
    side: track.side,
    goalkeeper: track.goalkeeper,
    jerseyNumber: track.jerseyNumber,
    startS: track.startS,
    samples: Buffer.from(encodeTrackSamples(track.points)).toString('base64'),
  }))
}
