import { z } from 'zod'

export const UuidSchema = z.uuid()

export const HealthSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
})

export const ContentTypeSchema = z.enum([
  'match_result',
  'match_announcement',
  'member_recruitment',
  'event',
])

export const SafetyFlagSchema = z.enum([
  'minor',
  'missing_consent',
  'uncertain_fact',
  'sensitive_data',
])

export const CreateSubmissionSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  teamId: UuidSchema.nullable().optional(),
  contentType: ContentTypeSchema,
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  sourceRevision: z.int().positive().default(1),
  priority: z.int().min(10).max(100).default(40),
})

export const GeneratedPostSchema = z.object({
  verifiedFacts: z.array(z.string()),
  missingFacts: z.array(z.string()),
  headline: z.string().max(80),
  caption: z.string().max(1800),
  shortCaption: z.string().max(500),
  callToAction: z.string().max(240),
  hashtags: z.array(z.string()).max(12),
  altText: z.string().max(500),
  templateId: z.string().min(1),
  safetyFlags: z.array(SafetyFlagSchema),
})

export const WorkflowPayloadSchema = z.object({
  submissionId: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  correlationId: UuidSchema,
  sourceRevision: z.int().positive(),
})

export const SubmissionAcceptedSchema = z.object({
  submissionId: UuidSchema,
  correlationId: UuidSchema,
  status: z.enum(['queued', 'facts_required']),
  idempotencyKey: z.string().min(1),
})

export type Health = z.infer<typeof HealthSchema>
export type ContentType = z.infer<typeof ContentTypeSchema>
export type CreateSubmission = z.infer<typeof CreateSubmissionSchema>
export type GeneratedPost = z.infer<typeof GeneratedPostSchema>
export type WorkflowPayload = z.infer<typeof WorkflowPayloadSchema>
