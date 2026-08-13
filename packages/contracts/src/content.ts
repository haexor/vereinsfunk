import { z } from 'zod'

export const UuidSchema = z.uuid()
export const ContentPresetSlugSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/).max(64)
export const CommunicationGoalSchema = z.enum([
  'inform', 'inspire', 'thank', 'invite', 'recruit', 'educate', 'strengthen_community',
])
export const OutputFormatSchema = z.enum(['feed_image', 'carousel', 'story', 'reel'])
// Historical rows can still contain the former visual formats (including `reel`).
// New text-workshop commands deliberately use this separate schema so a user-uploaded
// video is never misrepresented as an AI-generated Reel.
export const CompositionFormatSchema = z.enum(['text_post', 'photo_post', 'video_post'])
export const MediaAssetKindSchema = z.enum(['image', 'video'])
export const CompressionMethodSchema = z.enum(['device', 'server'])
export const CompressionFailureReasonSchema = z.enum([
  'unsupported_codec', 'unsupported_device', 'memory_guardrail', 'battery_guardrail',
  'network_guardrail', 'transcode_failed', 'cancelled',
])
export const CompressionProvenanceSchema = z.object({
  method: CompressionMethodSchema,
  profileVersion: z.string().trim().min(1).max(80),
  inputBytes: z.int().nonnegative(),
  outputBytes: z.int().positive().nullable(),
  container: z.literal('mp4'),
  videoCodec: z.literal('h264'),
  audioCodec: z.literal('aac').nullable(),
  width: z.int().positive().max(1080).nullable(),
  height: z.int().positive().max(1080).nullable(),
  durationMs: z.int().positive().max(180_000).nullable(),
  failureReason: CompressionFailureReasonSchema.nullable().default(null),
}).superRefine((provenance, context) => {
  // A failed/cancelled compression never produced real output bytes, dimensions or duration --
  // only a successful run must report them.
  if (provenance.failureReason === null && (provenance.outputBytes === null || provenance.width === null || provenance.height === null || provenance.durationMs === null)) {
    context.addIssue({ code: 'custom', message: 'outputBytes, width, height and durationMs are required when compression succeeded' })
  }
})
export const ImageUploadMetadataSchema = z.object({
  kind: z.literal('image'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  byteSize: z.int().positive().max(20 * 1024 * 1024),
  width: z.int().positive().max(12_000),
  height: z.int().positive().max(12_000),
})
export const VideoUploadMetadataSchema = z.object({
  kind: z.literal('video'),
  mimeType: z.literal('video/mp4'),
  byteSize: z.int().positive().max(250 * 1024 * 1024),
  width: z.int().positive().max(1080),
  height: z.int().positive().max(1080),
  durationMs: z.int().positive().max(180_000),
  container: z.literal('mp4'),
  videoCodec: z.literal('h264'),
  audioCodec: z.literal('aac').nullable(),
})
export const AttachmentUploadMetadataSchema = z.discriminatedUnion('kind', [ImageUploadMetadataSchema, VideoUploadMetadataSchema])

// Product decision (Plan 032, "Kuratierte und selbst angelegte Persona"): style profiles may
// name and imitate a real person (curated persona shipped by the platform, or custom persona an
// org creates itself). Safety is organisational -- who gets the poster/approver role, and the
// existing approval routes (Plan 011/024) -- not a keyword filter, which cannot reliably detect
// intent anyway. additionalInstructions stays bounded and low-priority in prompt assembly so it
// can never override grounding/safety/platform rules (see ADR-010), independent of this decision.
const StyleProfileInstructionSchema = z.string().trim().max(1_000)
export const StyleProfileRulesSchema = z.object({
  sentenceLength: z.enum(['short', 'mixed', 'long']),
  energy: z.int().min(1).max(5),
  humour: z.enum(['none', 'light']),
  formality: z.enum(['casual', 'balanced', 'formal']),
  perspective: z.enum(['we', 'club', 'you']),
  bannedPhrases: z.array(z.string().trim().min(1).max(120)).max(30),
  additionalInstructions: StyleProfileInstructionSchema.default(''),
}).strict()
export const SystemStyleProfileSlugSchema = z.enum([
  'klar_erklaerend', 'warm_gemeinschaftlich', 'lebendig_sportlich', 'leicht_humorvoll', 'feierlich_wertschaetzend',
])
export const StyleProfileKindSchema = z.enum(['system', 'custom'])
export const StyleProfileScopeSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
}).superRefine((scope, context) => {
  if (scope.teamId && !scope.departmentId) context.addIssue({ code: 'custom', message: 'teamId requires departmentId' })
})
export const CustomStyleProfileSchema = StyleProfileScopeSchema.extend({
  id: UuidSchema,
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.literal('custom'),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: z.array(z.string().trim().min(1).max(160)).max(30),
  isActive: z.boolean(),
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
export const CreateCustomStyleProfileRequestSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable().optional(),
  teamId: UuidSchema.nullable().optional(),
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: z.array(z.string().trim().min(1).max(160)).max(30),
}).superRefine((profile, context) => {
  if (profile.teamId && !profile.departmentId) context.addIssue({ code: 'custom', message: 'teamId requires departmentId' })
  if ((SystemStyleProfileSlugSchema.options as readonly string[]).includes(profile.slug)) {
    context.addIssue({ code: 'custom', message: 'System style profile slugs are reserved' })
  }
})
// Plan 037: a platform-admin-curated, global persona catalogue -- no organization_id, no
// composite foreign key (see platform_style_personas migration). Referenced by slug only, frozen
// into composition_sessions.style_profile_snapshot exactly like the five hardcoded system modes.
export const PlatformStylePersonaSchema = z.object({
  id: UuidSchema,
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: z.array(z.string().trim().min(1).max(160)).max(30),
  isActive: z.boolean(),
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
export const CreatePlatformStylePersonaRequestSchema = z.object({
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: z.array(z.string().trim().min(1).max(160)).max(30),
}).superRefine((persona, context) => {
  if ((SystemStyleProfileSlugSchema.options as readonly string[]).includes(persona.slug)) {
    context.addIssue({ code: 'custom', message: 'System style profile slugs are reserved' })
  }
})
export const UpdatePlatformStylePersonaRequestSchema = z.object({
  slug: ContentPresetSlugSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  styleRules: StyleProfileRulesSchema.optional(),
  avoidRules: z.array(z.string().trim().min(1).max(160)).max(30).optional(),
  isActive: z.boolean().optional(),
}).superRefine((persona, context) => {
  if (persona.slug !== undefined && (SystemStyleProfileSlugSchema.options as readonly string[]).includes(persona.slug)) {
    context.addIssue({ code: 'custom', path: ['slug'], message: 'System style profile slugs are reserved' })
  }
  if (Object.values(persona).every((value) => value === undefined)) {
    context.addIssue({ code: 'custom', message: 'At least one field must be provided' })
  }
})
export const GenerationIntentSchema = z.enum(['initial', 'revise'])
export const GenerationCandidateStatusSchema = z.enum(['pending', 'generating', 'ready', 'failed', 'accepted', 'abandoned', 'expired'])
export const CompositionSessionStatusSchema = z.enum(['draft', 'queued', 'generating', 'candidate_ready', 'failed', 'accepted', 'abandoned', 'expired'])
export const CreateCompositionSessionSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  teamId: UuidSchema.nullable().optional(),
  presetSlug: ContentPresetSlugSchema,
  communicationGoal: CommunicationGoalSchema,
  requestedFormats: z.array(CompositionFormatSchema).min(1).max(3).superRefine((formats, context) => {
    if (formats.includes('video_post') && formats.length > 1) context.addIssue({ code: 'custom', message: 'video_post cannot be combined with another presentation type' })
    if (new Set(formats).size !== formats.length) context.addIssue({ code: 'custom', message: 'requestedFormats must not contain duplicates' })
  }),
  styleProfileId: UuidSchema.nullable().optional(),
  systemStyleProfileSlug: SystemStyleProfileSlugSchema.optional(),
  // Plan 037: a third, mutually exclusive choice alongside styleProfileId/systemStyleProfileSlug.
  // Validated only on form here, like ContentPresetSlugSchema elsewhere -- actual existence and
  // isActive are checked at runtime in the route, exactly like styleProfileId already is today.
  personaSlug: ContentPresetSlugSchema.optional(),
  sourceMaterial: z.lazy(() => SourceMaterialSchema),
  mediaAssetIds: z.array(UuidSchema).max(10).default([]),
  sourceRevision: z.int().positive().default(1),
}).superRefine((value, context) => {
  const chosen = [value.styleProfileId, value.systemStyleProfileSlug, value.personaSlug].filter((field) => field !== undefined && field !== null)
  if (chosen.length > 1) context.addIssue({ code: 'custom', message: 'Choose at most one of styleProfileId, systemStyleProfileSlug, or personaSlug' })
})
export const CreateGenerationCommandSchema = z.object({
  sessionId: UuidSchema,
  generationIntent: GenerationIntentSchema,
  revisionInstruction: z.string().trim().min(1).max(500).optional(),
}).superRefine((command, context) => {
  if (command.generationIntent === 'revise' && !command.revisionInstruction) context.addIssue({ code: 'custom', message: 'A revision instruction is required' })
  if (command.generationIntent === 'initial' && command.revisionInstruction) context.addIssue({ code: 'custom', message: 'An initial generation does not accept a revision instruction' })
})
export const SourceFactValueSchema = z.union([z.string().trim().min(1).max(500), z.number().finite(), z.boolean()])

export const SourceMaterialSchema = z.object({
  facts: z.record(z.string().trim().min(1).max(80), SourceFactValueSchema).refine((facts) => Object.keys(facts).length <= 30),
  observations: z.array(z.string().trim().min(1).max(500)).max(20),
  quotes: z.array(z.object({ text: z.string().trim().min(1).max(500), attribution: z.string().trim().min(1).max(120).optional(), approved: z.boolean() })).max(10),
  doNotMention: z.array(z.string().trim().min(1).max(200)).max(20),
}).superRefine((material, context) => {
  if (Object.keys(material.facts).length + material.observations.length + material.quotes.length === 0) {
    context.addIssue({ code: 'custom', message: 'At least one fact, observation, or quote is required' })
  }
})

export const HealthSchema = z.object({
  status: z.literal('ok'), service: z.string().min(1), version: z.string().min(1), timestamp: z.iso.datetime(),
})

const RoleNameSchema = z.string().min(1)
export const MembershipTeamScopeSchema = z.object({
  id: UuidSchema, name: z.string().min(1), roles: z.array(RoleNameSchema),
})
export const MembershipDepartmentScopeSchema = z.object({
  id: UuidSchema, name: z.string().min(1), roles: z.array(RoleNameSchema), teams: z.array(MembershipTeamScopeSchema),
})
export const MembershipScopeSchema = z.object({
  organizationId: UuidSchema, organizationName: z.string().min(1), organizationTimezone: z.string().min(1),
  organizationRoles: z.array(RoleNameSchema), departments: z.array(MembershipDepartmentScopeSchema),
})
export const MembershipScopesSchema = z.array(MembershipScopeSchema)

// Kept as an exported alias for integrations compiled against the prototype.
export const ContentTypeSchema = ContentPresetSlugSchema
export const SafetyFlagSchema = z.enum(['minor', 'missing_consent', 'uncertain_fact', 'sensitive_data'])

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

export const ClaimSchema = z.object({ sourceId: z.string().min(1).max(100), text: z.string().trim().min(1).max(500) })
export const PlatformVariantSchema = z.object({
  platform: z.enum(['instagram', 'facebook']), format: OutputFormatSchema,
  headline: z.string().trim().min(1).max(80), caption: z.string().trim().max(2200),
  callToAction: z.string().trim().max(240), hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u)).max(12),
  altText: z.string().trim().min(1).max(500), layoutFamily: z.enum(['photo_moment', 'training', 'quote', 'collage', 'invitation', 'thanks', 'result']),
  slidePlan: z.array(z.object({ role: z.string().min(1).max(40), headline: z.string().max(80).optional(), body: z.string().max(240).optional(), mediaAssetId: UuidSchema.optional() })).max(10).optional(),
  claimSourceIds: z.array(z.string().min(1).max(100)).max(40),
})

export const GeneratedPostSchema = z.object({
  verifiedFacts: z.array(z.string()).max(60), missingFacts: z.array(z.string()).max(30),
  headline: z.string().max(80), caption: z.string().max(1800), shortCaption: z.string().max(500),
  callToAction: z.string().max(240), hashtags: z.array(z.string()).max(12), altText: z.string().max(500),
  templateId: z.string().min(1), safetyFlags: z.array(SafetyFlagSchema),
  generatedClaims: z.array(ClaimSchema).max(60).default([]), variants: z.array(PlatformVariantSchema).max(8).default([]),
})

export const ObscuringStyleSchema = z.enum(['club_mascot', 'sports_ball', 'emoji', 'confetti_badge', 'brand_shape', 'scribble', 'pixelate', 'solid_blur'])
export const FaceDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('consented'), consentRecordId: UuidSchema }),
  z.object({ kind: z.literal('obscure'), style: ObscuringStyleSchema }), z.object({ kind: z.literal('exclude') }),
])
// Paket 015 ergaenzt drei Blocker: consent_scope_mismatch (Zeile gueltig, deckt aber nicht den
// angefragten Umfang), naming_not_allowed und sensitive_text_data (beide textbasiert, siehe
// scanTextForSensitiveData in packages/domain -- wirken unabhaengig davon, ob ueberhaupt ein Foto
// existiert).
export const MediaGateBlockerSchema = z.enum([
  'scan_pending', 'face_pending', 'consent_invalid', 'derivative_stale', 'minor_review_required', 'original_selected',
  'consent_scope_mismatch', 'naming_not_allowed', 'sensitive_text_data',
])
export const MediaGateResultSchema = z.object({ publishable: z.boolean(), blockers: z.array(MediaGateBlockerSchema) })

export type Health = z.infer<typeof HealthSchema>
export type ContentPresetSlug = z.infer<typeof ContentPresetSlugSchema>
export type CommunicationGoal = z.infer<typeof CommunicationGoalSchema>
export type OutputFormat = z.infer<typeof OutputFormatSchema>
export type SourceMaterial = z.infer<typeof SourceMaterialSchema>
export type CreateSubmission = z.infer<typeof CreateSubmissionSchema>
export type GeneratedPost = z.infer<typeof GeneratedPostSchema>
export type PlatformVariant = z.infer<typeof PlatformVariantSchema>
export type FaceDecision = z.infer<typeof FaceDecisionSchema>
export type MediaGateResult = z.infer<typeof MediaGateResultSchema>
export type MembershipScope = z.infer<typeof MembershipScopeSchema>
export type MediaGateBlocker = z.infer<typeof MediaGateBlockerSchema>
export type CompositionFormat = z.infer<typeof CompositionFormatSchema>
export type AttachmentUploadMetadata = z.infer<typeof AttachmentUploadMetadataSchema>
export type CompressionProvenance = z.infer<typeof CompressionProvenanceSchema>
export type StyleProfileRules = z.infer<typeof StyleProfileRulesSchema>
export type CustomStyleProfile = z.infer<typeof CustomStyleProfileSchema>
export type CreateCustomStyleProfileRequest = z.infer<typeof CreateCustomStyleProfileRequestSchema>
export type PlatformStylePersona = z.infer<typeof PlatformStylePersonaSchema>
export type CreatePlatformStylePersonaRequest = z.infer<typeof CreatePlatformStylePersonaRequestSchema>
export type UpdatePlatformStylePersonaRequest = z.infer<typeof UpdatePlatformStylePersonaRequestSchema>
export type CreateCompositionSession = z.infer<typeof CreateCompositionSessionSchema>
export type CreateGenerationCommand = z.infer<typeof CreateGenerationCommandSchema>
