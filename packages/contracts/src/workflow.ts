import { z } from 'zod'
import { UuidSchema } from './content.js'

// 'sync-integration-source' ist wie 'collect-analytics' reserviert, aber nicht verdrahtet: Paket
// 014 fuehrt einen Sync-Lauf synchron in der API-Anfrage aus (siehe apps/api), weil Paket 004
// (Hatchet-Produktionsintegration) weiterhin "in Arbeit" ist. Der Name bleibt fuer die kuenftige
// geplante/automatische Ausfuehrung ueber sync_cron vorgesehen. 'enforce-retention' (Paket 020)
// folgt demselben Muster: POST /v1/organizations/:id/retention/run fuehrt den Lauf synchron aus.
// 'aggregate-metrics' (Paket 016) ist ebenfalls nur reserviert: GET /v1/analytics/* berechnet jede
// Kennzahl live aus den Rohtabellen, es gibt bislang keinen Lauf, den ein Cron ausloesen wuerde --
// siehe plans/016-auswertung-interne-kennzahlen.md, "Abweichungen vom Plan" Punkt 4.
// Product workflows are deliberately named here, rather than accepting arbitrary strings from
// an outbox row. This is the first boundary that keeps an accidentally persisted task name from
// becoming executable code in Hatchet.
export const WorkflowNameSchema = z.enum(['process-submission', 'generate-text-post', 'anonymize-media', 'render-content', 'apply-revision', 'publish-content', 'collect-analytics', 'cleanup-expired-invitations', 'sync-integration-source', 'enforce-retention', 'aggregate-metrics'])
export const WorkflowPayloadSchema = z.object({
  submissionId: UuidSchema.optional(), candidateId: UuidSchema.optional(), entityId: UuidSchema, organizationId: UuidSchema, departmentId: UuidSchema, teamId: UuidSchema.optional(),
  correlationId: UuidSchema, sourceRevision: z.int().positive(), purpose: z.string().trim().min(1).max(80), idempotencyKey: z.string().min(1).max(240),
}).strict().superRefine((payload, context) => {
  if (payload.submissionId && payload.submissionId !== payload.entityId) context.addIssue({ code: 'custom', message: 'submissionId must match entityId' })
})
export const WorkflowRunStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'action_required'])

// Paket 025: postId/postVersionId sind nur bei status='queued' gesetzt -- ein Entwurf entsteht
// erst, wenn keine Pflichtangabe fehlt (siehe evaluateSubmitPermission/FakeContentGenerator).
export const SubmissionAcceptedSchema = z.object({
  submissionId: UuidSchema, correlationId: UuidSchema, status: z.enum(['queued', 'facts_required']),
  idempotencyKey: z.string().min(1), postId: UuidSchema.optional(), postVersionId: UuidSchema.optional(),
})

export type WorkflowPayload = z.infer<typeof WorkflowPayloadSchema>
export type WorkflowName = z.infer<typeof WorkflowNameSchema>
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>
