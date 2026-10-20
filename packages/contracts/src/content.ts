import { z } from 'zod'
import { UuidSchema } from './primitives.js'

export const ContentPresetSlugSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/).max(64)
export const CommunicationGoalSchema = z.enum([
  'inform', 'inspire', 'thank', 'invite', 'recruit', 'educate', 'strengthen_community',
])
export const OutputFormatSchema = z.enum(['feed_image', 'carousel', 'story', 'reel'])
// Historical rows can still contain the former visual formats (including `reel`).
// New text-workshop commands deliberately use this separate schema so a user-uploaded
// video is never misrepresented as an AI-generated Reel.
export const CompositionFormatSchema = z.enum(['text_post', 'photo_post', 'video_post'])

export const SourceFactValueSchema = z.union([z.string().trim().min(1).max(500), z.number().finite(), z.boolean()])

const SourceMaterialShape = z.object({
  facts: z.record(z.string().trim().min(1).max(80), SourceFactValueSchema).refine((facts) => Object.keys(facts).length <= 30),
  observations: z.array(z.string().trim().min(1).max(500)).max(20),
  quotes: z.array(z.object({ text: z.string().trim().min(1).max(500), attribution: z.string().trim().min(1).max(120).optional(), approved: z.boolean() })).max(10),
})
function requireSourceMaterialContent(material: { facts: Record<string, unknown>; observations: readonly unknown[]; quotes: readonly unknown[] }, context: z.RefinementCtx) {
  if (Object.keys(material.facts).length + material.observations.length + material.quotes.length === 0) {
    context.addIssue({ code: 'custom', message: 'At least one fact, observation, or quote is required' })
  }
}
export const SourceMaterialSchema = SourceMaterialShape.superRefine(requireSourceMaterialContent)
// Die Form, in der source_material tatsaechlich in composition_sessions/submissions liegt: dieselbe
// Nutzereingabe, ergaenzt um die zum Anlagezeitpunkt geltende organisationsweite Sperrliste
// (policies.forbiddenTopics) -- ausschliesslich serverseitig gesetzt, nie Teil der Nutzer- oder
// Agent-Eingabe (SourceMaterialSchema oben), damit sie nicht durch eine Nutzereingabe ueberschrieben
// werden kann.
export const StoredSourceMaterialSchema = SourceMaterialShape.extend({
  forbiddenTopics: z.array(z.string().trim().min(1).max(200)).max(20),
}).superRefine(requireSourceMaterialContent)

export const HealthSchema = z.object({
  status: z.literal('ok'), service: z.string().min(1), version: z.string().min(1), timestamp: z.iso.datetime(),
})

// Kept as an exported alias for integrations compiled against the prototype.
export const ContentTypeSchema = ContentPresetSlugSchema


// Breaking: replaces the earlier contentType/facts shape; WorkflowPayloadSchema requires only IDs,
// a technical purpose and an idempotency key -- no content can cross this boundary.
export const CreateSubmissionSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  teamId: UuidSchema.nullable().optional(),
  presetSlug: ContentPresetSlugSchema,
  communicationGoal: CommunicationGoalSchema,
  requestedFormats: z.array(OutputFormatSchema).min(1).max(4),
  sourceMaterial: SourceMaterialSchema,
  sourceRevision: z.int().positive().default(1),
  priority: z.int().min(10).max(100).default(40),
  // Paket 019: aus welchem Spiel/welcher Veranstaltung entstand dieser Beitrag. Herkunft
  // (source_provenance/source_revision_at/source_prefill_snapshot) leitet die API selbst aus der
  // referenzierten Zeile ab, nie aus Client-Angaben -- vgl. plans/README.md "RPC traut Client nicht".
  fixtureId: UuidSchema.optional(),
  clubEventId: UuidSchema.optional(),
}).refine((value) => !value.fixtureId || !value.clubEventId, {
  message: 'fixtureId and clubEventId are mutually exclusive',
})


export type Health = z.infer<typeof HealthSchema>
export type ContentPresetSlug = z.infer<typeof ContentPresetSlugSchema>
export type CommunicationGoal = z.infer<typeof CommunicationGoalSchema>
export type OutputFormat = z.infer<typeof OutputFormatSchema>
export type SourceMaterial = z.infer<typeof SourceMaterialSchema>
export type CreateSubmission = z.infer<typeof CreateSubmissionSchema>
export type CompositionFormat = z.infer<typeof CompositionFormatSchema>
