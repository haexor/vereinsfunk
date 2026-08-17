import { z } from 'zod'
import { ContentPresetSlugSchema, MediaGateBlockerSchema, OutputFormatSchema, UuidSchema } from './content.js'
import { OAuthPlatformSchema, SocialPlatformSchema } from './primitives.js'
import { AssignableRoleSchema, ScopeLevelSchema } from './structure.js'

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
  // min(1) wie ApprovalStageSchema.label: eine leere Bezeichnung waere in der Datenbank erlaubt
  // (char_length <= 80), liesse danach aber jede Freigabeliste am label-Schema scheitern.
  reviewStageLabel: z.string().trim().min(1).max(80).nullable(),
  reviewMinimumApprovals: z.int().min(1).max(5).nullable(),
  reviewDeadlineHours: z.int().min(1).max(720).nullable(),
  minorApprovalRequired: z.boolean().nullable(),
  selfApprovalAllowed: z.boolean().nullable(),
  allowSameReviewerAcrossStages: z.boolean().nullable(),
  allowReviewExemptions: z.boolean().nullable(),
  mediaRequiresConsentCheck: z.boolean().nullable(),
  // Paket 015: consentExpiresOnLeave folgt derselben OR-Verschaerfung wie mediaRequiresConsentCheck
  // (own=null erbt); consentValidityMonths ist knotenlokal wie reviewMinimumApprovals (own=null
  // heisst "keine Frist auf dieser Ebene", effective fuer die Registratur-Vorbelegung wird
  // separat mit Abteilungs-/Vereins-Fallback aufgeloest, nicht hier).
  consentExpiresOnLeave: z.boolean().nullable(),
  consentValidityMonths: z.int().min(1).max(120).nullable(),
  allowedPresets: z.array(ContentPresetSlugSchema).nullable(),
  allowedFormats: z.array(OutputFormatSchema).nullable(),
  allowedChannelIds: z.array(UuidSchema).nullable(),
  // Plan 044: null = geerbt, [] = ausdruecklich keine Vorauswahl -- anders als die drei Felder
  // oben ersetzt ein gesetzter Wert die Vorgabe der aeusseren Ebene komplett (packages/domain,
  // mergeReplaceableList), statt sie nur einzuengen.
  defaultTargetPlatforms: z.array(SocialPlatformSchema).nullable(),
  forbiddenTopics: z.array(z.string().trim().min(1).max(200)),
  requiredHashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u)),
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
  // Paket 015: Medien-Gate-Blocker des zugehoerigen Beitrags (evaluateMediaGate), damit eine
  // Pruefende Person eine fehlende/nicht passende Einwilligung sieht, statt nur die Stufe selbst.
  // Leer, solange der Beitrag kein Medium mit Gesichtsregionen hat. .default([]) haelt bestehende
  // Konsumenten ohne diese Angabe kompatibel (gefunden im Code-Review).
  mediaGateBlockers: z.array(MediaGateBlockerSchema).default([]),
})
export const ApprovalDecisionSchema = z.object({
  id: UuidSchema,
  approvalStageId: UuidSchema,
  decidedBy: UuidSchema,
  decision: ApprovalDecisionTypeSchema,
  reason: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})
// Paket 024: redigierte Projektion des Zustands VOR einer Neuaufloesung -- bewusst ohne
// Pruefer-IDs (siehe plans/024, "Datenmodell": die opened_at-basierte Sichtbarkeitsregel fuer den
// Autor darf ueber den Verlauf nicht umgangen werden).
export const ApprovalRouteChangeStageSchema = z.object({
  position: z.number().int().positive(),
  label: z.string(),
  scope: ScopeLevelSchema,
  status: ApprovalStageStatusSchema,
  reviewerCount: z.number().int().nonnegative(),
})
export const ApprovalRouteChangeSchema = z.object({
  id: UuidSchema,
  changedBy: UuidSchema,
  reason: z.string(),
  stagesBefore: z.array(ApprovalRouteChangeStageSchema),
  createdAt: z.iso.datetime({ offset: true }),
})
export const ApprovalRequestSchema = z.object({
  id: UuidSchema,
  postId: UuidSchema,
  postVersionId: UuidSchema,
  stages: z.array(ApprovalStageSchema),
  decisions: z.array(ApprovalDecisionSchema),
  // .default([]) haelt bestehende Konsumenten ohne diese Angabe kompatibel, gleiches Muster wie
  // mediaGateBlockers oben.
  routeChanges: z.array(ApprovalRouteChangeSchema).default([]),
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

// Paket 024: eine laufende Freigabe bewusst neu aufloesen (plans/024-freigaberoute-neu-aufloesen.md).
export const ReresolveApprovalRouteRequestSchema = z.object({
  reason: z.string().trim().min(10).max(2000),
})
export const ReresolveApprovalRouteResponseSchema = z.object({
  postId: UuidSchema,
  approvalRequestId: UuidSchema,
  status: z.string(),
  firstStageId: UuidSchema.nullable(),
})
// Festhaengende Freigabe der eigenen Ebene (plans/024, "Oberflaeche"): mindestens eine offene
// Stufe ist ueberfaellig ODER die Anfrage ist invalidiert. Bewusst kleiner als der Plan-Entwurf --
// "der reviewer_snapshot ist nicht mehr erfuellbar" (unresolvableReviewers) fehlt, siehe
// plans/024, "Umsetzung: Ergebnis und Abweichungen vom Plan".
export const StalledApprovalRequestSchema = z.object({
  approvalRequestId: UuidSchema,
  postId: UuidSchema,
  postVersionId: UuidSchema,
  departmentId: UuidSchema,
  postTitle: z.string(),
  isOverdue: z.boolean(),
  invalidated: z.boolean(),
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
  platform: OAuthPlatformSchema,
  status: z.string(),
  scheduledFor: z.iso.datetime({ offset: true }).nullable(),
})

// Paket 025: Ergebnis von POST /v1/publications/:id/execute -- externalId/permalink fehlen bei
// einem Fehlschlag (status='failed'/'action_required').
export const PublicationExecuteResultSchema = z.object({
  id: UuidSchema,
  status: z.enum(['published', 'processing', 'unknown', 'failed', 'action_required']),
  externalId: z.string().optional(),
  permalink: z.string().optional(),
})

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
export type ApprovalRouteChange = z.infer<typeof ApprovalRouteChangeSchema>
export type RequestApprovalResponse = z.infer<typeof RequestApprovalResponseSchema>
export type DecideApprovalStageRequest = z.infer<typeof DecideApprovalStageRequestSchema>
export type DecideApprovalStageResponse = z.infer<typeof DecideApprovalStageResponseSchema>
export type ReresolveApprovalRouteRequest = z.infer<typeof ReresolveApprovalRouteRequestSchema>
export type ReresolveApprovalRouteResponse = z.infer<typeof ReresolveApprovalRouteResponseSchema>
export type StalledApprovalRequest = z.infer<typeof StalledApprovalRequestSchema>
export type ChannelQuota = z.infer<typeof ChannelQuotaSchema>
export type CreateChannelQuotaRequest = z.infer<typeof CreateChannelQuotaRequestSchema>
export type UpdateChannelQuotaRequest = z.infer<typeof UpdateChannelQuotaRequestSchema>
export type SchedulePublicationRequest = z.infer<typeof SchedulePublicationRequestSchema>
export type Publication = z.infer<typeof PublicationSchema>
