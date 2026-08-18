import { z } from 'zod'
import { UuidSchema } from './content.js'

// --- Paket 015: Einwilligungsverwaltung ---------------------------------------------------------

export const ConsentPurposeSchema = z.enum(['social_media', 'website', 'print', 'internal'])
export const ConsentPlatformSchema = z.enum(['instagram', 'facebook', 'twitter', 'linkedin'])
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
export type OrganizationConsentText = z.infer<typeof OrganizationConsentTextSchema>
export type UpdateOrganizationConsentTextRequest = z.infer<typeof UpdateOrganizationConsentTextRequestSchema>
