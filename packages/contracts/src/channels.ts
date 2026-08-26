import { z } from 'zod'
import { MaxCharactersSchema, UuidSchema } from './content.js'
import { hasExclusivePlatformConflict, OAuthPlatformSchema, SocialPlatformSchema } from './primitives.js'
import { AssignableRoleSchema, ScopeLevelSchema, rolesForScopeLevel } from './structure.js'

// Paket 012: Kanaele und Social-Accounts --------------------------------------------------------

// Paket 042: die Plattform-Menge lebt in primitives.ts, damit content.ts (Ziel-Plattformen eines
// Beitrags) sie ohne Zyklus mitbenutzt. Re-Export, damit bestehende Importe aus channels.js bleiben.
// Paket 045: OAuthPlatformSchema (policy.ts braucht sie ebenfalls fuer PublicationSchema.platform)
// liegt aus demselben Grund in primitives.ts.
export { hasExclusivePlatformConflict, OAuthPlatformSchema, SocialPlatformSchema }
// Plan 039: enger gefasst als SocialPlatformSchema -- ein Website-Kanal entsteht nie ueber OAuth
// (siehe CreateWebsiteChannelRequestSchema unten), diese beiden Routen kennen ihn deshalb nicht.
export const MetaOAuthPlatformSchema = z.enum(['instagram', 'facebook'])
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
  // Plan 039: null fuer einen Website-Kanal (kein externes Konto) -- schliesst sich mit websiteUrl
  // gegenseitig aus (social_connections_platform_fields_check).
  externalAccountId: z.string().nullable(),
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
  // Plan 039: nur fuer platform='website' gesetzt.
  websiteUrl: z.string().nullable(),
  // null heisst "die globale Vorgabe der Plattform gilt" (Entwurfsentscheidung 3) -- nicht mit
  // TEXT_GENERATION_DEFAULT_MAX_CHARACTERS aufgeloest, das entscheidet erst der Aufrufer.
  maxCharacters: MaxCharactersSchema.nullable(),
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
  // null setzt den Kanal auf die globale Plattform-Vorgabe zurueck (Plan 039, PR 1 Step 3).
  maxCharacters: MaxCharactersSchema.nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'at least one field must be provided' })

// Plan 039, PR 1 Step 2: die einzige Kanal-Anlage ohne OAuth. platform ist ausgeschrieben (nicht
// z.literal('website')), damit die Route eine falsche Plattform mit einem sprechenden 422 statt
// eines pauschalen Zod-400 ablehnt -- Instagram/Facebook entstehen weiterhin nur ueber den
// OAuth-Callback, sonst liesse sich ein Kanal ohne gueltiges Token anlegen.
export const CreateWebsiteChannelRequestSchema = z.object({
  organizationId: UuidSchema,
  platform: SocialPlatformSchema,
  displayName: z.string().trim().min(1).max(120),
  websiteUrl: z.string().trim().url().max(500),
  ownerScope: ChannelOwnerScopeSchema,
  ownerDepartmentId: UuidSchema.nullable(),
  maxCharacters: MaxCharactersSchema.optional(),
}).refine((value) => (value.ownerScope === 'organization') === (value.ownerDepartmentId === null), {
  message: 'ownerDepartmentId is required exactly when ownerScope is department',
})

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

export type { OAuthPlatform, SocialPlatform } from './primitives.js'
export type SocialConnectionStatus = z.infer<typeof SocialConnectionStatusSchema>
export type ChannelOwnerScope = z.infer<typeof ChannelOwnerScopeSchema>
export type ChannelScopeAssignment = z.infer<typeof ChannelScopeAssignmentSchema>
export type CreateChannelScopeRequest = z.infer<typeof CreateChannelScopeRequestSchema>
export type SocialConnection = z.infer<typeof SocialConnectionSchema>
export type UpdateSocialConnectionRequest = z.infer<typeof UpdateSocialConnectionRequestSchema>
export type CreateWebsiteChannelRequest = z.infer<typeof CreateWebsiteChannelRequestSchema>
export type ChannelPolicy = z.infer<typeof ChannelPolicySchema>
export type ChannelConnectStartRequest = z.infer<typeof ChannelConnectStartRequestSchema>
export type OAuthAvailableAccount = z.infer<typeof OAuthAvailableAccountSchema>
export type OAuthPendingConnection = z.infer<typeof OAuthPendingConnectionSchema>
export type SelectOAuthAccountRequest = z.infer<typeof SelectOAuthAccountRequestSchema>
export type AvailableChannelsResponse = z.infer<typeof AvailableChannelsResponseSchema>
export type CreateMembershipRequest = z.infer<typeof CreateMembershipRequestSchema>
export type UpdateMembershipRequest = z.infer<typeof UpdateMembershipRequestSchema>
