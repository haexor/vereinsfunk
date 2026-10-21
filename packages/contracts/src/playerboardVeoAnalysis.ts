import { z } from 'zod'

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

export type PlayerboardVeoAnalysisPart = z.infer<typeof PlayerboardVeoAnalysisPartSchema>
export type PlayerboardVeoAvailabilityReason = z.infer<typeof PlayerboardVeoAvailabilityReasonSchema>
export type PlayerboardVeoAvailability = z.infer<typeof PlayerboardVeoAvailabilitySchema>
export type PlayerboardVeoAnalysisWrite = z.infer<typeof PlayerboardVeoAnalysisWriteSchema>
export type PlayerboardVeoAnalysisEvent = z.infer<typeof PlayerboardVeoAnalysisEventSchema>
export type PlayerboardVeoAnalysisHeatmap = z.infer<typeof PlayerboardVeoAnalysisHeatmapSchema>
export type PlayerboardVeoAnalysisTrack = z.infer<typeof PlayerboardVeoAnalysisTrackSchema>
export type PlayerboardVeoPassPossession = z.infer<typeof PlayerboardVeoPassPossessionSchema>
export type PlayerboardVeoPassingNetwork = z.infer<typeof PlayerboardVeoPassingNetworkSchema>
