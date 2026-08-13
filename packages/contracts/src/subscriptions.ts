import { z } from 'zod'
import { UuidSchema } from './content.js'

// Plan 021: Tarife, Speicherkontingent und Beitragskontingente nach Medienherkunft.
export const MediaOriginSchema = z.enum(['own_upload', 'ai_image', 'ai_video'])
export const SubscriptionStatusSchema = z.enum(['active', 'past_due', 'cancelled', 'suspended'])
// Eine Regel, an zwei Stellen (Tarif-Kontingentzeile, Kontingent-Uebersteuerung) gepruft --
// dieselbe Funktion statt zweimal denselben Ausdruck, damit eine kuenftige Aenderung (z. B. eine
// weitere laengenbeschraenkte Herkunftsart) nicht eine der beiden Stellen vergessen kann.
function durationOnlyForAiVideo(value: { mediaOrigin: string; maxDurationSeconds: number | null }): boolean {
  return value.maxDurationSeconds === null || value.mediaOrigin === 'ai_video'
}
// null = unbegrenzt fuer diese Herkunft -- dasselbe Vokabular wie in der Migration.
export const SubscriptionPlanContentLimitSchema = z.object({
  mediaOrigin: MediaOriginSchema,
  maxPerMonth: z.int().positive().nullable(),
  maxDurationSeconds: z.int().positive().nullable(),
}).refine(durationOnlyForAiVideo, { message: 'maxDurationSeconds is only meaningful for ai_video' })

// Fehlt eine Herkunftsart komplett, gilt sie laut Datenmodell als 0, nicht unbegrenzt (siehe
// Migration, Kommentar zu subscription_plan_content_limits) -- schedule_publication() setzt genau
// das durch. Ohne diese Pruefung koennte ein Tarif mit nur einer von drei Zeilen angelegt werden,
// und GET /v1/subscription wuerde die fehlende Herkunftsart schlicht nicht auflisten, obwohl jede
// Einplanung dieser Art serverseitig abgelehnt wird (Divergenz zwischen angezeigtem und
// durchgesetztem Zustand, beim eigenen Review gefunden).
function hasExactlyOneRowPerMediaOrigin(limits: readonly { mediaOrigin: string }[]): boolean {
  const origins = limits.map((limit) => limit.mediaOrigin)
  return MediaOriginSchema.options.every((origin) => origins.filter((value) => value === origin).length === 1)
}

export const SubscriptionPlanSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  displayName: z.string().min(1),
  monthlyPriceCents: z.int().min(0).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  storageBytes: z.int().positive(),
  maxTeams: z.int().positive().nullable(),
  maxDepartments: z.int().positive().nullable(),
  isSelfServiceable: z.boolean(),
  sortOrder: z.int(),
  availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  availableUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  contentLimits: z.array(SubscriptionPlanContentLimitSchema),
})

export const EffectiveLimitsSchema = z.object({
  storageBytes: z.int().positive(),
  maxTeams: z.int().positive().nullable(),
  maxDepartments: z.int().positive().nullable(),
})

export const ContentQuotaUsageSchema = z.object({
  mediaOrigin: MediaOriginSchema,
  maxPerMonth: z.int().positive().nullable(),
  maxDurationSeconds: z.int().positive().nullable(),
  used: z.int().min(0),
})

export const SubscriptionSummarySchema = z.object({
  plan: z.object({
    key: z.string(),
    displayName: z.string(),
    monthlyPriceCents: z.int().min(0).nullable(),
    currency: z.string(),
  }),
  status: SubscriptionStatusSchema,
  limits: EffectiveLimitsSchema,
  isStorageOverridden: z.boolean(),
  isStructureOverridden: z.boolean(),
  usage: z.object({
    storageBytes: z.int().min(0),
    departments: z.int().min(0),
    teams: z.int().min(0),
  }),
  contentQuotas: z.array(ContentQuotaUsageSchema),
})

export const ChangeSubscriptionPlanRequestSchema = z.object({ planKey: z.string().regex(/^[a-z][a-z0-9_]*$/) })

// Speicher-Unterlimits je Abteilung oder Mannschaft -- 'organization' ist hier bewusst kein
// gueltiger Wert, das Vereinslimit kommt aus dem Tarif (siehe Migration).
export const StorageLimitScopeSchema = z.enum(['department', 'team'])
export const StorageLimitSchema = z.object({
  id: UuidSchema,
  scope: StorageLimitScopeSchema,
  scopeId: UuidSchema,
  storageBytes: z.int().positive(),
})
export const SetStorageLimitRequestSchema = z.object({
  scope: StorageLimitScopeSchema,
  scopeId: UuidSchema,
  storageBytes: z.int().positive(),
})

export const StorageUsageQuerySchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.optional(),
  teamId: UuidSchema.optional(),
})
export const StorageUsageBreakdownSchema = z.object({
  ownUploads: z.int().min(0),
  renderedMedia: z.int().min(0),
  brandAssets: z.int().min(0),
})
export const StorageUsageResponseSchema = z.object({
  usedBytes: z.int().min(0),
  limitBytes: z.int().positive().nullable(),
  breakdown: StorageUsageBreakdownSchema,
})

export const PublicationsUsageResponseSchema = z.object({ quotas: z.array(ContentQuotaUsageSchema) })

// --- Plattform-Admin: Tarife selbst anlegen und pflegen -----------------------------------------
export const CreateSubscriptionPlanRequestSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]*$/),
  displayName: z.string().trim().min(1).max(120),
  monthlyPriceCents: z.int().min(0).nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('EUR'),
  storageBytes: z.int().positive(),
  maxTeams: z.int().positive().nullable(),
  maxDepartments: z.int().positive().nullable(),
  isSelfServiceable: z.boolean().default(true),
  sortOrder: z.int().default(0),
  availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  availableUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  contentLimits: z.array(SubscriptionPlanContentLimitSchema).length(3).refine(hasExactlyOneRowPerMediaOrigin, { message: 'exactly one row per media origin is required' }),
})
export const UpdateSubscriptionPlanRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  monthlyPriceCents: z.int().min(0).nullable().optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  storageBytes: z.int().positive().optional(),
  maxTeams: z.int().positive().nullable().optional(),
  maxDepartments: z.int().positive().nullable().optional(),
  isSelfServiceable: z.boolean().optional(),
  sortOrder: z.int().optional(),
  availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  availableUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})
export const SetSubscriptionPlanContentLimitsRequestSchema = z.object({
  contentLimits: z.array(SubscriptionPlanContentLimitSchema).length(3).refine(hasExactlyOneRowPerMediaOrigin, { message: 'exactly one row per media origin is required' }),
})

// --- Plattform-Admin: Tarifzuordnung und operative Uebersteuerung je Verein ---------------------
export const OrganizationSubscriptionSchema = z.object({
  organizationId: UuidSchema,
  planKey: z.string(),
  status: SubscriptionStatusSchema,
  storageBytesOverride: z.int().positive().nullable(),
  maxTeamsOverride: z.int().positive().nullable(),
  maxDepartmentsOverride: z.int().positive().nullable(),
  overrideReason: z.string().nullable(),
})
export const SetOrganizationSubscriptionRequestSchema = z.object({
  planKey: z.string().trim().regex(/^[a-z][a-z0-9_]*$/),
  storageBytesOverride: z.int().positive().nullable().default(null),
  maxTeamsOverride: z.int().positive().nullable().default(null),
  maxDepartmentsOverride: z.int().positive().nullable().default(null),
  overrideReason: z.string().trim().min(1).max(500).optional(),
}).refine(
  (value) => (value.storageBytesOverride === null && value.maxTeamsOverride === null && value.maxDepartmentsOverride === null) || Boolean(value.overrideReason),
  { message: 'overrideReason is required whenever any override is set' },
)
export const ContentLimitOverrideSchema = z.object({
  mediaOrigin: MediaOriginSchema,
  maxPerMonth: z.int().positive().nullable(),
  maxDurationSeconds: z.int().positive().nullable(),
  overrideReason: z.string().min(1),
})
export const SetContentLimitOverrideRequestSchema = z.object({
  mediaOrigin: MediaOriginSchema,
  maxPerMonth: z.int().positive().nullable(),
  maxDurationSeconds: z.int().positive().nullable(),
  overrideReason: z.string().trim().min(1).max(500),
}).refine(durationOnlyForAiVideo, { message: 'maxDurationSeconds is only meaningful for ai_video' })

export type MediaOrigin = z.infer<typeof MediaOriginSchema>
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>
export type SubscriptionPlanContentLimit = z.infer<typeof SubscriptionPlanContentLimitSchema>
export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema>
export type EffectiveLimits = z.infer<typeof EffectiveLimitsSchema>
export type ContentQuotaUsage = z.infer<typeof ContentQuotaUsageSchema>
export type SubscriptionSummary = z.infer<typeof SubscriptionSummarySchema>
export type ChangeSubscriptionPlanRequest = z.infer<typeof ChangeSubscriptionPlanRequestSchema>
export type StorageLimitScope = z.infer<typeof StorageLimitScopeSchema>
export type StorageLimit = z.infer<typeof StorageLimitSchema>
export type SetStorageLimitRequest = z.infer<typeof SetStorageLimitRequestSchema>
export type StorageUsageQuery = z.infer<typeof StorageUsageQuerySchema>
export type StorageUsageBreakdown = z.infer<typeof StorageUsageBreakdownSchema>
export type StorageUsageResponse = z.infer<typeof StorageUsageResponseSchema>
export type PublicationsUsageResponse = z.infer<typeof PublicationsUsageResponseSchema>
export type CreateSubscriptionPlanRequest = z.infer<typeof CreateSubscriptionPlanRequestSchema>
export type UpdateSubscriptionPlanRequest = z.infer<typeof UpdateSubscriptionPlanRequestSchema>
export type SetSubscriptionPlanContentLimitsRequest = z.infer<typeof SetSubscriptionPlanContentLimitsRequestSchema>
export type OrganizationSubscription = z.infer<typeof OrganizationSubscriptionSchema>
export type SetOrganizationSubscriptionRequest = z.infer<typeof SetOrganizationSubscriptionRequestSchema>
export type ContentLimitOverride = z.infer<typeof ContentLimitOverrideSchema>
export type SetContentLimitOverrideRequest = z.infer<typeof SetContentLimitOverrideRequestSchema>
