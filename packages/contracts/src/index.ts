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
  sourceMaterial: z.lazy(() => SourceMaterialSchema),
  mediaAssetIds: z.array(UuidSchema).max(10).default([]),
  sourceRevision: z.int().positive().default(1),
}).superRefine((value, context) => {
  if (value.styleProfileId && value.systemStyleProfileSlug) context.addIssue({ code: 'custom', message: 'Choose either a custom or system style profile' })
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

// --- Paket 015: Einwilligungsverwaltung ---------------------------------------------------------

export const ConsentPurposeSchema = z.enum(['social_media', 'website', 'print', 'internal'])
export const ConsentPlatformSchema = z.enum(['instagram', 'facebook'])
export const ConsentMediaKindSchema = z.enum(['photo', 'video'])
export const ConsentContextSchema = z.enum(['team_photo', 'match', 'training', 'event', 'portrait'])

export const ConsentScopeSchema = z.object({
  purposes: z.array(ConsentPurposeSchema).min(1),
  platforms: z.array(ConsentPlatformSchema).nullable(),
  mediaKinds: z.array(ConsentMediaKindSchema).min(1),
  contexts: z.array(ConsentContextSchema).nullable(),
  namingAllowed: z.boolean(),
  departmentIds: z.array(UuidSchema).nullable(),
})

export const ConsentOriginSchema = z.enum(['paper', 'digital', 'imported'])
export const ConsentSignerRoleSchema = z.enum(['self', 'guardian'])
export const ConsentRevokedBySchema = z.enum(['self', 'guardian', 'organization'])
// Ampel fuer die Uebersicht (Plan 015, Abschnitt 6) -- serverseitig aus evaluateConsent plus
// Herkunft berechnet, damit die Oberflaeche nicht selbst die elf ConsentBlocker interpretieren muss.
export const ConsentStatusSchema = z.enum([
  'valid', 'expiring_soon', 'expired', 'revoked', 'not_yet_valid', 'guardian_missing', 'superseded', 'imported_unverified',
])

export const ConsentRecordSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  directoryPersonId: UuidSchema.nullable(),
  // POST /v1/data-subjects/:personId/erase setzt dieses Feld auf NULL (die Zeile selbst bleibt als
  // Nachweis bestehen, nur die identifizierende Verknuepfung verschwindet) -- nicht nullable haette
  // eine sonst gueltige Anfrage mit ZodError und 400 invalid_request scheitern lassen.
  pseudonymousSubjectRef: z.string().nullable(),
  scope: z.string(),
  scopeStructured: ConsentScopeSchema,
  origin: ConsentOriginSchema,
  sourceId: UuidSchema.nullable(),
  signedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  signerName: z.string().nullable(),
  signerRole: ConsentSignerRoleSchema.nullable(),
  guardianConfirmed: z.boolean(),
  validFrom: z.iso.datetime({ offset: true }),
  validUntil: z.iso.datetime({ offset: true }).nullable(),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
  revokedBy: ConsentRevokedBySchema.nullable(),
  revocationReason: z.string().nullable(),
  supersededBy: UuidSchema.nullable(),
  status: ConsentStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
})

// Multipart-Felder fuer POST /v1/consents (Datei separat, wie CreateBrandAssetRequestSchema).
// scopeStructured kommt als JSON-Zeichenkette an (multipart kennt nur Strings) und wird vor dieser
// Validierung bereits geparst -- siehe apps/api.
export const CreateConsentRecordFieldsSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.optional(),
  directoryPersonId: UuidSchema.optional(),
  pseudonymousSubjectRef: z.string().trim().min(8).max(160).optional(),
  scope: z.string().trim().min(1).max(500),
  scopeStructured: ConsentScopeSchema,
  signedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  signerName: z.string().trim().min(1).max(160),
  signerRole: ConsentSignerRoleSchema,
  guardianConfirmed: z.stringbool().default(false),
}).refine((value) => Boolean(value.directoryPersonId) !== Boolean(value.pseudonymousSubjectRef), {
  message: 'exactly one of directoryPersonId or pseudonymousSubjectRef is required',
})

export const RevokeConsentRequestSchema = z.object({
  revokedBy: ConsentRevokedBySchema,
  reason: z.string().trim().min(1).max(500).optional(),
})

export const SupersedeConsentRequestSchema = z.object({
  scope: z.string().trim().min(1).max(500),
  scopeStructured: ConsentScopeSchema,
  signedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  signerName: z.string().trim().min(1).max(160),
  signerRole: ConsentSignerRoleSchema,
  guardianConfirmed: z.boolean().default(false),
})

export const ConsentRequestStatusSchema = z.enum(['sent', 'granted', 'declined', 'expired', 'revoked_link'])
export const ConsentRequestSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  directoryPersonId: UuidSchema,
  recipientEmail: z.string(),
  recipientRole: ConsentSignerRoleSchema,
  requestedScope: ConsentScopeSchema,
  textVersion: z.string(),
  status: ConsentRequestStatusSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  respondedAt: z.iso.datetime({ offset: true }).nullable(),
  consentRecordId: UuidSchema.nullable(),
  sendCount: z.int(),
  lastSentAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
})
export const CreateConsentRequestRequestSchema = z.object({
  organizationId: UuidSchema,
  directoryPersonId: UuidSchema,
  recipientEmail: z.string().trim().toLowerCase().pipe(z.email()),
  recipientRole: ConsentSignerRoleSchema,
  requestedScope: ConsentScopeSchema,
})

// Oeffentliche, unauthentifizierte Seiten (Plan 015, Abschnitt 3) -- bewusst so schmal wie
// moeglich: kein Vereinsname anderer Personen, kein Auflisten weiterer Kinder.
export const PublicConsentRequestViewSchema = z.object({
  organizationName: z.string(),
  personLabel: z.string(),
  textVersion: z.string(),
  consentText: z.string(),
  requestedScope: ConsentScopeSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  status: ConsentRequestStatusSchema,
})
export const RespondConsentRequestRequestSchema = z.object({ decision: z.enum(['granted', 'declined']) })

export const PublicConsentRevocationViewSchema = z.object({
  organizationName: z.string(),
  personLabel: z.string(),
  status: z.enum(['active', 'already_revoked']),
})

// Text pro Verein editierbar, nie global (Entscheidung 2026-08-08). id dient als text_version --
// unveraenderlich, eine Aenderung legt eine neue Zeile an. id ist keine UUID: ohne eigenen Text
// liefert die API die feste Kennung 'default-template', dieselbe, die POST /v1/consent-requests
// dann in consent_requests.text_version speichert.
export const OrganizationConsentTextSchema = z.object({
  id: z.string(),
  organizationId: UuidSchema,
  body: z.string().min(1).max(20_000),
  createdAt: z.iso.datetime({ offset: true }).nullable(),
  isDefaultTemplate: z.boolean(),
})
export const UpdateOrganizationConsentTextRequestSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
})

// Paket 020: Rechtliche Pflichten und Datenschutzbetrieb -----------------------------------------

export const RetentionSettingsSchema = z.object({
  organizationId: UuidSchema,
  rawMediaDays: z.int().min(7).max(730),
  derivativeDays: z.int().min(30).max(3650).nullable(),
  auditEventDays: z.int().min(365).max(3650),
  consentEvidenceYears: z.int().min(1).max(30),
  // Paket 016: post_status_events. Nachgetragen, siehe plans/016-auswertung-interne-kennzahlen.md,
  // "Abweichungen vom Plan" Punkt 7 -- die Spalte war in 020 bewusst ausgespart worden.
  statusEventDays: z.int().min(90).max(3650),
  updatedAt: z.iso.datetime({ offset: true }),
})
export const UpdateRetentionSettingsRequestSchema = z.object({
  rawMediaDays: z.int().min(7).max(730).optional(),
  derivativeDays: z.int().min(30).max(3650).nullable().optional(),
  auditEventDays: z.int().min(365).max(3650).optional(),
  consentEvidenceYears: z.int().min(1).max(30).optional(),
  statusEventDays: z.int().min(90).max(3650).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })

export const RetentionRuleKeySchema = z.enum(['raw_media', 'media_derivatives', 'audit_events', 'expired_tokens', 'consent_evidence', 'stale_exports', 'status_events'])
export const RetentionDeletionSchema = z.object({
  ruleKey: RetentionRuleKeySchema,
  entityType: z.string(),
  entityCount: z.int().min(0),
  cutoffDate: z.iso.date(),
})
export const RunRetentionRequestSchema = z.object({ dryRun: z.boolean() })
export const RunRetentionResponseSchema = z.object({
  organizationId: UuidSchema,
  dryRun: z.boolean(),
  correlationId: UuidSchema,
  results: z.array(RetentionDeletionSchema),
})

export const DataSubjectRequestKindSchema = z.enum(['access', 'deletion', 'rectification', 'objection', 'portability'])
export const DataSubjectRequestSubjectKindSchema = z.enum(['member', 'directory_person', 'guardian', 'external'])
export const DataSubjectRequestStatusSchema = z.enum(['open', 'in_progress', 'completed', 'rejected', 'partially_completed'])
export const DataSubjectRequestSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  kind: DataSubjectRequestKindSchema,
  subjectKind: DataSubjectRequestSubjectKindSchema,
  directoryPersonId: UuidSchema.nullable(),
  subjectLabel: z.string(),
  receivedAt: z.iso.date(),
  dueAt: z.iso.date(),
  extendedUntil: z.iso.date().nullable(),
  extensionReason: z.string().nullable(),
  status: DataSubjectRequestStatusSchema,
  resolutionNote: z.string().nullable(),
  handledBy: UuidSchema.nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})
// Grenzen gegen offensichtlich unsinnige Werte (adversariale Pruefung): z.iso.date() allein
// akzeptiert Jahre 0001-9999 und der due_at-Trigger rechnet ungeprueft "+ interval '1 month'" --
// ein receivedAt nahe 9999-12-31 erzeugt ein due_at, das jenseits von z.iso.date()s eigener
// Grenze liegt und macht danach JEDE Leseantwort (auch die Listen-Route) dauerhaft ungueltig, ohne
// dass es einen Loeschweg fuer die Zeile gibt. 2020-01-01 liegt deutlich vor der ersten Zeile
// dieses Projekts; "heute" schliesst ein Eingangsdatum in der Zukunft aus.
const DATA_SUBJECT_REQUEST_RECEIVED_AT_MIN = '2020-01-01'
export const CreateDataSubjectRequestRequestSchema = z.object({
  kind: DataSubjectRequestKindSchema,
  subjectKind: DataSubjectRequestSubjectKindSchema,
  directoryPersonId: UuidSchema.nullable().optional(),
  subjectLabel: z.string().trim().min(1).max(200),
  receivedAt: z.iso.date().refine(
    (value) => value >= DATA_SUBJECT_REQUEST_RECEIVED_AT_MIN && value <= new Date().toISOString().slice(0, 10),
    { message: `receivedAt must be between ${DATA_SUBJECT_REQUEST_RECEIVED_AT_MIN} and today` },
  ),
})
export const UpdateDataSubjectRequestRequestSchema = z.object({
  status: DataSubjectRequestStatusSchema.optional(),
  resolutionNote: z.string().trim().max(2000).nullable().optional(),
  extendedUntil: z.iso.date().nullable().optional(),
  extensionReason: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })
  // Eine Teilaktualisierung sieht nur die mitgeschickten Felder, nicht den bestehenden
  // Datenbankzustand -- "extensionReason ohne extendedUntil in DERSELBEN Anfrage" ist deshalb die
  // einzige Bedingung, die dieses Schema allein pruefen kann. Der Spiegelfall (extendedUntil wird
  // auf null gesetzt, ein bestehendes extensionReason bleibt unangetastet) wird serverseitig in
  // apps/api/src/app.ts behoben, indem extensionReason dabei mitgeloescht wird (gefunden in der
  // adversarialen Pruefung: beide Faelle verletzten sonst den CHECK der Datenbank mit einem
  // unbehandelten 500 statt eines verstaendlichen 400).
  .refine((value) => !value.extensionReason || (value.extendedUntil !== undefined && value.extendedUntil !== null), {
    message: 'setting extensionReason requires providing extendedUntil in the same request',
  })

export const DataSubjectExportResponseSchema = z.object({ signedUrl: z.string(), expiresAt: z.iso.datetime({ offset: true }) })
export const DataSubjectEraseResponseSchema = z.object({
  erased: z.array(z.string()),
  retained: z.array(z.object({ category: z.string(), reason: z.string() })),
})

export const ProcessingRecordSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  purpose: z.string(),
  legalBasis: z.string(),
  dataCategories: z.array(z.string()),
  subjectCategories: z.array(z.string()),
  recipients: z.array(z.string()),
  thirdCountryTransfer: z.boolean(),
  transferSafeguard: z.string().nullable(),
  retentionNote: z.string(),
  reviewedAt: z.iso.date().nullable(),
  reviewedBy: UuidSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})
export const CreateProcessingRecordRequestSchema = z.object({
  purpose: z.string().trim().min(1).max(300),
  legalBasis: z.string().trim().min(1).max(1000),
  dataCategories: z.array(z.string().trim().min(1)).default([]),
  subjectCategories: z.array(z.string().trim().min(1)).default([]),
  recipients: z.array(z.string().trim().min(1)).default([]),
  thirdCountryTransfer: z.boolean().default(false),
  transferSafeguard: z.string().trim().max(300).nullable().optional(),
  retentionNote: z.string().trim().min(1).max(1000),
}).refine((value) => !value.thirdCountryTransfer || !!value.transferSafeguard, {
  message: 'transferSafeguard is required when thirdCountryTransfer is true',
})
export const UpdateProcessingRecordRequestSchema = z.object({
  purpose: z.string().trim().min(1).max(300).optional(),
  legalBasis: z.string().trim().min(1).max(1000).optional(),
  dataCategories: z.array(z.string().trim().min(1)).optional(),
  subjectCategories: z.array(z.string().trim().min(1)).optional(),
  recipients: z.array(z.string().trim().min(1)).optional(),
  thirdCountryTransfer: z.boolean().optional(),
  transferSafeguard: z.string().trim().max(300).nullable().optional(),
  retentionNote: z.string().trim().min(1).max(1000).optional(),
  confirmReviewed: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })
  // Nur die Kombination innerhalb DIESER Anfrage pruefbar (thirdCountryTransfer=true UND
  // transferSafeguard explizit geloescht in einem Aufruf) -- der wichtigere Fall, dass
  // thirdCountryTransfer bereits true in der Datenbank steht und nur transferSafeguard genullt
  // wird, kann ein Zod-Schema ohne Datenbankzugriff nicht sehen und wird serverseitig in
  // apps/api/src/app.ts vor dem Update gegen den bestehenden Datensatz geprueft.
  .refine((value) => value.thirdCountryTransfer !== true || value.transferSafeguard !== null, {
    message: 'transferSafeguard cannot be cleared while thirdCountryTransfer is true',
  })

export const ProcessorAgreementStatusSchema = z.enum(['pending', 'active', 'expired', 'terminated'])
export const ProcessorAgreementSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  processorName: z.string(),
  purpose: z.string(),
  signedAt: z.iso.date().nullable(),
  validUntil: z.iso.date().nullable(),
  hasDocument: z.boolean(),
  status: ProcessorAgreementStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
})
export const CreateProcessorAgreementFieldsSchema = z.object({
  processorName: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(1).max(300),
  signedAt: z.iso.date().optional(),
  validUntil: z.iso.date().optional(),
  status: ProcessorAgreementStatusSchema.default('pending'),
}).refine((value) => value.signedAt === undefined || value.validUntil === undefined || value.validUntil > value.signedAt, {
  message: 'validUntil must be after signedAt',
})
export const UpdateProcessorAgreementRequestSchema = z.object({
  status: ProcessorAgreementStatusSchema.optional(),
  validUntil: z.iso.date().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })
// validUntil > signedAt kann hier nicht mitgeprueft werden -- signedAt ist in diesem Schema gar
// nicht setzbar, der bestehende Wert steht nur in der Datenbank. apps/api/src/app.ts laedt ihn vor
// dem Update nach und prueft dort.

export const AuditChainVerificationSchema = z.object({
  organizationId: UuidSchema,
  checkedCount: z.int().min(0),
  tamperedCount: z.int().min(0),
  unlinkedCount: z.int().min(0),
  lastSignedAt: z.iso.datetime({ offset: true }).nullable(),
  // null nur, wenn noch nie signiert wurde -- sonst das Ergebnis der kryptografischen Pruefung der
  // zuletzt gespeicherten Signatur gegen den Schluessel (nicht in der Datenbank). false ist der
  // eigentliche Alarm dieses Endpunkts: die gespeicherte Signatur passt nicht mehr zum
  // gespeicherten Kopf-Hash.
  signatureValid: z.boolean().nullable(),
})
export const SignAuditChainResponseSchema = z.object({
  organizationId: UuidSchema,
  eventCount: z.int().min(0),
  headHash: z.string().nullable(),
  keyVersion: z.string(),
  signedAt: z.iso.datetime({ offset: true }),
})

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
  submissionId: UuidSchema.optional(), entityId: UuidSchema, organizationId: UuidSchema, departmentId: UuidSchema, teamId: UuidSchema.optional(),
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

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/)
export const LegalFormSchema = z.enum(['e_v', 'gmbh', 'gugmbh', 'ggmbh', 'nicht_eingetragen', 'sonstige'])

// Oeffentlich, ohne Anmeldung abrufbar (GET /v1/organizations/:id/imprint) -- ein Verein kann
// diese URL aus seiner Instagram-/Facebook-Bio verlinken, ohne eine eigene Website zu betreiben.
// Traegt nur, was auf einem Impressum stehen darf: keine Profil-ID, keine E-Mail einer
// verantwortlichen Person ausser der offiziellen Vereinskontaktadresse.
export const PublicOrganizationImprintSchema = z.object({
  organizationName: z.string(),
  legalName: z.string().nullable(),
  legalForm: LegalFormSchema.nullable(),
  registerCourt: z.string().nullable(),
  registerNumber: z.string().nullable(),
  street: z.string().nullable(),
  houseNumber: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  countryCode: z.string(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  responsiblePersonName: z.string().nullable(),
})
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
  // Ausdrueckliche Freigabe fuer GET /v1/organizations/:id/imprint (oeffentlich, ohne Anmeldung) --
  // ohne dieses Feld wuerden Kontakt-/Adress-/Registerangaben, die nur zur internen Verwaltung
  // eingetragen wurden, ungefragt veroeffentlicht (adversariale Pruefung). Default false.
  imprintPublished: z.boolean().optional(),
})
export const OrganizationProfileUpdateSchema = OrganizationProfileFieldsSchema.refine(
  (value) => Object.keys(value).length > 0,
  { message: 'at least one field must be provided' },
)
export const OrganizationProfileSchema = OrganizationProfileFieldsSchema.extend({
  organizationId: UuidSchema,
  countryCode: CountryCodeSchema,
  imprintPublished: z.boolean(),
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
  // Paket 019: Herkunft und Merkmale, die fuer Inhalte zaehlen. Nur der Sync-Codepfad (Service
  // Role) schreibt sie -- keine Oberflaeche in diesem Paket setzt sie manuell, siehe Migration
  // 2026080704_fixtures_and_events.sql.
  ageGroup: z.string().nullable().optional(),
  competition: z.string().nullable().optional(),
  sourceId: UuidSchema.nullable().optional(),
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
  // Paket 015: consentExpiresOnLeave folgt derselben OR-Verschaerfung wie mediaRequiresConsentCheck
  // (own=null erbt); consentValidityMonths ist knotenlokal wie reviewMinimumApprovals (own=null
  // heisst "keine Frist auf dieser Ebene", effective fuer die Registratur-Vorbelegung wird
  // separat mit Abteilungs-/Vereins-Fallback aufgeloest, nicht hier).
  consentExpiresOnLeave: z.boolean().nullable(),
  consentValidityMonths: z.int().min(1).max(120).nullable(),
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
  platform: z.enum(['instagram', 'facebook']),
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
  // Paket 020: presserechtliche Pflichtangaben je Kanal.
  imprintUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
  editorialResponsibleProfileId: UuidSchema.nullable(),
  editorialResponsibleNote: z.string().nullable(),
})
export const UpdateSocialConnectionRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  purpose: z.string().trim().max(200).nullable().optional(),
  responsibleProfileId: UuidSchema.nullable().optional(),
  confidential: z.boolean().optional(),
  imprintUrl: z.string().trim().url().max(500).nullable().optional(),
  privacyUrl: z.string().trim().url().max(500).nullable().optional(),
  editorialResponsibleProfileId: UuidSchema.nullable().optional(),
  editorialResponsibleNote: z.string().trim().max(500).nullable().optional(),
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
// The vocabulary deliberately describes future tasks, but only text_generation has an adapter.
// APIs must reject activating every other task until its own adapter spike exists.
export const LlmTaskKindSchema = z.enum(['text_generation', 'image_generation', 'video_generation'])
export const LlmRuntimeParametersSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.2),
  maxOutputTokens: z.int().min(128).max(4_000).default(1_200),
  structuredOutputRequired: z.literal(true).default(true),
}).strict()
export const LlmProviderConfigurationSchema = z.object({
  id: UuidSchema,
  label: z.string().trim().min(1).max(160),
  protocol: LlmProviderProtocolSchema,
  baseUrl: z.url(),
  model: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(60), // historical display/operations field
  taskKind: LlmTaskKindSchema,
  runtimeParameters: LlmRuntimeParametersSchema,
  priority: z.int(),
  isActive: z.boolean(),
  hasSecret: z.boolean(),
})
export const CreateLlmProviderConfigurationRequestSchema = z.object({
  label: z.string().trim().min(1).max(160),
  protocol: LlmProviderProtocolSchema,
  baseUrl: z.url(),
  model: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(60).default('text_generation'),
  taskKind: LlmTaskKindSchema.default('text_generation'),
  runtimeParameters: LlmRuntimeParametersSchema.default({ temperature: 0.2, maxOutputTokens: 1200, structuredOutputRequired: true }),
  priority: z.int().default(100),
  isActive: z.boolean().default(true),
  apiKey: z.string().trim().min(1).max(4000),
})
export const UpdateLlmProviderConfigurationRequestSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  protocol: LlmProviderProtocolSchema.optional(),
  baseUrl: z.url().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  purpose: z.string().trim().min(1).max(60).optional(),
  taskKind: LlmTaskKindSchema.optional(),
  runtimeParameters: LlmRuntimeParametersSchema.optional(),
  priority: z.int().optional(),
  isActive: z.boolean().optional(),
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
export const PlatformAdminOrganizationActivitySchema = z.object({
  posts: z.int().min(0),
  reels: z.int().min(0),
  videoAssets: z.int().min(0),
})
export const PlatformAdminOrganizationDetailSchema = z.object({
  organizationId: UuidSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  timezone: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  memberCount: z.int().min(0),
  departmentCount: z.int().min(0),
  contact: z.object({
    responsiblePersonName: z.string().min(1).nullable(),
    // Die E-Mail des aktuellen organization_owner-Accounts. Sie ist nicht mit der
    // freiwillig gepflegten Vereins-Kontaktadresse gleichzusetzen und wird nur auf
    // der requirePlatformAdmin-geschuetzten Detailroute ausgegeben.
    ownerAccountEmail: z.string().email().nullable(),
    email: z.string().email().nullable(),
    phone: z.string().min(1).nullable(),
    legalName: z.string().min(1).nullable(),
    street: z.string().min(1).nullable(),
    houseNumber: z.string().min(1).nullable(),
    postalCode: z.string().min(1).nullable(),
    city: z.string().min(1).nullable(),
    countryCode: CountryCodeSchema,
    websiteUrl: z.url().nullable(),
  }),
  storage: z.object({
    rawMediaBytes: z.number().int().min(0),
    renderedMediaBytes: z.number().int().min(0),
    totalMediaBytes: z.number().int().min(0),
  }),
  activity: z.object({
    day: PlatformAdminOrganizationActivitySchema,
    week: PlatformAdminOrganizationActivitySchema,
    month: PlatformAdminOrganizationActivitySchema,
    year: PlatformAdminOrganizationActivitySchema,
  }),
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
export const SyncIdempotencyKeySchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
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
  idempotencyKey: SyncIdempotencyKeySchema,
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

// Paket 019: Mannschaften, Spielplaene, Ergebnisse und Veranstaltungen.
export const FixtureKindSchema = z.enum(['match', 'friendly', 'tournament', 'cup'])
export const FixtureStatusSchema = z.enum(['scheduled', 'postponed', 'cancelled', 'played', 'unknown'])
export const FixtureSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  teamId: UuidSchema.nullable(),
  kind: FixtureKindSchema,
  competition: z.string().nullable(),
  isHome: z.boolean().nullable(),
  ownTeamLabel: z.string().nullable(),
  opponentName: z.string().nullable(),
  kickoffAt: z.iso.datetime({ offset: true }).nullable(),
  kickoffTimeConfirmed: z.boolean(),
  venueName: z.string().nullable(),
  venueAddress: z.string().nullable(),
  status: FixtureStatusSchema,
  homeScore: z.int().min(0).nullable(),
  awayScore: z.int().min(0).nullable(),
  note: z.string().nullable(),
  announcementDismissedAt: z.iso.datetime({ offset: true }).nullable(),
  resultDismissedAt: z.iso.datetime({ offset: true }).nullable(),
  sourceId: UuidSchema.nullable(),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const ClubEventCategorySchema = z.enum([
  'general_meeting', 'festival', 'tournament', 'training_camp', 'course', 'social', 'fundraiser', 'ceremony', 'other',
])
export const ClubEventStatusSchema = z.enum(['scheduled', 'postponed', 'cancelled'])
export const ClubEventSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  category: ClubEventCategorySchema,
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  allDay: z.boolean(),
  locationName: z.string().nullable(),
  locationAddress: z.string().nullable(),
  registrationUrl: z.string().nullable(),
  status: ClubEventStatusSchema,
  invitationDismissedAt: z.iso.datetime({ offset: true }).nullable(),
  sourceId: UuidSchema.nullable(),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

// Herkunftsnachweis einer vorbelegten Tatsache (plans/019, Abschnitt 3): je Fakt, aus welcher
// Quellenzeile und von welchem Stand er kommt. Von der API selbst aus der referenzierten
// fixture/club_event-Zeile berechnet, nie vom Client uebernommen.
export const FactProvenanceSchema = z.object({
  source: z.enum(['fixture', 'club_event']),
  sourceId: UuidSchema,
  capturedAt: z.iso.datetime({ offset: true }),
})
export const SourceProvenanceMapSchema = z.record(z.string(), FactProvenanceSchema)

export const ContentSuggestionKindSchema = z.enum(['fixture_announcement', 'fixture_result', 'event_invitation', 'quota_reminder'])
export const ContentSuggestionSchema = z.object({
  kind: ContentSuggestionKindSchema,
  label: z.string().min(1),
  departmentId: UuidSchema.nullable(),
  fixtureId: UuidSchema.optional(),
  clubEventId: UuidSchema.optional(),
  occursAt: z.iso.datetime({ offset: true }).optional(),
}).refine((value) => {
  if (value.kind === 'fixture_announcement' || value.kind === 'fixture_result') return value.fixtureId !== undefined && value.clubEventId === undefined
  if (value.kind === 'event_invitation') return value.clubEventId !== undefined && value.fixtureId === undefined
  return value.fixtureId === undefined && value.clubEventId === undefined
}, { message: 'reference id must match the suggestion kind' })
export const ContentSuggestionsResponseSchema = z.object({ suggestions: z.array(ContentSuggestionSchema) })

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
export type WorkflowName = z.infer<typeof WorkflowNameSchema>
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>
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
export type LlmTaskKind = z.infer<typeof LlmTaskKindSchema>
export type LlmRuntimeParameters = z.infer<typeof LlmRuntimeParametersSchema>
export type LlmProviderConfigurationDto = z.infer<typeof LlmProviderConfigurationSchema>
export type CreateLlmProviderConfigurationRequest = z.infer<typeof CreateLlmProviderConfigurationRequestSchema>
export type UpdateLlmProviderConfigurationRequest = z.infer<typeof UpdateLlmProviderConfigurationRequestSchema>
export type PlatformAdminOrganizationSummary = z.infer<typeof PlatformAdminOrganizationSummarySchema>
export type PlatformAdminOrganizationDetail = z.infer<typeof PlatformAdminOrganizationDetailSchema>
export type PlatformAdminOrganizationActivity = z.infer<typeof PlatformAdminOrganizationActivitySchema>
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
export type FixtureKind = z.infer<typeof FixtureKindSchema>
export type FixtureStatus = z.infer<typeof FixtureStatusSchema>
export type Fixture = z.infer<typeof FixtureSchema>
export type ClubEventCategory = z.infer<typeof ClubEventCategorySchema>
export type ClubEventStatus = z.infer<typeof ClubEventStatusSchema>
export type ClubEvent = z.infer<typeof ClubEventSchema>
export type FactProvenance = z.infer<typeof FactProvenanceSchema>
export type SourceProvenanceMap = z.infer<typeof SourceProvenanceMapSchema>
export type ContentSuggestionKind = z.infer<typeof ContentSuggestionKindSchema>
export type ContentSuggestion = z.infer<typeof ContentSuggestionSchema>
export type ContentSuggestionsResponse = z.infer<typeof ContentSuggestionsResponseSchema>
export type ConsentScope = z.infer<typeof ConsentScopeSchema>
export type ConsentOrigin = z.infer<typeof ConsentOriginSchema>
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>
export type CreateConsentRecordFields = z.infer<typeof CreateConsentRecordFieldsSchema>
export type RevokeConsentRequest = z.infer<typeof RevokeConsentRequestSchema>
export type SupersedeConsentRequest = z.infer<typeof SupersedeConsentRequestSchema>
export type ConsentRequestStatus = z.infer<typeof ConsentRequestStatusSchema>
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>
export type CreateConsentRequestRequest = z.infer<typeof CreateConsentRequestRequestSchema>
export type PublicConsentRequestView = z.infer<typeof PublicConsentRequestViewSchema>
export type RespondConsentRequestRequest = z.infer<typeof RespondConsentRequestRequestSchema>
export type PublicConsentRevocationView = z.infer<typeof PublicConsentRevocationViewSchema>
export type MediaGateBlocker = z.infer<typeof MediaGateBlockerSchema>
export type OrganizationConsentText = z.infer<typeof OrganizationConsentTextSchema>
export type UpdateOrganizationConsentTextRequest = z.infer<typeof UpdateOrganizationConsentTextRequestSchema>
export type RetentionSettings = z.infer<typeof RetentionSettingsSchema>
export type UpdateRetentionSettingsRequest = z.infer<typeof UpdateRetentionSettingsRequestSchema>
export type RetentionRuleKey = z.infer<typeof RetentionRuleKeySchema>
export type RetentionDeletion = z.infer<typeof RetentionDeletionSchema>
export type RunRetentionRequest = z.infer<typeof RunRetentionRequestSchema>
export type RunRetentionResponse = z.infer<typeof RunRetentionResponseSchema>
export type DataSubjectRequestKind = z.infer<typeof DataSubjectRequestKindSchema>
export type DataSubjectRequestSubjectKind = z.infer<typeof DataSubjectRequestSubjectKindSchema>
export type DataSubjectRequestStatus = z.infer<typeof DataSubjectRequestStatusSchema>
export type DataSubjectRequest = z.infer<typeof DataSubjectRequestSchema>
export type CreateDataSubjectRequestRequest = z.infer<typeof CreateDataSubjectRequestRequestSchema>
export type UpdateDataSubjectRequestRequest = z.infer<typeof UpdateDataSubjectRequestRequestSchema>
export type DataSubjectExportResponse = z.infer<typeof DataSubjectExportResponseSchema>
export type DataSubjectEraseResponse = z.infer<typeof DataSubjectEraseResponseSchema>
export type ProcessingRecord = z.infer<typeof ProcessingRecordSchema>
export type CreateProcessingRecordRequest = z.infer<typeof CreateProcessingRecordRequestSchema>
export type UpdateProcessingRecordRequest = z.infer<typeof UpdateProcessingRecordRequestSchema>
export type ProcessorAgreementStatus = z.infer<typeof ProcessorAgreementStatusSchema>
export type ProcessorAgreement = z.infer<typeof ProcessorAgreementSchema>
export type CreateProcessorAgreementFields = z.infer<typeof CreateProcessorAgreementFieldsSchema>
export type UpdateProcessorAgreementRequest = z.infer<typeof UpdateProcessorAgreementRequestSchema>
export type AuditChainVerification = z.infer<typeof AuditChainVerificationSchema>
export type SignAuditChainResponse = z.infer<typeof SignAuditChainResponseSchema>
export type PublicOrganizationImprint = z.infer<typeof PublicOrganizationImprintSchema>
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
export type CompositionFormat = z.infer<typeof CompositionFormatSchema>
export type AttachmentUploadMetadata = z.infer<typeof AttachmentUploadMetadataSchema>
export type CompressionProvenance = z.infer<typeof CompressionProvenanceSchema>
export type StyleProfileRules = z.infer<typeof StyleProfileRulesSchema>
export type CustomStyleProfile = z.infer<typeof CustomStyleProfileSchema>
export type CreateCustomStyleProfileRequest = z.infer<typeof CreateCustomStyleProfileRequestSchema>
export type CreateCompositionSession = z.infer<typeof CreateCompositionSessionSchema>
export type CreateGenerationCommand = z.infer<typeof CreateGenerationCommandSchema>
