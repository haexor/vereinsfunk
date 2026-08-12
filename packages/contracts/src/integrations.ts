import { z } from 'zod'
import { UuidSchema } from './content.js'

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
}).refine((value) => value.teamId === undefined || value.teamId === null || (value.departmentId !== undefined && value.departmentId !== null), {
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
