import { z } from 'zod'
import { UuidSchema } from './content.js'
import { ChannelQuotaSchema } from './policy.js'

// Paket 016: Auswertung: interne Kennzahlen -------------------------------------------------------
// organizationId+optionale departmentId/teamId statt eines scope/scopeId-Enumpaars (Abweichung 3
// im Plan): das ist das Muster, das jeder bestehende GET-Endpunkt mit Scope-Filter bereits nutzt
// (/v1/consent-requests, /v1/consents, /v1/organizations/:id/fixtures).
const ANALYTICS_MAX_RANGE_DAYS = 366 * 2 // 24 Monate, wie vom Plan unter "Endpunkte" verlangt.
function checkAnalyticsScopeQuery(
  value: { departmentId?: string | undefined; teamId?: string | undefined; from: string; to: string },
  context: { addIssue: (issue: { code: 'custom'; message: string; path?: (string | number)[] }) => void },
): void {
  if (value.teamId && !value.departmentId) {
    context.addIssue({ code: 'custom', message: 'teamId requires departmentId', path: ['teamId'] })
  }
  if (value.from > value.to) {
    context.addIssue({ code: 'custom', message: 'from must not be after to', path: ['from'] })
  }
  const spanDays = (new Date(value.to).getTime() - new Date(value.from).getTime()) / 86_400_000
  if (spanDays > ANALYTICS_MAX_RANGE_DAYS) {
    context.addIssue({ code: 'custom', message: `range must not exceed ${ANALYTICS_MAX_RANGE_DAYS} days`, path: ['to'] })
  }
}
const analyticsScopeShape = {
  organizationId: UuidSchema,
  departmentId: UuidSchema.optional(),
  teamId: UuidSchema.optional(),
  from: z.iso.date(),
  to: z.iso.date(),
}
export const AnalyticsScopeQuerySchema = z.object(analyticsScopeShape).superRefine(checkAnalyticsScopeQuery)

// null statt eines Datums, solange der Verein noch keinen einzigen Beitrag hat -- eine Seite, die
// "letzte 30 Tage" anzeigt, muss erkennen koennen, dass ein junger Verein erst seit wenigen Tagen
// Daten hat, statt einen Einbruch dort zu vermuten, wo nur Datenmangel ist (Plan, Abschnitt
// "Endpunkte").
export const AnalyticsCoverageSchema = z.object({
  measurementStartsAt: z.iso.date().nullable(),
  requestedFrom: z.iso.date(),
  requestedTo: z.iso.date(),
})

// Trend ist die relative Aenderung gegenueber der vorherigen, gleich langen Periode -- null, wenn
// diese Vorperiode unvollstaendig ist (vor measurementStartsAt beginnt) oder der vorherige Wert 0
// war. Kein Fallback auf 0 % (Plan, Abschnitt "Metrikdefinitionen").
const AnalyticsTrendSchema = z.number().nullable()

export const AnalyticsQuotaUsageSchema = ChannelQuotaSchema.extend({ used: z.int().min(0) })

export const AnalyticsSummarySchema = z.object({
  coverage: AnalyticsCoverageSchema,
  postsCreated: z.int().min(0),
  postsCreatedTrend: AnalyticsTrendSchema,
  postsPublished: z.int().min(0),
  postsPublishedTrend: AnalyticsTrendSchema,
  publicationsPublished: z.int().min(0),
  publicationsPublishedTrend: AnalyticsTrendSchema,
  publicationsFailed: z.int().min(0),
  // null, wenn im Zeitraum keine Entscheidung getroffen wurde -- unentschiedene zaehlen laut Plan
  // nicht in den Nenner, eine leere Menge hat keine Quote.
  approvalRate: z.number().min(0).max(1).nullable(),
  approvalRateTrend: AnalyticsTrendSchema,
  changeRequestRate: z.number().min(0).max(1).nullable(),
  leadTimeSecondsMedian: z.number().min(0).nullable(),
  leadTimeSecondsMedianTrend: AnalyticsTrendSchema,
  approvalSecondsMedian: z.number().min(0).nullable(),
  averageRevisionsPerPost: z.number().min(0).nullable(),
  workflowFailureRate: z.number().min(0).max(1).nullable(),
  // null bei einer bereits auf eine Abteilung/ein Team eingeschraenkten Anfrage -- "aktive
  // Abteilungen" ist nur auf Vereinsebene eine sinnvolle Aussage.
  activeDepartments: z.int().min(0).nullable(),
  quotas: z.array(AnalyticsQuotaUsageSchema),
})

export const AnalyticsTimeseriesMetricSchema = z.enum([
  'postsCreated', 'postsPublished', 'publicationsPublished', 'publicationsFailed',
  'approvalsGranted', 'approvalsChangesRequested', 'approvalsRejected', 'workflowRuns', 'workflowFailures',
])
export const AnalyticsGranularitySchema = z.enum(['day', 'week', 'month'])
export const AnalyticsTimeseriesQuerySchema = z
  .object({ ...analyticsScopeShape, metric: AnalyticsTimeseriesMetricSchema, granularity: AnalyticsGranularitySchema.default('day') })
  .superRefine(checkAnalyticsScopeQuery)
export const AnalyticsTimeseriesPointSchema = z.object({ bucketStart: z.iso.date(), value: z.int().min(0) })
export const AnalyticsTimeseriesResponseSchema = z.object({
  metric: AnalyticsTimeseriesMetricSchema,
  granularity: AnalyticsGranularitySchema,
  coverage: AnalyticsCoverageSchema,
  points: z.array(AnalyticsTimeseriesPointSchema),
})

export const AnalyticsBreakdownDimensionSchema = z.enum(['department', 'team', 'channel', 'preset', 'goal', 'format'])
export const AnalyticsBreakdownQuerySchema = z
  .object({ ...analyticsScopeShape, dimension: AnalyticsBreakdownDimensionSchema })
  .superRefine(checkAnalyticsScopeQuery)
export const AnalyticsBreakdownEntrySchema = z.object({ key: z.string(), label: z.string(), count: z.int().min(0) })
export const AnalyticsBreakdownResponseSchema = z.object({
  dimension: AnalyticsBreakdownDimensionSchema,
  coverage: AnalyticsCoverageSchema,
  entries: z.array(AnalyticsBreakdownEntrySchema),
})

export const AnalyticsFunnelQuerySchema = z.object(analyticsScopeShape).superRefine(checkAnalyticsScopeQuery)
export const AnalyticsFunnelStageSchema = z.enum(['draft', 'approval_requested', 'approved', 'scheduled', 'published'])
export const AnalyticsFunnelEntrySchema = z.object({ stage: AnalyticsFunnelStageSchema, count: z.int().min(0) })
export const AnalyticsFunnelResponseSchema = z.object({
  coverage: AnalyticsCoverageSchema,
  stages: z.array(AnalyticsFunnelEntrySchema),
})

export type AnalyticsScopeQuery = z.infer<typeof AnalyticsScopeQuerySchema>
export type AnalyticsCoverage = z.infer<typeof AnalyticsCoverageSchema>
export type AnalyticsQuotaUsage = z.infer<typeof AnalyticsQuotaUsageSchema>
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>
export type AnalyticsTimeseriesMetric = z.infer<typeof AnalyticsTimeseriesMetricSchema>
export type AnalyticsGranularity = z.infer<typeof AnalyticsGranularitySchema>
export type AnalyticsTimeseriesQuery = z.infer<typeof AnalyticsTimeseriesQuerySchema>
export type AnalyticsTimeseriesPoint = z.infer<typeof AnalyticsTimeseriesPointSchema>
export type AnalyticsTimeseriesResponse = z.infer<typeof AnalyticsTimeseriesResponseSchema>
export type AnalyticsBreakdownDimension = z.infer<typeof AnalyticsBreakdownDimensionSchema>
export type AnalyticsBreakdownQuery = z.infer<typeof AnalyticsBreakdownQuerySchema>
export type AnalyticsBreakdownEntry = z.infer<typeof AnalyticsBreakdownEntrySchema>
export type AnalyticsBreakdownResponse = z.infer<typeof AnalyticsBreakdownResponseSchema>
export type AnalyticsFunnelQuery = z.infer<typeof AnalyticsFunnelQuerySchema>
export type AnalyticsFunnelStage = z.infer<typeof AnalyticsFunnelStageSchema>
export type AnalyticsFunnelEntry = z.infer<typeof AnalyticsFunnelEntrySchema>
export type AnalyticsFunnelResponse = z.infer<typeof AnalyticsFunnelResponseSchema>
