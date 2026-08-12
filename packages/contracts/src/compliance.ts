import { z } from 'zod'
import { UuidSchema } from './content.js'

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
