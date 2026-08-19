import { z } from 'zod'
import { MaxCharactersSchema, UuidSchema } from './content.js'
import { CountryCodeSchema, SocialPlatformSchema } from './primitives.js'

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

// Einladungsflow (loest den frueheren synchronen POST /v1/platform-admins ab): eine eingeladene
// Person muss noch kein auth.users-Konto haben, siehe create_platform_admin_invitation() in
// 2026081901_platform_admin_invitations.sql.
export const PlatformAdminInvitationSchema = z.object({
  id: UuidSchema,
  email: z.string().trim().toLowerCase().pipe(z.email()),
  invitedBy: UuidSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  acceptedAt: z.iso.datetime({ offset: true }).nullable(),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
  lastSentAt: z.iso.datetime({ offset: true }),
  sendCount: z.int().min(1).max(10),
  createdAt: z.iso.datetime({ offset: true }),
})
export const AcceptPlatformAdminInvitationRequestSchema = z.object({ token: z.string().min(1) })

// Nur ein Schluessel existiert heute (loest 009s hartkodierte Konstante ab). Ein unbekannter
// Schluessel wird von der API abgelehnt statt stillschweigend ungeprueft gespeichert zu werden.
export const PlatformSettingKeySchema = z.enum(['max_organizations_per_owner', 'publishing_enabled'])
export const PlatformSettingValueSchemas = {
  max_organizations_per_owner: z.int().positive().max(1000),
  // Globaler Not-Aus fuer externe Veroeffentlichungen. Er ist bewusst keine
  // organisationsbezogene Einstellung: ein Plattform-Admin muss im Incident-Fall alle
  // Vereine gleichzeitig und ohne deren Berechtigungen erreichen koennen.
  publishing_enabled: z.boolean(),
} as const satisfies Record<z.infer<typeof PlatformSettingKeySchema>, z.ZodType<unknown>>
export const PlatformSettingSchema = z.object({
  key: PlatformSettingKeySchema,
  value: JsonValueSchema,
  updatedAt: z.iso.datetime({ offset: true }),
})
export const UpdatePlatformSettingRequestSchema = z.object({ value: JsonValueSchema })

export const PublishingProviderSchema = z.enum(['meta', 'twitter', 'linkedin'])
export const PublishingProviderConfigurationSchema = z.object({
  provider: PublishingProviderSchema,
  clientId: z.string().trim().min(1).max(500),
  graphVersion: z.string().trim().min(1).max(80).nullable(),
  hasSecret: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }),
})
// The secret is write-only. A platform admin can rotate it, never retrieve it.
export const UpdatePublishingProviderConfigurationRequestSchema = z.object({
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().trim().min(1).max(4000),
  graphVersion: z.string().trim().min(1).max(80).nullable().optional(),
})

export const LlmProviderProtocolSchema = z.enum(['anthropic', 'openai'])
// The vocabulary deliberately describes future tasks, but only text_generation has an adapter.
// APIs must reject activating every other task until its own adapter spike exists.
export const LlmTaskKindSchema = z.enum(['text_generation', 'image_generation', 'video_generation'])
// Breaking: systemPromptOverride was removed. Paket 042 moved temperature/maxOutputTokens off
// the provider entirely (see TEXT_GENERATION_TEMPERATURE_STEPS/text-generation-platform-defaults
// in content.ts) -- a provider is now purely access/routing configuration.
export const LlmProviderConfigurationSchema = z.object({
  id: UuidSchema,
  label: z.string().trim().min(1).max(160),
  protocol: LlmProviderProtocolSchema,
  baseUrl: z.url(),
  model: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(60), // historical display/operations field
  taskKind: LlmTaskKindSchema,
  structuredOutputRequired: z.literal(true),
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
  structuredOutputRequired: z.literal(true).default(true),
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
  structuredOutputRequired: z.literal(true).optional(),
  priority: z.int().optional(),
  isActive: z.boolean().optional(),
  apiKey: z.string().trim().min(1).max(4000).optional(),
})

// Analog PlatformSettingSchema/UpdatePlatformSettingRequestSchema oben, aber ein eigenes Schema
// statt eines weiteren PlatformSettingKey-Eintrags: der Wert steht hier pro Social-Media-Plattform
// (nicht global) und die Tabelle ist fuer jedes Mitglied lesbar, nicht nur fuer Plattform-Admins.
// Eine Zeile je Plattform, mit deren verbindlicher Zeichengrenze. Dieselbe
// SocialPlatformSchema wie die Kanal-Domaene: auf welchen Plattformen ein Beitrag entstehen darf,
// ist genau die Menge, auf die veroeffentlicht werden kann. Jede neue Plattform braucht deshalb
// zwingend eine Zeile hier -- fehlt sie, kann die Laenge fuer sie nicht bestimmt werden.
export const TextGenerationPlatformDefaultSchema = z.object({
  platform: SocialPlatformSchema,
  maxCharacters: MaxCharactersSchema,
  updatedAt: z.iso.datetime({ offset: true }),
})
export const UpdateTextGenerationPlatformDefaultRequestSchema = z.object({
  maxCharacters: MaxCharactersSchema,
})

// Plan 042, PR 3 Step 1: die Textwerkstatt (ein normales Mitglied) kann GET /v1/llm-providers
// nicht sehen (requirePlatformAdmin), muss aber wissen, ob der Temperatur-Regler ueberhaupt eine
// Wirkung hat -- der Anthropic-Adapter sendet temperature bewusst nicht. Bewusst nur ein Boolean:
// die Antwort verraet weder Anbieter noch Endpunkt noch Modell.
export const TextGenerationCapabilitiesSchema = z.object({
  temperatureSupported: z.boolean(),
})

// Welches Protokoll temperature tatsaechlich mitsendet -- eine Quelle statt zweier
// Zeichenkettenvergleiche, die auseinanderlaufen koennen: die API blendet den Regler danach aus
// (GET /v1/text-generation-capabilities) und der Worker nimmt temperature danach in den
// provider_parameter_hash auf (apps/worker/src/textGeneration.ts). Waeren sich beide uneins, hiesse
// entweder ein wirkungsloser Regler bedienbar oder der Hash behauptete eine nie gesendete
// Provenienz. Der Anthropic-Adapter sendet sie bewusst nicht (aktuelle Claude-Modelle lehnen den
// Parameter mit 400 ab, siehe AnthropicStructuredContentGenerator).
export function providerSendsTemperature(protocol: string): boolean {
  return protocol === 'openai'
}

// Modellauswahl im Formular: statt einer im Frontend gepflegten Liste fragt die API den Provider
// selbst. Der Schluessel kommt aus dem Formular, weil beim Anlegen noch keine Konfiguration und
// damit kein hinterlegtes Geheimnis existiert; gespeichert wird er hier nicht.
export const ListLlmProviderModelsRequestSchema = z.object({
  protocol: LlmProviderProtocolSchema,
  baseUrl: z.url(),
  apiKey: z.string().trim().min(1).max(4000),
})
export const ListLlmProviderModelsResponseSchema = z.object({
  models: z.array(z.string().trim().min(1).max(120)),
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

export type PlatformAdminStatus = z.infer<typeof PlatformAdminStatusSchema>
export type PlatformAdmin = z.infer<typeof PlatformAdminSchema>
export type AddPlatformAdminRequest = z.infer<typeof AddPlatformAdminRequestSchema>
export type PlatformAdminInvitation = z.infer<typeof PlatformAdminInvitationSchema>
export type AcceptPlatformAdminInvitationRequest = z.infer<typeof AcceptPlatformAdminInvitationRequestSchema>
export type PlatformSettingKey = z.infer<typeof PlatformSettingKeySchema>
export type PlatformSetting = z.infer<typeof PlatformSettingSchema>
export type UpdatePlatformSettingRequest = z.infer<typeof UpdatePlatformSettingRequestSchema>
export type PublishingProvider = z.infer<typeof PublishingProviderSchema>
export type PublishingProviderConfiguration = z.infer<typeof PublishingProviderConfigurationSchema>
export type UpdatePublishingProviderConfigurationRequest = z.infer<typeof UpdatePublishingProviderConfigurationRequestSchema>
export type LlmProviderProtocol = z.infer<typeof LlmProviderProtocolSchema>
export type LlmTaskKind = z.infer<typeof LlmTaskKindSchema>
export type LlmProviderConfigurationDto = z.infer<typeof LlmProviderConfigurationSchema>
export type CreateLlmProviderConfigurationRequest = z.infer<typeof CreateLlmProviderConfigurationRequestSchema>
export type UpdateLlmProviderConfigurationRequest = z.infer<typeof UpdateLlmProviderConfigurationRequestSchema>
export type TextGenerationPlatformDefault = z.infer<typeof TextGenerationPlatformDefaultSchema>
export type UpdateTextGenerationPlatformDefaultRequest = z.infer<typeof UpdateTextGenerationPlatformDefaultRequestSchema>
export type TextGenerationCapabilities = z.infer<typeof TextGenerationCapabilitiesSchema>
export type ListLlmProviderModelsRequest = z.infer<typeof ListLlmProviderModelsRequestSchema>
export type ListLlmProviderModelsResponse = z.infer<typeof ListLlmProviderModelsResponseSchema>
export type PlatformAdminOrganizationSummary = z.infer<typeof PlatformAdminOrganizationSummarySchema>
export type PlatformAdminOrganizationDetail = z.infer<typeof PlatformAdminOrganizationDetailSchema>
export type PlatformAdminOrganizationActivity = z.infer<typeof PlatformAdminOrganizationActivitySchema>
export type UsageMetricsQuery = z.infer<typeof UsageMetricsQuerySchema>
export type UsageMetricsBucket = z.infer<typeof UsageMetricsBucketSchema>
export type UsageMetricsResponse = z.infer<typeof UsageMetricsResponseSchema>
