import { z } from 'zod'
import { FixtureKindSchema } from './clubSchedule.js'
import { PlayerboardVeoStatSchema } from './playerboard.js'
import { UuidSchema } from './primitives.js'

// --- Spec 002: Veo-Spielanalyse -----------------------------------------------------------------
//
// Schreibdaten des Workers fuer public.playerboard_veo_apply_analysis (data-model.md). Orte sind
// normiert: die jeweilige Mannschaft greift Richtung x = 1 an, x und y in [0, 1] (research.md R-06).
// Matrizen und Positionsdaten reisen als base64 und werden in SQL mit decode(..., 'base64') gelesen.

export const PlayerboardVeoAnalysisPartSchema = z.enum([
  'events', 'shots', 'heatmaps', 'tracking', 'passes', 'possession', 'passStrings', 'momentum', 'passingNetwork', 'report',
])
export const PlayerboardVeoAvailabilityReasonSchema = z.enum([
  'veo_processing', 'periods_missing', 'older_analytics_version', 'not_provided', 'no_jersey',
])
export const PlayerboardVeoAnalysisStatusSchema = z.enum(['pending', 'complete', 'unavailable'])
export const PlayerboardVeoAnalyticsVersionSchema = z.enum(['1', '1.1', '2'])

const UnitSchema = z.number().min(0).max(1)
// Veo-Rueckennummern; der Torwart-Platzhalter der Veo-App ist 9999.
const VeoJerseySchema = z.int().min(0).max(9999)
const PitchSideSchema = z.enum(['left', 'right'])

/** base64, dessen dekodierte Laenge `check` erfuellt (atob gibt es im Browser und in Node). */
function base64Bytes(check: (length: number) => boolean, message: string) {
  return z.string().refine((value) => {
    try {
      return check(atob(value).length)
    } catch {
      return false
    }
  }, message)
}

export const PlayerboardVeoAvailabilitySchema = z.partialRecord(PlayerboardVeoAnalysisPartSchema, z.object({
  status: z.enum(['available', 'unavailable', 'pending']),
  reason: PlayerboardVeoAvailabilityReasonSchema.optional(),
}).strict())

export const PlayerboardVeoPeriodSchema = z.object({
  number: z.int().min(1),
  startS: z.number().nonnegative(),
  endS: z.number().nonnegative(),
  ownSide: PitchSideSchema,
  confirmed: z.boolean(),
}).strict()

const ThirdsSchema = z.object({ defensive: z.number().nonnegative(), middle: z.number().nonnegative(), attacking: z.number().nonnegative() }).strict()

const TeamPassPossessionSchema = z.object({
  possessionSeconds: z.number().nonnegative(),
  passesCompleted: z.int().nonnegative(),
  possessionWon: z.int().nonnegative(),
  // [Kettenlaenge, Anzahl]
  passStrings: z.array(z.tuple([z.int().positive(), z.int().nonnegative()])),
  // Anzahl angekommener Paesse je Drittel aus Sicht der Mannschaft.
  passThirds: ThirdsSchema,
  // Veos Ballbesitzwerte je Drittel, bereits aus Sicht der Mannschaft.
  possessionThirds: ThirdsSchema,
}).strict()

export const PlayerboardVeoPassPossessionSchema = z.array(z.object({
  periodNumber: z.int().min(1),
  durationS: z.number().nonnegative(),
  own: TeamPassPossessionSchema,
  opponent: TeamPassPossessionSchema,
}).strict())

export const PlayerboardVeoPassingNetworkSchema = z.array(z.object({
  // 0 = ganzes Spiel
  periodNumber: z.int().min(0),
  nodes: z.array(z.object({ jerseyNumber: VeoJerseySchema, x: UnitSchema, y: UnitSchema, passesMade: z.int().nonnegative(), passesReceived: z.int().nonnegative() }).strict()),
  edges: z.array(z.object({ fromJersey: VeoJerseySchema, toJersey: VeoJerseySchema, completedPasses: z.int().nonnegative() }).strict()),
}).strict())

export const PlayerboardVeoAnalysisEventSchema = z.object({
  veoEventId: z.string().min(1).max(200),
  teamAssociation: z.enum(['own', 'opponent']),
  eventType: z.string().min(1).max(60),
  jerseyNumber: VeoJerseySchema.nullable(),
  periodNumber: z.int().min(1),
  periodTimeMs: z.int().nonnegative(),
  videoTimeMs: z.int().nonnegative(),
  x: UnitSchema.nullable(),
  y: UnitSchema.nullable(),
  endX: UnitSchema.nullable(),
  endY: UnitSchema.nullable(),
  outcome: z.int().nullable(),
  receiverJerseyNumber: VeoJerseySchema.nullable(),
  assistJerseyNumber: VeoJerseySchema.nullable(),
}).strict()
  .refine((event) => (event.x === null) === (event.y === null), 'x and y are set together')
  .refine((event) => (event.endX === null) === (event.endY === null), 'endX and endY are set together')

export const PlayerboardVeoAnalysisHeatmapSchema = z.object({
  jerseyNumber: VeoJerseySchema,
  // 0 = ganzes Spiel
  periodNumber: z.int().min(0),
  width: z.int().min(1).max(200),
  height: z.int().min(1).max(200),
  cells: z.string(),
  averageX: UnitSchema.nullable(),
  averageY: UnitSchema.nullable(),
  secondsPlayed: z.int().nonnegative().nullable(),
}).strict()
  .refine((heatmap) => {
    try {
      return atob(heatmap.cells).length === heatmap.width * heatmap.height
    } catch {
      return false
    }
  }, 'cells must hold width * height bytes')

export const PlayerboardVeoAnalysisTrackSchema = z.object({
  veoTrackId: z.int().nonnegative(),
  side: PitchSideSchema,
  goalkeeper: z.boolean(),
  jerseyNumber: VeoJerseySchema.nullable(),
  startS: z.int().nonnegative(),
  samples: base64Bytes((length) => length > 0 && length % 4 === 0, 'samples must hold x/y pairs of uint16'),
}).strict()

export const PlayerboardVeoAnalysisWriteSchema = z.object({
  veoMatchSlug: z.string().min(1).max(200).nullable(),
  status: PlayerboardVeoAnalysisStatusSchema,
  analyticsVersion: PlayerboardVeoAnalyticsVersionSchema,
  periods: z.array(PlayerboardVeoPeriodSchema),
  availability: PlayerboardVeoAvailabilitySchema,
  passPossession: PlayerboardVeoPassPossessionSchema.nullable(),
  momentum: z.array(z.tuple([z.number(), z.number().nullable()])).nullable(),
  passingNetwork: PlayerboardVeoPassingNetworkSchema.nullable(),
  // Bereits im Veo-Client gegen Veos Schema geprueft und auf das Benoetigte gekuerzt.
  report: z.record(z.string(), z.unknown()).nullable(),
  events: z.array(PlayerboardVeoAnalysisEventSchema),
  heatmaps: z.array(PlayerboardVeoAnalysisHeatmapSchema),
  // null = gespeicherte Positionsdaten behalten (sie werden einmal je Spiel geholt).
  tracks: z.array(PlayerboardVeoAnalysisTrackSchema).nullable(),
}).strict()

// --- Lesen: Spielauswertung (contracts/veo-analysis.md "analysis" und "tracks") -------------------

const PeriodValuesSchema = z.array(z.object({ period: z.int().min(1), value: z.number() }).strict())
const ReadStatSchema = PlayerboardVeoStatSchema.extend({ periodValues: PeriodValuesSchema })

export const PlayerboardVeoMatchAnalysisSchema = z.object({
  fixtureId: UuidSchema,
  kickoffAt: z.string(),
  opponentName: z.string().nullable(),
  isHome: z.boolean().nullable(),
  ownScore: z.int().nullable(),
  opponentScore: z.int().nullable(),
  // https://app.veo.co/matches/{slug}/ (R-11); null, solange der Abgleich den Slug nicht kennt.
  veoUrl: z.url().nullable(),
  analysisStatus: z.enum(['none', 'pending', 'complete', 'unavailable']),
  analyticsVersion: PlayerboardVeoAnalyticsVersionSchema.nullable(),
  periods: z.array(PlayerboardVeoPeriodSchema),
  availability: PlayerboardVeoAvailabilitySchema,
  teamStats: z.array(ReadStatSchema.extend({ teamAssociation: z.enum(['own', 'opponent']) })),
  players: z.array(z.object({
    jerseyNumber: VeoJerseySchema,
    playerId: UuidSchema.nullable(),
    personId: UuidSchema.nullable(),
    name: z.string().nullable(),
    matchedManually: z.boolean(),
    stats: z.array(ReadStatSchema),
  })),
  // playerId nur bei eigenen Ereignissen, aus der aktuellen Zuordnung der Rueckennummer.
  events: z.array(z.object({
    id: z.string().min(1),
    teamAssociation: z.enum(['own', 'opponent']),
    eventType: z.string().min(1),
    jerseyNumber: VeoJerseySchema.nullable(),
    playerId: UuidSchema.nullable(),
    periodNumber: z.int().min(1),
    periodTimeMs: z.int().nonnegative(),
    videoTimeMs: z.int().nonnegative(),
    x: UnitSchema.nullable(),
    y: UnitSchema.nullable(),
    endX: UnitSchema.nullable(),
    endY: UnitSchema.nullable(),
    outcome: z.int().nullable(),
    receiverJerseyNumber: VeoJerseySchema.nullable(),
    assistJerseyNumber: VeoJerseySchema.nullable(),
  })),
  heatmaps: z.array(z.object({
    jerseyNumber: VeoJerseySchema,
    periodNumber: z.int().min(0),
    width: z.int().min(1).max(200),
    height: z.int().min(1).max(200),
    cells: z.string(),
    averageX: UnitSchema.nullable(),
    averageY: UnitSchema.nullable(),
  })),
  passPossession: PlayerboardVeoPassPossessionSchema.nullable(),
  momentum: z.array(z.tuple([z.number(), z.number().nullable()])).nullable(),
  passingNetwork: PlayerboardVeoPassingNetworkSchema.nullable(),
  hasReport: z.boolean(),
  hasTracking: z.boolean(),
})

export const PlayerboardVeoMatchTracksSchema = z.object({
  sampleHz: z.literal(1),
  periods: z.array(PlayerboardVeoPeriodSchema),
  // Kamera-Koordinaten je Spielfeldseite; packages/domain ordnet sie ueber ownSide zu.
  tracks: z.array(PlayerboardVeoAnalysisTrackSchema),
})

// --- Veo Analytics: Saison der Mannschaft (Inventar §1b) ------------------------------------------

// Kennzahlenkatalog wie Veos "Edit key metrics" (Inventar §1b.3); SQL authz.playerboard_veo_key_metric_ids
// und packages/domain VEO_TEAM_KEY_METRICS fuehren dieselben IDs.
export const PlayerboardVeoKeyMetricIdSchema = z.enum([
  'possession_percent', 'possession_minutes', 'possession_won',
  'possession_location_in_defensive_third', 'possession_location_in_middle_third', 'possession_location_in_attacking_third',
  'pass_location_in_defensive_third', 'pass_location_in_middle_third', 'pass_location_in_attacking_third',
  'passes_completed', 'three_to_five_passes', 'six_or_more_passes', 'longest_pass_string',
  'goals_scored', 'goals_conceded', 'kick_free_kick', 'shots_on_goal', 'shots_conceded', 'kick_corner', 'kick_goalie',
  'kick_penalty', 'throw_in', 'foul', 'tackles', 'duels', 'dribbles', 'interceptions', 'loose_ball_recoveries', 'saves',
  'shots_to_goal_conversion_rate', 'total_attempts', 'total_attempts_conceded', 'attacking_events', 'defensive_events', 'win_ratio',
])

/** Kommagetrennte Query-Liste ("a,b") als Array; leer oder fehlend = kein Filter. */
function commaList<T extends z.ZodType>(item: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : value),
    z.array(item).min(1).max(100),
  ).optional()
}

// Filter wie Veos Analytics Studio: Zeitraum, Spielart, die letzten n Spiele oder eine Auswahl, die
// dann allein gilt.
export const PlayerboardVeoSeasonQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  kinds: commaList(FixtureKindSchema),
  last: z.coerce.number().int().min(1).max(100).optional(),
  fixtureIds: commaList(UuidSchema),
}).strict()

export const PlayerboardVeoSeasonMatchSchema = z.object({
  fixtureId: UuidSchema,
  kickoffAt: z.string(),
  kind: FixtureKindSchema,
  opponentName: z.string().nullable(),
  isHome: z.boolean().nullable(),
  ownScore: z.int().nullable(),
  opponentScore: z.int().nullable(),
  veoUrl: z.url().nullable(),
  analysisStatus: z.enum(['none', 'pending', 'complete', 'unavailable']),
  analyticsVersion: PlayerboardVeoAnalyticsVersionSchema.nullable(),
  periods: z.array(PlayerboardVeoPeriodSchema),
  availability: PlayerboardVeoAvailabilitySchema,
  teamStats: z.array(ReadStatSchema.extend({ teamAssociation: z.enum(['own', 'opponent']) })),
  passPossession: PlayerboardVeoPassPossessionSchema.nullable(),
  // Nur FootballShot und FootballGoal; playerId nur bei eigenen.
  shots: z.array(z.object({
    id: z.string().min(1),
    teamAssociation: z.enum(['own', 'opponent']),
    eventType: z.enum(['FootballShot', 'FootballGoal']),
    jerseyNumber: VeoJerseySchema.nullable(),
    playerId: UuidSchema.nullable(),
    periodNumber: z.int().min(1),
    periodTimeMs: z.int().nonnegative(),
    videoTimeMs: z.int().nonnegative(),
    x: UnitSchema.nullable(),
    y: UnitSchema.nullable(),
    assistJerseyNumber: VeoJerseySchema.nullable(),
  })),
})

// --- Veo Analytics: Spieler ueber die Saison (Inventar §2.1) -----------------------------------------

// Je Spiel die Werte jeder Rueckennummer als {statType: value}; Ranglisten, Saisontabelle und
// Vergleich rechnet packages/domain (veoPlayers.ts).
export const PlayerboardVeoPlayerSeasonMatchSchema = z.object({
  fixtureId: UuidSchema,
  kickoffAt: z.string(),
  opponentName: z.string().nullable(),
  ownScore: z.int().nullable(),
  opponentScore: z.int().nullable(),
  analyticsVersion: PlayerboardVeoAnalyticsVersionSchema.nullable(),
  players: z.array(z.object({
    jerseyNumber: VeoJerseySchema,
    playerId: UuidSchema.nullable(),
    personId: UuidSchema.nullable(),
    name: z.string().nullable(),
    stats: z.record(z.string().min(1), z.number()),
  })),
})

// Heatmaps eines Spielers (playerId) oder einer nicht zugeordneten Rueckennummer (jerseyNumber),
// mit denselben Filtern wie die Saison.
export const PlayerboardVeoPlayerHeatmapsQuerySchema = PlayerboardVeoSeasonQuerySchema.extend({
  playerId: UuidSchema.optional(),
  jerseyNumber: z.coerce.number().int().min(0).max(9999).optional(),
}).strict().refine((query) => (query.playerId === undefined) !== (query.jerseyNumber === undefined), 'either playerId or jerseyNumber is required')

export const PlayerboardVeoPlayerHeatmapSchema = z.object({
  fixtureId: UuidSchema,
  jerseyNumber: VeoJerseySchema,
  width: z.int().min(1).max(200),
  height: z.int().min(1).max(200),
  cells: z.string(),
  secondsPlayed: z.int().nonnegative().nullable(),
})

const unique = (values: readonly string[]) => new Set(values).size === values.length
const DateRangeSchema = z.tuple([z.iso.date(), z.iso.date()]).refine(([from, to]) => from <= to, 'range must not end before it starts')

// Kennzahlen (bis 4, leer = Veos Standard) und Vergleichsradar (genau 6) je Mannschaft.
export const PlayerboardVeoTeamViewsSchema = z.object({
  keyMetrics: z.array(PlayerboardVeoKeyMetricIdSchema).max(4).refine(unique, 'key metrics must be unique'),
  radar: z.object({
    metrics: z.array(PlayerboardVeoKeyMetricIdSchema).length(6).refine(unique, 'radar metrics must be unique'),
    comparingTeamId: UuidSchema.nullable(),
    ownRange: DateRangeSchema,
    comparingRange: DateRangeSchema,
  }).strict().nullable(),
}).strict()

export type PlayerboardVeoAnalysisPart = z.infer<typeof PlayerboardVeoAnalysisPartSchema>
export type PlayerboardVeoAvailabilityReason = z.infer<typeof PlayerboardVeoAvailabilityReasonSchema>
export type PlayerboardVeoAvailability = z.infer<typeof PlayerboardVeoAvailabilitySchema>
export type PlayerboardVeoAnalysisWrite = z.infer<typeof PlayerboardVeoAnalysisWriteSchema>
export type PlayerboardVeoAnalysisEvent = z.infer<typeof PlayerboardVeoAnalysisEventSchema>
export type PlayerboardVeoAnalysisHeatmap = z.infer<typeof PlayerboardVeoAnalysisHeatmapSchema>
export type PlayerboardVeoAnalysisTrack = z.infer<typeof PlayerboardVeoAnalysisTrackSchema>
export type PlayerboardVeoPassPossession = z.infer<typeof PlayerboardVeoPassPossessionSchema>
export type PlayerboardVeoPassingNetwork = z.infer<typeof PlayerboardVeoPassingNetworkSchema>
export type PlayerboardVeoPeriod = z.infer<typeof PlayerboardVeoPeriodSchema>
export type PlayerboardVeoMatchAnalysis = z.infer<typeof PlayerboardVeoMatchAnalysisSchema>
export type PlayerboardVeoMatchEvent = PlayerboardVeoMatchAnalysis['events'][number]
export type PlayerboardVeoMatchTracks = z.infer<typeof PlayerboardVeoMatchTracksSchema>
export type PlayerboardVeoKeyMetricId = z.infer<typeof PlayerboardVeoKeyMetricIdSchema>
export type PlayerboardVeoPlayerSeasonMatch = z.infer<typeof PlayerboardVeoPlayerSeasonMatchSchema>
export type PlayerboardVeoPlayerHeatmapsQuery = z.infer<typeof PlayerboardVeoPlayerHeatmapsQuerySchema>
export type PlayerboardVeoPlayerHeatmap = z.infer<typeof PlayerboardVeoPlayerHeatmapSchema>
export type PlayerboardVeoSeasonQuery = z.infer<typeof PlayerboardVeoSeasonQuerySchema>
export type PlayerboardVeoSeasonMatch = z.infer<typeof PlayerboardVeoSeasonMatchSchema>
export type PlayerboardVeoTeamViews = z.infer<typeof PlayerboardVeoTeamViewsSchema>
