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

// 'sync-integration-source' ist wie 'collect-analytics' reserviert, aber nicht verdrahtet: Paket
// 014 fuehrt einen Sync-Lauf synchron in der API-Anfrage aus (siehe apps/api), weil Paket 004
// (Hatchet-Produktionsintegration) weiterhin "in Arbeit" ist. Der Name bleibt fuer die kuenftige
// geplante/automatische Ausfuehrung ueber sync_cron vorgesehen.
export const WorkflowNameSchema = z.enum(['process-submission', 'anonymize-media', 'render-content', 'apply-revision', 'publish-content', 'collect-analytics', 'cleanup-expired-invitations', 'sync-integration-source'])
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
// Muss mit packages/domain/src/fonts.ts (curatedFonts) Schritt halten -- Contracts bleibt
// absichtlich ohne Laufzeitabhaengigkeit auf Domain (siehe packages/contracts/package.json),
// deshalb dieselbe Duplizierung wie bei den Permission-Listen (TS/SQL).
export const CuratedFontKeySchema = z.enum(['manrope', 'dm_sans', 'space_grotesk', 'karla'])
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

const OrganizationProfileFieldsSchema = z.object({
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
export const OrganizationProfileUpdateSchema = OrganizationProfileFieldsSchema.refine(
  (value) => Object.keys(value).length > 0,
  { message: 'at least one field must be provided' },
)
export const OrganizationProfileSchema = OrganizationProfileFieldsSchema.extend({
  organizationId: UuidSchema,
  countryCode: CountryCodeSchema,
})

// Nur Felder, die eine Abteilung/Mannschaft ueberhaupt selbst setzen kann (siehe
// BrandOverrideFieldsSchema unten, die Spalten von department_brand_profiles/team_brand_profiles
// und BRAND_LOCKABLE_FIELDS in packages/domain als TS-Gegenstueck). Ohne diese Begrenzung liess
// sich ein Tippfehler ('primary_colour') speichern, der dann nichts sperrt -- und die Oberflaeche
// bot Sperren fuer Felder an, die unterhalb des Vereins ohnehin niemand setzen kann.
export const BrandLockableFieldSchema = z.enum([
  'primaryColor', 'accentColor', 'tone', 'logoAssetId', 'displayFontAssetId', 'bodyFontAssetId',
])
const LockedFieldsSchema = z.array(BrandLockableFieldSchema).max(6)

export const OrganizationBrandUpdateSchema = z.object({
  primaryColor: HexColorSchema,
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  textColor: HexColorSchema,
  onPrimaryColor: HexColorSchema,
  tone: BrandToneSchema,
  displayFontKey: CuratedFontKeySchema,
  bodyFontKey: CuratedFontKeySchema,
  displayFontAssetId: UuidSchema.nullable().optional(),
  bodyFontAssetId: UuidSchema.nullable().optional(),
  allowDepartmentOverrides: z.boolean().optional(),
  lockedFields: LockedFieldsSchema.optional(),
})
export const OrganizationBrandSchema = z.object({
  organizationId: UuidSchema,
  primaryColor: HexColorSchema,
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  textColor: HexColorSchema,
  onPrimaryColor: HexColorSchema,
  tone: BrandToneSchema,
  displayFontKey: CuratedFontKeySchema,
  bodyFontKey: CuratedFontKeySchema,
  displayFontAssetId: UuidSchema.nullable(),
  bodyFontAssetId: UuidSchema.nullable(),
  allowDepartmentOverrides: z.boolean(),
  lockedFields: z.array(BrandLockableFieldSchema),
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

// Paket 013: Branding-Assets (Logovarianten, Wasserzeichen, eigene Schriften) auf Vereins-,
// Abteilungs- und Mannschaftsebene.
export const BrandAssetKindSchema = z.enum(['logo_primary', 'logo_light', 'logo_dark', 'logo_mark', 'wordmark', 'watermark', 'font'])
export const BrandAssetStatusSchema = z.enum(['processing', 'ready', 'rejected', 'replaced'])
export const FontStyleSchema = z.enum(['normal', 'italic'])

export const BrandAssetSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
  kind: BrandAssetKindSchema,
  objectPath: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.int().positive(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  fontFamily: z.string().nullable(),
  fontWeight: z.int().min(100).max(900).nullable(),
  fontStyle: FontStyleSchema.nullable(),
  licenseHolder: z.string().nullable(),
  licenseNote: z.string().nullable(),
  licenseConfirmedAt: z.iso.datetime({ offset: true }).nullable(),
  status: BrandAssetStatusSchema,
  rejectionReason: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})

// Aus den multipart-Feldern eines POST /v1/brand/assets gelesen -- die Datei selbst kommt als
// eigener Teil des multipart-Streams, nicht durch dieses Schema.
export const CreateBrandAssetRequestSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.optional(),
  teamId: UuidSchema.optional(),
  kind: BrandAssetKindSchema,
}).refine((value) => value.teamId === undefined || value.departmentId !== undefined, {
  message: 'teamId requires departmentId',
})

export const ConfirmBrandAssetLicenseRequestSchema = z.object({
  licenseHolder: z.string().trim().min(1).max(200),
  licenseNote: z.string().trim().max(1000).optional(),
  confirmed: z.literal(true),
})

const BrandOverrideFieldsSchema = z.object({
  primaryColor: HexColorSchema.nullable().optional(),
  accentColor: HexColorSchema.nullable().optional(),
  tone: BrandToneSchema.nullable().optional(),
  logoAssetId: UuidSchema.nullable().optional(),
  displayFontAssetId: UuidSchema.nullable().optional(),
  bodyFontAssetId: UuidSchema.nullable().optional(),
})

export const UpdateDepartmentBrandRequestSchema = BrandOverrideFieldsSchema.extend({
  allowTeamOverrides: z.boolean().optional(),
  lockedFields: LockedFieldsSchema.optional(),
})
export const DepartmentBrandSchema = UpdateDepartmentBrandRequestSchema.extend({
  organizationId: UuidSchema,
  departmentId: UuidSchema,
})

export const UpdateTeamBrandRequestSchema = BrandOverrideFieldsSchema
export const TeamBrandSchema = UpdateTeamBrandRequestSchema.extend({
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  teamId: UuidSchema,
})

export const OnboardingStepSchema = z.enum(['branding', 'responsible_person'])
export const OnboardingStateSchema = z.object({
  completedSteps: z.array(OnboardingStepSchema),
  dismissedAt: z.iso.datetime({ offset: true }).nullable(),
})

// Abteilungen, Teams, Mitgliedschaften und Einladungen (Paket 010).
export const ScopeLevelSchema = z.enum(['organization', 'department', 'team'])
// Jede Rolle, die in organization_memberships/department_memberships/team_memberships
// tatsaechlich vorkommen kann -- inklusive organization_owner, das nur lesend auftaucht.
export const RoleSchema = z.enum([
  'organization_owner', 'organization_admin', 'social_manager', 'billing_admin', 'organization_viewer',
  'department_admin', 'editor', 'approver', 'contributor', 'viewer', 'team_manager',
])
// organization_owner ist nie ueber diese Schemas vergebbar -- nur einladbar/zuweisbar sind
// die uebrigen Rollen (siehe invitations_role_matches_scope und authz.can_assign_role in
// 2026080601_structure_and_invitations.sql, sowie canAssignRole in packages/authorization).
export const AssignableRoleSchema = z.enum([
  'organization_admin', 'social_manager', 'billing_admin', 'organization_viewer',
  'department_admin', 'editor', 'approver', 'contributor', 'viewer', 'team_manager',
])

export const DepartmentSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})
export const CreateDepartmentRequestSchema = z.object({ name: z.string().trim().min(1).max(120) })
export const UpdateDepartmentRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.archived !== undefined, { message: 'at least one field must be provided' })

export const TeamSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  name: z.string().min(1),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})
export const CreateTeamRequestSchema = z.object({ name: z.string().trim().min(1).max(120) })
export const UpdateTeamRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.archived !== undefined, { message: 'at least one field must be provided' })

// Einzige Quelle fuer "welche Rolle passt zu welcher Scope-Ebene" -- von
// CreateMembershipRequestSchema, CreateInvitationRequestSchema (unten) und apps/api (fuer
// UpdateMembershipRequestSchema, das scope nicht im Body traegt) gemeinsam genutzt, damit diese
// Zuordnung nicht an drei Stellen unabhaengig voneinander gepflegt wird (siehe invitations_role_matches_scope
// in 2026080601_structure_and_invitations.sql fuer das SQL-Gegenstueck).
export const ORGANIZATION_SCOPED_ROLES: readonly AssignableRole[] = ['organization_admin', 'social_manager', 'billing_admin', 'organization_viewer']
export const DEPARTMENT_SCOPED_ROLES: readonly AssignableRole[] = ['department_admin', 'editor', 'approver', 'contributor', 'viewer']
export const TEAM_SCOPED_ROLES: readonly AssignableRole[] = ['team_manager', 'contributor', 'viewer']
export function rolesForScopeLevel(scope: ScopeLevel): readonly AssignableRole[] {
  return scope === 'organization' ? ORGANIZATION_SCOPED_ROLES : scope === 'department' ? DEPARTMENT_SCOPED_ROLES : TEAM_SCOPED_ROLES
}

// Richtlinien mit Vererbung (Paket 023): zwei boolesche Felder je Ebene, `null` heisst "von oben
// erben". Die Antwort traegt den effektiven Wert, den eigenen (ungeerbten) Wert, ob eine hoehere
// Ebene bereits verschaerft hat (lockedByAncestor -- ein Lockern an dieser Ebene waere wirkungslos)
// und ob der Anfragende diese Ebene ueberhaupt bearbeiten darf.
// Paket 012 ergaenzt zwei kanalbezogene Flags -- beide nur auf Vereinsebene sinnvoll (Plan 012:
// "eine Abteilung darf sich diese Erlaubnis nicht selbst geben"), durchgesetzt in set_policy_setting()
// selbst (organization_only_flag), nicht nur hier im Schema.
export const PolicyFlagSchema = z.enum([
  'invite_allowed', 'posts_visible_org_wide', 'allow_department_owned_channels', 'require_channel_responsible',
])
export const PolicyFlagStateSchema = z.object({
  effective: z.boolean(),
  ownValue: z.boolean().nullable(),
  lockedByAncestor: z.boolean(),
  canEdit: z.boolean(),
})
export const PolicySettingSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  name: z.string().min(1),
  inviteAllowed: PolicyFlagStateSchema,
  postsVisibleOrgWide: PolicyFlagStateSchema,
})
export const UpdatePolicySettingRequestSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  flag: PolicyFlagSchema,
  value: z.boolean().nullable(),
})

// Paket 011: Freigaberouten, Vertrauen je Mitglied, Kontingente ---------------------------------

export const ReviewModeSchema = z.enum(['any_with_permission', 'named'])
export const ReviewRequirementSchema = z.enum(['inherit', 'always', 'waived'])
export const QuotaPeriodSchema = z.enum(['day', 'week', 'month'])
export const ApprovalDecisionTypeSchema = z.enum(['approved', 'changes_requested', 'rejected'])
export const ApprovalStageStatusSchema = z.enum(['pending', 'open', 'satisfied', 'rejected', 'skipped', 'stalled'])

// Mehr als eine Einzelperson, weil "das Marketing muss freigeben" keine Namensliste sein soll --
// wer die Rolle verlaesst, verliert die Pruefrolle automatisch (Plan 011, "Fachliches Modell").
export const ReviewerRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: UuidSchema }),
  z.object({ kind: z.literal('organization_role'), role: AssignableRoleSchema }),
  z.object({ kind: z.literal('department_role'), departmentId: UuidSchema, role: AssignableRoleSchema }),
  z.object({ kind: z.literal('team_role'), departmentId: UuidSchema, teamId: UuidSchema, role: AssignableRoleSchema }),
])

export const PolicyReviewerSchema = z.object({
  id: UuidSchema,
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  kind: z.enum(['user', 'organization_role', 'department_role', 'team_role']),
  userId: UuidSchema.nullable(),
  role: z.string().nullable(),
  targetDepartmentId: UuidSchema.nullable(),
  targetTeamId: UuidSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})
export const CreatePolicyReviewerRequestSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  ref: ReviewerRefSchema,
})

// Heterogen typisiert (anders als die zwei booleschen Flags aus 023) -- own ist der ungeerbte
// Wert dieser Ebene (null = erben), effective das Ergebnis von mergeEffectiveConfig ueber
// Verein/Abteilung/Team (packages/domain).
export const PolicyRuleValuesSchema = z.object({
  reviewRequired: z.boolean().nullable(),
  reviewMode: ReviewModeSchema.nullable(),
  // min(1) wie tone und wie ApprovalStageSchema.label: eine leere Bezeichnung waere in der Datenbank
  // erlaubt (char_length <= 80), liesse danach aber jede Freigabeliste am label-Schema scheitern.
  reviewStageLabel: z.string().trim().min(1).max(80).nullable(),
  reviewMinimumApprovals: z.int().min(1).max(5).nullable(),
  reviewDeadlineHours: z.int().min(1).max(720).nullable(),
  minorApprovalRequired: z.boolean().nullable(),
  selfApprovalAllowed: z.boolean().nullable(),
  allowSameReviewerAcrossStages: z.boolean().nullable(),
  allowReviewExemptions: z.boolean().nullable(),
  mediaRequiresConsentCheck: z.boolean().nullable(),
  allowedPresets: z.array(ContentPresetSlugSchema).nullable(),
  allowedFormats: z.array(OutputFormatSchema).nullable(),
  allowedChannelIds: z.array(UuidSchema).nullable(),
  forbiddenTopics: z.array(z.string().trim().min(1).max(200)),
  requiredHashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u)),
  tone: z.string().trim().min(1).max(60).nullable(),
})
export const PolicyRuleSettingSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  name: z.string().min(1),
  own: PolicyRuleValuesSchema,
  effective: PolicyRuleValuesSchema,
  canEdit: z.boolean(),
  reviewers: z.array(PolicyReviewerSchema),
})
export const UpdatePolicyRulesRequestSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  patch: PolicyRuleValuesSchema.partial().refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' }),
})

export const MemberReviewTrustSchema = z.object({
  id: UuidSchema,
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  userId: UuidSchema,
  submitAllowed: z.boolean(),
  reviewRequirement: ReviewRequirementSchema,
  reason: z.string().max(500).nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
})
export const SetMemberReviewTrustRequestSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  userId: UuidSchema,
  submitAllowed: z.boolean(),
  reviewRequirement: ReviewRequirementSchema,
  reason: z.string().trim().max(500).nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
})

// reviewerUserIds ist null, solange die Stufe fuer den Anfragenden nicht sichtbar sein soll (der
// Autor sieht die Zusammensetzung noch nicht geoeffneter aeusserer Stufen nicht, Plan 011).
export const ApprovalStageSchema = z.object({
  id: UuidSchema,
  position: z.int().positive(),
  scope: ScopeLevelSchema,
  label: z.string().min(1),
  mode: ReviewModeSchema,
  minimumApprovals: z.int().min(1).max(5),
  isMinorStage: z.boolean(),
  status: ApprovalStageStatusSchema,
  reviewerUserIds: z.array(UuidSchema).nullable(),
  deadlineAt: z.iso.datetime({ offset: true }).nullable(),
  isOverdue: z.boolean(),
})
export const ApprovalDecisionSchema = z.object({
  id: UuidSchema,
  approvalStageId: UuidSchema,
  decidedBy: UuidSchema,
  decision: ApprovalDecisionTypeSchema,
  reason: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})
export const ApprovalRequestSchema = z.object({
  id: UuidSchema,
  postId: UuidSchema,
  postVersionId: UuidSchema,
  stages: z.array(ApprovalStageSchema),
  decisions: z.array(ApprovalDecisionSchema),
})
export const RequestApprovalResponseSchema = z.object({
  postId: UuidSchema,
  status: z.string(),
  approvalRequestId: UuidSchema.nullable(),
})
export const DecideApprovalStageRequestSchema = z.object({
  decision: ApprovalDecisionTypeSchema,
  reason: z.string().trim().min(1).max(2000).nullable().optional(),
})
export const DecideApprovalStageResponseSchema = z.object({
  stageId: UuidSchema,
  stageStatus: ApprovalStageStatusSchema,
  postStatus: z.string(),
  nextStageId: UuidSchema.optional(),
})

export const ChannelQuotaSchema = z.object({
  id: UuidSchema,
  scope: ScopeLevelSchema,
  scopeId: UuidSchema.nullable(),
  socialConnectionId: UuidSchema.nullable(),
  period: QuotaPeriodSchema,
  maxPublications: z.int().min(1).max(1000),
})
export const CreateChannelQuotaRequestSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  socialConnectionId: UuidSchema.nullable().optional(),
  period: QuotaPeriodSchema,
  maxPublications: z.int().min(1).max(1000),
})
export const UpdateChannelQuotaRequestSchema = z.object({ maxPublications: z.int().min(1).max(1000) })

export const SchedulePublicationRequestSchema = z.object({
  socialConnectionId: UuidSchema,
  scheduledFor: z.iso.datetime({ offset: true }).nullable(),
})
export const PublicationSchema = z.object({
  id: UuidSchema,
  postVersionId: UuidSchema,
  socialConnectionId: UuidSchema,
  platform: z.enum(['instagram', 'facebook']),
  status: z.string(),
  scheduledFor: z.iso.datetime({ offset: true }).nullable(),
})

// Paket 012: Kanaele und Social-Accounts --------------------------------------------------------

export const SocialPlatformSchema = z.enum(['instagram', 'facebook'])
export const SocialConnectionStatusSchema = z.enum(['active', 'action_required', 'disconnected'])
// team ist kein gueltiger Kanalbesitz (siehe social_connections_owner_check) -- eigenes Schema
// statt des geteilten ScopeLevelSchema, damit ein Team hier gar nicht erst waehlbar ist.
export const ChannelOwnerScopeSchema = z.enum(['organization', 'department'])

export const ChannelScopeAssignmentSchema = z.object({
  id: UuidSchema,
  scope: ScopeLevelSchema,
  scopeId: UuidSchema.nullable(),
  canSchedule: z.boolean(),
})
export const CreateChannelScopeRequestSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  canSchedule: z.boolean().default(true),
})

export const SocialConnectionSchema = z.object({
  id: UuidSchema,
  platform: SocialPlatformSchema,
  externalAccountId: z.string(),
  displayName: z.string(),
  status: SocialConnectionStatusSchema,
  tokenExpiresAt: z.iso.datetime({ offset: true }).nullable(),
  lastVerifiedAt: z.iso.datetime({ offset: true }).nullable(),
  ownerScope: ChannelOwnerScopeSchema,
  ownerDepartmentId: UuidSchema.nullable(),
  responsibleProfileId: UuidSchema.nullable(),
  purpose: z.string().nullable(),
  confidential: z.boolean(),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  scopes: z.array(ChannelScopeAssignmentSchema),
})
export const UpdateSocialConnectionRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  purpose: z.string().trim().max(200).nullable().optional(),
  responsibleProfileId: UuidSchema.nullable().optional(),
  confidential: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })

// Nur Lesen: geschrieben wird ueber das bestehende PUT /v1/policy-settings mit scope='organization'
// (PolicyFlagSchema oben traegt die zwei neuen Flags bereits) -- ein eigener Schreibpfad waere eine
// zweite, parallele Implementierung derselben set_policy_setting()-RPC gewesen.
export const ChannelPolicySchema = z.object({
  allowDepartmentOwnedChannels: z.boolean(),
  requireChannelResponsible: z.boolean(),
})

export const ChannelConnectStartRequestSchema = z.object({
  ownerScope: ChannelOwnerScopeSchema,
  ownerDepartmentId: UuidSchema.nullable(),
}).refine((value) => (value.ownerScope === 'organization') === (value.ownerDepartmentId === null), {
  message: 'ownerDepartmentId is required exactly when ownerScope is department',
})

export const OAuthAvailableAccountSchema = z.object({
  externalAccountId: z.string(),
  displayName: z.string(),
})
export const OAuthPendingConnectionSchema = z.object({
  id: UuidSchema,
  platform: SocialPlatformSchema,
  availableAccounts: z.array(OAuthAvailableAccountSchema),
})
export const SelectOAuthAccountRequestSchema = z.object({ externalAccountId: z.string() })

export const AvailableChannelsResponseSchema = z.object({ socialConnectionIds: z.array(UuidSchema) })

export const CreateMembershipRequestSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  userId: UuidSchema,
  role: AssignableRoleSchema,
}).superRefine((value, context) => {
  if (!rolesForScopeLevel(value.scope).includes(value.role)) {
    context.addIssue({ code: 'custom', message: `role must be one of ${rolesForScopeLevel(value.scope).join(', ')} for scope "${value.scope}"` })
  }
})
export const UpdateMembershipRequestSchema = z.object({ role: AssignableRoleSchema })
// Getrennt von UpdateMembershipRequestSchema (Paket 023): eine Befristung zu setzen ist kein
// Rollenwechsel und braucht keine can_assign_role-Pruefung einer neuen Rolle, siehe
// public.set_membership_expiry() in supabase/migrations.
export const UpdateMembershipExpiryRequestSchema = z.object({ expiresAt: z.iso.datetime({ offset: true }).nullable() })

// scopeName ist bewusst nicht Teil dieses Schemas: die Oberflaeche kennt Abteilungs-/Team-Namen
// bereits aus useSession()/useScope() (siehe authz.membership_scopes()) und kann sie ueber
// scope+scopeId nachschlagen, ohne dass dieser Endpunkt sie redundant mitliefern muss.
// Capability-Felder (Paket 023): die Antwort traegt mit, ob DER ANFRAGENDE diese Zeile aendern
// darf -- serverseitig aus denselben Funktionen berechnet, die PATCH/DELETE /v1/memberships auch
// selbst durchsetzen (authz.can_remove_role/can_assign_role via canRemoveRole/canAssignRole). Die
// Oberflaeche zeigt und sendet nur, was hier steht, statt useCan()/canAssignRole ein zweites Mal
// gegen die eigene Rolle herzuleiten -- genau die Doppelherleitung, die im Nachfolge-Review von
// Paket 010 zwei funktionale Fehler verursacht hat.
export const MemberRoleEntrySchema = z.object({
  membershipId: UuidSchema,
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  role: RoleSchema,
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  canChangeRole: z.boolean(),
  canRemove: z.boolean(),
  canSetExpiry: z.boolean(),
}).superRefine((value, context) => {
  // organization_owner ist nie durch AssignableRoleSchema/rolesForScopeLevel abgedeckt (nicht
  // vergebbar), taucht in einer Mitgliederliste fuer scope: 'organization' aber lesend auf --
  // hier deshalb separat erlaubt, sonst wuerde ein echter Vereinsinhaber die Antwort ungueltig
  // machen. Jede andere Rolle/Scope-Kombination ist unmoeglich (department_role/team_role in der
  // Datenbank kennen organization_owner gar nicht) und war vor diesem Check unbemerkt vom Schema
  // akzeptiert worden (beim Review dieses Pakets gefunden).
  const validRoles: readonly string[] = value.scope === 'organization' ? ['organization_owner', ...ORGANIZATION_SCOPED_ROLES] : rolesForScopeLevel(value.scope)
  if (!validRoles.includes(value.role)) {
    context.addIssue({ code: 'custom', message: `role must be one of ${validRoles.join(', ')} for scope "${value.scope}"` })
  }
})
export const MemberSchema = z.object({
  userId: UuidSchema,
  displayName: z.string().min(1),
  roles: z.array(MemberRoleEntrySchema).min(1),
})

export const InvitationSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: AssignableRoleSchema,
  invitedBy: UuidSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  acceptedAt: z.iso.datetime({ offset: true }).nullable(),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
  lastSentAt: z.iso.datetime({ offset: true }),
  sendCount: z.int().min(1).max(10),
  createdAt: z.iso.datetime({ offset: true }),
})
// Die Ebene ergibt sich aus departmentId/teamId -- dieselbe Regel wie invitations_scope_check
// und invitations_role_matches_scope in der Migration, hier vor dem ersten DB-Roundtrip geprueft.
export const CreateInvitationRequestSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable().optional(),
  teamId: UuidSchema.nullable().optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: AssignableRoleSchema,
}).superRefine((value, context) => {
  if (value.teamId && !value.departmentId) {
    context.addIssue({ code: 'custom', message: 'a team-scoped invitation requires departmentId' })
  }
  if (value.teamId && !TEAM_SCOPED_ROLES.includes(value.role)) {
    context.addIssue({ code: 'custom', message: `role must be one of ${TEAM_SCOPED_ROLES.join(', ')} for a team-scoped invitation` })
  } else if (!value.teamId && value.departmentId && !DEPARTMENT_SCOPED_ROLES.includes(value.role)) {
    context.addIssue({ code: 'custom', message: `role must be one of ${DEPARTMENT_SCOPED_ROLES.join(', ')} for a department-scoped invitation` })
  } else if (!value.departmentId && !ORGANIZATION_SCOPED_ROLES.includes(value.role)) {
    context.addIssue({ code: 'custom', message: `role must be one of ${ORGANIZATION_SCOPED_ROLES.join(', ')} for an organization-scoped invitation` })
  }
})
export const AcceptInvitationRequestSchema = z.object({ token: z.string().min(1) })
export const AcceptInvitationResponseSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
  role: AssignableRoleSchema,
})

// Plattform-Administration (Paket 022): der SaaS-Betreiber, orthogonal zu allen
// vereinsbezogenen Rollen oben. Jede Schreiboperation hier ist requirePlatformAdmin-gated.
export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
)

export const PlatformAdminStatusSchema = z.object({ isPlatformAdmin: z.boolean(), isDefaultAdmin: z.boolean() })
export const PlatformAdminSchema = z.object({
  userId: UuidSchema,
  isDefaultAdmin: z.boolean(),
  // offset: true -- PostgREST serialisiert timestamptz mit numerischem Offset (z.B. +00:00),
  // nicht mit dem "Z"-Suffix, den z.iso.datetime() sonst zwingend verlangt.
  createdAt: z.iso.datetime({ offset: true }),
})
export const AddPlatformAdminRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
})

// Nur ein Schluessel existiert heute (loest 009s hartkodierte Konstante ab). Ein unbekannter
// Schluessel wird von der API abgelehnt statt stillschweigend ungeprueft gespeichert zu werden.
export const PlatformSettingKeySchema = z.enum(['max_organizations_per_owner'])
export const PlatformSettingValueSchemas = {
  max_organizations_per_owner: z.int().positive().max(1000),
} as const satisfies Record<z.infer<typeof PlatformSettingKeySchema>, z.ZodType<unknown>>
export const PlatformSettingSchema = z.object({
  key: PlatformSettingKeySchema,
  value: JsonValueSchema,
  updatedAt: z.iso.datetime({ offset: true }),
})
export const UpdatePlatformSettingRequestSchema = z.object({ value: JsonValueSchema })

export const LlmProviderProtocolSchema = z.enum(['anthropic', 'openai'])
export const LlmProviderConfigurationSchema = z.object({
  id: UuidSchema,
  label: z.string().trim().min(1).max(160),
  protocol: LlmProviderProtocolSchema,
  baseUrl: z.url(),
  model: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(60),
  priority: z.int(),
  isActive: z.boolean(),
  systemPromptOverride: z.string().trim().min(1).max(8000).nullable(),
  hasSecret: z.boolean(),
})
export const CreateLlmProviderConfigurationRequestSchema = z.object({
  label: z.string().trim().min(1).max(160),
  protocol: LlmProviderProtocolSchema,
  baseUrl: z.url(),
  model: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(60).default('default'),
  priority: z.int().default(100),
  isActive: z.boolean().default(true),
  systemPromptOverride: z.string().trim().min(1).max(8000).nullable().optional(),
  apiKey: z.string().trim().min(1).max(4000),
})
export const UpdateLlmProviderConfigurationRequestSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  protocol: LlmProviderProtocolSchema.optional(),
  baseUrl: z.url().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  purpose: z.string().trim().min(1).max(60).optional(),
  priority: z.int().optional(),
  isActive: z.boolean().optional(),
  systemPromptOverride: z.string().trim().min(1).max(8000).nullable().optional(),
  apiKey: z.string().trim().min(1).max(4000).optional(),
})

export const PlatformAdminOrganizationSummarySchema = z.object({
  organizationId: UuidSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  memberCount: z.int().min(0),
  departmentCount: z.int().min(0),
  createdAt: z.iso.datetime({ offset: true }),
})
export const UsageMetricsQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
})
export const UsageMetricsBucketSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  postsCreated: z.int().min(0),
  llmGeneratedVersions: z.int().min(0),
  workflowRunsFailed: z.int().min(0),
  publicationsFailed: z.int().min(0),
})
export const UsageMetricsResponseSchema = z.object({ buckets: z.array(UsageMetricsBucketSchema) })

// Integrationsrahmen und Mitgliederverzeichnis (Paket 014). HTTP- und Webhook-Transport sind nur
// als Werte vorgesehen -- kein Adapter in diesem Paket, siehe plans/014.
export const IntegrationDomainSchema = z.enum(['people', 'teams', 'fixtures', 'events'])
export const IntegrationTransportSchema = z.enum(['file', 'http', 'ical', 'webhook'])
export const FieldMappingSchema = z.record(z.string(), z.string())

export const IntegrationSourceSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  transport: IntegrationTransportSchema,
  providerKey: z.string().min(1),
  displayName: z.string().min(1),
  enabledDomains: z.array(IntegrationDomainSchema).min(1).max(4),
  departmentId: UuidSchema.nullable(),
  endpointUrl: z.url().nullable(),
  fieldMapping: FieldMappingSchema,
  syncCron: z.string().nullable(),
  lossThresholdPercent: z.int().min(1).max(100),
  enabled: z.boolean(),
  lastSyncAt: z.iso.datetime({ offset: true }).nullable(),
  lastSyncStatus: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})

export const CreateIntegrationSourceRequestSchema = z
  .object({
    // 'http'/'webhook' bewusst nicht waehlbar: kein Adapter in diesem Paket (plans/014).
    transport: z.enum(['file', 'ical']),
    providerKey: z.string().trim().min(1).max(80),
    displayName: z.string().trim().min(1).max(160),
    enabledDomains: z.array(IntegrationDomainSchema).min(1).max(4),
    departmentId: UuidSchema.nullable().optional(),
    endpointUrl: z.url().optional(),
    fieldMapping: FieldMappingSchema.optional(),
    lossThresholdPercent: z.int().min(1).max(100).optional(),
  })
  .refine((value) => value.transport !== 'ical' || value.endpointUrl !== undefined, {
    message: 'endpointUrl is required for ical sources',
  })
  // cardinality() in der Migration zaehlt Duplikate mit -- ['people','people'] besteht den
  // DB-CHECK trotzdem, ohne dass ein zweiter Bereich tatsaechlich aktiviert waere.
  .refine((value) => new Set(value.enabledDomains).size === value.enabledDomains.length, { message: 'enabledDomains must not contain duplicates' })

export const UpdateIntegrationSourceRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160).optional(),
    enabledDomains: z.array(IntegrationDomainSchema).min(1).max(4).optional(),
    endpointUrl: z.url().optional(),
    fieldMapping: FieldMappingSchema.optional(),
    lossThresholdPercent: z.int().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })
  .refine((value) => value.enabledDomains === undefined || new Set(value.enabledDomains).size === value.enabledDomains.length, {
    message: 'enabledDomains must not contain duplicates',
  })

export const SyncModeSchema = z.enum(['dry_run', 'apply'])
export const SyncRunStatusSchema = z.enum(['running', 'succeeded', 'failed', 'cancelled', 'aborted_loss_threshold'])
export const IntegrationSyncRunSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  sourceId: UuidSchema,
  domain: IntegrationDomainSchema,
  mode: SyncModeSchema,
  status: SyncRunStatusSchema,
  createdCount: z.int().min(0),
  updatedCount: z.int().min(0),
  retiredCount: z.int().min(0),
  skippedCount: z.int().min(0),
  conflictCount: z.int().min(0),
  errorClass: z.string().nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
})

export const SyncConflictKindSchema = z.enum(['ambiguous_match', 'unknown_structure', 'value_conflict', 'invalid_record'])
export const SyncConflictResolutionSchema = z.enum(['pending', 'keep_current', 'take_incoming', 'ignore_permanently'])
export const IntegrationSyncConflictSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  syncRunId: UuidSchema,
  sourceId: UuidSchema,
  domain: IntegrationDomainSchema,
  externalId: z.string().nullable(),
  localId: UuidSchema.nullable(),
  label: z.string().min(1),
  field: z.string().min(1),
  currentValue: z.string().nullable(),
  incomingValue: z.string().nullable(),
  kind: SyncConflictKindSchema,
  resolution: SyncConflictResolutionSchema,
  resolvedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})
export const ResolveSyncConflictRequestSchema = z.object({
  resolution: z.enum(['keep_current', 'take_incoming', 'ignore_permanently']),
})

// Antwort auf einen Sync-Lauf (Trockenlauf oder Uebernahme): der Lauf selbst plus die dabei
// entstandenen Konflikte, damit die Oberflaeche beides in einer Anfrage bekommt.
export const SyncSourceResponseSchema = z.object({
  run: IntegrationSyncRunSchema,
  conflicts: z.array(IntegrationSyncConflictSchema),
})

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const DirectoryPersonStatusSchema = z.enum(['active', 'inactive', 'left', 'unknown'])
export const DirectoryPersonSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthYear: z.int().min(1900).max(2100).nullable(),
  isMinor: z.boolean(),
  status: DirectoryPersonStatusSchema,
  leftAt: IsoDateSchema.nullable(),
  joinedAt: IsoDateSchema.nullable(),
  profileId: UuidSchema.nullable(),
  becameAdultAt: z.iso.datetime({ offset: true }).nullable(),
  sourceId: UuidSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})

// Nur ueber einen eigenen Endpunkt erreichbar (department.manage oder hoeher, mit Audit-Eintrag) --
// niemals Teil von DirectoryPersonSchema, siehe plans/014 "Rechtekonzept".
export const DirectoryPersonGuardianContactSchema = z.object({
  guardianName: z.string().nullable(),
  guardianEmail: z.string().nullable(),
})

const DirectoryPersonFieldsSchema = z.object({
  departmentId: UuidSchema.nullable().optional(),
  teamId: UuidSchema.nullable().optional(),
  birthYear: z.int().min(1900).max(2100).nullable().optional(),
  isMinor: z.boolean().optional(),
  status: DirectoryPersonStatusSchema.optional(),
  joinedAt: IsoDateSchema.nullable().optional(),
  guardianName: z.string().trim().min(1).max(160).nullable().optional(),
  guardianEmail: z.string().trim().toLowerCase().pipe(z.email()).nullable().optional(),
  profileId: UuidSchema.nullable().optional(),
})
export const CreateDirectoryPersonRequestSchema = DirectoryPersonFieldsSchema.extend({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
}).refine((value) => value.teamId === undefined || value.teamId === null || value.departmentId !== undefined, {
  message: 'teamId requires departmentId',
})
export const UpdateDirectoryPersonRequestSchema = DirectoryPersonFieldsSchema.extend({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  leftAt: IsoDateSchema.nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })

// Eigenes Profil (Paket 014, Abschnitt "Personenstammdaten: zwei Datensatzarten, nicht eine"):
// Selbstbedienung, keine Vereinsdaten -- die Vereinszugehoerigkeit bleibt reine Anzeige.
export const ProfileSchema = z.object({
  id: UuidSchema,
  displayName: z.string().min(1),
  avatarPath: z.string().nullable(),
})
export const UpdateProfileRequestSchema = z
  .object({ displayName: z.string().trim().min(1).max(120).optional() })
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })

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
export type BrandAssetKind = z.infer<typeof BrandAssetKindSchema>
export type BrandAssetStatus = z.infer<typeof BrandAssetStatusSchema>
export type BrandAsset = z.infer<typeof BrandAssetSchema>
export type CreateBrandAssetRequest = z.infer<typeof CreateBrandAssetRequestSchema>
export type ConfirmBrandAssetLicenseRequest = z.infer<typeof ConfirmBrandAssetLicenseRequestSchema>
export type UpdateDepartmentBrandRequest = z.infer<typeof UpdateDepartmentBrandRequestSchema>
export type DepartmentBrand = z.infer<typeof DepartmentBrandSchema>
export type UpdateTeamBrandRequest = z.infer<typeof UpdateTeamBrandRequestSchema>
export type TeamBrand = z.infer<typeof TeamBrandSchema>
export type CuratedFontKey = z.infer<typeof CuratedFontKeySchema>
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>
export type OnboardingState = z.infer<typeof OnboardingStateSchema>
export type ScopeLevel = z.infer<typeof ScopeLevelSchema>
export type AssignableRole = z.infer<typeof AssignableRoleSchema>
export type Department = z.infer<typeof DepartmentSchema>
export type CreateDepartmentRequest = z.infer<typeof CreateDepartmentRequestSchema>
export type UpdateDepartmentRequest = z.infer<typeof UpdateDepartmentRequestSchema>
export type Team = z.infer<typeof TeamSchema>
export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>
export type UpdateTeamRequest = z.infer<typeof UpdateTeamRequestSchema>
export type PolicyFlag = z.infer<typeof PolicyFlagSchema>
export type PolicyFlagState = z.infer<typeof PolicyFlagStateSchema>
export type PolicySetting = z.infer<typeof PolicySettingSchema>
export type UpdatePolicySettingRequest = z.infer<typeof UpdatePolicySettingRequestSchema>
export type ReviewMode = z.infer<typeof ReviewModeSchema>
export type ReviewRequirement = z.infer<typeof ReviewRequirementSchema>
export type QuotaPeriod = z.infer<typeof QuotaPeriodSchema>
export type ApprovalDecisionTypeValue = z.infer<typeof ApprovalDecisionTypeSchema>
export type ApprovalStageStatus = z.infer<typeof ApprovalStageStatusSchema>
export type ReviewerRef = z.infer<typeof ReviewerRefSchema>
export type PolicyReviewer = z.infer<typeof PolicyReviewerSchema>
export type CreatePolicyReviewerRequest = z.infer<typeof CreatePolicyReviewerRequestSchema>
export type PolicyRuleValues = z.infer<typeof PolicyRuleValuesSchema>
export type PolicyRuleSetting = z.infer<typeof PolicyRuleSettingSchema>
export type UpdatePolicyRulesRequest = z.infer<typeof UpdatePolicyRulesRequestSchema>
export type MemberReviewTrust = z.infer<typeof MemberReviewTrustSchema>
export type SetMemberReviewTrustRequest = z.infer<typeof SetMemberReviewTrustRequestSchema>
export type ApprovalStage = z.infer<typeof ApprovalStageSchema>
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>
export type RequestApprovalResponse = z.infer<typeof RequestApprovalResponseSchema>
export type DecideApprovalStageRequest = z.infer<typeof DecideApprovalStageRequestSchema>
export type DecideApprovalStageResponse = z.infer<typeof DecideApprovalStageResponseSchema>
export type ChannelQuota = z.infer<typeof ChannelQuotaSchema>
export type CreateChannelQuotaRequest = z.infer<typeof CreateChannelQuotaRequestSchema>
export type UpdateChannelQuotaRequest = z.infer<typeof UpdateChannelQuotaRequestSchema>
export type SchedulePublicationRequest = z.infer<typeof SchedulePublicationRequestSchema>
export type Publication = z.infer<typeof PublicationSchema>
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>
export type SocialConnectionStatus = z.infer<typeof SocialConnectionStatusSchema>
export type ChannelOwnerScope = z.infer<typeof ChannelOwnerScopeSchema>
export type ChannelScopeAssignment = z.infer<typeof ChannelScopeAssignmentSchema>
export type CreateChannelScopeRequest = z.infer<typeof CreateChannelScopeRequestSchema>
export type SocialConnection = z.infer<typeof SocialConnectionSchema>
export type UpdateSocialConnectionRequest = z.infer<typeof UpdateSocialConnectionRequestSchema>
export type ChannelPolicy = z.infer<typeof ChannelPolicySchema>
export type ChannelConnectStartRequest = z.infer<typeof ChannelConnectStartRequestSchema>
export type OAuthAvailableAccount = z.infer<typeof OAuthAvailableAccountSchema>
export type OAuthPendingConnection = z.infer<typeof OAuthPendingConnectionSchema>
export type SelectOAuthAccountRequest = z.infer<typeof SelectOAuthAccountRequestSchema>
export type AvailableChannelsResponse = z.infer<typeof AvailableChannelsResponseSchema>
export type CreateMembershipRequest = z.infer<typeof CreateMembershipRequestSchema>
export type UpdateMembershipRequest = z.infer<typeof UpdateMembershipRequestSchema>
export type UpdateMembershipExpiryRequest = z.infer<typeof UpdateMembershipExpiryRequestSchema>
export type MemberRoleEntry = z.infer<typeof MemberRoleEntrySchema>
export type Member = z.infer<typeof MemberSchema>
export type Invitation = z.infer<typeof InvitationSchema>
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponseSchema>
export type PlatformAdminStatus = z.infer<typeof PlatformAdminStatusSchema>
export type PlatformAdmin = z.infer<typeof PlatformAdminSchema>
export type AddPlatformAdminRequest = z.infer<typeof AddPlatformAdminRequestSchema>
export type PlatformSettingKey = z.infer<typeof PlatformSettingKeySchema>
export type PlatformSetting = z.infer<typeof PlatformSettingSchema>
export type UpdatePlatformSettingRequest = z.infer<typeof UpdatePlatformSettingRequestSchema>
export type LlmProviderProtocol = z.infer<typeof LlmProviderProtocolSchema>
export type LlmProviderConfigurationDto = z.infer<typeof LlmProviderConfigurationSchema>
export type CreateLlmProviderConfigurationRequest = z.infer<typeof CreateLlmProviderConfigurationRequestSchema>
export type UpdateLlmProviderConfigurationRequest = z.infer<typeof UpdateLlmProviderConfigurationRequestSchema>
export type PlatformAdminOrganizationSummary = z.infer<typeof PlatformAdminOrganizationSummarySchema>
export type UsageMetricsQuery = z.infer<typeof UsageMetricsQuerySchema>
export type UsageMetricsBucket = z.infer<typeof UsageMetricsBucketSchema>
export type UsageMetricsResponse = z.infer<typeof UsageMetricsResponseSchema>
export type IntegrationDomain = z.infer<typeof IntegrationDomainSchema>
export type IntegrationTransport = z.infer<typeof IntegrationTransportSchema>
export type FieldMapping = z.infer<typeof FieldMappingSchema>
export type IntegrationSource = z.infer<typeof IntegrationSourceSchema>
export type CreateIntegrationSourceRequest = z.infer<typeof CreateIntegrationSourceRequestSchema>
export type UpdateIntegrationSourceRequest = z.infer<typeof UpdateIntegrationSourceRequestSchema>
export type SyncMode = z.infer<typeof SyncModeSchema>
export type SyncRunStatus = z.infer<typeof SyncRunStatusSchema>
export type IntegrationSyncRun = z.infer<typeof IntegrationSyncRunSchema>
export type SyncConflictKind = z.infer<typeof SyncConflictKindSchema>
export type SyncConflictResolution = z.infer<typeof SyncConflictResolutionSchema>
export type IntegrationSyncConflict = z.infer<typeof IntegrationSyncConflictSchema>
export type ResolveSyncConflictRequest = z.infer<typeof ResolveSyncConflictRequestSchema>
export type SyncSourceResponse = z.infer<typeof SyncSourceResponseSchema>
export type DirectoryPersonStatus = z.infer<typeof DirectoryPersonStatusSchema>
export type DirectoryPerson = z.infer<typeof DirectoryPersonSchema>
export type DirectoryPersonGuardianContact = z.infer<typeof DirectoryPersonGuardianContactSchema>
export type CreateDirectoryPersonRequest = z.infer<typeof CreateDirectoryPersonRequestSchema>
export type UpdateDirectoryPersonRequest = z.infer<typeof UpdateDirectoryPersonRequestSchema>
export type Profile = z.infer<typeof ProfileSchema>
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>
