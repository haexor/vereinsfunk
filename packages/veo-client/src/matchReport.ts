import { z } from 'zod'
import { parseOrChanged, veoApi } from './client.js'
import { VeoError } from './errors.js'
import type { VeoHttpOptions } from './http.js'

// Spec 002 (research.md R-10): Veos Spielbericht. Das Schema behaelt nur, was Vereinsfunk zeigt;
// Zod verwirft alle anderen Schluessel -- damit fallen Namen, Wappen, Videos und Coach-Assist-Texte
// schon an der Systemgrenze weg (Spieler bleiben nur mit Rueckennummer). Die Form ist im Testabruf
// vom 2026-10-21 belegt (view "advanced"); im Basisplan fehlen ganze Abschnitte, deshalb optional.

const nullableNumber = z.number().nullable()

const StatValueSchema = z.object({
  full_time: z.object({ own: nullableNumber, opponent: nullableNumber }),
  periods: z.array(z.object({ period_number: z.number().int().min(1), own: nullableNumber, opponent: nullableNumber })),
  comparison: z.object({ full_time: z.object({ difference: z.number(), match_count: z.number().int().nonnegative() }) }).nullable().optional(),
})

const StatSectionSchema = z.record(z.string(), StatValueSchema)

const PassStringBucketsSchema = z.array(z.object({ length: z.number().int().positive(), count: z.number().int().nonnegative() }))

const SpeedDistributionSchema = z.object({
  status: z.string(),
  durations: z.object({ below_hsr_ms: z.number(), hsr_ms: z.number(), sprint_ms: z.number() }).nullable().optional(),
  percentages: z.object({ below_hsr: z.number(), hsr: z.number(), sprint: z.number() }).nullable().optional(),
})

const SpeedZonesSchema = z.object({
  status: z.string(),
  thresholds: z.object({ hsr_kmh: z.number(), sprint_kmh: z.number() }).nullable().optional(),
  bucket_seconds: z.number().positive().nullable().optional(),
  items: z.array(z.object({
    start_ms: z.number().nonnegative(),
    end_ms: z.number().nonnegative(),
    own: SpeedDistributionSchema,
    opponent: SpeedDistributionSchema,
    players: z.array(z.object({ team: z.enum(['Own', 'Opponent']), jersey_number: z.string().nullable(), distribution: SpeedDistributionSchema })),
  })).optional(),
})

const ScorerSchema = z.object({ player_jersey: z.string().nullable(), period_number: z.number().int().min(1), period_time_ms: z.number().int().nonnegative() })

const MatchReportSchema = z.object({
  view: z.string(),
  teams: z.object({ own_side: z.enum(['home', 'away']) }),
  score: z.object({ full_time: z.object({ home: z.number().int().nullable(), away: z.number().int().nullable() }) }),
  periods: z.array(z.object({ start_time: z.number(), end_time: z.number(), own_side: z.enum(['left', 'right']) })),
  scorers: z.object({ home: z.array(ScorerSchema), away: z.array(ScorerSchema) }),
  lineup: z.object({
    formation: z.string().nullable().optional(),
    formation_positions: z.array(z.object({
      field_position: z.string().nullable().optional(),
      position_index: z.number().int().nullable().optional(),
      position_name: z.string().nullable().optional(),
      jersey_number: z.union([z.string(), z.number()]).nullable().optional(),
      is_starting: z.boolean().optional(),
      is_team_captain: z.boolean().optional(),
      is_unused_substitute: z.boolean().optional(),
      is_player_of_the_match: z.boolean().optional(),
    })),
  }).nullable().optional(),
  overview: z.object({ key_stats: StatSectionSchema }),
  attacking: StatSectionSchema.nullable().optional(),
  defensive: StatSectionSchema.nullable().optional(),
  passing: z.object({
    pass_locations: z.record(z.string(), z.record(z.string(), StatSectionSchema)).nullable().optional(),
    pass_strings: z.object({
      full_time: z.object({ own: PassStringBucketsSchema, opponent: PassStringBucketsSchema }),
      periods: z.array(z.object({ period_number: z.number().int().min(1), own: PassStringBucketsSchema, opponent: PassStringBucketsSchema })),
    }).nullable().optional(),
  }).catchall(StatValueSchema).nullable().optional(),
  physical: z.object({ speed_zones: SpeedZonesSchema.nullable().optional() }).catchall(StatValueSchema).nullable().optional(),
})

export type VeoMatchReport = z.infer<typeof MatchReportSchema>

export function parseMatchReport(json: unknown): VeoMatchReport {
  return parseOrChanged(MatchReportSchema, json, 'match report')
}

/** Spielbericht eines Spiels; null, wenn Veo fuer dieses Spiel keinen erstellt (404). */
export async function fetchMatchReport(accessToken: string, veoMatchId: string, options: VeoHttpOptions = {}): Promise<VeoMatchReport | null> {
  const result = await veoApi(accessToken, `/analysis/matches/${encodeURIComponent(veoMatchId)}/match-report/`, {}, options)
  if (result.status === 404) return null
  if (result.status >= 300) throw new VeoError('upstream_error', `Veo match report request failed -> ${result.status}`, result.status)
  return parseMatchReport(result.json)
}
