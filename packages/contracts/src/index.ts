import { z } from 'zod'

export const UuidSchema = z.uuid()
export const ContentPresetSlugSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/).max(64)
export const CommunicationGoalSchema = z.enum([
  'inform', 'inspire', 'thank', 'invite', 'recruit', 'educate', 'strengthen_community',
])
export const OutputFormatSchema = z.enum(['feed_image', 'carousel', 'story', 'reel'])
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

// Breaking: replaces the earlier contentType/facts shape; WorkflowPayloadSchema now requires entityId/idempotencyKey too.
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
export const MediaGateBlockerSchema = z.enum(['scan_pending', 'face_pending', 'consent_invalid', 'derivative_stale', 'minor_review_required', 'original_selected'])
export const MediaGateResultSchema = z.object({ publishable: z.boolean(), blockers: z.array(MediaGateBlockerSchema) })

export const WorkflowNameSchema = z.enum(['process-submission', 'anonymize-media', 'render-content', 'apply-revision', 'publish-content', 'collect-analytics'])
export const WorkflowPayloadSchema = z.object({
  submissionId: UuidSchema.optional(), entityId: UuidSchema, organizationId: UuidSchema, departmentId: UuidSchema,
  correlationId: UuidSchema, sourceRevision: z.int().positive(), idempotencyKey: z.string().min(1).max(240),
}).superRefine((payload, context) => {
  if (payload.submissionId && payload.submissionId !== payload.entityId) context.addIssue({ code: 'custom', message: 'submissionId must match entityId' })
})

export const SubmissionAcceptedSchema = z.object({ submissionId: UuidSchema, correlationId: UuidSchema, status: z.enum(['queued', 'facts_required']), idempotencyKey: z.string().min(1) })

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/)
export const LegalFormSchema = z.enum(['e_v', 'gmbh', 'gugmbh', 'ggmbh', 'nicht_eingetragen', 'sonstige'])
export const CuratedFontKeySchema = z.enum(['manrope', 'dm_sans'])
export const BrandToneSchema = z.enum(['nahbar', 'dynamisch', 'sachlich'])
// Rejects garbage before it ever reaches organizations.timezone -- an invalid IANA zone
// would otherwise only fail later, as a RangeError inside Intl.DateTimeFormat calls that
// format every date and scheduling deadline in the organization's timezone.
const IanaTimezoneSchema = z.string().min(1).max(64).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}, { message: 'must be a valid IANA time zone' })

export const CreateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  firstDepartmentName: z.string().trim().min(1).max(120),
  timezone: IanaTimezoneSchema.default('Europe/Berlin'),
})
export const CreateOrganizationResponseSchema = z.object({ organizationId: UuidSchema, slug: z.string().min(1) })

export const OrganizationProfileUpdateSchema = z.object({
  legalName: z.string().trim().min(1).max(160).nullable().optional(),
  legalForm: LegalFormSchema.nullable().optional(),
  registerCourt: z.string().trim().min(1).max(160).nullable().optional(),
  registerNumber: z.string().trim().min(1).max(80).nullable().optional(),
  street: z.string().trim().min(1).max(160).nullable().optional(),
  houseNumber: z.string().trim().min(1).max(20).nullable().optional(),
  postalCode: z.string().trim().min(1).max(20).nullable().optional(),
  city: z.string().trim().min(1).max(120).nullable().optional(),
  countryCode: CountryCodeSchema.optional(),
  contactEmail: z.string().trim().toLowerCase().pipe(z.email()).nullable().optional(),
  contactPhone: z.string().trim().min(1).max(40).nullable().optional(),
  websiteUrl: z.url().nullable().optional(),
  foundedYear: z.int().min(1800).max(2100).nullable().optional(),
  responsiblePersonProfileId: UuidSchema.nullable().optional(),
})
export const OrganizationProfileSchema = OrganizationProfileUpdateSchema.extend({
  organizationId: UuidSchema,
  countryCode: CountryCodeSchema,
})

export const OrganizationBrandUpdateSchema = z.object({
  primaryColor: HexColorSchema,
  accentColor: HexColorSchema,
  tone: BrandToneSchema,
  displayFontKey: CuratedFontKeySchema,
  bodyFontKey: CuratedFontKeySchema,
})
export const OrganizationBrandSchema = OrganizationBrandUpdateSchema.extend({
  organizationId: UuidSchema,
  logoPath: z.string().nullable(),
  logoDarkPath: z.string().nullable(),
})

export const BrandLogoVariantSchema = z.enum(['light', 'dark'])
export const BrandLogoUploadResponseSchema = z.object({
  variant: BrandLogoVariantSchema,
  path: z.string().min(1),
  signedUrl: z.url(),
  sanitized: z.boolean(),
})

export const OnboardingStepSchema = z.enum(['branding', 'responsible_person'])
export const OnboardingStateSchema = z.object({
  completedSteps: z.array(OnboardingStepSchema),
  dismissedAt: z.iso.datetime().nullable(),
})

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
export type WorkflowPayload = z.infer<typeof WorkflowPayloadSchema>
export type MembershipScope = z.infer<typeof MembershipScopeSchema>
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequestSchema>
export type OrganizationProfileUpdate = z.infer<typeof OrganizationProfileUpdateSchema>
export type OrganizationProfile = z.infer<typeof OrganizationProfileSchema>
export type OrganizationBrandUpdate = z.infer<typeof OrganizationBrandUpdateSchema>
export type OrganizationBrand = z.infer<typeof OrganizationBrandSchema>
export type BrandLogoVariant = z.infer<typeof BrandLogoVariantSchema>
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>
export type OnboardingState = z.infer<typeof OnboardingStateSchema>
