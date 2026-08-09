import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { parseApiEnvironment } from '@vereinsfunk/config'
import { assertGroundedPost, createGroundedContentBrief, FakeContentGenerator, factsFromClubEvent, factsFromFixture } from '@vereinsfunk/content-engine'
import {
  AcceptInvitationRequestSchema,
  AcceptInvitationResponseSchema,
  AddPlatformAdminRequestSchema,
  AnalyticsBreakdownQuerySchema,
  AnalyticsBreakdownResponseSchema,
  AnalyticsFunnelQuerySchema,
  AnalyticsFunnelResponseSchema,
  AnalyticsScopeQuerySchema,
  AnalyticsSummarySchema,
  AnalyticsTimeseriesQuerySchema,
  AnalyticsTimeseriesResponseSchema,
  ApprovalRequestSchema,
  ApprovalStageSchema,
  AuditChainVerificationSchema,
  AvailableChannelsResponseSchema,
  BrandAssetSchema,
  BrandLogoUploadResponseSchema,
  BrandLogoVariantSchema,
  ConfirmBrandAssetLicenseRequestSchema,
  ConsentRecordSchema,
  ConsentRequestSchema,
  CreateBrandAssetRequestSchema,
  CreateConsentRecordFieldsSchema,
  CreateConsentRequestRequestSchema,
  CreateDataSubjectRequestRequestSchema,
  CreateProcessingRecordRequestSchema,
  CreateProcessorAgreementFieldsSchema,
  ChannelConnectStartRequestSchema,
  ChannelOwnerScopeSchema,
  ChannelPolicySchema,
  ChannelQuotaSchema,
  ChannelScopeAssignmentSchema,
  CreateChannelQuotaRequestSchema,
  CreateChannelScopeRequestSchema,
  CreateDepartmentRequestSchema,
  CreateDirectoryPersonRequestSchema,
  CreateIntegrationSourceRequestSchema,
  CreateInvitationRequestSchema,
  CreateLlmProviderConfigurationRequestSchema,
  CreateMembershipRequestSchema,
  CreateOrganizationRequestSchema,
  CreateOrganizationResponseSchema,
  CreatePolicyReviewerRequestSchema,
  CreateSubmissionSchema,
  CreateTeamRequestSchema,
  DataSubjectEraseResponseSchema,
  DataSubjectExportResponseSchema,
  DataSubjectRequestSchema,
  DecideApprovalStageRequestSchema,
  DecideApprovalStageResponseSchema,
  DepartmentBrandSchema,
  DepartmentSchema,
  DirectoryPersonGuardianContactSchema,
  ClubEventSchema,
  ContentSuggestionsResponseSchema,
  DirectoryPersonSchema,
  DirectoryPersonStatusSchema,
  FixtureSchema,
  HealthSchema,
  IntegrationDomainSchema,
  IntegrationSourceSchema,
  IntegrationSyncConflictSchema,
  IntegrationSyncRunSchema,
  InvitationSchema,
  LlmProviderConfigurationSchema,
  MemberReviewTrustSchema,
  MemberRoleEntrySchema,
  rolesForScopeLevel,
  MemberSchema,
  OAuthPendingConnectionSchema,
  OnboardingStateSchema,
  OnboardingStepSchema,
  OrganizationBrandSchema,
  OrganizationBrandUpdateSchema,
  OrganizationConsentTextSchema,
  OrganizationProfileSchema,
  OrganizationProfileUpdateSchema,
  PlatformAdminOrganizationSummarySchema,
  PlatformAdminSchema,
  PlatformAdminStatusSchema,
  PlatformSettingKeySchema,
  PlatformSettingSchema,
  PlatformSettingValueSchemas,
  PolicyReviewerSchema,
  PolicyRuleSettingSchema,
  PolicySettingSchema,
  ProcessingRecordSchema,
  ProcessorAgreementSchema,
  ProfileSchema,
  PublicationExecuteResultSchema,
  PublicationSchema,
  PublicConsentRequestViewSchema,
  PublicConsentRevocationViewSchema,
  PublicOrganizationImprintSchema,
  RequestApprovalResponseSchema,
  ResolveSyncConflictRequestSchema,
  RespondConsentRequestRequestSchema,
  RetentionDeletionSchema,
  RetentionSettingsSchema,
  RevokeConsentRequestSchema,
  RunRetentionRequestSchema,
  RunRetentionResponseSchema,
  ScopeLevelSchema,
  SchedulePublicationRequestSchema,
  SelectOAuthAccountRequestSchema,
  SetMemberReviewTrustRequestSchema,
  SignAuditChainResponseSchema,
  SocialConnectionSchema,
  SocialPlatformSchema,
  SubmissionAcceptedSchema,
  SupersedeConsentRequestSchema,
  SyncModeSchema,
  SyncSourceResponseSchema,
  TeamBrandSchema,
  TeamSchema,
  UpdateChannelQuotaRequestSchema,
  UpdateDataSubjectRequestRequestSchema,
  UpdateDepartmentBrandRequestSchema,
  UpdateDepartmentRequestSchema,
  UpdateDirectoryPersonRequestSchema,
  UpdateIntegrationSourceRequestSchema,
  UpdateLlmProviderConfigurationRequestSchema,
  UpdateMembershipExpiryRequestSchema,
  UpdateMembershipRequestSchema,
  UpdateOrganizationConsentTextRequestSchema,
  UpdatePlatformSettingRequestSchema,
  UpdatePolicyRulesRequestSchema,
  UpdatePolicySettingRequestSchema,
  UpdateProcessingRecordRequestSchema,
  UpdateProcessorAgreementRequestSchema,
  UpdateProfileRequestSchema,
  UpdateRetentionSettingsRequestSchema,
  UpdateSocialConnectionRequestSchema,
  UpdateTeamBrandRequestSchema,
  UpdateTeamRequestSchema,
  UsageMetricsQuerySchema,
  UsageMetricsResponseSchema,
  UuidSchema,
  type ConsentScope,
  type ConsentStatus,
  type ContentSuggestion,
  type FieldMapping,
  type IntegrationDomain,
  type OutputFormat,
  type PolicyFlagState,
  type PolicyRuleValues,
  type ReviewerRef,
  type ScopeLevel,
  type SyncConflictKind,
  type Team,
  type SyncMode,
} from '@vereinsfunk/contracts'
import { canAssignRole, canRemoveRole, hasPermission, type Permission, type Role } from '@vereinsfunk/authorization'
import { FileSourceTransport, IcalSourceTransport, planSync, resolveIcalDateTime, type SourceTransport, type SyncPlanResult } from '@vereinsfunk/integrations'
import {
  clubEventDomainAdapter,
  createClubEventMatchStrategy,
  createFixtureMatchStrategy,
  createTeamMatchStrategy,
  ExternalClubEventSchema,
  ExternalFixtureSchema,
  ExternalTeamSchema,
  fixtureDomainAdapter,
  teamDomainAdapter,
  type ClubEventLocal,
  type ExternalClubEvent,
  type ExternalFixture,
  type ExternalTeam,
  type FixtureLocal,
  type FixtureStatus,
  type TeamDepartmentResolver,
  type TeamLocal,
  type TeamNameResolver,
} from '@vereinsfunk/club-schedule'
import {
  createPeopleMatchStrategy,
  deriveIsMinor,
  peopleDomainAdapter,
  PersonExternalSchema,
  type DepartmentResolver,
  type DirectoryPersonLocal,
  type PersonExternal,
} from '@vereinsfunk/member-directory'
import {
  addDays,
  approvalDurationSecondsSamples,
  BRAND_LOCKABLE_FIELDS,
  computeCountMetrics,
  computeCountMetricsSeries,
  computeFunnel,
  computeTrend,
  createIdempotencyKey,
  daysBetween,
  evaluateConsent,
  evaluateMediaGate,
  evaluateSubmitPermission,
  isBrandAssetSelectable,
  isConsentRecordInvalid,
  isConsentScopeMismatch,
  isInWindow,
  leadTimeSecondsSamples,
  median,
  mergeEffectiveConfig,
  rangeWindow,
  resolveAvailableChannels,
  resolveEffectiveConfig,
  resolveReviewers,
  resolveReviewRoute,
  scanTextForSensitiveData,
  type BrandAssetRef,
  type BrandLockableField,
  type ChannelCandidate,
  type ConfigOverride,
  type CountMetrics,
  type MediaGateBlocker,
  type MembershipRecord,
  type ReviewerRef as DomainReviewerRef,
  type ScopeLevelName,
  type StageDefinition,
  type TrustRecord,
} from '@vereinsfunk/domain'
import { FakePublisher, MetaPublisher, RealMetaOAuthClient, type MetaOAuthClient, type PublicationInput, type PublicationMedia, type SocialPublisher, type ValidationResult } from '@vereinsfunk/publishing'
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAuthGuards, SupabasePlatformAdminProvider, SupabaseRoleProvider, type PermissionScope, type PlatformAdminProvider, type RoleProvider } from './auth.js'
import { generateSvgRasterDerivatives, SvgRasterizationError } from './brandAssetDerivatives.js'
import { FontEmbeddingRestrictedError, processBrandFontUpload, UnsupportedFontFormatError } from './brandFont.js'
import { hashLogoBuffer, LogoDimensionsError, processBrandLogoUpload, UnsupportedLogoFormatError } from './brandLogo.js'
import { createEmailSender, type EmailMessage, type EmailSender } from './email.js'
import { buildInvitationEmail, generateInvitationToken } from './invitations.js'
import { mapLlmProviderConfigurationRow } from './llmProviders.js'
import { fetchPublicUrl, isAllowedOutboundUrl, OutboundFetchError } from './outboundFetch.js'
import { byteaToBuffer, ciphertextToBytea, createChainSignerFromEnvironment, createSecretBoxFromEnvironment } from './secretBox.js'
import { createServiceClient, createUserClient } from './supabase.js'

// Injectable the same way orchestrator/uploads/roleProvider already are: routes that create
// an organization or its profile need a real Postgres round-trip (RLS, the owner-limit
// enforced inside create_organization, the responsible-person trigger), which a test should
// fake rather than require a live Supabase instance for `pnpm test`.
export interface SupabaseClientFactory {
  forUser(accessToken: string): SupabaseClient
  forService(): SupabaseClient
}

export interface BuildAppOptions {
  logger?: boolean
  uploads?: MediaUploadService
  roleProvider?: RoleProvider
  supabaseClients?: SupabaseClientFactory
  platformAdminProvider?: PlatformAdminProvider
  emailSender?: EmailSender
  metaOAuthClient?: MetaOAuthClient
  // Paket 025: Ueberschreibung fuer Tests. Ausserhalb von Tests entscheidet PUBLISHING_PROVIDER,
  // welcher echte Adapter je Social-Connection gebaut wird (siehe createPublisherForConnection) --
  // ein MetaPublisher braucht das entschluesselte Connection-Token, kann also nicht einmalig beim
  // Start konstruiert werden wie die anderen Injectables hier.
  publisher?: SocialPublisher
}

export interface MediaUploadService {
  create(input: { organizationId: string; departmentId: string; assetId: string; filename: string; mimeType: string; byteSize: number }): Promise<{ uploadUrl: string; objectPath: string; expiresAt: string }>
  complete(input: { assetId: string; sha256: string }): Promise<{ accepted: true }>
}

class LocalUploadService implements MediaUploadService {
  async create(input: { organizationId: string; departmentId: string; assetId: string; filename: string; mimeType: string; byteSize: number }) { return { uploadUrl: `https://storage.invalid/upload/${input.assetId}`, objectPath: `organizations/${input.organizationId}/departments/${input.departmentId}/assets/${input.assetId}/${input.filename}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() } }
  async complete(): Promise<{ accepted: true }> { return { accepted: true } }
}

const PROFILE_UPDATE_COLUMNS: Record<string, string> = {
  legalName: 'legal_name',
  legalForm: 'legal_form',
  registerCourt: 'register_court',
  registerNumber: 'register_number',
  street: 'street',
  houseNumber: 'house_number',
  postalCode: 'postal_code',
  city: 'city',
  countryCode: 'country_code',
  contactEmail: 'contact_email',
  contactPhone: 'contact_phone',
  websiteUrl: 'website_url',
  foundedYear: 'founded_year',
  responsiblePersonProfileId: 'responsible_person_profile_id',
  imprintPublished: 'imprint_published',
}

function toProfileUpdatePayload(input: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const [key, column] of Object.entries(PROFILE_UPDATE_COLUMNS)) {
    if (key in input) payload[column] = input[key]
  }
  return payload
}

function mapProfileRow(row: Record<string, unknown>) {
  const mapped: Record<string, unknown> = { organizationId: row.organization_id }
  for (const [key, column] of Object.entries(PROFILE_UPDATE_COLUMNS)) mapped[key] = row[column]
  return mapped
}

function mapBrandRow(row: Record<string, unknown>) {
  return {
    organizationId: row.organization_id,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    backgroundColor: row.background_color,
    textColor: row.text_color,
    onPrimaryColor: row.on_primary_color,
    tone: row.tone,
    displayFontKey: row.display_font_key,
    bodyFontKey: row.body_font_key,
    displayFontAssetId: row.display_font_asset_id,
    bodyFontAssetId: row.body_font_asset_id,
    allowDepartmentOverrides: row.allow_department_overrides,
    lockedFields: row.locked_fields,
    logoPath: row.logo_path,
    logoDarkPath: row.logo_dark_path,
  }
}

function mapBrandAssetRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    departmentId: row.department_id,
    teamId: row.team_id,
    kind: row.kind,
    objectPath: row.object_path,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    fontFamily: row.font_family,
    fontWeight: row.font_weight,
    fontStyle: row.font_style,
    licenseHolder: row.license_holder,
    licenseNote: row.license_note,
    licenseConfirmedAt: row.license_confirmed_at,
    status: row.status,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  }
}

function mapDepartmentBrandRow(row: Record<string, unknown>) {
  return {
    organizationId: row.organization_id,
    departmentId: row.department_id,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    tone: row.tone,
    logoAssetId: row.logo_asset_id,
    displayFontAssetId: row.display_font_asset_id,
    bodyFontAssetId: row.body_font_asset_id,
    allowTeamOverrides: row.allow_team_overrides,
    lockedFields: row.locked_fields,
  }
}

function mapTeamBrandRow(row: Record<string, unknown>) {
  return {
    organizationId: row.organization_id,
    departmentId: row.department_id,
    teamId: row.team_id,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    tone: row.tone,
    logoAssetId: row.logo_asset_id,
    displayFontAssetId: row.display_font_asset_id,
    bodyFontAssetId: row.body_font_asset_id,
  }
}

// Die Ergaenzung aus Plan 013, "Design-Entscheidung": ein referenziertes Asset (Logo, Schrift)
// muss auf der Zielebene oder einer uebergeordneten liegen -- dieselbe Regel wie fuer die
// Auswahlliste in der Oberflaeche (isBrandAssetSelectable), hier als Schreibgrenze durchgesetzt,
// weil RLS allein "liegt der Verweis auf einer erlaubten Ebene" nicht sinnvoll ausdruecken kann.
async function loadSelectableBrandAsset(
  client: SupabaseClient,
  organizationId: string,
  assetId: string,
  targetScope: ScopeLevelName,
  targetDepartmentId: string | undefined,
  targetTeamId: string | undefined,
): Promise<{ id: string; kind: string } | null> {
  const result = await client
    .from('brand_assets')
    .select('id, kind, department_id, team_id, status')
    .eq('organization_id', organizationId)
    .eq('id', assetId)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data || result.data.status !== 'ready') return null
  const asset: BrandAssetRef = {
    scope: result.data.department_id === null ? 'organization' : result.data.team_id === null ? 'department' : 'team',
    departmentId: result.data.department_id ?? undefined,
    teamId: result.data.team_id ?? undefined,
  }
  if (!isBrandAssetSelectable(asset, targetScope, targetDepartmentId, targetTeamId)) return null
  return { id: result.data.id as string, kind: result.data.kind as string }
}

const LOGO_ASSET_KINDS = new Set(['logo_primary', 'logo_light', 'logo_dark', 'logo_mark', 'wordmark', 'watermark'])

// Der Rahmen, den eine hoehere Ebene setzt, gilt beim SCHREIBEN und nicht erst beim Aufloesen.
// resolveBrand ignoriert einen unerlaubten Wert zwar zuverlaessig, aber die API haette ihn vorher
// klaglos gespeichert -- die Abteilung sieht ihre Farbe im Formular stehen und nirgends wirken.
// Geerbte Felder (null) bleiben immer erlaubt: so raeumt man einen frueher gesetzten Wert weg.
type BrandOverrideInput = Partial<Record<BrandLockableField, string | null | undefined>>

function firstBlockedBrandField(input: BrandOverrideInput, lockedFields: readonly string[]): BrandLockableField | null {
  const locked = new Set(lockedFields)
  for (const field of BRAND_LOCKABLE_FIELDS) {
    const value = input[field]
    if (value !== undefined && value !== null && locked.has(field)) return field
  }
  return null
}

function setsAnyBrandField(input: BrandOverrideInput): boolean {
  return BRAND_LOCKABLE_FIELDS.some((field) => input[field] !== undefined && input[field] !== null)
}

function mapDepartmentRow(row: Record<string, unknown>) {
  return { id: row.id, organizationId: row.organization_id, name: row.name, slug: row.slug, archivedAt: row.archived_at, createdAt: row.created_at }
}

function mapTeamRow(row: Record<string, unknown>) {
  return {
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, name: row.name,
    // Paket 019: nur vom Sync-Codepfad (Service Role) gesetzt, siehe Migration
    // 2026080704_fixtures_and_events.sql -- hier trotzdem mitgegeben, weil TeamSchema sie verlangt.
    ageGroup: row.age_group ?? null, competition: row.competition ?? null, sourceId: row.source_id ?? null,
    archivedAt: row.archived_at, createdAt: row.created_at,
  }
}

// scopeId spiegelt resolveMembershipScope-Konvention: teamId, sonst departmentId, sonst die
// organizationId selbst -- dieselbe Fallback-Kette wie in GET/POST /v1/channel-quotas.
function mapChannelScopeRow(row: Record<string, unknown>, organizationId: string) {
  return { id: row.id, scope: row.scope, scopeId: row.team_id ?? row.department_id ?? organizationId, canSchedule: row.can_schedule }
}

function mapSocialConnectionRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    platform: row.platform,
    externalAccountId: row.external_account_id,
    displayName: row.display_name,
    status: row.status,
    tokenExpiresAt: row.token_expires_at,
    lastVerifiedAt: row.last_verified_at,
    ownerScope: row.owner_scope,
    ownerDepartmentId: row.owner_department_id,
    responsibleProfileId: row.responsible_profile_id,
    purpose: row.purpose,
    confidential: row.confidential,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    imprintUrl: row.imprint_url,
    privacyUrl: row.privacy_url,
    editorialResponsibleProfileId: row.editorial_responsible_profile_id,
    editorialResponsibleNote: row.editorial_responsible_note,
  }
}

const SOCIAL_CONNECTION_COLUMNS =
  'id, platform, external_account_id, display_name, status, token_expires_at, last_verified_at, owner_scope, owner_department_id, responsible_profile_id, purpose, confidential, archived_at, created_at, imprint_url, privacy_url, editorial_responsible_profile_id, editorial_responsible_note'

// redirect_uri muss zwischen /start und /callback exakt uebereinstimmen (Meta lehnt sonst den
// Code-Tausch ab) -- META_OAUTH_REDIRECT_URL ist die Basis-URL der API, nicht der volle Pfad,
// damit dieselbe Konfiguration fuer beide Plattformrouten reicht.
function metaRedirectUri(redirectBaseUrl: string, platform: 'instagram' | 'facebook'): string {
  return new URL(`/v1/channels/connect/${platform}/callback`, redirectBaseUrl).toString()
}

function mapInvitationRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    departmentId: row.department_id,
    teamId: row.team_id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    lastSentAt: row.last_sent_at,
    sendCount: row.send_count,
    createdAt: row.created_at,
  }
}

function membershipTableFor(scope: ScopeLevel): 'organization_memberships' | 'department_memberships' | 'team_memberships' {
  return scope === 'organization' ? 'organization_memberships' : scope === 'department' ? 'department_memberships' : 'team_memberships'
}

// supabase/config.toml caps a single response at max_rows=1000 -- a plain select() on a large
// organization's membership table would silently truncate the roster. Pages through range()
// until a page comes back short.
async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1)
    if (page.error) throw page.error
    const data = page.data ?? []
    rows.push(...data)
    if (data.length < pageSize) break
  }
  return rows
}

// Ein .in() mit unbegrenzt vielen IDs traegt die gesamte Liste in der Anfrage-URL -- dieselbe
// Grenze wie bei den Profil-Bloecken in GET /members und dem Retention-Lauf. Batcht in Chunks von
// 100, statt die Ergebnisse einer einzelnen Anfrage zu verwerfen.
async function fetchAllRowsForIds<T>(
  ids: readonly string[],
  fetchPage: (batch: readonly string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const batchSize = 100
  const rows: T[] = []
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize)
    rows.push(...(await fetchAllRows<T>((from, to) => fetchPage(batch, from, to))))
  }
  return rows
}

// Loest scope+scopeId (aus CreateMembershipRequestSchema) in einen PermissionScope auf --
// organizationId muss fuer department/team erst nachgeschlagen werden, damit requirePermission
// und canAssignRole (beide brauchen den vollen Scope-Pfad) korrekt kaskadieren koennen.
async function resolveMembershipScope(
  client: SupabaseClient,
  scope: ScopeLevel,
  scopeId: string,
): Promise<PermissionScope | null> {
  if (scope === 'organization') return { organizationId: scopeId }
  if (scope === 'department') {
    const department = await client.from('departments').select('organization_id').eq('id', scopeId).maybeSingle()
    if (department.error) throw department.error
    return department.data ? { organizationId: department.data.organization_id as string, departmentId: scopeId } : null
  }
  const team = await client.from('teams').select('organization_id, department_id').eq('id', scopeId).maybeSingle()
  if (team.error) throw team.error
  return team.data ? { organizationId: team.data.organization_id as string, departmentId: team.data.department_id as string, teamId: scopeId } : null
}

// exactOptionalPropertyTypes verbietet departmentId/teamId: undefined -- die Schluessel muessen
// bei Abwesenheit ganz fehlen statt explizit auf undefined gesetzt zu sein.
function toPermissionScope(organizationId: string, departmentId?: string | null, teamId?: string | null): PermissionScope {
  return { organizationId, ...(departmentId ? { departmentId } : {}), ...(teamId ? { teamId } : {}) }
}

// --- Paket 015: Einwilligungsverwaltung -----------------------------------------------------

// Bereitgestellte Vorlage, bis ein Verein einen eigenen Text hinterlegt (Plan 015, "Einwilligungstext
// pro Verein editierbar"). Anwaltliche Pruefung ist Voraussetzung fuer den Produktivbetrieb, siehe
// plans/README.md "Entschiedene Produktfragen" -- diese Vorlage ist ein Platzhalter, kein Rechtstext.
const DEFAULT_CONSENT_TEXT_TEMPLATE = `Einwilligung zur Veröffentlichung von Fotos und Videos in sozialen Medien

Der Verein möchte über sein Vereinsleben berichten und dafür auch Fotos und Videos auf seinen Social-Media-Kanälen veröffentlichen. Mit dieser Einwilligung bestätigen Sie, dass Fotos und Videos im hier beschriebenen Umfang veröffentlicht werden dürfen.

Diese Einwilligung ist freiwillig. Sie können sie jederzeit ohne Angabe von Gründen für die Zukunft widerrufen; das beeinträchtigt nicht die Rechtmäßigkeit der bis zum Widerruf erfolgten Veröffentlichungen.`

// setUTCMonth() ueberlaeuft korrekt auf das naechste Jahr (z. B. Monat 13 -> Januar des
// Folgejahres) -- kein eigener Divisions-/Modulo-Code fuer den Jahresuebertrag noetig. Der Tag
// wird vorher auf 1 gesetzt und danach auf den letzten Tag des Zielmonats begrenzt, sonst wuerde
// z. B. der 31. August + 6 Monate ueber den 28./29. Februar hinaus in den Maerz ueberlaufen
// (gefunden im Code-Review) und die Einwilligung faelschlich laenger gueltig machen.
function addMonthsToIsoDate(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDayOfTargetMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDayOfTargetMonth))
  return date.toISOString()
}

function generatePublicToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('hex')
  return { rawToken, tokenHash: createHash('sha256').update(rawToken).digest('hex') }
}

type ConsentRecordRow = {
  id: string
  organization_id: string
  directory_person_id: string | null
  pseudonymous_subject_ref: string | null
  scope: string
  scope_structured: ConsentScope
  origin: 'paper' | 'digital' | 'imported'
  source_id: string | null
  signed_at: string | null
  signer_name: string | null
  signer_role: 'self' | 'guardian' | null
  guardian_confirmed: boolean
  valid_from: string
  valid_until: string | null
  revoked_at: string | null
  revoked_by: 'self' | 'guardian' | 'organization' | null
  revocation_reason: string | null
  superseded_by: string | null
  created_at: string
}

// Reine Aussage ueber die Zeile selbst (Ampel fuer die Uebersicht) -- unabhaengig von jedem
// konkreten Verwendungszweck. evaluateConsent (packages/domain) prueft zusaetzlich die Deckung
// eines KONKRETEN Beitrags und wird separat fuer die Gate-Auswertung verwendet, nicht hier.
function computeConsentRecordStatus(row: ConsentRecordRow, now: Date): ConsentStatus {
  if (row.superseded_by !== null) return 'superseded'
  if (row.revoked_at !== null) return 'revoked'
  if (row.signer_role === 'guardian' && !row.guardian_confirmed) return 'guardian_missing'
  if (new Date(row.valid_from) > now) return 'not_yet_valid'
  if (row.valid_until !== null) {
    const validUntil = new Date(row.valid_until)
    if (validUntil <= now) return 'expired'
    if ((validUntil.getTime() - now.getTime()) / 86_400_000 <= 30) return 'expiring_soon'
  }
  return 'valid'
}

function mapConsentRecordRow(row: ConsentRecordRow, now: Date) {
  return ConsentRecordSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    directoryPersonId: row.directory_person_id,
    pseudonymousSubjectRef: row.pseudonymous_subject_ref,
    scope: row.scope,
    scopeStructured: row.scope_structured,
    origin: row.origin,
    sourceId: row.source_id,
    signedAt: row.signed_at,
    signerName: row.signer_name,
    signerRole: row.signer_role,
    guardianConfirmed: row.guardian_confirmed,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revocationReason: row.revocation_reason,
    supersededBy: row.superseded_by,
    status: computeConsentRecordStatus(row, now),
    createdAt: row.created_at,
  })
}

type ConsentRequestRow = {
  id: string
  organization_id: string
  department_id: string
  directory_person_id: string
  recipient_email: string
  recipient_role: 'self' | 'guardian'
  requested_scope: ConsentScope
  text_version: string
  status: 'sent' | 'granted' | 'declined' | 'expired' | 'revoked_link'
  expires_at: string
  responded_at: string | null
  consent_record_id: string | null
  send_count: number
  last_sent_at: string
  created_by: string
  created_at: string
}

function mapConsentRequestRow(row: ConsentRequestRow) {
  return ConsentRequestSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    departmentId: row.department_id,
    directoryPersonId: row.directory_person_id,
    recipientEmail: row.recipient_email,
    recipientRole: row.recipient_role,
    requestedScope: row.requested_scope,
    textVersion: row.text_version,
    status: row.status,
    expiresAt: row.expires_at,
    respondedAt: row.responded_at,
    consentRecordId: row.consent_record_id,
    sendCount: row.send_count,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
  })
}

function describeConsentScope(scope: ConsentScope): string[] {
  const lines: string[] = []
  const purposeLabels: Record<string, string> = {
    social_media: 'Social Media', website: 'Vereinswebsite', print: 'Printmaterial', internal: 'interne Nutzung',
  }
  const contextLabels: Record<string, string> = {
    team_photo: 'Mannschaftsfoto', match: 'Spiel', training: 'Training', event: 'Veranstaltung', portrait: 'Porträt',
  }
  lines.push(`Zweck: ${scope.purposes.map((purpose) => purposeLabels[purpose] ?? purpose).join(', ')}`)
  lines.push(`Plattformen: ${scope.platforms === null ? 'alle vom Verein genutzten' : scope.platforms.join(', ')}`)
  lines.push(`Medienart: ${scope.mediaKinds.map((kind) => (kind === 'photo' ? 'Foto' : 'Video')).join(', ')}`)
  lines.push(`Anlässe: ${scope.contexts === null ? 'alle' : scope.contexts.map((context) => contextLabels[context] ?? context).join(', ')}`)
  lines.push(scope.namingAllowed ? 'Namentliche Nennung ist erlaubt.' : 'Namentliche Nennung ist nicht erlaubt.')
  return lines
}

// Spiegelt authz.resolve_policy_flag() als AND-Reduktion in TS -- dieselbe Duplizierung wie bei
// canAssignRole/canRemoveRole/role_rank (siehe packages/authorization), hier fuer die
// Anzeigezustaende "geerbt/verschaerft/gesperrt" der Richtlinienoberflaeche. Durchgesetzt wird
// weiterhin ausschliesslich in Postgres (RLS und die *_memberships_insert-Policies); dies dient
// nur der Darstellung.
function resolvePolicyFlagState(ancestorEffective: boolean, ownValue: boolean | null, canEdit: boolean): PolicyFlagState {
  return {
    effective: ancestorEffective && (ownValue ?? true),
    ownValue,
    lockedByAncestor: !ancestorEffective,
    canEdit,
  }
}

const POLICY_MANAGE_PERMISSION: Record<ScopeLevel, Permission> = {
  organization: 'organization.manage',
  department: 'department.manage',
  team: 'team.manage',
}

// POST /v1/invitations nimmt organizationId/departmentId/teamId direkt vom Client entgegen.
// Ungeprueft wuerde requirePermission auf einer Scope-Kette pruefen, die client-seitig frei
// kombinierbar ist (z. B. eine fremde organizationId zusammen mit der eigenen departmentId) --
// beim Mandantentrennung-Review gefunden, dort nur zufaellig durch den FK-Constraint auf
// invitations abgefangen. Hier wird departmentId/teamId serverseitig gegen ihre echte
// organization_id/department_id verifiziert, bevor irgendeine Berechtigung geprueft wird.
async function resolveInvitationScope(
  client: SupabaseClient,
  input: { organizationId: string; departmentId?: string | null | undefined; teamId?: string | null | undefined },
): Promise<{ scope: PermissionScope; scopeName: string } | null> {
  if (input.teamId) {
    const team = await client.from('teams').select('organization_id, department_id, name').eq('id', input.teamId).maybeSingle()
    if (team.error) throw team.error
    if (!team.data || team.data.organization_id !== input.organizationId || team.data.department_id !== input.departmentId) return null
    return {
      scope: { organizationId: team.data.organization_id as string, departmentId: team.data.department_id as string, teamId: input.teamId },
      scopeName: team.data.name as string,
    }
  }
  if (input.departmentId) {
    const department = await client.from('departments').select('organization_id, name').eq('id', input.departmentId).maybeSingle()
    if (department.error) throw department.error
    if (!department.data || department.data.organization_id !== input.organizationId) return null
    return { scope: { organizationId: department.data.organization_id as string, departmentId: input.departmentId }, scopeName: department.data.name as string }
  }
  return { scope: { organizationId: input.organizationId }, scopeName: '' }
}

// Fuer Routen, die den Scope bereits aus einer vertrauenswuerdigen Quelle kennen (z. B. der
// invitations-Zeile selbst bei /resend) -- reine Namensauskunft, keine erneute Verifikation.
async function resolveScopeName(client: SupabaseClient, scope: PermissionScope, organizationName: string): Promise<string> {
  if (scope.teamId) {
    const team = await client.from('teams').select('name').eq('id', scope.teamId).single()
    if (team.error) throw team.error
    return team.data.name as string
  }
  if (scope.departmentId) {
    const department = await client.from('departments').select('name').eq('id', scope.departmentId).single()
    if (department.error) throw department.error
    return department.data.name as string
  }
  return organizationName
}

// --- Paket 014: Integrationsrahmen und Mitgliederverzeichnis -------------------------------------

function mapIntegrationSourceRow(row: Record<string, unknown>) {
  return IntegrationSourceSchema.parse({
    id: row.id, organizationId: row.organization_id, transport: row.transport, providerKey: row.provider_key,
    displayName: row.display_name, enabledDomains: row.enabled_domains, departmentId: row.department_id,
    endpointUrl: row.endpoint_url, fieldMapping: row.field_mapping, syncCron: row.sync_cron,
    lossThresholdPercent: row.loss_threshold_percent, enabled: row.enabled, lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status, createdAt: row.created_at,
  })
}

function mapSyncRunRow(row: Record<string, unknown>) {
  return IntegrationSyncRunSchema.parse({
    id: row.id, organizationId: row.organization_id, sourceId: row.source_id, domain: row.domain, mode: row.mode,
    status: row.status, createdCount: row.created_count, updatedCount: row.updated_count, retiredCount: row.retired_count,
    skippedCount: row.skipped_count, conflictCount: row.conflict_count, errorClass: row.error_class,
    startedAt: row.started_at, finishedAt: row.finished_at,
  })
}

function mapSyncConflictRow(row: Record<string, unknown>) {
  return IntegrationSyncConflictSchema.parse({
    id: row.id, organizationId: row.organization_id, syncRunId: row.sync_run_id, sourceId: row.source_id, domain: row.domain,
    externalId: row.external_id, localId: row.local_id, label: row.label, field: row.field, currentValue: row.current_value,
    incomingValue: row.incoming_value, kind: row.kind, resolution: row.resolution, resolvedAt: row.resolved_at, createdAt: row.created_at,
  })
}

function mapFixtureRow(row: Record<string, unknown>) {
  return FixtureSchema.parse({
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    kind: row.kind, competition: row.competition, isHome: row.is_home, ownTeamLabel: row.own_team_label,
    opponentName: row.opponent_name, kickoffAt: row.kickoff_at, kickoffTimeConfirmed: row.kickoff_time_confirmed,
    venueName: row.venue_name, venueAddress: row.venue_address, status: row.status,
    homeScore: row.home_score, awayScore: row.away_score, note: row.note,
    announcementDismissedAt: row.announcement_dismissed_at, resultDismissedAt: row.result_dismissed_at,
    sourceId: row.source_id, sourceUpdatedAt: row.source_updated_at, createdAt: row.created_at, updatedAt: row.updated_at,
  })
}

function mapClubEventRow(row: Record<string, unknown>) {
  return ClubEventSchema.parse({
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    title: row.title, description: row.description, category: row.category,
    startsAt: row.starts_at, endsAt: row.ends_at, allDay: row.all_day,
    locationName: row.location_name, locationAddress: row.location_address, registrationUrl: row.registration_url,
    status: row.status, invitationDismissedAt: row.invitation_dismissed_at,
    sourceId: row.source_id, sourceUpdatedAt: row.source_updated_at, createdAt: row.created_at, updatedAt: row.updated_at,
  })
}

function mapDirectoryPersonRow(row: Record<string, unknown>) {
  return DirectoryPersonSchema.parse({
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id, teamId: row.team_id,
    firstName: row.first_name, lastName: row.last_name, birthYear: row.birth_year, isMinor: row.is_minor,
    status: row.status, leftAt: row.left_at, joinedAt: row.joined_at, profileId: row.profile_id,
    becameAdultAt: row.became_adult_at, sourceId: row.source_id, createdAt: row.created_at,
  })
}

// Wie resolveInvitationScope: departmentId/teamId serverseitig gegen ihre echte organization_id/
// department_id verifizieren, bevor irgendeine Berechtigung geprueft wird -- sonst waeren sie
// client-seitig frei kombinierbar (z. B. eine fremde departmentId zu dieser Organisation).
async function resolveDirectoryScope(
  client: SupabaseClient,
  organizationId: string,
  departmentId: string | null,
  teamId: string | null,
): Promise<PermissionScope | null> {
  if (teamId) {
    const team = await client.from('teams').select('organization_id, department_id').eq('id', teamId).maybeSingle()
    if (team.error) throw team.error
    if (!team.data || team.data.organization_id !== organizationId || team.data.department_id !== departmentId) return null
    return { organizationId, departmentId: team.data.department_id as string, teamId }
  }
  if (departmentId) {
    const department = await client.from('departments').select('organization_id').eq('id', departmentId).maybeSingle()
    if (department.error) throw department.error
    if (!department.data || department.data.organization_id !== organizationId) return null
    return { organizationId, departmentId }
  }
  return { organizationId }
}

/**
 * `isMinor` aus der Anfrage darf den Schutz nur anheben, nie senken. Ohne diese Klammer koennte
 * ein Aufrufer eine Person mit Geburtsjahr 2015 als `isMinor: false` anlegen und damit sowohl den
 * CHECK auf einen Elternkontakt als auch die strengere Freigaberoute umgehen -- derselbe
 * wiederkehrende Fund wie bei den security-definer-RPCs aus 011/012: sicherheitsrelevante Werte
 * leitet der Server selbst her, statt sie vom Aufrufer zu uebernehmen. Ohne bekanntes Geburtsjahr
 * gibt es nichts herzuleiten, dann zaehlt die Angabe.
 */
function resolveIsMinor(requested: boolean | undefined, birthYear: number | null, referenceYear: number): boolean {
  const derived = birthYear != null ? deriveIsMinor(birthYear, referenceYear) : false
  return derived || (requested ?? false)
}

function normalizeStructureName(name: string): string {
  return name.trim().toLowerCase()
}

// Dieselbe Aufloesung wie im geschlossenen resolveIds() aus packages/member-directory/src/match.ts
// -- dort fuer den Feldvergleich waehrend planSync, hier fuer das tatsaechliche Schreiben nach
// einer Uebernahme. Keine gemeinsame Exportstelle: zwei Zeilen Lookup rechtfertigen keine eigene
// Paketschnittstelle.
function resolvePersonScope(entity: PersonExternal, resolver: DepartmentResolver) {
  const departmentId = entity.departmentName ? resolver.resolveDepartmentId(entity.departmentName) : undefined
  const teamId = entity.teamName && departmentId ? resolver.resolveTeamId(departmentId, entity.teamName) : undefined
  return { departmentId, teamId }
}

// Deterministisch aus Quelle, Bereich, Konfliktart, Feld und Identitaet (plans/014: "fingerprint
// ist der Grund, warum ignore_permanently funktioniert"). sha256 statt einer Verkettung roh: Labels
// koennen das Trennzeichen selbst enthalten.
function conflictFingerprint(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex')
}

async function collectRows(transport: SourceTransport): Promise<Readonly<Record<string, unknown>>[]> {
  const rows: Readonly<Record<string, unknown>>[] = []
  for await (const row of transport.read({})) rows.push(row)
  return rows
}

interface PendingConflict {
  kind: SyncConflictKind
  label: string
  field: string
  externalId: string | null
  localId: string | null
  currentValue: string | null
  incomingValue: string | null
  fingerprint: string
}

// Baut die Konfliktzeilen aus einem SyncPlan -- gemeinsam fuer alle vier Bereiche (Personen,
// Mannschaften, Spiele, Veranstaltungen; Paket 019 verallgemeinert, was Paket 014 nur fuer
// Personen brauchte). identityOf ist die des jeweiligen DomainAdapter.
function buildPendingConflicts<TLocal extends { id: string }, TExternal>(input: {
  plan: SyncPlanResult<TLocal, TExternal>
  sourceId: string
  domain: IntegrationDomain
  identityOf: (entity: TExternal) => { externalId: string } | { fuzzy: readonly string[] }
  invalidRecords: readonly { label: string; reason: string }[]
  ignoredFingerprints: ReadonlySet<string>
}): PendingConflict[] {
  const { plan, sourceId, domain, identityOf, invalidRecords, ignoredFingerprints } = input
  const pendingConflicts: PendingConflict[] = []
  for (const conflict of plan.conflicts) {
    const identity = conflict.incoming ? identityOf(conflict.incoming) : null
    const externalId = identity && 'externalId' in identity ? identity.externalId : null
    const localId = conflict.candidates?.[0]?.id ?? null
    const field = conflict.kind === 'unknown_structure' ? 'structure' : 'identity'
    const fingerprint = conflictFingerprint([sourceId, domain, conflict.kind, field, externalId ?? localId ?? conflict.label])
    if (ignoredFingerprints.has(fingerprint)) continue
    // unknown_structure traegt in conflict.reason den unaufgeloesten Rohwert -- nicht spiegeln
    // (derselbe Fund wie in Paket 014 bei directory_people).
    const incomingValue = conflict.kind === 'unknown_structure' ? null : (conflict.reason ?? null)
    pendingConflicts.push({ kind: conflict.kind, label: conflict.label, field, externalId, localId, currentValue: null, incomingValue, fingerprint })
  }
  for (const invalid of invalidRecords) {
    const fingerprint = conflictFingerprint([sourceId, domain, 'invalid_record', 'record', invalid.label])
    if (ignoredFingerprints.has(fingerprint)) continue
    pendingConflicts.push({ kind: 'invalid_record', label: invalid.label, field: 'record', externalId: null, localId: null, currentValue: null, incomingValue: invalid.reason, fingerprint })
  }
  return pendingConflicts
}

async function loadIgnoredFingerprints(service: SupabaseClient, sourceId: string): Promise<ReadonlySet<string>> {
  const ignored = await service.from('integration_sync_conflicts').select('fingerprint').eq('source_id', sourceId).eq('resolution', 'ignore_permanently')
  if (ignored.error) throw ignored.error
  return new Set(ignored.data.map((row) => row.fingerprint as string))
}

async function handleAbortedSync(input: {
  service: SupabaseClient
  organizationId: string
  sourceId: string
  domain: IntegrationDomain
  mode: SyncMode
  correlationId: string
  triggeredBy: string
}) {
  const run = await input.service
    .from('integration_sync_runs')
    .insert({
      organization_id: input.organizationId, source_id: input.sourceId, domain: input.domain, mode: input.mode,
      status: 'aborted_loss_threshold', correlation_id: input.correlationId, finished_at: new Date().toISOString(), triggered_by: input.triggeredBy,
    })
    .select('id, organization_id, source_id, domain, mode, status, created_count, updated_count, retired_count, skipped_count, conflict_count, error_class, started_at, finished_at')
    .single()
  if (run.error) throw run.error
  await input.service.from('integration_sources').update({ last_sync_at: new Date().toISOString(), last_sync_status: 'aborted_loss_threshold' }).eq('id', input.sourceId)
  return SyncSourceResponseSchema.parse({ run: mapSyncRunRow(run.data), conflicts: [] })
}

async function finishSyncRun(input: {
  service: SupabaseClient
  request: FastifyRequest
  organizationId: string
  sourceId: string
  domain: IntegrationDomain
  mode: SyncMode
  correlationId: string
  createdCount: number
  updatedCount: number
  retiredCount: number
  skippedCount: number
  pendingConflicts: readonly PendingConflict[]
}) {
  const run = await input.service
    .from('integration_sync_runs')
    .insert({
      organization_id: input.organizationId, source_id: input.sourceId, domain: input.domain, mode: input.mode, status: 'succeeded',
      created_count: input.createdCount, updated_count: input.updatedCount, retired_count: input.retiredCount,
      skipped_count: input.skippedCount, conflict_count: input.pendingConflicts.length,
      correlation_id: input.correlationId, finished_at: new Date().toISOString(), triggered_by: input.request.auth!.userId,
    })
    .select('id, organization_id, source_id, domain, mode, status, created_count, updated_count, retired_count, skipped_count, conflict_count, error_class, started_at, finished_at')
    .single()
  if (run.error) throw run.error

  let conflictRows: Record<string, unknown>[] = []
  if (input.pendingConflicts.length > 0) {
    const conflictInsert = await input.service
      .from('integration_sync_conflicts')
      .insert(
        input.pendingConflicts.map((conflict) => ({
          organization_id: input.organizationId, sync_run_id: run.data.id, source_id: input.sourceId, domain: input.domain,
          external_id: conflict.externalId, local_id: conflict.localId, label: conflict.label, field: conflict.field,
          current_value: conflict.currentValue, incoming_value: conflict.incomingValue, kind: conflict.kind, fingerprint: conflict.fingerprint,
        })),
      )
      .select('id, organization_id, sync_run_id, source_id, domain, external_id, local_id, label, field, current_value, incoming_value, kind, resolution, resolved_at, created_at')
    if (conflictInsert.error) throw conflictInsert.error
    conflictRows = conflictInsert.data
  }

  await input.service.from('integration_sources').update({ last_sync_at: new Date().toISOString(), last_sync_status: 'succeeded' }).eq('id', input.sourceId)
  // Inline statt des recordAuditEvent-Helfers weiter unten in dieser Datei: der ist eine Closure
  // innerhalb von buildApp (braucht supabaseClients aus dessen Scope), diese Funktion hier ist
  // bewusst top-level wie collectRows/conflictFingerprint -- service ist bereits alles, was der
  // Audit-Eintrag braucht.
  const audit = await input.service.from('audit_events').insert({
    organization_id: input.organizationId, actor_user_id: input.request.auth!.userId, action: `integration_source.sync_${input.mode}`,
    entity_type: 'integration_sync_runs', entity_id: run.data.id as string, correlation_id: input.request.id,
    metadata: { created: input.createdCount, updated: input.updatedCount, retired: input.retiredCount, conflicts: input.pendingConflicts.length },
  })
  if (audit.error) input.request.log.error({ err: audit.error, correlationId: input.request.id }, 'audit_events insert failed')

  return SyncSourceResponseSchema.parse({ run: mapSyncRunRow(run.data), conflicts: conflictRows.map(mapSyncConflictRow) })
}

// Loest einen rohen Datumswert (iCal-Kompaktform ODER eine bereits vollstaendige ISO-Zeichenkette
// aus einer Datei-Spalte) in eine UTC-Instanz auf. Ein Datei-Export mit einer eigenen
// kickoffAt/startsAt-Spalte liefert ueblicherweise bereits ein eindeutiges Format -- dafuer gilt
// die Angabe als bestaetigt (kein TZID-Fall). resolveIcalDateTime deckt nur die iCal-Kompaktform ab.
function resolveScheduleDateTime(
  rawValue: string,
  tzid: string | undefined,
  fallbackTimezone: string,
): { iso: string; confirmed: boolean } | undefined {
  const icalResolved = resolveIcalDateTime(rawValue, tzid, fallbackTimezone)
  if (icalResolved) return icalResolved
  const parsed = new Date(rawValue)
  if (!Number.isNaN(parsed.getTime())) return { iso: parsed.toISOString(), confirmed: true }
  return undefined
}

interface SyncDomainContext {
  request: FastifyRequest
  reply: FastifyReply
  service: SupabaseClient
  organizationId: string
  sourceDepartmentId: string | null
  sourceId: string
  sourceFieldMapping: FieldMapping
  sourceLossThresholdPercent: number
  mode: SyncMode
  domain: IntegrationDomain
  correlationId: string
  rawRows: readonly Readonly<Record<string, unknown>>[]
  organizationTimezone: string
}

async function handleTeamsSync(ctx: SyncDomainContext): Promise<FastifyReply> {
  const { request, reply, service, organizationId, sourceDepartmentId, sourceId, sourceFieldMapping, sourceLossThresholdPercent, mode, domain, correlationId, rawRows } = ctx

  // Wie bei Personen (Paket 014): Mannschaften ohne Quelle (Duplikatvermeidung gegen von Hand
  // gepflegte Eintraege) plus bereits dieser Quelle zugeordnete Mannschaften. Anders als
  // directory_people (department_id dort "on delete set null", plus eine Umhaenge-Moeglichkeit
  // per PATCH) hat teams.department_id "on delete cascade" (Loeschen der Abteilung loescht das
  // Team mit, es entsteht keine Waise) und keinen Schreibpfad, der department_id nachtraeglich
  // aendert -- der 014-Review-Fund "eigene Quellzeile verschwindet aus dem naechsten existing"
  // wurde deshalb bewusst NICHT auf teams uebertragen; die Ausgangslage, die ihn ausloeste, gibt
  // es hier nicht.
  let existingQuery = service
    .from('teams')
    .select('id, name, department_id, age_group, competition, source_id, external_id, source_updated_at, updated_at')
    .eq('organization_id', organizationId)
    .or(`source_id.is.null,source_id.eq.${sourceId}`)
  if (sourceDepartmentId) existingQuery = existingQuery.eq('department_id', sourceDepartmentId)
  const existingRows = await existingQuery
  if (existingRows.error) throw existingRows.error
  const existingLocals: TeamLocal[] = existingRows.data.map((row) => ({
    id: row.id as string, externalId: row.external_id as string | null, sourceId: row.source_id as string | null,
    name: row.name as string, departmentId: row.department_id as string, ageGroup: row.age_group as string | null,
    competition: row.competition as string | null,
    sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at as string) : null,
    updatedAt: new Date(row.updated_at as string),
  }))

  // Dieselbe Abteilungs-Scope-Einschraenkung wie bei Personen (Fund aus 014): eine
  // abteilungsgebundene Quelle loest Abteilungsnamen nur innerhalb der eigenen Abteilung auf.
  const departmentRows = sourceDepartmentId
    ? await service.from('departments').select('id, name').eq('id', sourceDepartmentId)
    : await service.from('departments').select('id, name').eq('organization_id', organizationId)
  if (departmentRows.error) throw departmentRows.error
  const departmentIdByName = new Map(departmentRows.data.map((row) => [normalizeStructureName(row.name as string), row.id as string]))
  const resolver: TeamDepartmentResolver = { resolveDepartmentId: (name) => departmentIdByName.get(normalizeStructureName(name)) }

  const incoming: ExternalTeam[] = []
  const invalidRecords: { label: string; reason: string }[] = []
  let rowIndex = 0
  for (const raw of rawRows) {
    rowIndex += 1
    const normalized = teamDomainAdapter.normalize(raw, sourceFieldMapping)
    if (normalized === undefined) continue
    const parsed = ExternalTeamSchema.safeParse(normalized)
    if (!parsed.success) {
      const guessedName = typeof (normalized as Record<string, unknown>).name === 'string' ? ((normalized as Record<string, unknown>).name as string) : `Zeile ${rowIndex}`
      invalidRecords.push({ label: guessedName, reason: parsed.error.issues.map((issue) => issue.message).join('; ') })
      continue
    }
    incoming.push(parsed.data)
  }

  const match = createTeamMatchStrategy(resolver)
  const plan = planSync({ existing: existingLocals, incoming, match, policy: { lossThresholdPercent: sourceLossThresholdPercent } })
  if (plan.aborted) {
    return reply.code(200).send(await handleAbortedSync({ service, organizationId, sourceId, domain, mode, correlationId, triggeredBy: request.auth!.userId }))
  }

  const ignoredFingerprints = await loadIgnoredFingerprints(service, sourceId)
  const pendingConflicts = buildPendingConflicts({ plan, sourceId, domain, identityOf: teamDomainAdapter.identityOf, invalidRecords, ignoredFingerprints })

  // Ein neu anzulegendes/zu aktualisierendes Team ohne aufloesbare Abteilung UND ohne
  // abteilungsgebundene Quelle haette keinen department_id-Wert -- die Spalte ist not null. Statt
  // eines ungefangenen DB-Fehlers wird das ein Konflikt (dieselbe Vorsicht wie bei Personen ohne
  // Elternkontakt in Paket 014).
  const applicableCreated: ExternalTeam[] = []
  for (const entity of plan.created) {
    const resolvedDepartmentId = (match.fieldsOf(entity) as { departmentId: string | null }).departmentId ?? sourceDepartmentId
    if (!resolvedDepartmentId) {
      const fingerprint = conflictFingerprint([sourceId, domain, 'invalid_record', 'departmentId', entity.externalId ?? entity.name])
      if (!pendingConflicts.some((conflict) => conflict.fingerprint === fingerprint)) {
        pendingConflicts.push({ kind: 'invalid_record', label: entity.name, field: 'departmentId', externalId: entity.externalId ?? null, localId: null, currentValue: null, incomingValue: 'keine Abteilung zuordenbar', fingerprint })
      }
      continue
    }
    applicableCreated.push(entity)
  }

  const appliedUpdatedCount = plan.updated.length
  if (mode === 'apply') {
    if (applicableCreated.length > 0) {
      const insertRows = applicableCreated.map((entity) => {
        const resolved = match.fieldsOf(entity) as { departmentId: string | null }
        return {
          organization_id: organizationId, department_id: resolved.departmentId ?? sourceDepartmentId, name: entity.name,
          age_group: entity.ageGroup ?? null, competition: entity.competition ?? null,
          source_id: sourceId, external_id: entity.externalId ?? null, source_updated_at: entity.sourceUpdatedAt ?? null,
        }
      })
      const insert = await service.from('teams').insert(insertRows)
      if (insert.error) throw insert.error
    }
    for (const update of plan.updated) {
      const resolved = match.fieldsOf(update.external) as { departmentId: string | null }
      const result = await service
        .from('teams')
        .update({
          name: update.external.name, department_id: resolved.departmentId ?? update.local.departmentId,
          age_group: update.external.ageGroup ?? update.local.ageGroup, competition: update.external.competition ?? update.local.competition,
          source_updated_at: update.external.sourceUpdatedAt ?? update.local.sourceUpdatedAt?.toISOString() ?? null,
        })
        .eq('id', update.local.id)
      if (result.error) throw result.error
    }
    for (const retired of plan.retired) {
      const result = await service.from('teams').update({ archived_at: new Date().toISOString() }).eq('id', retired.id).is('archived_at', null)
      if (result.error) throw result.error
    }
  }

  return reply.code(200).send(await finishSyncRun({
    service, request, organizationId, sourceId, domain, mode, correlationId,
    createdCount: applicableCreated.length, updatedCount: appliedUpdatedCount, retiredCount: plan.retired.length,
    skippedCount: plan.skipped.length, pendingConflicts,
  }))
}

async function handleFixturesSync(ctx: SyncDomainContext): Promise<FastifyReply> {
  const { request, reply, service, organizationId, sourceDepartmentId, sourceId, sourceFieldMapping, sourceLossThresholdPercent, mode, domain, correlationId, rawRows, organizationTimezone } = ctx

  // Ein Spiel braucht eine Abteilung (fixtures.department_id ist not null) und die Quelle liefert
  // keinen eigenen Abteilungsnamen (anders als teams/people) -- ohne abteilungsgebundene Quelle
  // ist nicht entscheidbar, wohin ein synchronisiertes Spiel gehoert.
  if (!sourceDepartmentId) return reply.code(409).send({ error: 'source_missing_department', correlationId: request.id })

  const existingRows = await service
    .from('fixtures')
    .select('id, external_id, source_id, team_id, is_home, own_team_label, opponent_name, competition, kickoff_at, kickoff_time_confirmed, venue_name, venue_address, status, home_score, away_score, note, source_updated_at, updated_at')
    .eq('organization_id', organizationId)
    .eq('department_id', sourceDepartmentId)
    .or(`source_id.is.null,source_id.eq.${sourceId}`)
  if (existingRows.error) throw existingRows.error
  const existingLocals: FixtureLocal[] = existingRows.data.map((row) => ({
    id: row.id as string, externalId: row.external_id as string | null, sourceId: row.source_id as string | null,
    teamId: row.team_id as string | null, isHome: row.is_home as boolean | null, ownTeamLabel: row.own_team_label as string | null,
    opponentName: row.opponent_name as string | null, competition: row.competition as string | null,
    kickoffAt: row.kickoff_at ? new Date(row.kickoff_at as string) : null, kickoffTimeConfirmed: row.kickoff_time_confirmed as boolean,
    venueName: row.venue_name as string | null, venueAddress: row.venue_address as string | null,
    status: row.status as FixtureStatus, homeScore: row.home_score as number | null, awayScore: row.away_score as number | null,
    note: row.note as string | null, sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at as string) : null,
    updatedAt: new Date(row.updated_at as string),
  }))

  // Mannschaftszuordnung ("wer sind wir") nur innerhalb der eigenen Abteilung -- dieselbe
  // Scope-Einschraenkung wie bei Personen/Mannschaften.
  const teamRows = await service.from('teams').select('id, name').eq('department_id', sourceDepartmentId)
  if (teamRows.error) throw teamRows.error
  const teamIdByName = new Map(teamRows.data.map((row) => [normalizeStructureName(row.name as string), row.id as string]))
  const resolver: TeamNameResolver = { resolveTeamId: (name) => teamIdByName.get(normalizeStructureName(name)) }

  const incoming: ExternalFixture[] = []
  const invalidRecords: { label: string; reason: string }[] = []
  let rowIndex = 0
  for (const raw of rawRows) {
    rowIndex += 1
    const normalized = fixtureDomainAdapter.normalize(raw, sourceFieldMapping)
    if (normalized === undefined) continue
    const parsed = ExternalFixtureSchema.safeParse(normalized)
    if (!parsed.success) {
      const guessed = normalized as Record<string, unknown>
      const label = typeof guessed.opponentName === 'string' ? guessed.opponentName : typeof guessed.awayNameRaw === 'string' ? guessed.awayNameRaw : `Zeile ${rowIndex}`
      invalidRecords.push({ label, reason: parsed.error.issues.map((issue) => issue.message).join('; ') })
      continue
    }
    incoming.push(parsed.data)
  }

  const match = createFixtureMatchStrategy(resolver)
  const plan = planSync({ existing: existingLocals, incoming, match, policy: { lossThresholdPercent: sourceLossThresholdPercent } })
  if (plan.aborted) {
    return reply.code(200).send(await handleAbortedSync({ service, organizationId, sourceId, domain, mode, correlationId, triggeredBy: request.auth!.userId }))
  }

  const ignoredFingerprints = await loadIgnoredFingerprints(service, sourceId)
  const pendingConflicts = buildPendingConflicts({ plan, sourceId, domain, identityOf: fixtureDomainAdapter.identityOf, invalidRecords, ignoredFingerprints })

  let appliedUpdatedCount = plan.updated.length
  if (mode === 'apply') {
    if (plan.created.length > 0) {
      const insertRows = plan.created.map((entity) => {
        const resolved = match.fieldsOf(entity) as { teamId: string | null; opponentName: string | null; isHome: boolean | null; competition: string | null; kickoffAt: string | null }
        const kickoff = resolved.kickoffAt ? resolveScheduleDateTime(resolved.kickoffAt, entity.kickoffAtTzid, organizationTimezone) : undefined
        const ownTeamLabel = resolved.isHome === true ? entity.homeNameRaw ?? null : resolved.isHome === false ? entity.awayNameRaw ?? null : null
        return {
          organization_id: organizationId, department_id: sourceDepartmentId, team_id: resolved.teamId,
          is_home: resolved.isHome, own_team_label: ownTeamLabel, opponent_name: resolved.opponentName, competition: resolved.competition,
          kickoff_at: kickoff?.iso ?? null, kickoff_time_confirmed: kickoff ? (entity.kickoffTimeConfirmed ?? kickoff.confirmed) : true,
          venue_name: entity.venueName ?? null, venue_address: entity.venueAddress ?? null,
          status: entity.status ?? 'scheduled', home_score: entity.homeScore ?? null, away_score: entity.awayScore ?? null,
          note: entity.note ?? null, source_id: sourceId, external_id: entity.externalId ?? null, source_updated_at: entity.sourceUpdatedAt ?? null,
        }
      })
      const insert = await service.from('fixtures').insert(insertRows)
      if (insert.error) throw insert.error
    }
    for (const update of plan.updated) {
      const resolved = match.fieldsOf(update.external) as { teamId: string | null; opponentName: string | null; isHome: boolean | null; competition: string | null; kickoffAt: string | null }
      const patch: Record<string, unknown> = {
        team_id: resolved.teamId ?? update.local.teamId, opponent_name: resolved.opponentName ?? update.local.opponentName,
        is_home: resolved.isHome ?? update.local.isHome, competition: resolved.competition ?? update.local.competition,
        source_updated_at: update.external.sourceUpdatedAt ?? update.local.sourceUpdatedAt?.toISOString() ?? null,
      }
      if (update.external.kickoffAt !== undefined) {
        const kickoff = resolveScheduleDateTime(update.external.kickoffAt, update.external.kickoffAtTzid, organizationTimezone)
        if (kickoff) { patch.kickoff_at = kickoff.iso; patch.kickoff_time_confirmed = update.external.kickoffTimeConfirmed ?? kickoff.confirmed }
      }
      if (update.external.venueName !== undefined) patch.venue_name = update.external.venueName
      if (update.external.venueAddress !== undefined) patch.venue_address = update.external.venueAddress
      if (update.external.status !== undefined) patch.status = update.external.status
      if (update.external.homeScore !== undefined) patch.home_score = update.external.homeScore
      if (update.external.awayScore !== undefined) patch.away_score = update.external.awayScore
      if (update.external.note !== undefined) patch.note = update.external.note
      const result = await service.from('fixtures').update(patch).eq('id', update.local.id)
      if (result.error) {
        // 23514: status='played' ohne beide Torzahlen -- eine unvollstaendige Ergebniskorrektur
        // bleibt unveraendert stehen statt den ganzen Lauf abzubrechen (dasselbe Muster wie bei
        // Personen/Elternkontakt in Paket 014).
        if (result.error.code !== '23514') throw result.error
        appliedUpdatedCount -= 1
      }
    }
    for (const retired of plan.retired) {
      // Ein aus der Quelle verschwundenes Spiel gilt als abgesagt, nie als geloescht -- ein
      // bereits gespieltes ('played') Ergebnis bleibt davon unberuehrt.
      const result = await service.from('fixtures').update({ status: 'cancelled' }).eq('id', retired.id).neq('status', 'played')
      if (result.error) throw result.error
    }
  }

  return reply.code(200).send(await finishSyncRun({
    service, request, organizationId, sourceId, domain, mode, correlationId,
    createdCount: plan.created.length, updatedCount: appliedUpdatedCount, retiredCount: plan.retired.length,
    skippedCount: plan.skipped.length, pendingConflicts,
  }))
}

async function handleEventsSync(ctx: SyncDomainContext): Promise<FastifyReply> {
  const { request, reply, service, organizationId, sourceDepartmentId, sourceId, sourceFieldMapping, sourceLossThresholdPercent, mode, domain, correlationId, rawRows, organizationTimezone } = ctx

  let existingQuery = service
    .from('club_events')
    .select('id, external_id, recurrence_key, source_id, title, description, category, starts_at, ends_at, all_day, location_name, location_address, registration_url, status, source_updated_at, updated_at')
    .eq('organization_id', organizationId)
    .or(`source_id.is.null,source_id.eq.${sourceId}`)
  if (sourceDepartmentId) existingQuery = existingQuery.eq('department_id', sourceDepartmentId)
  else existingQuery = existingQuery.is('department_id', null)
  const existingRows = await existingQuery
  if (existingRows.error) throw existingRows.error
  const existingLocals: ClubEventLocal[] = existingRows.data.map((row) => ({
    id: row.id as string, externalId: row.external_id as string | null, recurrenceKey: row.recurrence_key as string | null,
    sourceId: row.source_id as string | null,
    title: row.title as string, description: row.description as string | null, category: row.category as string,
    startsAt: new Date(row.starts_at as string), endsAt: row.ends_at ? new Date(row.ends_at as string) : null,
    allDay: row.all_day as boolean, locationName: row.location_name as string | null, locationAddress: row.location_address as string | null,
    registrationUrl: row.registration_url as string | null, status: row.status as string,
    sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at as string) : null,
    updatedAt: new Date(row.updated_at as string),
  }))

  const incoming: ExternalClubEvent[] = []
  const invalidRecords: { label: string; reason: string }[] = []
  let rowIndex = 0
  for (const raw of rawRows) {
    rowIndex += 1
    const normalized = clubEventDomainAdapter.normalize(raw, sourceFieldMapping)
    if (normalized === undefined) continue
    const parsed = ExternalClubEventSchema.safeParse(normalized)
    if (!parsed.success) {
      const guessed = normalized as Record<string, unknown>
      const label = typeof guessed.title === 'string' ? guessed.title : `Zeile ${rowIndex}`
      invalidRecords.push({ label, reason: parsed.error.issues.map((issue) => issue.message).join('; ') })
      continue
    }
    incoming.push(parsed.data)
  }

  const plan = planSync({ existing: existingLocals, incoming, match: createClubEventMatchStrategy(), policy: { lossThresholdPercent: sourceLossThresholdPercent } })
  if (plan.aborted) {
    return reply.code(200).send(await handleAbortedSync({ service, organizationId, sourceId, domain, mode, correlationId, triggeredBy: request.auth!.userId }))
  }

  const ignoredFingerprints = await loadIgnoredFingerprints(service, sourceId)
  const pendingConflicts = buildPendingConflicts({ plan, sourceId, domain, identityOf: clubEventDomainAdapter.identityOf, invalidRecords, ignoredFingerprints })

  // Eine Veranstaltung ohne aufloesbaren Start-Zeitpunkt (kaputtes Datumsformat) wuerde an der
  // not-null-Spalte starts_at scheitern -- als Konflikt behandeln statt ungefangen zu werfen.
  const applicableCreated: { entity: ExternalClubEvent; startsAt: string; startsAtConfirmed: boolean }[] = []
  for (const entity of plan.created) {
    const resolved = resolveScheduleDateTime(entity.startsAt, entity.startsAtTzid, organizationTimezone)
    if (!resolved) {
      const fingerprint = conflictFingerprint([sourceId, domain, 'invalid_record', 'startsAt', entity.externalId ?? entity.title])
      if (!pendingConflicts.some((conflict) => conflict.fingerprint === fingerprint)) {
        pendingConflicts.push({ kind: 'invalid_record', label: entity.title, field: 'startsAt', externalId: entity.externalId ?? null, localId: null, currentValue: null, incomingValue: entity.startsAt, fingerprint })
      }
      continue
    }
    applicableCreated.push({ entity, startsAt: resolved.iso, startsAtConfirmed: resolved.confirmed })
  }

  let appliedUpdatedCount = plan.updated.length
  if (mode === 'apply') {
    if (applicableCreated.length > 0) {
      const insertRows = applicableCreated.map(({ entity, startsAt }) => {
        const end = entity.endsAt ? resolveScheduleDateTime(entity.endsAt, entity.endsAtTzid, organizationTimezone) : undefined
        return {
          organization_id: organizationId, department_id: sourceDepartmentId,
          title: entity.title, description: entity.description ?? null, category: entity.category ?? 'other',
          starts_at: startsAt, ends_at: end?.iso ?? null, all_day: entity.allDay ?? false,
          location_name: entity.locationName ?? null, location_address: entity.locationAddress ?? null,
          registration_url: entity.registrationUrl ?? null, status: entity.status ?? 'scheduled',
          source_id: sourceId, external_id: entity.externalId ?? null, recurrence_key: entity.recurrenceKey ?? null,
          source_updated_at: entity.sourceUpdatedAt ?? null,
        }
      })
      const insert = await service.from('club_events').insert(insertRows)
      if (insert.error) throw insert.error
    }
    for (const update of plan.updated) {
      const patch: Record<string, unknown> = {
        source_updated_at: update.external.sourceUpdatedAt ?? update.local.sourceUpdatedAt?.toISOString() ?? null,
      }
      if (update.external.title !== undefined) patch.title = update.external.title
      if (update.external.description !== undefined) patch.description = update.external.description
      if (update.external.category !== undefined) patch.category = update.external.category
      // Wie beim Anlegen (oben): ein nicht aufloesbares Datum wird ein Konflikt statt eines
      // Updates, das das betroffene Feld klammheimlich ausspart und die Zeile trotzdem als
      // erfolgreich aktualisiert zaehlt.
      let unresolvedDateField: 'startsAt' | 'endsAt' | undefined
      if (update.external.startsAt !== undefined) {
        const resolved = resolveScheduleDateTime(update.external.startsAt, update.external.startsAtTzid, organizationTimezone)
        if (resolved) patch.starts_at = resolved.iso
        else unresolvedDateField = 'startsAt'
      }
      if (!unresolvedDateField && update.external.endsAt !== undefined) {
        const resolved = resolveScheduleDateTime(update.external.endsAt, update.external.endsAtTzid, organizationTimezone)
        if (resolved) patch.ends_at = resolved.iso
        else unresolvedDateField = 'endsAt'
      }
      if (unresolvedDateField) {
        const incomingValue = unresolvedDateField === 'startsAt' ? update.external.startsAt : update.external.endsAt
        const fingerprint = conflictFingerprint([sourceId, domain, 'invalid_record', unresolvedDateField, update.external.externalId ?? update.local.id])
        if (!pendingConflicts.some((conflict) => conflict.fingerprint === fingerprint)) {
          pendingConflicts.push({ kind: 'invalid_record', label: update.local.title, field: unresolvedDateField, externalId: update.external.externalId ?? null, localId: update.local.id, currentValue: null, incomingValue: incomingValue ?? null, fingerprint })
        }
        appliedUpdatedCount -= 1
        continue
      }
      if (update.external.allDay !== undefined) patch.all_day = update.external.allDay
      if (update.external.locationName !== undefined) patch.location_name = update.external.locationName
      if (update.external.locationAddress !== undefined) patch.location_address = update.external.locationAddress
      if (update.external.registrationUrl !== undefined) patch.registration_url = update.external.registrationUrl
      if (update.external.status !== undefined) patch.status = update.external.status
      const result = await service.from('club_events').update(patch).eq('id', update.local.id)
      if (result.error) throw result.error
    }
    for (const retired of plan.retired) {
      const result = await service.from('club_events').update({ status: 'cancelled' }).eq('id', retired.id)
      if (result.error) throw result.error
    }
  }

  return reply.code(200).send(await finishSyncRun({
    service, request, organizationId, sourceId, domain, mode, correlationId,
    createdCount: applicableCreated.length, updatedCount: appliedUpdatedCount, retiredCount: plan.retired.length,
    skippedCount: plan.skipped.length, pendingConflicts,
  }))
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const environment = parseApiEnvironment()
  const fastifyOptions: FastifyServerOptions = {
    logController: new LogController({ disableRequestLogging: environment.NODE_ENV === 'test' }),
    requestIdHeader: 'x-correlation-id',
    genReqId: () => randomUUID(),
    logger:
      options.logger === false
        ? false
        : {
            level: environment.LOG_LEVEL,
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie', '*.access_token', '*.media'],
              censor: '[REDACTED]',
            },
          },
  }
  const app = Fastify(fastifyOptions)
  const uploads = options.uploads ?? new LocalUploadService()
  const roleProvider = options.roleProvider ?? new SupabaseRoleProvider(environment)
  const supabaseClients: SupabaseClientFactory = options.supabaseClients ?? {
    forUser: (accessToken) => createUserClient(environment, accessToken),
    forService: () => createServiceClient(environment),
  }
  const platformAdminProvider = options.platformAdminProvider ?? new SupabasePlatformAdminProvider(() => supabaseClients.forService())
  const metaOAuthClient: MetaOAuthClient =
    options.metaOAuthClient ??
    new RealMetaOAuthClient({
      appId: environment.META_APP_ID ?? '',
      appSecret: environment.META_APP_SECRET ?? '',
      graphVersion: environment.META_GRAPH_VERSION,
    })
  const emailSender =
    options.emailSender ??
    // Ohne echten Versand ist der Log die einzige Stelle, an der der Einladungslink (inkl.
    // Rohtoken) ueberhaupt sichtbar wird -- ohne message.text waere die Einladung lokal nicht
    // einloesbar, obwohl sie serverseitig korrekt erzeugt wurde.
    createEmailSender(environment, (message) => app.log.info({ to: message.to, subject: message.subject, text: message.text }, 'invitation email (fake provider)'))
  const { requireAuth, requirePermission, requirePlatformAdmin } = createAuthGuards(environment, roleProvider, platformAdminProvider)

  // Paket 025: ein MetaPublisher braucht das entschluesselte Token GENAU dieser Social-Connection
  // (anders als metaOAuthClient oben, das appId/appSecret-Ebene bleibt) -- deshalb keine einmalige
  // Instanz, sondern eine Fabrik je Aufruf. options.publisher ueberschreibt vollstaendig (Tests).
  function createPublisherForConnection(platform: 'instagram' | 'facebook', accessToken: string, externalAccountId: string): SocialPublisher {
    if (options.publisher) return options.publisher
    if (environment.PUBLISHING_PROVIDER !== 'meta') return new FakePublisher()
    return new MetaPublisher({
      graphVersion: environment.META_GRAPH_VERSION,
      accessToken,
      ...(platform === 'instagram' ? { instagramAccountId: externalAccountId } : { facebookPageId: externalAccountId }),
    })
  }

  // Genau der eine Ursprung, unter dem das Frontend laeuft -- dieselbe Quelle wie fuer die
  // Einladungslinks weiter unten. Vorher stand hier in Entwicklung Port 4200 fest verdrahtet
  // (ein Dev-Server auf einem anderen Port scheiterte still an der Preflight-Pruefung) und in
  // Produktion origin: false, was jeden Cross-Origin-Aufruf verbietet -- damit haette sich das
  // ausgelieferte Frontend selbst ausgesperrt, sobald es nicht unter derselben Herkunft wie die
  // API liegt. WEB_BASE_URL ist in Produktion Pflicht (packages/config), der Fallback greift
  // also nur lokal. Ueber .origin, weil ein abschliessender Slash oder ein Pfad in der
  // Konfiguration sonst gegen den Origin-Header nie matcht und wieder still fehlschluege.
  await app.register(cors, {
    origin: [new URL(environment.WEB_BASE_URL ?? 'http://localhost:4200').origin],
    // @fastify/cors' eigener Default ist 'GET,HEAD,POST' (die CORS-safelisted Methoden) --
    // jede PATCH/PUT/DELETE-Anfrage aus dem echten Browser scheiterte dadurch am Preflight
    // (Access-Control-Allow-Methods liess die angefragte Methode nie zu), obwohl die Route selbst
    // existierte. Betraf u. a. das Umbenennen/Archivieren/Loeschen auf /struktur, Rollenwechsel und
    // Entfernen auf /mitglieder sowie die neuen Richtlinien-/Befristungsrouten aus Paket 023 (beim
    // manuellen Browser-Test dieses Pakets gefunden). vitest/app.inject() umgeht CORS vollstaendig
    // und deckte das nie auf.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  })
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } })

  app.get('/health', async () =>
    HealthSchema.parse({
      status: 'ok',
      service: 'api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    }),
  )

  app.post('/v1/submissions', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateSubmissionSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'post.create', { organizationId: input.organizationId, departmentId: input.departmentId }))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)

    // Paket 011: evaluateSubmitPermission vor der ersten Persistenz -- Berechtigung im Scope ist
    // durch requirePermission oben schon bestaetigt, Vertrauen/Preset/Format sind es noch nicht.
    const config = await resolveScopedEffectiveConfig(client, input.organizationId, input.departmentId, input.teamId ?? null)
    const trust = await fetchMemberTrust(client, request.auth!.userId, input.organizationId, input.departmentId, input.teamId ?? null)
    const submitCheck = evaluateSubmitPermission({
      hasCreatePermission: true,
      // fetchMemberTrust liefert bereits alle zutreffenden Ebenen (Verein, die Abteilung, das
      // Team) -- ein find() auf nur EINE Ebene liesse sich durch die Wahl von teamId umgehen
      // (Abteilungssperre bleibt unbeachtet) oder pruefte die Vereinsebene nie (beim
      // Rechte-Review gefunden). Verschaerfung wirkt wie ueberall sonst: jede Ebene kann
      // sperren, keine kann eine Sperre einer anderen Ebene aufheben.
      submitAllowed: trust.every((record) => record.submitAllowed !== false),
      presetSlug: input.presetSlug,
      requestedFormats: input.requestedFormats,
      allowedPresets: config.policies.allowedPresets,
      allowedFormats: config.policies.allowedFormats,
    })
    if (!submitCheck.allowed) {
      // submit_not_allowed ist eine Berechtigungsfrage (das Vertrauen dieser Person, Plan 011:
      // "Einreichen bei submit_allowed = false -> 403"); preset_not_allowed/format_not_allowed sind
      // inhaltliche Verstoesse gegen die Richtlinie dieses Scopes -> 422 mit maschinenlesbarem Grund.
      const status = submitCheck.reason === 'submit_not_allowed' ? 403 : 422
      return reply.code(status).send({ error: submitCheck.reason, correlationId: request.id })
    }

    // Herkunft eines Spiel-/Veranstaltungsbezugs leitet die API selbst aus der referenzierten
    // Zeile her, nie aus Client-Angaben (plans/README.md, "RPC traut Client nicht") -- der Client
    // nennt nur fixtureId/clubEventId, die tatsaechlichen Fakten/den Quellenstand bestimmt diese
    // Anfrage selbst per factsFromFixture/factsFromClubEvent. sourceMaterial.facts bleibt
    // trotzdem das vom Menschen bestaetigte Ergebnis (plans/019, Abschnitt 3: "er bestaetigt
    // schneller als er tippt, aber er bestaetigt") -- provenance/snapshot sind nur die
    // Herkunftsangabe dazu, keine Ueberschreibung der Fakten.
    let sourceProvenance: Record<string, unknown> = {}
    let sourceRevisionAt: string | null = null
    let sourcePrefillSnapshot: Record<string, unknown> | null = null
    if (input.fixtureId || input.clubEventId) {
      const organizationRow = await client.from('organizations').select('timezone').eq('id', input.organizationId).single()
      if (organizationRow.error) throw organizationRow.error
      const timezone = organizationRow.data.timezone as string

      if (input.fixtureId) {
        const fixtureRow = await client
          .from('fixtures')
          .select('id, organization_id, department_id, team_id, kind, competition, is_home, own_team_label, opponent_name, kickoff_at, kickoff_time_confirmed, venue_name, venue_address, status, home_score, away_score, note, announcement_dismissed_at, result_dismissed_at, source_id, source_updated_at, created_at, updated_at')
          .eq('organization_id', input.organizationId)
          .eq('id', input.fixtureId)
          .maybeSingle()
        if (fixtureRow.error) throw fixtureRow.error
        if (!fixtureRow.data || fixtureRow.data.department_id !== input.departmentId) {
          return reply.code(400).send({ error: 'fixture_not_found_in_department', correlationId: request.id })
        }
        const fixture = mapFixtureRow(fixtureRow.data)
        let team: Team | null = null
        if (fixture.teamId) {
          const teamRow = await client
            .from('teams')
            .select('id, organization_id, department_id, name, age_group, competition, source_id, archived_at, created_at')
            .eq('id', fixture.teamId)
            .maybeSingle()
          if (teamRow.error) throw teamRow.error
          team = teamRow.data ? TeamSchema.parse(mapTeamRow(teamRow.data)) : null
        }
        const facts = factsFromFixture(fixture, team, timezone)
        if (facts.ok) {
          sourceProvenance = facts.provenance
          sourcePrefillSnapshot = facts.facts
        }
        sourceRevisionAt = fixture.sourceUpdatedAt ?? fixtureRow.data.updated_at as string
      } else if (input.clubEventId) {
        const eventRow = await client
          .from('club_events')
          .select('id, organization_id, department_id, team_id, title, description, category, starts_at, ends_at, all_day, location_name, location_address, registration_url, status, invitation_dismissed_at, source_id, source_updated_at, created_at, updated_at')
          .eq('organization_id', input.organizationId)
          .eq('id', input.clubEventId)
          .maybeSingle()
        if (eventRow.error) throw eventRow.error
        if (!eventRow.data || (eventRow.data.department_id !== null && eventRow.data.department_id !== input.departmentId)) {
          return reply.code(400).send({ error: 'event_not_found_in_department', correlationId: request.id })
        }
        const clubEvent = mapClubEventRow(eventRow.data)
        const facts = factsFromClubEvent(clubEvent, timezone)
        if (facts.ok) {
          sourceProvenance = facts.provenance
          sourcePrefillSnapshot = facts.facts
        }
        sourceRevisionAt = clubEvent.sourceUpdatedAt ?? eventRow.data.updated_at as string
      }
    }

    // forbiddenTopics wird additiv zu doNotMention ergaenzt (Plan 011, "Durchsetzung an vier
    // Stellen") -- die Content-Engine kennt beide nicht getrennt, nur eine gemeinsame Verbotsliste.
    const insert = await client
      .from('submissions')
      .insert({
        organization_id: input.organizationId,
        department_id: input.departmentId,
        team_id: input.teamId ?? null,
        content_type: input.presetSlug,
        preset_slug: input.presetSlug,
        communication_goal: input.communicationGoal,
        requested_formats: input.requestedFormats,
        facts: input.sourceMaterial.facts,
        source_material: {
          ...input.sourceMaterial,
          doNotMention: Array.from(new Set([...input.sourceMaterial.doNotMention, ...config.policies.forbiddenTopics])),
        },
        source_revision: input.sourceRevision,
        fixture_id: input.fixtureId ?? null,
        club_event_id: input.clubEventId ?? null,
        source_provenance: sourceProvenance,
        source_revision_at: sourceRevisionAt,
        source_prefill_snapshot: sourcePrefillSnapshot,
        created_by: request.auth!.userId,
      })
      .select('id, status')
      .single()
    if (insert.error) throw insert.error
    const submissionId = insert.data.id as string
    const correlationId = request.id
    const generated = await new FakeContentGenerator().generate(input)
    let draft: { postId: string; postVersionId: string } | null = null
    if (generated.missingFacts.length === 0) {
      // Schliesst die seit den Paketen 011/012/014/015/019 dokumentierte Luecke: bis hierhin
      // entstand nie ein post/post_version aus einer submission (plans/025). assertGroundedPost
      // setzt die in Plan 001 nur definierte, nie durchgesetzte Invariante erstmals durch --
      // mit FakeContentGenerator deterministisch nie verletzt, aber kein stilles Sicherheitsnetz.
      assertGroundedPost(generated, createGroundedContentBrief(input))

      // Geflacht, NICHT die unveraenderte EffectiveConfig-Verschachtelung: schedule_publication
      // und GET /v1/post-versions/:id/available-channels lesen bereits heute
      // effective_config_snapshot->'config'->'allowedChannelIds' direkt, nicht
      // ->'config'->'policies'->'allowedChannelIds'. Da bisher nichts diese Spalte beschrieb, blieb
      // der Mismatch folgenlos -- als erster Schreibzugriff muss dieser Code die gelesene Form
      // treffen, sonst waere die Kanal-Beschraenkung aus 011/012 ab hier stillschweigend wirkungslos.
      const effectiveConfigSnapshot = { config: { tone: config.tone, goals: config.goals, hashtags: config.hashtags, ...config.policies } }

      // posts/post_versions/post_variants haben keine Insert-Policy fuer authenticated (RLS ohne
      // passende Policy verweigert das grundsaetzlich) -- Schreibzugriff laeuft wie bei
      // directory_people/fixtures/consent_records ausschliesslich ueber die API mit Service Role,
      // nach dem bereits oben erfolgten requirePermission('post.create', ...).
      const service = supabaseClients.forService()
      const postInsert = await service
        .from('posts')
        .insert({
          organization_id: input.organizationId, department_id: input.departmentId, team_id: input.teamId ?? null,
          submission_id: submissionId, status: 'draft_ready', created_by: request.auth!.userId,
        })
        .select('id')
        .single()
      if (postInsert.error) throw postInsert.error
      const postId = postInsert.data.id as string

      // Die vier Schreibvorgaenge sind getrennte PostgREST-Aufrufe ohne gemeinsame Transaktion --
      // ohne diese Kompensation bliebe bei jedem Fehler nach dem posts-Insert eine 'draft_ready'-
      // Zeile ohne current_version_id und ohne Version zurueck (Code-Review zu PR #25, dieselbe
      // Kompensationslehre wie bei POST /v1/llm-providers und POST /v1/oauth-pending/:id/select).
      try {
        const versionInsert = await service
          .from('post_versions')
          .insert({
            organization_id: input.organizationId, post_id: postId, version_number: 1,
            source_facts_snapshot: input.sourceMaterial, effective_config_snapshot: effectiveConfigSnapshot,
            title: generated.headline, caption: generated.caption, call_to_action: generated.callToAction,
            hashtags: generated.hashtags, alt_text: generated.altText, safety_flags: generated.safetyFlags,
            created_by_type: 'llm',
          })
          .select('id')
          .single()
        if (versionInsert.error) throw versionInsert.error
        const postVersionId = versionInsert.data.id as string

        const postUpdate = await service.from('posts').update({ current_version_id: postVersionId }).eq('id', postId)
        if (postUpdate.error) throw postUpdate.error

        // Welche Variante/welches Format zu einer konkreten Veroeffentlichung gehoert, ist Teil des
        // noch fehlenden Kreativsystems (Plan 005) -- hier nur befuellt, weil das Datenmodell es
        // erwartet und generated.variants es bereits vollstaendig liefert.
        if (generated.variants.length > 0) {
          const variantsInsert = await service.from('post_variants').insert(
            generated.variants.map((variant) => ({
              organization_id: input.organizationId, post_version_id: postVersionId, platform: variant.platform,
              format: variant.format, schema_version: '1', prompt_version: generated.templateId, variant,
            })),
          )
          if (variantsInsert.error) throw variantsInsert.error
        }

        await recordAuditEvent(request, {
          organizationId: input.organizationId, action: 'post.drafted', entityType: 'post_versions', entityId: postVersionId,
          metadata: { postId, submissionId, presetSlug: input.presetSlug },
        })
        draft = { postId, postVersionId }
      } catch (err) {
        await service.from('posts').delete().eq('id', postId)
        throw err
      }
    }
    const accepted = SubmissionAcceptedSchema.parse({
      submissionId,
      correlationId,
      status: generated.missingFacts.length > 0 ? 'facts_required' : 'queued',
      idempotencyKey: createIdempotencyKey('submission', submissionId, input.sourceRevision),
      ...(draft ?? {}),
    })

    request.log.info(
      {
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        submissionId,
        correlationId,
        missingFactsCount: generated.missingFacts.length,
        postVersionId: draft?.postVersionId ?? null,
      },
      'submission accepted',
    )

    return reply.code(202).send({ ...accepted, preview: generated })
  })

  const UploadInitiateSchema = z.object({ organizationId: UuidSchema, departmentId: UuidSchema, filename: z.string().min(1).max(120).regex(/^[^/\\]+$/), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']), byteSize: z.int().positive().max(100 * 1024 * 1024) })
  app.post('/v1/media/uploads', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UploadInitiateSchema.parse(request.body); const assetId = randomUUID()
    if (!(await requirePermission(request, reply, 'post.create', { organizationId: input.organizationId, departmentId: input.departmentId }))) return
    const upload = await uploads.create({ ...input, assetId })
    return reply.code(201).send({ assetId, ...upload })
  })
  app.post('/v1/media/:assetId/complete', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    // Keine requirePermission-Pruefung: welchem Verein/Abteilung ein assetId gehoert, ist
    // erst bekannt, wenn media_assets echt persistiert wird (LocalUploadService ist noch
    // ein Stub). Sobald das der Fall ist, muss hier die Zugehoerigkeit nachgeschlagen und
    // gegen 'post.edit' geprueft werden -- sonst kann jeder authentifizierte Nutzer ein
    // fremdes assetId abschliessen.
    const params = z.object({ assetId: UuidSchema }).parse(request.params); const body = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).parse(request.body)
    return reply.code(202).send(await uploads.complete({ ...params, ...body }))
  })
  app.post('/v1/media/gate', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    // Keine requirePermission-Pruefung: reine, zustandslose Regelauswertung ohne Scope-Bezug
    // und ohne Datenzugriff -- es gibt nichts scope-Gebundenes, gegen das zu pruefen waere.
    const input = z.object({
      scanStatus: z.enum(['pending', 'clean', 'failed']), facesConfirmedComplete: z.boolean(), hasOriginalSelected: z.boolean(),
      derivativeCurrent: z.boolean(), minorReviewConfirmed: z.boolean(),
      faces: z.array(z.object({
        subjectKind: z.enum(['adult', 'minor', 'unknown']), decision: z.enum(['pending', 'consented', 'obscure', 'exclude']),
        consentValid: z.boolean().optional(), consentScopeMismatch: z.boolean().optional(),
      })),
      namingNotAllowed: z.boolean().optional(), sensitiveTextData: z.boolean().optional(),
    }).parse(request.body)
    return evaluateMediaGate(input)
  })

  app.post('/v1/organizations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateOrganizationRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('create_organization', {
      organization_name: input.name,
      first_department_name: input.firstDepartmentName,
      organization_timezone: input.timezone,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('organization limit reached')) {
        return reply.code(429).send({ error: 'organization_limit_reached', correlationId: request.id })
      }
      // Der Trigger aus 2026080602_platform_admin_separation.sql schlaegt erst beim
      // Mitgliedschafts-Insert am Ende von create_organization() zu; die Funktion laeuft in
      // einer Transaktion, die angelegte Organisation wird also vollstaendig zurueckgerollt.
      if (rpc.error.message.includes('platform_admin_cannot_hold_membership')) {
        return reply.code(409).send({ error: 'platform_admin_cannot_hold_membership', correlationId: request.id })
      }
      throw rpc.error
    }
    const organizationId = rpc.data as string
    const created = await client.from('organizations').select('slug').eq('id', organizationId).single()
    if (created.error) throw created.error
    return reply.code(201).send(CreateOrganizationResponseSchema.parse({ organizationId, slug: created.data.slug }))
  })

  // Bislang gab es nur die PATCH-Route (Paket 009) -- ohne einen Lesepfad kann keine Oberflaeche
  // die aktuellen Impressumsangaben vorausgefuellt anzeigen, bevor sie geaendert werden (Paket 020,
  // Plan Abschnitt "3. Pflichtangaben und Verantwortung": einstellungen/recht.vue muss die
  // bestehenden Werte zuerst LESEN koennen). Dieselbe Berechtigung wie PATCH.
  app.get('/v1/organizations/:id/profile', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', { organizationId: params.id }))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const result = await client.from('organization_profiles').select().eq('organization_id', params.id).single()
    if (result.error) throw result.error
    return reply.code(200).send(OrganizationProfileSchema.parse(mapProfileRow(result.data)))
  })

  app.patch('/v1/organizations/:id/profile', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = OrganizationProfileUpdateSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'organization.manage', { organizationId: params.id }))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const update = await client
      .from('organization_profiles')
      .update(toProfileUpdatePayload(input))
      .eq('organization_id', params.id)
      .select()
      .single()
    if (update.error) {
      if (update.error.message.includes('responsible person must be an active member')) {
        return reply.code(400).send({ error: 'invalid_responsible_person', correlationId: request.id })
      }
      throw update.error
    }
    return reply.code(200).send(OrganizationProfileSchema.parse(mapProfileRow(update.data)))
  })

  app.put('/v1/organizations/:id/brand', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = OrganizationBrandUpdateSchema.parse(request.body)
    // brand.manage statt organization.manage (Plan 013): organization_owner/-admin erhalten es
    // automatisch (jede Permission ausser billing.manage), fuer alle anderen Rollen aendert sich
    // nichts gegenueber vorher -- nur der Name der durchgesetzten Berechtigung.
    if (!(await requirePermission(request, reply, 'brand.manage', { organizationId: params.id }))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    for (const [assetId, expectedKind] of [
      [input.displayFontAssetId, 'font'],
      [input.bodyFontAssetId, 'font'],
    ] as const) {
      if (!assetId) continue
      const asset = await loadSelectableBrandAsset(client, params.id, assetId, 'organization', undefined, undefined)
      if (!asset || asset.kind !== expectedKind) {
        return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
      }
    }
    const payload: Record<string, unknown> = {
      primary_color: input.primaryColor,
      accent_color: input.accentColor,
      background_color: input.backgroundColor,
      text_color: input.textColor,
      on_primary_color: input.onPrimaryColor,
      tone: input.tone,
      display_font_key: input.displayFontKey,
      body_font_key: input.bodyFontKey,
    }
    if (input.displayFontAssetId !== undefined) payload.display_font_asset_id = input.displayFontAssetId
    if (input.bodyFontAssetId !== undefined) payload.body_font_asset_id = input.bodyFontAssetId
    if (input.allowDepartmentOverrides !== undefined) payload.allow_department_overrides = input.allowDepartmentOverrides
    if (input.lockedFields !== undefined) payload.locked_fields = input.lockedFields
    const update = await client.from('organization_brand_profiles').update(payload).eq('organization_id', params.id).select().single()
    if (update.error) throw update.error
    return reply.code(200).send(OrganizationBrandSchema.parse(mapBrandRow(update.data)))
  })

  app.post('/v1/organizations/:id/brand/logo', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'brand.manage', { organizationId: params.id }))) return

    const filePart = await request.file()
    if (!filePart) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })

    let processed
    let variant: 'light' | 'dark'
    try {
      // `filePart.fields` is populated as busboy parses the multipart stream, so a field
      // declared after the file part is only present once the file's stream -- drained here
      // via toBuffer() -- has fully flushed. Reading it afterwards makes the route independent
      // of whether the client sends `variant` before or after the file part.
      const buffer = await filePart.toBuffer()
      const variantField = filePart.fields.variant
      const variantValue = variantField && 'value' in variantField ? variantField.value : undefined
      variant = BrandLogoVariantSchema.parse(variantValue)
      processed = await processBrandLogoUpload(buffer)
    } catch (error) {
      if (error instanceof UnsupportedLogoFormatError || error instanceof LogoDimensionsError) {
        return reply.code(400).send({ error: 'invalid_logo', message: error.message, correlationId: request.id })
      }
      // @fastify/multipart throws FST_REQ_FILE_TOO_LARGE (413) from toBuffer() itself, not
      // from a route handler return -- it must be caught here or it falls through to the
      // generic 500 handler below.
      if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
      }
      throw error
    }

    const objectPath = `organizations/${params.id}/brand/${variant}-${hashLogoBuffer(processed.buffer)}.${processed.extension}`
    const service = supabaseClients.forService()
    const upload = await service.storage
      .from('brand-assets')
      .upload(objectPath, processed.buffer, { contentType: processed.contentType, upsert: true })
    if (upload.error) throw upload.error
    const signed = await service.storage.from('brand-assets').createSignedUrl(objectPath, 600)
    if (signed.error) throw signed.error

    const column = variant === 'light' ? 'logo_path' : 'logo_dark_path'
    const brandUpdate = await service.from('organization_brand_profiles').update({ [column]: objectPath }).eq('organization_id', params.id)
    if (brandUpdate.error) throw brandUpdate.error

    // Design-Entscheidung (Plan 013): der bestehende Logo-Upload wird auf brand_assets
    // umgestellt statt eine Parallelstruktur zu schaffen -- logo_path/logo_dark_path bleiben
    // denormalisierte Zeiger auf das jeweils aktuelle 'ready'-Asset. Assets werden nie
    // ersetzt, nur abgeloest (Plan 013, "Umsetzung"): die vorige Zeile derselben Kind/Ebene
    // wird 'replaced', bevor die neue eingefuegt wird.
    const assetKind = variant === 'light' ? 'logo_primary' : 'logo_dark'
    const supersede = await service
      .from('brand_assets')
      .update({ status: 'replaced' })
      .eq('organization_id', params.id)
      .is('department_id', null)
      .is('team_id', null)
      .eq('kind', assetKind)
      .eq('status', 'ready')
    if (supersede.error) throw supersede.error
    // upsert statt insert: object_path traegt den Inhalts-Hash und ist per unique(bucket_id,
    // object_path) eindeutig. Wird dieselbe Datei ein zweites Mal hochgeladen, entsteht derselbe
    // Pfad -- ein reines insert scheiterte dann an der Eindeutigkeit, nachdem der Supersede-Schritt
    // die vorhandene Zeile bereits auf 'replaced' gesetzt hatte. Der Verein stuende danach ohne
    // aktives Logo-Asset da, und der Aufruf endete in einer 500.
    const assetInsert = await service
      .from('brand_assets')
      .upsert(
        {
          organization_id: params.id,
          department_id: null,
          team_id: null,
          kind: assetKind,
          object_path: objectPath,
          mime_type: processed.contentType,
          byte_size: processed.buffer.length,
          sha256: hashLogoBuffer(processed.buffer),
          width: processed.width ?? null,
          height: processed.height ?? null,
          status: 'ready',
          created_by: request.auth!.userId,
        },
        { onConflict: 'bucket_id,object_path' },
      )
      .select()
      .single()
    if (assetInsert.error) throw assetInsert.error

    const audit = await service.from('audit_events').insert({
      organization_id: params.id,
      actor_user_id: request.auth!.userId,
      action: 'organization.brand_logo_uploaded',
      entity_type: 'organization_brand_profiles',
      entity_id: params.id,
      correlation_id: request.id,
      metadata: { variant, sanitized: processed.sanitized, brandAssetId: assetInsert.data.id },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

    return reply.code(201).send(
      BrandLogoUploadResponseSchema.parse({ variant, path: objectPath, signedUrl: signed.data.signedUrl, sanitized: processed.sanitized }),
    )
  })

  app.post('/v1/brand/assets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return

    const filePart = await request.file()
    if (!filePart) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })

    let fields: z.infer<typeof CreateBrandAssetRequestSchema>
    let buffer: Buffer
    try {
      // Wie beim Logo-Upload: die Datei zuerst vollstaendig lesen, danach die begleitenden
      // multipart-Felder auswerten -- busboy fuellt filePart.fields erst, sobald der
      // Datei-Stream durchgelaufen ist.
      buffer = await filePart.toBuffer()
      const rawFields = Object.fromEntries(
        Object.entries(filePart.fields).map(([key, field]) => [key, field && 'value' in field ? field.value : undefined]),
      )
      fields = CreateBrandAssetRequestSchema.parse(rawFields)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
      }
      if (error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw error
    }

    const scope = toPermissionScope(fields.organizationId, fields.departmentId, fields.teamId)
    if (!(await requirePermission(request, reply, 'brand.manage', scope))) return

    // Auf Vereinsebene fuehren logo_path/logo_dark_path den denormalisierten Zeiger auf das
    // jeweils aktuelle 'ready'-Asset. Nur der dedizierte Endpunkt pflegt sie mit; kaeme ein
    // logo_primary/logo_dark hier durch, wuerde das bisherige Asset auf 'replaced' gesetzt,
    // waehrend der Zeiger unveraendert darauf zeigt -- das neue Logo tauchte nirgends auf.
    // Abteilungen und Mannschaften haben keinen solchen Zeiger (sie waehlen ueber logo_asset_id).
    if (!fields.departmentId && (fields.kind === 'logo_primary' || fields.kind === 'logo_dark')) {
      return reply.code(400).send({ error: 'use_organization_logo_endpoint', correlationId: request.id })
    }

    if (fields.teamId) {
      const client = supabaseClients.forUser(request.auth!.accessToken)
      // organization_id mitpruefen, nicht nur department_id: sonst koennte eine echte
      // Team-Mitgliedschaft mit einer davon abweichenden organizationId kombiniert werden, bevor
      // der zusammengesetzte Fremdschluessel beim Insert erst spaeter (als harter 500) eingreift.
      const team = await client.from('teams').select('id').eq('id', fields.teamId).eq('department_id', fields.departmentId!).eq('organization_id', fields.organizationId).maybeSingle()
      if (team.error) throw team.error
      if (!team.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    } else if (fields.departmentId) {
      const client = supabaseClients.forUser(request.auth!.accessToken)
      const department = await client.from('departments').select('id').eq('id', fields.departmentId).eq('organization_id', fields.organizationId).maybeSingle()
      if (department.error) throw department.error
      if (!department.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }

    // Validierung des Dateiinhalts laeuft vor jedem Service-Role-Aufruf (wie beim bestehenden
    // Logo-Upload): eine abgelehnte Datei braucht nie einen echten Supabase-Client.
    let processedFont: Awaited<ReturnType<typeof processBrandFontUpload>> | undefined
    let processedImage: Awaited<ReturnType<typeof processBrandLogoUpload>> | undefined
    if (fields.kind === 'font') {
      try {
        processedFont = await processBrandFontUpload(buffer)
      } catch (error) {
        if (error instanceof UnsupportedFontFormatError) {
          return reply.code(400).send({ error: 'invalid_font', message: error.message, correlationId: request.id })
        }
        if (error instanceof FontEmbeddingRestrictedError) {
          return reply.code(400).send({ error: 'font_embedding_restricted', message: error.message, correlationId: request.id })
        }
        if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
        }
        throw error
      }
    } else {
      try {
        processedImage = await processBrandLogoUpload(buffer)
      } catch (error) {
        if (error instanceof UnsupportedLogoFormatError || error instanceof LogoDimensionsError) {
          return reply.code(400).send({ error: 'invalid_logo', message: error.message, correlationId: request.id })
        }
        if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
        }
        throw error
      }
    }

    const service = supabaseClients.forService()
    const scopeSegment = fields.teamId
      ? `departments/${fields.departmentId}/teams/${fields.teamId}`
      : fields.departmentId
        ? `departments/${fields.departmentId}`
        : 'organization'

    const insertPayload: Record<string, unknown> = {
      organization_id: fields.organizationId,
      department_id: fields.departmentId ?? null,
      team_id: fields.teamId ?? null,
      kind: fields.kind,
      created_by: request.auth!.userId,
    }

    if (processedFont) {
      const hash = hashLogoBuffer(processedFont.woff2Buffer)
      const rawObjectPath = `organizations/${fields.organizationId}/brand/${scopeSegment}/font-${hash}-original.${processedFont.originalExtension}`
      const woff2ObjectPath = `organizations/${fields.organizationId}/brand/${scopeSegment}/font-${hash}.woff2`
      const rawUpload = await service.storage
        .from('raw-media')
        .upload(rawObjectPath, processedFont.originalBuffer, { contentType: processedFont.originalContentType, upsert: true })
      if (rawUpload.error) throw rawUpload.error
      const woff2Upload = await service.storage
        .from('brand-assets')
        .upload(woff2ObjectPath, processedFont.woff2Buffer, { contentType: 'font/woff2', upsert: true })
      if (woff2Upload.error) throw woff2Upload.error
      Object.assign(insertPayload, {
        object_path: woff2ObjectPath,
        source_object_path: rawObjectPath,
        mime_type: 'font/woff2',
        byte_size: processedFont.woff2Buffer.length,
        sha256: hash,
        font_family: processedFont.fontFamily,
        font_weight: processedFont.fontWeight,
        font_style: processedFont.fontStyle,
        status: 'processing',
      })
    } else if (processedImage) {
      const hash = hashLogoBuffer(processedImage.buffer)
      const objectPath = `organizations/${fields.organizationId}/brand/${scopeSegment}/${fields.kind}-${hash}.${processedImage.extension}`
      const upload = await service.storage
        .from('brand-assets')
        .upload(objectPath, processedImage.buffer, { contentType: processedImage.contentType, upsert: true })
      if (upload.error) throw upload.error

      let rasterDerivativePaths: Record<string, string> = {}
      if (processedImage.extension === 'svg') {
        let derivatives
        try {
          derivatives = await generateSvgRasterDerivatives(processedImage.buffer)
        } catch (error) {
          if (error instanceof SvgRasterizationError) {
            return reply.code(400).send({ error: 'invalid_logo', message: error.message, correlationId: request.id })
          }
          throw error
        }
        const derivativeUploads = await Promise.all(
          (Object.entries(derivatives) as [string, Buffer][]).map(async ([size, png]) => {
            const path = `organizations/${fields.organizationId}/brand/${scopeSegment}/${fields.kind}-${hash}-${size}.png`
            const result = await service.storage.from('brand-assets').upload(path, png, { contentType: 'image/png', upsert: true })
            if (result.error) throw result.error
            return [size, path] as const
          }),
        )
        rasterDerivativePaths = Object.fromEntries(derivativeUploads)
      }

      Object.assign(insertPayload, {
        object_path: objectPath,
        mime_type: processedImage.contentType,
        byte_size: processedImage.buffer.length,
        sha256: hash,
        width: processedImage.width ?? null,
        height: processedImage.height ?? null,
        raster_derivative_paths: rasterDerivativePaths,
        status: 'ready',
      })
    }

    if (insertPayload.status === 'ready') {
      const supersede = await service
        .from('brand_assets')
        .update({ status: 'replaced' })
        .eq('organization_id', fields.organizationId)
        .eq('kind', fields.kind)
        .eq('status', 'ready')
        .filter('department_id', fields.departmentId ? 'eq' : 'is', fields.departmentId ?? null)
        .filter('team_id', fields.teamId ? 'eq' : 'is', fields.teamId ?? null)
      if (supersede.error) throw supersede.error
    }

    // Wie beim Logo-Endpunkt: derselbe Dateiinhalt ergibt denselben object_path, und
    // unique(bucket_id, object_path) liesse ein reines insert beim zweiten Hochladen scheitern.
    const insert = await service.from('brand_assets').upsert(insertPayload, { onConflict: 'bucket_id,object_path' }).select().single()
    if (insert.error) throw insert.error

    const audit = await service.from('audit_events').insert({
      organization_id: fields.organizationId,
      actor_user_id: request.auth!.userId,
      action: 'brand_asset.uploaded',
      entity_type: 'brand_assets',
      entity_id: insert.data.id,
      correlation_id: request.id,
      metadata: { kind: fields.kind, departmentId: fields.departmentId ?? null, teamId: fields.teamId ?? null },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

    return reply.code(201).send(BrandAssetSchema.parse(mapBrandAssetRow(insert.data)))
  })

  app.post('/v1/brand/assets/:id/confirm-license', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = ConfirmBrandAssetLicenseRequestSchema.parse(request.body)

    // Ueber den Nutzer-eigenen Client lesen, nicht per Service Role: brand_assets_select traegt
    // bereits die Abschottung zwischen Abteilungen/Mannschaften (siehe Migration) durch -- ein
    // Asset ausserhalb des eigenen Vereins/Scopes liefert so schon "nicht gefunden", statt vor
    // der Berechtigungspruefung per Service Role Existenz und Art eines fremden Assets zu verraten.
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('brand_assets').select().eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (existing.data.kind !== 'font') return reply.code(400).send({ error: 'not_a_font_asset', correlationId: request.id })

    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, 'brand.manage', scope))) return

    const service = supabaseClients.forService()
    // Abgeloest wird nur DIESELBE Schrift (Familie, Schnitt, Lage) -- anders als ein Logo ist eine
    // Schrift kein Platz, den es je Ebene nur einmal gibt: das Markenprofil kennt eine Ueberschriften-
    // und eine Fliesstextschrift, und der Plan sieht mehrere eigene Schriftdateien je Verein vor.
    // Ein Supersede ueber kind = 'font' allein haette beim Bestaetigen der zweiten Schrift die
    // erste entwertet und damit unreferenzierbar gemacht.
    const supersede = await service
      .from('brand_assets')
      .update({ status: 'replaced' })
      .eq('organization_id', existing.data.organization_id)
      .eq('kind', 'font')
      .eq('status', 'ready')
      .eq('font_family', existing.data.font_family)
      .eq('font_weight', existing.data.font_weight)
      .eq('font_style', existing.data.font_style)
      .filter('department_id', existing.data.department_id ? 'eq' : 'is', existing.data.department_id ?? null)
      .filter('team_id', existing.data.team_id ? 'eq' : 'is', existing.data.team_id ?? null)
    if (supersede.error) throw supersede.error

    const update = await service
      .from('brand_assets')
      .update({
        license_holder: input.licenseHolder,
        license_note: input.licenseNote ?? null,
        license_confirmed_at: new Date().toISOString(),
        license_confirmed_by: request.auth!.userId,
        status: 'ready',
      })
      .eq('id', params.id)
      .select()
      .single()
    if (update.error) throw update.error

    const audit = await service.from('audit_events').insert({
      organization_id: existing.data.organization_id,
      actor_user_id: request.auth!.userId,
      action: 'brand_asset.license_confirmed',
      entity_type: 'brand_assets',
      entity_id: params.id,
      correlation_id: request.id,
      metadata: { licenseHolder: input.licenseHolder },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

    return reply.code(200).send(BrandAssetSchema.parse(mapBrandAssetRow(update.data)))
  })

  app.put('/v1/departments/:id/brand', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateDepartmentBrandRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const department = await client.from('departments').select('organization_id').eq('id', params.id).maybeSingle()
    if (department.error) throw department.error
    if (!department.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = department.data.organization_id as string
    if (!(await requirePermission(request, reply, 'brand.manage', { organizationId, departmentId: params.id }))) return

    // Ueber die Service Role, nicht ueber den Nutzer-Client: ob die Sperre greift, darf nicht davon
    // abhaengen, ob die Aufruferin das Vereinsprofil selbst lesen darf -- sonst liefe die Pruefung
    // fuer genau die Rollen ins Leere, fuer die sie gedacht ist. Die Berechtigung im Ziel-Scope ist
    // an dieser Stelle bereits geprueft.
    const organizationBrand = await supabaseClients
      .forService()
      .from('organization_brand_profiles')
      .select('allow_department_overrides, locked_fields')
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (organizationBrand.error) throw organizationBrand.error
    if (organizationBrand.data && setsAnyBrandField(input) && !organizationBrand.data.allow_department_overrides) {
      return reply.code(400).send({ error: 'overrides_not_allowed', correlationId: request.id })
    }
    const blockedField = firstBlockedBrandField(input, (organizationBrand.data?.locked_fields as string[] | null) ?? [])
    if (blockedField) return reply.code(400).send({ error: 'field_locked', field: blockedField, correlationId: request.id })

    for (const [assetId, expectedKinds] of [
      [input.logoAssetId, LOGO_ASSET_KINDS],
      [input.displayFontAssetId, new Set(['font'])],
      [input.bodyFontAssetId, new Set(['font'])],
    ] as const) {
      if (!assetId) continue
      const asset = await loadSelectableBrandAsset(client, organizationId, assetId, 'department', params.id, undefined)
      if (!asset || !expectedKinds.has(asset.kind)) {
        return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
      }
    }

    const payload: Record<string, unknown> = { organization_id: organizationId, department_id: params.id, updated_by: request.auth!.userId }
    if (input.primaryColor !== undefined) payload.primary_color = input.primaryColor
    if (input.accentColor !== undefined) payload.accent_color = input.accentColor
    if (input.tone !== undefined) payload.tone = input.tone
    if (input.logoAssetId !== undefined) payload.logo_asset_id = input.logoAssetId
    if (input.displayFontAssetId !== undefined) payload.display_font_asset_id = input.displayFontAssetId
    if (input.bodyFontAssetId !== undefined) payload.body_font_asset_id = input.bodyFontAssetId
    if (input.allowTeamOverrides !== undefined) payload.allow_team_overrides = input.allowTeamOverrides
    if (input.lockedFields !== undefined) payload.locked_fields = input.lockedFields

    const upsert = await client.from('department_brand_profiles').upsert(payload, { onConflict: 'organization_id,department_id' }).select().single()
    if (upsert.error) throw upsert.error
    return reply.code(200).send(DepartmentBrandSchema.parse(mapDepartmentBrandRow(upsert.data)))
  })

  app.put('/v1/teams/:id/brand', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateTeamBrandRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const team = await client.from('teams').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (team.error) throw team.error
    if (!team.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = team.data.organization_id as string
    const departmentId = team.data.department_id as string
    if (!(await requirePermission(request, reply, 'brand.manage', { organizationId, departmentId, teamId: params.id }))) return

    // Beide Ebenen daruber zaehlen: die Vereinssperre gilt fuer die Mannschaft auch dann, wenn die
    // Abteilung sie nicht wiederholt, und eine Abteilung, die selbst nicht abweichen darf, kann das
    // Recht nicht an ihre Mannschaften weiterreichen (siehe resolveBrand in packages/domain).
    // Wie beim Abteilungsendpunkt ueber die Service Role -- siehe dort.
    const service = supabaseClients.forService()
    const [organizationBrand, departmentBrand] = await Promise.all([
      service.from('organization_brand_profiles').select('allow_department_overrides, locked_fields').eq('organization_id', organizationId).maybeSingle(),
      service.from('department_brand_profiles').select('allow_team_overrides, locked_fields').eq('organization_id', organizationId).eq('department_id', departmentId).maybeSingle(),
    ])
    if (organizationBrand.error) throw organizationBrand.error
    if (departmentBrand.error) throw departmentBrand.error
    const teamOverridesAllowed =
      (organizationBrand.data?.allow_department_overrides ?? true) && (departmentBrand.data?.allow_team_overrides ?? true)
    if (setsAnyBrandField(input) && !teamOverridesAllowed) {
      return reply.code(400).send({ error: 'overrides_not_allowed', correlationId: request.id })
    }
    const lockedFields = [
      ...((organizationBrand.data?.locked_fields as string[] | null) ?? []),
      ...((departmentBrand.data?.locked_fields as string[] | null) ?? []),
    ]
    const blockedField = firstBlockedBrandField(input, lockedFields)
    if (blockedField) return reply.code(400).send({ error: 'field_locked', field: blockedField, correlationId: request.id })

    for (const [assetId, expectedKinds] of [
      [input.logoAssetId, LOGO_ASSET_KINDS],
      [input.displayFontAssetId, new Set(['font'])],
      [input.bodyFontAssetId, new Set(['font'])],
    ] as const) {
      if (!assetId) continue
      const asset = await loadSelectableBrandAsset(client, organizationId, assetId, 'team', departmentId, params.id)
      if (!asset || !expectedKinds.has(asset.kind)) {
        return reply.code(400).send({ error: 'invalid_asset_reference', correlationId: request.id })
      }
    }

    const payload: Record<string, unknown> = {
      organization_id: organizationId,
      department_id: departmentId,
      team_id: params.id,
      updated_by: request.auth!.userId,
    }
    if (input.primaryColor !== undefined) payload.primary_color = input.primaryColor
    if (input.accentColor !== undefined) payload.accent_color = input.accentColor
    if (input.tone !== undefined) payload.tone = input.tone
    if (input.logoAssetId !== undefined) payload.logo_asset_id = input.logoAssetId
    if (input.displayFontAssetId !== undefined) payload.display_font_asset_id = input.displayFontAssetId
    if (input.bodyFontAssetId !== undefined) payload.body_font_asset_id = input.bodyFontAssetId

    const upsert = await client.from('team_brand_profiles').upsert(payload, { onConflict: 'organization_id,department_id,team_id' }).select().single()
    if (upsert.error) throw upsert.error
    return reply.code(200).send(TeamBrandSchema.parse(mapTeamBrandRow(upsert.data)))
  })

  app.get('/v1/onboarding', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const onboarding = await client
      .from('organization_onboarding')
      .select('completed_steps, dismissed_at')
      .eq('organization_id', query.organizationId)
      .maybeSingle()
    if (onboarding.error) throw onboarding.error
    if (!onboarding.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return reply.code(200).send(
      OnboardingStateSchema.parse({ completedSteps: onboarding.data.completed_steps, dismissedAt: onboarding.data.dismissed_at }),
    )
  })

  app.post('/v1/onboarding/steps/:step/complete', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ step: OnboardingStepSchema }).parse(request.params)
    const body = z.object({ organizationId: UuidSchema }).parse(request.body)
    if (!(await requirePermission(request, reply, 'organization.manage', { organizationId: body.organizationId }))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const current = await client
      .from('organization_onboarding')
      .select('completed_steps')
      .eq('organization_id', body.organizationId)
      .single()
    if (current.error) throw current.error
    const completedSteps = Array.from(new Set([...(current.data.completed_steps as string[]), params.step]))
    const update = await client
      .from('organization_onboarding')
      .update({ completed_steps: completedSteps })
      .eq('organization_id', body.organizationId)
      .select('completed_steps, dismissed_at')
      .single()
    if (update.error) throw update.error
    return reply.code(200).send(
      OnboardingStateSchema.parse({ completedSteps: update.data.completed_steps, dismissedAt: update.data.dismissed_at }),
    )
  })

  // --- Abteilungen, Teams, Mitgliedschaften und Einladungen (Paket 010) ----------------

  app.post('/v1/organizations/:orgId/departments', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ orgId: UuidSchema }).parse(request.params)
    const input = CreateDepartmentRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'department.manage', { organizationId: params.orgId }))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('create_department', { target_organization_id: params.orgId, department_name: input.name })
    if (rpc.error) throw rpc.error
    const department = await client.from('departments').select('id, organization_id, name, slug, archived_at, created_at').eq('id', rpc.data as string).single()
    if (department.error) throw department.error
    // audit_events ist append-only und wird ausschliesslich privilegiert beschrieben ("Inserts
    // happen through privileged API procedures", 202608020001_initial_tenant_foundation.sql):
    // authenticated hat weder Insert-Grant noch Insert-Policy. Mit dem Nutzer-Client lief jeder
    // dieser Inserts in "permission denied for table audit_events", wurde nur geloggt und der
    // Request antwortete trotzdem mit 2xx -- der komplette Audit-Trail dieses Pakets war damit
    // wirkungslos (im Nachfolge-Review dieses PRs gefunden). Gilt fuer alle audit_events-Inserts
    // unten genauso; der Service-Client ist dasselbe Muster wie im Brand-Logo-Upload (Paket 022).
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: params.orgId,
      actor_user_id: request.auth!.userId,
      action: 'department.created',
      entity_type: 'departments',
      entity_id: department.data.id,
      correlation_id: request.id,
      metadata: { name: input.name },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(201).send(DepartmentSchema.parse(mapDepartmentRow(department.data)))
  })

  app.patch('/v1/departments/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateDepartmentRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('departments').select('organization_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'department.manage', { organizationId: existing.data.organization_id as string }))) return
    const payload: Record<string, unknown> = {}
    if (input.name !== undefined) payload.name = input.name
    if (input.archived !== undefined) payload.archived_at = input.archived ? new Date().toISOString() : null
    const update = await client.from('departments').update(payload).eq('id', params.id).select('id, organization_id, name, slug, archived_at, created_at').single()
    if (update.error) throw update.error
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: existing.data.organization_id,
      actor_user_id: request.auth!.userId,
      action: 'department.updated',
      entity_type: 'departments',
      entity_id: params.id,
      correlation_id: request.id,
      metadata: payload,
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(200).send(DepartmentSchema.parse(mapDepartmentRow(update.data)))
  })

  app.delete('/v1/departments/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('departments').select('organization_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'department.manage', { organizationId: existing.data.organization_id as string }))) return
    const del = await client.from('departments').delete().eq('id', params.id).select('id')
    if (del.error) {
      if (del.error.message.includes('the last department')) return reply.code(409).send({ error: 'last_department_cannot_be_deleted', correlationId: request.id })
      if (del.error.message.includes('cannot be deleted')) return reply.code(409).send({ error: 'department_delete_blocked', correlationId: request.id })
      throw del.error
    }
    // PostgREST reports no error when RLS filters the target row out of a DELETE -- it simply
    // matches zero rows (see supabase/tests' pgTAP regression for this). Without checking the
    // returned row count, a caller without department.manage in this row's scope would see a
    // misleading 204 for a department that still exists (found in this package's review).
    if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: existing.data.organization_id,
      actor_user_id: request.auth!.userId,
      action: 'department.deleted',
      entity_type: 'departments',
      entity_id: params.id,
      correlation_id: request.id,
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(204).send()
  })

  app.post('/v1/departments/:id/teams', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateTeamRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const department = await client.from('departments').select('organization_id').eq('id', params.id).maybeSingle()
    if (department.error) throw department.error
    if (!department.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'team.manage', { organizationId: department.data.organization_id as string, departmentId: params.id }))) return
    const insert = await client
      .from('teams')
      .insert({ organization_id: department.data.organization_id, department_id: params.id, name: input.name })
      .select('id, organization_id, department_id, name, age_group, competition, source_id, archived_at, created_at')
      .single()
    if (insert.error) throw insert.error
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: department.data.organization_id,
      actor_user_id: request.auth!.userId,
      action: 'team.created',
      entity_type: 'teams',
      entity_id: insert.data.id,
      correlation_id: request.id,
      metadata: { name: input.name, departmentId: params.id },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(201).send(TeamSchema.parse(mapTeamRow(insert.data)))
  })

  app.patch('/v1/teams/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateTeamRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('teams').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'team.manage', { organizationId: existing.data.organization_id as string, departmentId: existing.data.department_id as string }))) return
    const payload: Record<string, unknown> = {}
    if (input.name !== undefined) payload.name = input.name
    if (input.archived !== undefined) payload.archived_at = input.archived ? new Date().toISOString() : null
    const update = await client.from('teams').update(payload).eq('id', params.id).select('id, organization_id, department_id, name, age_group, competition, source_id, archived_at, created_at').single()
    if (update.error) throw update.error
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: existing.data.organization_id,
      actor_user_id: request.auth!.userId,
      action: 'team.updated',
      entity_type: 'teams',
      entity_id: params.id,
      correlation_id: request.id,
      metadata: payload,
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(200).send(TeamSchema.parse(mapTeamRow(update.data)))
  })

  app.delete('/v1/teams/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('teams').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'team.manage', { organizationId: existing.data.organization_id as string, departmentId: existing.data.department_id as string }))) return
    const del = await client.from('teams').delete().eq('id', params.id).select('id')
    if (del.error) {
      if (del.error.message.includes('cannot be deleted')) return reply.code(409).send({ error: 'team_delete_blocked', correlationId: request.id })
      throw del.error
    }
    if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: existing.data.organization_id,
      actor_user_id: request.auth!.userId,
      action: 'team.deleted',
      entity_type: 'teams',
      entity_id: params.id,
      correlation_id: request.id,
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(204).send()
  })

  // --- Richtlinien mit Vererbung (Paket 023) --------------------------------------------

  async function fetchPolicyRows(client: SupabaseClient, organizationId: string) {
    const rows = await client
      .from('policy_settings')
      .select('scope, department_id, team_id, invite_allowed, posts_visible_org_wide')
      .eq('organization_id', organizationId)
    if (rows.error) throw rows.error
    const orgRow = rows.data.find((row) => row.scope === 'organization') ?? null
    const deptRowById = new Map(rows.data.filter((row) => row.scope === 'department').map((row) => [row.department_id as string, row]))
    const teamRowById = new Map(rows.data.filter((row) => row.scope === 'team').map((row) => [row.team_id as string, row]))
    return { orgRow, deptRowById, teamRowById }
  }

  function buildPolicySetting(
    scope: ScopeLevel,
    scopeId: string,
    name: string,
    ownRow: { invite_allowed: boolean | null; posts_visible_org_wide: boolean | null } | null,
    ancestorInviteAllowed: boolean,
    ancestorPostsVisible: boolean,
    canEdit: boolean,
  ) {
    return PolicySettingSchema.parse({
      scope,
      scopeId,
      name,
      inviteAllowed: resolvePolicyFlagState(ancestorInviteAllowed, ownRow?.invite_allowed ?? null, canEdit),
      postsVisibleOrgWide: resolvePolicyFlagState(ancestorPostsVisible, ownRow?.posts_visible_org_wide ?? null, canEdit),
    })
  }

  // Eine befristete Mitgliedschaft oder Befreiung ist nach expires_at wirkungslos. Jede Abfrage auf
  // organization_memberships/department_memberships/team_memberships/member_review_trust, deren
  // Ergebnis eine Berechtigung traegt, filtert damit -- dieselbe Bedingung, die die authz-Funktionen
  // in SQL verwenden ("expires_at is null or expires_at > now()"). Als gemeinsamer Helfer, damit die
  // Stellen nicht auseinanderlaufen (beim Review dieses Pakets gefunden: drei Stellen ohne Filter).
  function notExpiredFilter(): string {
    return `expires_at.is.null,expires_at.gt.${new Date().toISOString()}`
  }

  // Deckt dieselbe Mitgliedschaft ab wie authz.is_any_member_of_organization (RLS-Grundlage von
  // policy_settings_select): Organisationsrolle ODER Abteilungs- ODER Teammitgliedschaft, nicht
  // nur eine Organisationsrolle wie roleProvider.rolesForScope(..., { organizationId }) allein
  // prueft.
  async function isAnyMemberOfOrganization(client: SupabaseClient, userId: string, organizationId: string): Promise<boolean> {
    const notExpired = notExpiredFilter()
    const [org, department, team] = await Promise.all([
      client.from('organization_memberships').select('id').eq('organization_id', organizationId).eq('user_id', userId).or(notExpired).limit(1),
      client.from('department_memberships').select('id').eq('organization_id', organizationId).eq('user_id', userId).or(notExpired).limit(1),
      client.from('team_memberships').select('id').eq('organization_id', organizationId).eq('user_id', userId).or(notExpired).limit(1),
    ])
    if (org.error) throw org.error
    if (department.error) throw department.error
    if (team.error) throw team.error
    return org.data.length > 0 || department.data.length > 0 || team.data.length > 0
  }

  // Dieselbe Form wie die inline geschriebenen audit_events-Inserts weiter oben in dieser Datei
  // (Service-Client, weil audit_events fuer authenticated keine INSERT-Policy hat; Fehler werden
  // geloggt, nicht geworfen -- ein fehlgeschlagener Audit-Eintrag darf die bereits durchgefuehrte
  // Aenderung nicht nachtraeglich als Fehler ausgeben). Als Helfer, weil die Kanal- und
  // Prueferrouten unten acht gleichartige Aufrufer haetten.
  async function recordAuditEvent(
    request: FastifyRequest,
    event: { organizationId: string; action: string; entityType: string; entityId: string | null; metadata?: Record<string, unknown> },
  ): Promise<void> {
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: event.organizationId,
      actor_user_id: request.auth!.userId,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId,
      correlation_id: request.id,
      metadata: event.metadata ?? {},
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
  }

  app.get('/v1/organizations/:id/policy-settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    // organizations_select_member verlangt eine Organisationsrolle -- ein reiner Abteilungs- oder
    // Team-Admin ohne Organisationsrolle (der Richtlinien fuer seine eigene Ebene durchaus sehen
    // und setzen darf) saehe hier sonst "not found" statt seiner eigenen Einstellungen (beim
    // Rechte-Review dieses Pakets gefunden). Der Name ist ohnehin nicht sensibel -- authz.
    // membership_scopes() liefert ihn schon heute jedem Mitglied unabhaengig von der Rolle. Die
    // Mitgliedschaftspruefung oben laeuft davor, damit kein Nicht-Mitglied ueberhaupt bis hierher
    // kommt.
    const organization = await supabaseClients.forService().from('organizations').select('name').eq('id', params.id).maybeSingle()
    if (organization.error) throw organization.error
    if (!organization.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const [departments, teams, policyRows] = await Promise.all([
      client.from('departments').select('id, name').eq('organization_id', params.id).order('name'),
      client.from('teams').select('id, name, department_id').eq('organization_id', params.id).order('name'),
      fetchPolicyRows(client, params.id),
    ])
    if (departments.error) throw departments.error
    if (teams.error) throw teams.error
    const { orgRow, deptRowById, teamRowById } = policyRows

    const orgInviteAllowed = orgRow?.invite_allowed ?? true
    const orgPostsVisible = orgRow?.posts_visible_org_wide ?? true

    // Eine Ebene wird fuer die Rollenermittlung nur einmal nachgeschlagen, nach demselben Muster
    // wie rolesByScopeKey in GET /v1/organizations/:id/members -- sonst loest buildPolicySetting
    // pro Eintrag einen eigenen rolesForScope-Aufruf aus (51 Aufrufe bei 10 Abteilungen/40 Teams).
    const rolesByScopeKey = new Map<string, readonly Role[]>()
    rolesByScopeKey.set('organization', await roleProvider.rolesForScope(request.auth!, { organizationId: params.id }))
    await Promise.all([
      ...departments.data.map(async (department) => {
        rolesByScopeKey.set(`department:${department.id}`, await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId: department.id as string }))
      }),
      ...teams.data.map(async (team) => {
        rolesByScopeKey.set(
          `team:${team.id}`,
          await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId: team.department_id as string, teamId: team.id as string }),
        )
      }),
    ])
    const canEditFor = (scope: ScopeLevel, scopeId: string) => {
      const roles = rolesByScopeKey.get(scope === 'organization' ? 'organization' : `${scope}:${scopeId}`) ?? []
      return hasPermission(roles, POLICY_MANAGE_PERMISSION[scope])
    }

    const entries = [
      buildPolicySetting('organization', params.id, organization.data.name as string, orgRow, true, true, canEditFor('organization', params.id)),
      ...departments.data.map((department) => {
        const ownRow = deptRowById.get(department.id as string) ?? null
        return buildPolicySetting('department', department.id as string, department.name as string, ownRow, orgInviteAllowed, orgPostsVisible, canEditFor('department', department.id as string))
      }),
      ...teams.data.map((team) => {
        const ownRow = teamRowById.get(team.id as string) ?? null
        const deptRow = deptRowById.get(team.department_id as string) ?? null
        const ancestorInviteAllowed = orgInviteAllowed && (deptRow?.invite_allowed ?? true)
        const ancestorPostsVisible = orgPostsVisible && (deptRow?.posts_visible_org_wide ?? true)
        return buildPolicySetting('team', team.id as string, team.name as string, ownRow, ancestorInviteAllowed, ancestorPostsVisible, canEditFor('team', team.id as string))
      }),
    ]
    return reply.code(200).send(entries)
  })

  app.put('/v1/policy-settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UpdatePolicySettingRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return
    const rpc = await client.rpc('set_policy_setting', {
      target_organization_id: scope.organizationId,
      target_scope: input.scope,
      target_department_id: scope.departmentId ?? null,
      target_team_id: scope.teamId ?? null,
      target_flag: input.flag,
      target_value: input.value,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      // Paket 012: allow_department_owned_channels/require_channel_responsible sind nur auf
      // Vereinsebene sinnvoll -- set_policy_setting() lehnt einen anderen target_scope selbst ab
      // (dieselbe Lehre wie bei request_approval/schedule_publication: die RPC leitet
      // sicherheitsrelevante Werte selbst her statt sie vom Aufrufer zu uebernehmen).
      if (rpc.error.message.includes('organization_only_flag')) return reply.code(422).send({ error: 'organization_only_flag', correlationId: request.id })
      throw rpc.error
    }
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId,
      actor_user_id: request.auth!.userId,
      action: 'policy_setting.changed',
      entity_type: 'policy_settings',
      entity_id: rpc.data.id,
      correlation_id: request.id,
      metadata: { scope: input.scope, scopeId: input.scopeId, flag: input.flag, value: input.value },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

    // Service-Client aus demselben Grund wie im GET-Pendant oben: organizations_select_member
    // verlangt eine Organisationsrolle, die ein Abteilungs-/Team-Admin hier nicht hat.
    const [organization, policyRows] = await Promise.all([
      supabaseClients.forService().from('organizations').select('name').eq('id', scope.organizationId).single(),
      fetchPolicyRows(client, scope.organizationId),
    ])
    if (organization.error) throw organization.error
    const { orgRow, deptRowById } = policyRows
    const orgInviteAllowed = orgRow?.invite_allowed ?? true
    const orgPostsVisible = orgRow?.posts_visible_org_wide ?? true
    let name = organization.data.name as string
    let ownRow: { invite_allowed: boolean | null; posts_visible_org_wide: boolean | null } | null = orgRow
    let ancestorInviteAllowed = true
    let ancestorPostsVisible = true
    if (input.scope !== 'organization') {
      const department = await client.from('departments').select('name').eq('id', scope.departmentId!).single()
      if (department.error) throw department.error
      name = department.data.name as string
      ownRow = policyRows.deptRowById.get(scope.departmentId!) ?? null
      ancestorInviteAllowed = orgInviteAllowed
      ancestorPostsVisible = orgPostsVisible
      if (input.scope === 'team') {
        const team = await client.from('teams').select('name').eq('id', scope.teamId!).single()
        if (team.error) throw team.error
        name = team.data.name as string
        ownRow = policyRows.teamRowById.get(scope.teamId!) ?? null
        const deptRow = deptRowById.get(scope.departmentId!) ?? null
        ancestorInviteAllowed = orgInviteAllowed && (deptRow?.invite_allowed ?? true)
        ancestorPostsVisible = orgPostsVisible && (deptRow?.posts_visible_org_wide ?? true)
      }
    }
    // canEdit ist hier immer true: requirePermission oben hat POLICY_MANAGE_PERMISSION[input.scope]
    // fuer genau diesen Scope bereits bestaetigt, ein erneuter rolesForScope-Aufruf waere redundant.
    return reply.code(200).send(buildPolicySetting(input.scope, input.scopeId, name, ownRow, ancestorInviteAllowed, ancestorPostsVisible, true))
  })

  // --- Paket 011: Freigaberouten, Vertrauen je Mitglied, Kontingente -------------------------

  const POLICY_RULE_COLUMNS =
    'id, submit_requires_permission, review_required, review_mode, review_stage_label, review_minimum_approvals, review_deadline_hours, minor_approval_required, self_approval_allowed, allow_same_reviewer_across_stages, allow_review_exemptions, media_requires_consent_check, allowed_presets, allowed_formats, allowed_channel_ids, forbidden_topics, required_hashtags, tone, consent_expires_on_leave, consent_validity_months'
  interface PolicyRuleRow {
    id: string
    review_required: boolean | null
    review_mode: 'any_with_permission' | 'named' | null
    review_stage_label: string | null
    review_minimum_approvals: number | null
    review_deadline_hours: number | null
    minor_approval_required: boolean | null
    self_approval_allowed: boolean | null
    allow_same_reviewer_across_stages: boolean | null
    allow_review_exemptions: boolean | null
    media_requires_consent_check: boolean | null
    allowed_presets: string[] | null
    allowed_formats: OutputFormat[] | null
    allowed_channel_ids: string[] | null
    forbidden_topics: string[]
    required_hashtags: string[]
    tone: string | null
    // Paket 015: consent_expires_on_leave ist Vererbungssemantik (mergeEffectiveConfig), analog zu
    // media_requires_consent_check; consent_validity_months ist knotenlokal wie
    // review_minimum_approvals -- own/effective in mapConfigToRuleValues unten sind identisch.
    consent_expires_on_leave: boolean | null
    consent_validity_months: number | null
  }

  // Alle Regelzeilen einer Organisation in EINER Abfrage, indiziert je Ebene -- dasselbe Muster wie
  // fetchPolicyRows fuer die zwei booleschen Flags aus 023. Eine Auflösung je Ebene mit eigener
  // Abfrage erzeugte ueber alle Ebenen hinweg eine N+1-Kette (bei 10 Abteilungen und 40 Teams 141
  // Abfragen auf policy_settings allein, beim Review dieses Pakets gefunden).
  interface PolicyRuleRows {
    orgRow: PolicyRuleRow | null
    deptRowById: Map<string, PolicyRuleRow>
    teamRowById: Map<string, PolicyRuleRow>
  }

  async function fetchPolicyRuleRows(client: SupabaseClient, organizationId: string): Promise<PolicyRuleRows> {
    const rows = await client.from('policy_settings').select(`${POLICY_RULE_COLUMNS}, scope, department_id, team_id`).eq('organization_id', organizationId)
    if (rows.error) throw rows.error
    const data = rows.data as (PolicyRuleRow & { scope: ScopeLevel; department_id: string | null; team_id: string | null })[]
    return {
      orgRow: data.find((row) => row.scope === 'organization') ?? null,
      deptRowById: new Map(data.filter((row) => row.scope === 'department').map((row) => [row.department_id as string, row])),
      teamRowById: new Map(data.filter((row) => row.scope === 'team').map((row) => [row.team_id as string, row])),
    }
  }

  function ownPolicyRuleRow(rows: PolicyRuleRows, scope: ScopeLevel, departmentId: string | null, teamId: string | null): PolicyRuleRow | null {
    if (scope === 'organization') return rows.orgRow
    if (scope === 'department') return rows.deptRowById.get(departmentId!) ?? null
    return rows.teamRowById.get(teamId!) ?? null
  }

  // Nur die Felder mit echter Vererbungssemantik fliessen in mergeEffectiveConfig ein.
  // review_required/review_mode/review_stage_label/review_minimum_approvals/review_deadline_hours
  // und allow_review_exemptions sind additiv/knotenlokal (Plan 011, "Freigabestufen: additiv") --
  // sie werden direkt aus der eigenen Zeile gelesen, nicht ueber Ebenen gemischt.
  function toRuleOverride(row: PolicyRuleRow | null): ConfigOverride {
    if (!row) return {}
    return {
      policies: {
        ...(row.review_required !== null ? { approvalRequired: row.review_required } : {}),
        ...(row.minor_approval_required !== null ? { minorApprovalRequired: row.minor_approval_required } : {}),
        forbiddenTopics: row.forbidden_topics,
        requiredHashtags: row.required_hashtags,
        ...(row.self_approval_allowed !== null ? { selfApprovalAllowed: row.self_approval_allowed } : {}),
        ...(row.allow_same_reviewer_across_stages !== null ? { allowSameReviewerAcrossStages: row.allow_same_reviewer_across_stages } : {}),
        ...(row.media_requires_consent_check !== null ? { mediaRequiresConsentCheck: row.media_requires_consent_check } : {}),
        ...(row.consent_expires_on_leave !== null ? { consentExpiresOnLeave: row.consent_expires_on_leave } : {}),
        allowedPresets: row.allowed_presets,
        allowedFormats: row.allowed_formats,
        allowedChannelIds: row.allowed_channel_ids,
      },
    }
  }

  function mapOwnRowToRuleValues(row: PolicyRuleRow | null): PolicyRuleValues {
    return {
      reviewRequired: row?.review_required ?? null,
      reviewMode: row?.review_mode ?? null,
      reviewStageLabel: row?.review_stage_label ?? null,
      reviewMinimumApprovals: row?.review_minimum_approvals ?? null,
      reviewDeadlineHours: row?.review_deadline_hours ?? null,
      minorApprovalRequired: row?.minor_approval_required ?? null,
      selfApprovalAllowed: row?.self_approval_allowed ?? null,
      allowSameReviewerAcrossStages: row?.allow_same_reviewer_across_stages ?? null,
      allowReviewExemptions: row?.allow_review_exemptions ?? null,
      mediaRequiresConsentCheck: row?.media_requires_consent_check ?? null,
      consentExpiresOnLeave: row?.consent_expires_on_leave ?? null,
      consentValidityMonths: row?.consent_validity_months ?? null,
      allowedPresets: row?.allowed_presets ?? null,
      allowedFormats: row?.allowed_formats ?? null,
      allowedChannelIds: row?.allowed_channel_ids ?? null,
      forbiddenTopics: row?.forbidden_topics ?? [],
      requiredHashtags: row?.required_hashtags ?? [],
      tone: row?.tone ?? null,
    }
  }

  function mapConfigToRuleValues(config: ReturnType<typeof resolveEffectiveConfig>, ownRow: PolicyRuleRow | null): PolicyRuleValues {
    return {
      reviewRequired: ownRow?.review_required ?? null,
      reviewMode: ownRow?.review_mode ?? null,
      reviewStageLabel: ownRow?.review_stage_label ?? null,
      reviewMinimumApprovals: ownRow?.review_minimum_approvals ?? null,
      reviewDeadlineHours: ownRow?.review_deadline_hours ?? null,
      minorApprovalRequired: config.policies.minorApprovalRequired,
      selfApprovalAllowed: config.policies.selfApprovalAllowed,
      allowSameReviewerAcrossStages: config.policies.allowSameReviewerAcrossStages,
      allowReviewExemptions: ownRow?.allow_review_exemptions ?? null,
      mediaRequiresConsentCheck: config.policies.mediaRequiresConsentCheck,
      consentExpiresOnLeave: config.policies.consentExpiresOnLeave,
      // Knotenlokal wie reviewMinimumApprovals (own-Zeile, keine Vererbung ueber Ebenen) --
      // die echte Abteilungs-/Vereins-Rueckfallkette fuer die Registratur-Vorbelegung loest
      // resolveConsentValidityMonths separat auf (POST /v1/consents), nicht hier.
      consentValidityMonths: ownRow?.consent_validity_months ?? null,
      allowedPresets: config.policies.allowedPresets ? [...config.policies.allowedPresets] : null,
      allowedFormats: config.policies.allowedFormats ? ([...config.policies.allowedFormats] as OutputFormat[]) : null,
      allowedChannelIds: config.policies.allowedChannelIds ? [...config.policies.allowedChannelIds] : null,
      forbiddenTopics: [...config.policies.forbiddenTopics],
      requiredHashtags: [...config.policies.requiredHashtags],
      tone: config.tone ?? null,
    }
  }

  // Loest die effektive Konfiguration einer Ebene aus den bereits geladenen Regelzeilen auf, indem
  // sie die Kette Verein -> (Abteilung) -> (Team) durchlaeuft (Plan 011 gilt fuer GET-alle wie
  // PUT-eine-Ebene gleich).
  function computeRuleEntry(
    rows: PolicyRuleRows, scope: ScopeLevel, scopeId: string, departmentIdForTeam: string | null,
  ): { ownRow: PolicyRuleRow | null; config: ReturnType<typeof resolveEffectiveConfig> } {
    let config = resolveEffectiveConfig(toRuleOverride(rows.orgRow))
    let ownRow = rows.orgRow
    if (scope !== 'organization') {
      const departmentId = scope === 'department' ? scopeId : departmentIdForTeam!
      const departmentRow = ownPolicyRuleRow(rows, 'department', departmentId, null)
      config = mergeEffectiveConfig(config, toRuleOverride(departmentRow))
      ownRow = departmentRow
      if (scope === 'team') {
        const teamRow = ownPolicyRuleRow(rows, 'team', departmentId, scopeId)
        config = mergeEffectiveConfig(config, toRuleOverride(teamRow))
        ownRow = teamRow
      }
    }
    return { ownRow, config }
  }

  const REVIEWER_COLUMNS = 'id, policy_settings_id, kind, user_id, role, target_department_id, target_team_id, created_at'
  type ReviewerRow = { id: string; policy_settings_id: string; kind: string; user_id: string | null; role: string | null; target_department_id: string | null; target_team_id: string | null; created_at: string }

  function mapPolicyReviewer(row: ReviewerRow, scope: ScopeLevel, scopeId: string) {
    return PolicyReviewerSchema.parse({
      id: row.id, scope, scopeId, kind: row.kind, userId: row.user_id, role: row.role,
      targetDepartmentId: row.target_department_id, targetTeamId: row.target_team_id, createdAt: row.created_at,
    })
  }

  async function reviewersForPolicySettings(client: SupabaseClient, policySettingsId: string | undefined, scope: ScopeLevel, scopeId: string) {
    if (!policySettingsId) return []
    const rows = await client.from('policy_reviewers').select(REVIEWER_COLUMNS).eq('policy_settings_id', policySettingsId)
    if (rows.error) throw rows.error
    return (rows.data as ReviewerRow[]).map((row) => mapPolicyReviewer(row, scope, scopeId))
  }

  async function resolveScopedEffectiveConfig(client: SupabaseClient, organizationId: string, departmentId: string, teamId: string | null) {
    const rows = await fetchPolicyRuleRows(client, organizationId)
    return computeRuleEntry(rows, teamId ? 'team' : 'department', teamId ?? departmentId, departmentId).config
  }

  async function fetchMemberTrust(
    client: SupabaseClient, userId: string, organizationId: string, departmentId: string, teamId: string | null,
  ): Promise<TrustRecord[]> {
    // Eine abgelaufene Befreiung darf keine Freigabestufe mehr entfernen -- deshalb derselbe
    // Ablauffilter wie bei den Mitgliedschaften (beim Review dieses Pakets gefunden).
    const rows = await client
      .from('member_review_trust')
      .select('scope, department_id, team_id, submit_allowed, review_requirement')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .or(notExpiredFilter())
    if (rows.error) throw rows.error
    return rows.data
      .filter((row) => row.scope === 'organization' || (row.scope === 'department' && row.department_id === departmentId) || (row.scope === 'team' && teamId !== null && row.team_id === teamId))
      .map((row) => ({ scope: row.scope as ScopeLevel, submitAllowed: row.submit_allowed as boolean, reviewRequirement: row.review_requirement as TrustRecord['reviewRequirement'] }))
  }

  app.get('/v1/organizations/:id/policy-rules', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const organization = await supabaseClients.forService().from('organizations').select('name').eq('id', params.id).maybeSingle()
    if (organization.error) throw organization.error
    if (!organization.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const [departments, teams, ruleRows] = await Promise.all([
      client.from('departments').select('id, name').eq('organization_id', params.id).order('name'),
      client.from('teams').select('id, name, department_id').eq('organization_id', params.id).order('name'),
      fetchPolicyRuleRows(client, params.id),
    ])
    if (departments.error) throw departments.error
    if (teams.error) throw teams.error

    // Prueferzuweisungen fuer alle Ebenen in einer Abfrage statt einer je Eintrag, aus demselben
    // Grund wie fetchPolicyRuleRows oben.
    const policySettingsIds = [
      ...(ruleRows.orgRow ? [ruleRows.orgRow.id] : []),
      ...Array.from(ruleRows.deptRowById.values()).map((row) => row.id),
      ...Array.from(ruleRows.teamRowById.values()).map((row) => row.id),
    ]
    const reviewersByPolicySettingsId = new Map<string, ReviewerRow[]>()
    if (policySettingsIds.length > 0) {
      const reviewerRows = await client.from('policy_reviewers').select(REVIEWER_COLUMNS).in('policy_settings_id', policySettingsIds)
      if (reviewerRows.error) throw reviewerRows.error
      for (const row of reviewerRows.data as ReviewerRow[]) {
        const bucket = reviewersByPolicySettingsId.get(row.policy_settings_id) ?? []
        bucket.push(row)
        reviewersByPolicySettingsId.set(row.policy_settings_id, bucket)
      }
    }

    const rolesByScopeKey = new Map<string, readonly Role[]>()
    rolesByScopeKey.set('organization', await roleProvider.rolesForScope(request.auth!, { organizationId: params.id }))
    await Promise.all([
      ...departments.data.map(async (department) => {
        rolesByScopeKey.set(`department:${department.id}`, await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId: department.id as string }))
      }),
      ...teams.data.map(async (team) => {
        rolesByScopeKey.set(`team:${team.id}`, await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId: team.department_id as string, teamId: team.id as string }))
      }),
    ])
    const canEditFor = (scope: ScopeLevel, scopeId: string) => hasPermission(rolesByScopeKey.get(scope === 'organization' ? 'organization' : `${scope}:${scopeId}`) ?? [], POLICY_MANAGE_PERMISSION[scope])

    function buildEntry(scope: ScopeLevel, scopeId: string, name: string, departmentIdForTeam: string | null) {
      const { ownRow, config } = computeRuleEntry(ruleRows, scope, scopeId, departmentIdForTeam)
      return PolicyRuleSettingSchema.parse({
        scope, scopeId, name,
        own: mapOwnRowToRuleValues(ownRow),
        effective: mapConfigToRuleValues(config, ownRow),
        canEdit: canEditFor(scope, scopeId),
        reviewers: (ownRow ? reviewersByPolicySettingsId.get(ownRow.id) ?? [] : []).map((row) => mapPolicyReviewer(row, scope, scopeId)),
      })
    }

    const entries = [
      buildEntry('organization', params.id, organization.data.name as string, null),
      ...departments.data.map((department) => buildEntry('department', department.id as string, department.name as string, null)),
      ...teams.data.map((team) => buildEntry('team', team.id as string, team.name as string, team.department_id as string)),
    ]
    return reply.code(200).send(entries)
  })

  app.put('/v1/policy-rules', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UpdatePolicyRulesRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return
    const rpc = await client.rpc('set_policy_rules', {
      target_organization_id: scope.organizationId, target_scope: input.scope,
      target_department_id: scope.departmentId ?? null, target_team_id: scope.teamId ?? null,
      patch: input.patch,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('unknown_policy_rule_field')) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      // 23514 = check_violation. Zod kann die Kombination reviewMode='named'/reviewRequired nur
      // innerhalb DESSELBEN patch pruefen -- ein frueherer Patch koennte reviewRequired bereits
      // gesetzt haben, ein spaeterer patch={reviewMode:'named'} allein sieht dann fuer Zod
      // vollstaendig gueltig aus und verletzt erst am policy_settings_named_requires_review-Check
      // (beim Vertraege-Review als 500 statt 400 gefunden).
      if (rpc.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw rpc.error
    }
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId, actor_user_id: request.auth!.userId, action: 'policy_rules.changed',
      entity_type: 'policy_settings', entity_id: rpc.data.id, correlation_id: request.id,
      metadata: { scope: input.scope, scopeId: input.scopeId, patch: input.patch },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

    const departmentIdForTeam = input.scope === 'team' ? scope.departmentId! : null
    const { ownRow, config } = computeRuleEntry(await fetchPolicyRuleRows(client, scope.organizationId), input.scope, input.scopeId, departmentIdForTeam)
    // .error jeder Namensabfrage einzeln pruefen, wie an jeder anderen Stelle dieser Datei: ohne die
    // Pruefung waere name bei einem Datenbankfehler undefined, PolicyRuleSettingSchema.parse wuerfe
    // einen ZodError, und der Error-Handler antwortete mit 400 invalid_request auf einen
    // Datenbankfehler (beim Review dieses Pakets gefunden).
    const nameQuery =
      input.scope === 'organization'
        ? await supabaseClients.forService().from('organizations').select('name').eq('id', scope.organizationId).single()
        : input.scope === 'department'
          ? await client.from('departments').select('name').eq('id', scope.departmentId!).single()
          : await client.from('teams').select('name').eq('id', scope.teamId!).single()
    if (nameQuery.error) throw nameQuery.error
    const name = nameQuery.data.name as string

    return reply.code(200).send(
      PolicyRuleSettingSchema.parse({
        scope: input.scope, scopeId: input.scopeId, name,
        own: mapOwnRowToRuleValues(ownRow),
        effective: mapConfigToRuleValues(config, ownRow),
        canEdit: true,
        reviewers: await reviewersForPolicySettings(client, ownRow?.id, input.scope, input.scopeId),
      }),
    )
  })

  // Reviewer-Referenzen sind eng an eine policy_settings-Zeile gebunden -- fehlt sie fuer diesen
  // Scope noch, wird sie ueber set_policy_rules mit einem leeren Patch angelegt (dieselbe
  // Race-sichere Select-fuer-Update-dann-Upsert-Logik wie beim eigentlichen Schreiben von Regeln).
  app.post('/v1/policy-reviewers', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreatePolicyReviewerRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return

    const ensured = await client.rpc('set_policy_rules', {
      target_organization_id: scope.organizationId, target_scope: input.scope,
      target_department_id: scope.departmentId ?? null, target_team_id: scope.teamId ?? null, patch: {},
    })
    if (ensured.error) {
      if (ensured.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      throw ensured.error
    }

    const ref: ReviewerRef = input.ref
    const row: Record<string, unknown> = {
      organization_id: scope.organizationId, policy_settings_id: ensured.data.id, kind: ref.kind, created_by: request.auth!.userId,
      user_id: ref.kind === 'user' ? ref.userId : null,
      role: ref.kind === 'user' ? null : ref.role,
      target_department_id: ref.kind === 'department_role' || ref.kind === 'team_role' ? ref.departmentId : null,
      target_team_id: ref.kind === 'team_role' ? ref.teamId : null,
    }
    const insert = await client.from('policy_reviewers').insert(row).select('id, kind, user_id, role, target_department_id, target_team_id, created_at').single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'already_a_reviewer', correlationId: request.id })
      // 23503 = foreign_key_violation: eine department_role/team_role-Referenz mit einer
      // departmentId/teamId, die nicht existiert (Fremdschluessel schuetzt bereits gegen eine
      // fremde Organisation, siehe Migration -- das hier ist der Tippfehler-/Vertraege-Fall).
      if (insert.error.code === '23503') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'policy_reviewer.added',
      entityType: 'policy_reviewers',
      entityId: insert.data.id as string,
      metadata: { scope: input.scope, scopeId: input.scopeId, kind: ref.kind },
    })
    return reply.code(201).send(
      PolicyReviewerSchema.parse({
        id: insert.data.id, scope: input.scope, scopeId: input.scopeId, kind: insert.data.kind, userId: insert.data.user_id,
        role: insert.data.role, targetDepartmentId: insert.data.target_department_id, targetTeamId: insert.data.target_team_id, createdAt: insert.data.created_at,
      }),
    )
  })

  app.delete('/v1/policy-reviewers/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('policy_reviewers').select('policy_settings_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const setting = await client.from('policy_settings').select('scope, department_id, team_id, organization_id').eq('id', existing.data.policy_settings_id).single()
    if (setting.error) throw setting.error
    const scope = toPermissionScope(setting.data.organization_id as string, setting.data.department_id as string | null, setting.data.team_id as string | null)
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[setting.data.scope as ScopeLevel], scope))) return
    const del = await client.from('policy_reviewers').delete().eq('id', params.id).select('id')
    if (del.error) throw del.error
    if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: setting.data.organization_id as string,
      action: 'policy_reviewer.removed',
      entityType: 'policy_reviewers',
      entityId: params.id,
      metadata: { scope: setting.data.scope, policySettingsId: existing.data.policy_settings_id },
    })
    return reply.code(204).send()
  })

  // Wie die beiden Policy-Routen oben: ein Nicht-Mitglied bekommt 403, nicht eine leere Liste.
  // Welche Zeilen ein Mitglied sieht, entscheidet member_review_trust_select -- die eigene Zeile und
  // die Ebenen, die es verwaltet; reason ist damit schon zeilenweise geschuetzt.
  app.get('/v1/organizations/:id/member-review-trust', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const rows = await client
      .from('member_review_trust')
      .select('id, scope, department_id, team_id, user_id, submit_allowed, review_requirement, reason, expires_at')
      .eq('organization_id', params.id)
    if (rows.error) throw rows.error
    return reply.code(200).send(
      rows.data.map((row) =>
        MemberReviewTrustSchema.parse({
          id: row.id, scope: row.scope, scopeId: row.team_id ?? row.department_id ?? params.id, userId: row.user_id,
          submitAllowed: row.submit_allowed, reviewRequirement: row.review_requirement, reason: row.reason, expiresAt: row.expires_at,
        }),
      ),
    )
  })

  app.put('/v1/member-review-trust', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = SetMemberReviewTrustRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return
    const rpc = await client.rpc('set_member_review_trust', {
      target_organization_id: scope.organizationId, target_scope: input.scope,
      target_department_id: scope.departmentId ?? null, target_team_id: scope.teamId ?? null,
      target_user_id: input.userId, target_submit_allowed: input.submitAllowed, target_review_requirement: input.reviewRequirement,
      target_reason: input.reason, target_expires_at: input.expiresAt,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      // Vertrauen fuer eine Person, die diesem Verein nicht angehoert -- user_id traegt keinen
      // zusammengesetzten Fremdschluessel auf den Verein, die RPC prueft es deshalb selbst.
      if (rpc.error.message.includes('user_not_a_member')) return reply.code(422).send({ error: 'user_not_a_member', correlationId: request.id })
      throw rpc.error
    }
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId, actor_user_id: request.auth!.userId, action: 'member_review_trust.changed',
      entity_type: 'member_review_trust', entity_id: rpc.data.id, correlation_id: request.id,
      metadata: { scope: input.scope, scopeId: input.scopeId, userId: input.userId, reviewRequirement: input.reviewRequirement },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(200).send(
      MemberReviewTrustSchema.parse({
        id: rpc.data.id, scope: input.scope, scopeId: input.scopeId, userId: input.userId,
        submitAllowed: rpc.data.submit_allowed, reviewRequirement: rpc.data.review_requirement, reason: rpc.data.reason, expiresAt: rpc.data.expires_at,
      }),
    )
  })

  app.get('/v1/organizations/:id/members', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const [orgRows, deptRows, teamRows] = await Promise.all([
      fetchAllRows<{ id: string; user_id: string; role: string; expires_at: string | null }>((from, to) =>
        client.from('organization_memberships').select('id, user_id, role, expires_at').eq('organization_id', params.id).range(from, to),
      ),
      fetchAllRows<{ id: string; user_id: string; role: string; expires_at: string | null; department_id: string }>((from, to) =>
        client.from('department_memberships').select('id, user_id, role, expires_at, department_id').eq('organization_id', params.id).range(from, to),
      ),
      fetchAllRows<{ id: string; user_id: string; role: string; expires_at: string | null; team_id: string; department_id: string }>((from, to) =>
        client.from('team_memberships').select('id, user_id, role, expires_at, team_id, department_id').eq('organization_id', params.id).range(from, to),
      ),
    ])

    const userIds = new Set<string>()
    for (const row of [...orgRows, ...deptRows, ...teamRows]) userIds.add(row.user_id)
    // Ein einzelnes .in() mit allen Nutzer-IDs waere doppelt begrenzt: max_rows=1000 kappt die
    // Antwort (derselbe Grund wie bei fetchAllRows oben), und die IDs stehen als Query-String in
    // der URL, die schon bei einigen hundert UUIDs die Header-Grenze des Gateways reisst. Ohne
    // Bloecke fielen betroffene Mitglieder still auf "Unbekannt" zurueck.
    const allUserIds = Array.from(userIds)
    const displayNameById = new Map<string, string>()
    for (let offset = 0; offset < allUserIds.length; offset += 100) {
      const profiles = await client.from('profiles').select('id, display_name').in('id', allUserIds.slice(offset, offset + 100))
      if (profiles.error) throw profiles.error
      for (const row of profiles.data) displayNameById.set(row.id as string, row.display_name as string)
    }

    // Capability-Felder (Paket 023): fuer jede eindeutige Ebene in dieser Antwort einmal die
    // Rollen DES ANFRAGENDEN nachschlagen (nicht die des jeweiligen Mitglieds), dann daraus fuer
    // jede Zeile ableiten, ob er sie aendern/entfernen/befristen darf -- dieselben Funktionen, die
    // PATCH/DELETE /v1/memberships selbst durchsetzen. Eine Ebene wird dabei nur einmal
    // nachgeschlagen, auch wenn mehrere Mitglieder ihr angehoeren.
    const rolesByScopeKey = new Map<string, readonly Role[]>()
    rolesByScopeKey.set('organization', await roleProvider.rolesForScope(request.auth!, { organizationId: params.id }))
    const uniqueDepartmentIds = new Set(deptRows.map((row) => row.department_id))
    const uniqueTeams = new Map(teamRows.map((row) => [row.team_id, row.department_id]))
    await Promise.all([
      ...Array.from(uniqueDepartmentIds).map(async (departmentId) => {
        rolesByScopeKey.set(`department:${departmentId}`, await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId }))
      }),
      ...Array.from(uniqueTeams.entries()).map(async ([teamId, departmentId]) => {
        rolesByScopeKey.set(`team:${teamId}`, await roleProvider.rolesForScope(request.auth!, { organizationId: params.id, departmentId, teamId }))
      }),
    ])
    function capabilitiesFor(scope: ScopeLevel, scopeId: string, role: string) {
      const actorRoles = rolesByScopeKey.get(scope === 'organization' ? 'organization' : `${scope}:${scopeId}`) ?? []
      const canRemoveTarget = canRemoveRole(actorRoles, role as Role)
      return {
        canChangeRole: hasPermission(actorRoles, 'member.invite') && canRemoveTarget,
        canSetExpiry: hasPermission(actorRoles, 'member.invite') && canRemoveTarget,
        canRemove: hasPermission(actorRoles, 'member.remove') && canRemoveTarget,
      }
    }

    const membersById = new Map<string, { userId: string; displayName: string; roles: unknown[] }>()
    const addRole = (userId: string, entry: unknown) => {
      const existing = membersById.get(userId)
      if (existing) existing.roles.push(entry)
      else membersById.set(userId, { userId, displayName: displayNameById.get(userId) ?? 'Unbekannt', roles: [entry] })
    }
    for (const row of orgRows) {
      addRole(row.user_id, { membershipId: row.id, scope: 'organization', scopeId: params.id, role: row.role, expiresAt: row.expires_at, ...capabilitiesFor('organization', params.id, row.role) })
    }
    for (const row of deptRows) {
      addRole(row.user_id, { membershipId: row.id, scope: 'department', scopeId: row.department_id, role: row.role, expiresAt: row.expires_at, ...capabilitiesFor('department', row.department_id, row.role) })
    }
    for (const row of teamRows) {
      addRole(row.user_id, { membershipId: row.id, scope: 'team', scopeId: row.team_id, role: row.role, expiresAt: row.expires_at, ...capabilitiesFor('team', row.team_id, row.role) })
    }

    return reply.code(200).send(Array.from(membersById.values()).map((member) => MemberSchema.parse(member)))
  })

  app.post('/v1/memberships', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateMembershipRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    const roles = await roleProvider.rolesForScope(request.auth!, scope)
    if (!canAssignRole(roles, input.role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const table = membershipTableFor(input.scope)
    const row: Record<string, unknown> = { organization_id: scope.organizationId, user_id: input.userId, role: input.role }
    if (input.scope === 'department') row.department_id = input.scopeId
    if (input.scope === 'team') {
      row.department_id = scope.departmentId
      row.team_id = input.scopeId
    }
    const insert = await client.from(table).insert(row).select('id, user_id, role, expires_at').single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'already_a_member', correlationId: request.id })
      if (insert.error.code === '22P02') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      // Anders als die Organisations- und Einladungsroute schreibt diese hier direkt in die
      // Tabelle, laeuft also unmittelbar in den Trigger aus
      // 2026080602_platform_admin_separation.sql.
      if (insert.error.message.includes('platform_admin_cannot_hold_membership')) {
        return reply.code(409).send({ error: 'platform_admin_cannot_hold_membership', correlationId: request.id })
      }
      // requirePermission oben prueft nur die Rolle, nicht `policy_settings.invite_allowed`
      // (Paket 023) -- das ist ausschliesslich in der *_memberships_insert-Policy selbst
      // verdrahtet und kann deshalb erst hier, als abgelehntes Insert, sichtbar werden.
      if (insert.error.code === '42501') return reply.code(403).send({ error: 'invite_not_allowed', correlationId: request.id })
      throw insert.error
    }
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId,
      actor_user_id: request.auth!.userId,
      action: 'membership.created',
      entity_type: table,
      entity_id: insert.data.id,
      correlation_id: request.id,
      metadata: { userId: input.userId, role: input.role, scope: input.scope, scopeId: input.scopeId },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    const canRemoveNewRole = canRemoveRole(roles, insert.data.role as Role)
    return reply.code(201).send(
      MemberRoleEntrySchema.parse({
        membershipId: insert.data.id, scope: input.scope, scopeId: input.scopeId, role: insert.data.role, expiresAt: insert.data.expires_at,
        canChangeRole: hasPermission(roles, 'member.invite') && canRemoveNewRole,
        canSetExpiry: hasPermission(roles, 'member.invite') && canRemoveNewRole,
        canRemove: hasPermission(roles, 'member.remove') && canRemoveNewRole,
      }),
    )
  })

  app.patch('/v1/memberships/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z.object({ scope: ScopeLevelSchema }).parse(request.query)
    const input = UpdateMembershipRequestSchema.parse(request.body)
    // UpdateMembershipRequestSchema traegt scope nicht im Body (das kommt aus der Query) und kann
    // Rolle-gegen-Scope deshalb nicht selbst per superRefine pruefen (anders als
    // CreateMembershipRequestSchema) -- ohne diesen Check waere eine falsche Kombination erst am
    // Enum-Cast beim Insert als ungehandelter 500 sichtbar geworden.
    if (!rolesForScopeLevel(query.scope).includes(input.role)) {
      return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
    }
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const table = membershipTableFor(query.scope)
    const existing = await client.from(table).select('organization_id, department_id, team_id, user_id, role').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    const roles = await roleProvider.rolesForScope(request.auth!, scope)
    // Ein Rollenwechsel ist intern Delete+Insert (siehe Plan 010) -- ohne canRemoveRole gegen die
    // AKTUELLE Rolle koennte z. B. ein organization_admin einen organization_owner degradieren,
    // obwohl canAssignRole eine Neuzuweisung von organization_owner korrekt verweigert (beim
    // Rechte-Review dieses Pakets gefunden).
    if (!canRemoveRole(roles, existing.data.role as Role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    if (!canAssignRole(roles, input.role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    // Delete+Insert als zwei getrennte PostgREST-Aufrufe war nicht atomar: ein fehlschlagender
    // Insert liess die bereits geloeschte alte Mitgliedschaft verloren zurueck, ein durch RLS
    // still gefiltertes Delete fuehrte zu zwei gleichzeitigen Mitgliedschaften (beim
    // Vertraege-Review dieses Pakets gefunden). change_membership_role fuehrt beide Schritte in
    // einer Transaktion aus und wiederholt dieselben Berechtigungs-/Rang-Checks server-seitig.
    const rpc = await client.rpc('change_membership_role', {
      target_scope: query.scope,
      target_membership_id: params.id,
      target_role: input.role,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('cannot be removed')) return reply.code(409).send({ error: 'cannot_remove_last_owner', correlationId: request.id })
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw rpc.error
    }
    const result = rpc.data as { membershipId: string; userId: string; role: string; expiresAt: string | null; fromRole: string }
    const scopeId = query.scope === 'organization' ? scope.organizationId : query.scope === 'department' ? scope.departmentId! : (existing.data.team_id as string)
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId,
      actor_user_id: request.auth!.userId,
      action: 'membership.role_changed',
      entity_type: table,
      entity_id: result.membershipId,
      correlation_id: request.id,
      metadata: { userId: result.userId, fromRole: result.fromRole, toRole: result.role, scope: query.scope, scopeId },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    const canRemoveNewRole = canRemoveRole(roles, result.role as Role)
    return reply.code(200).send(
      MemberRoleEntrySchema.parse({
        membershipId: result.membershipId, scope: query.scope, scopeId, role: result.role, expiresAt: result.expiresAt,
        canChangeRole: hasPermission(roles, 'member.invite') && canRemoveNewRole,
        canSetExpiry: hasPermission(roles, 'member.invite') && canRemoveNewRole,
        canRemove: hasPermission(roles, 'member.remove') && canRemoveNewRole,
      }),
    )
  })

  // Getrennt von PATCH /v1/memberships/:id (Paket 023): eine Befristung zu setzen erfordert nicht
  // die can_assign_role-Pruefung einer neuen Rolle, siehe public.set_membership_expiry().
  app.patch('/v1/memberships/:id/expiry', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z.object({ scope: ScopeLevelSchema }).parse(request.query)
    const input = UpdateMembershipExpiryRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const table = membershipTableFor(query.scope)
    const existing = await client.from(table).select('organization_id, department_id, team_id, user_id, role').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    const roles = await roleProvider.rolesForScope(request.auth!, scope)
    const canRemoveTarget = canRemoveRole(roles, existing.data.role as Role)
    if (!canRemoveTarget) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const rpc = await client.rpc('set_membership_expiry', {
      target_scope: query.scope,
      target_membership_id: params.id,
      target_expires_at: input.expiresAt,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('cannot be removed')) return reply.code(409).send({ error: 'cannot_remove_last_owner', correlationId: request.id })
      throw rpc.error
    }
    const result = rpc.data as { membershipId: string; expiresAt: string | null }
    const scopeId = query.scope === 'organization' ? scope.organizationId : query.scope === 'department' ? scope.departmentId! : (existing.data.team_id as string)
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId,
      actor_user_id: request.auth!.userId,
      action: 'membership.expiry_changed',
      entity_type: table,
      entity_id: result.membershipId,
      correlation_id: request.id,
      metadata: { userId: existing.data.user_id, expiresAt: result.expiresAt, scope: query.scope, scopeId },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(200).send(
      MemberRoleEntrySchema.parse({
        membershipId: result.membershipId, scope: query.scope, scopeId, role: existing.data.role, expiresAt: result.expiresAt,
        canChangeRole: hasPermission(roles, 'member.invite') && canRemoveTarget,
        canSetExpiry: hasPermission(roles, 'member.invite') && canRemoveTarget,
        canRemove: hasPermission(roles, 'member.remove') && canRemoveTarget,
      }),
    )
  })

  app.delete('/v1/memberships/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z.object({ scope: ScopeLevelSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const table = membershipTableFor(query.scope)
    const existing = await client.from(table).select('organization_id, department_id, team_id, user_id, role').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'member.remove', scope))) return
    // Siehe PATCH oben: derselbe Rang-gegen-aktuelle-Rolle-Check, sonst kann ein Akteur mit
    // member.remove jemanden entfernen, der maechtiger ist als er selbst.
    const roles = await roleProvider.rolesForScope(request.auth!, scope)
    if (!canRemoveRole(roles, existing.data.role as Role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    // Die verantwortliche Person muss nur ihre Organisationsmitgliedschaft behalten (Paket 009) --
    // dieser Guard darf ein Verlassen/Entfernen aus einem Team oder einer Abteilung nicht
    // blockieren, nur den Austritt aus dem Verein selbst (beim Vertraege-Review gefunden).
    if (query.scope === 'organization') {
      const profile = await client.from('organization_profiles').select('responsible_person_profile_id').eq('organization_id', scope.organizationId).maybeSingle()
      if (profile.error) throw profile.error
      if (profile.data?.responsible_person_profile_id === existing.data.user_id) {
        return reply.code(409).send({ error: 'responsible_person_cannot_be_removed', correlationId: request.id })
      }
    }
    // Presserechtliche Verantwortung (Paket 020) ausserhalb des organization-Zweigs: anders als
    // responsible_person_profile_id gibt es fuer editorial_responsible_profile_id keinen Trigger,
    // der eine Vereinsmitgliedschaft erzwingt -- PATCH /v1/channels/:id akzeptiert jede Person mit
    // IRGENDEINER Mitgliedschaft im Verein (isAnyMemberOfOrganization), auch eine rein
    // abteilungs- oder mannschaftsgebundene. Ein Schutz, der nur beim Entfernen der
    // Vereinsmitgliedschaft greift, liesse genau diese Person ungeschuetzt aus ihrer Abteilung
    // oder Mannschaft entfernen, waehrend sie weiterhin als presserechtlich verantwortlich auf
    // einem Kanal benannt bleibt (adversariale Pruefung) -- deshalb unabhaengig vom angefragten
    // Scope. Service-Client: die RLS-Sichtbarkeit von social_connections darf hier keine Rolle
    // spielen, sonst waere der Schutz per fehlender Kanal-Berechtigung umgehbar.
    const editorialResponsible = await supabaseClients
      .forService()
      .from('social_connections')
      .select('id')
      .eq('organization_id', scope.organizationId)
      .eq('editorial_responsible_profile_id', existing.data.user_id)
      // Ein getrennter/archivierter Kanal veroeffentlicht nichts mehr und traegt keine
      // presserechtliche Verantwortung -- ohne diesen Filter bliebe die benannte Person
      // dauerhaft unentfernbar, weil DELETE /v1/channels/:id die Zeile bewusst stehen laesst.
      .is('archived_at', null)
      .limit(1)
    if (editorialResponsible.error) throw editorialResponsible.error
    if (editorialResponsible.data.length > 0) {
      return reply.code(409).send({ error: 'editorial_responsible_cannot_be_removed', correlationId: request.id })
    }
    const del = await client.from(table).delete().eq('id', params.id).select('id')
    if (del.error) {
      if (del.error.message.includes('cannot be removed')) return reply.code(409).send({ error: 'cannot_remove_last_owner', correlationId: request.id })
      throw del.error
    }
    if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId,
      actor_user_id: request.auth!.userId,
      action: 'membership.removed',
      entity_type: table,
      entity_id: params.id,
      correlation_id: request.id,
      metadata: { userId: existing.data.user_id, role: existing.data.role, scope: query.scope },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(204).send()
  })

  app.get('/v1/organizations/:id/invitations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    // Optionale Scope-Parameter: die RLS-Policy invitations_select_admin erlaubt einem
    // department_admin/team_manager bereits, offene Einladungen der eigenen Abteilung/des
    // eigenen Teams zu sehen -- ohne diese Parameter verlangte diese Route immer
    // organisationsweites member.invite, sodass ein Abteilungsverantwortlicher seine eigenen
    // offenen Einladungen nie auflisten konnte (beim Review dieses Pakets gefunden). Ohne
    // Parameter bleibt das Verhalten unveraendert organisationsweit.
    const query = z.object({ departmentId: UuidSchema.optional(), teamId: UuidSchema.optional() }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // Dieselbe serverseitige Verifikation der Scope-Kette wie in POST /v1/invitations: ohne sie
    // pruefte requirePermission auf einer frei vom Client zusammengesetzten Kette (fremde
    // organizationId plus eigene departmentId) und liess den Aufruf durch. Ein Leck entstand
    // dadurch nur nicht, weil der zusammengesetzte Fremdschluessel auf invitations eine solche
    // Kombination ohnehin auf null Zeilen filtert -- die Sicherheit haengt damit an einem
    // Fremdschluessel statt an einer Pruefung (im Nachfolge-Review dieses PRs gefunden).
    const resolved = await resolveInvitationScope(client, {
      organizationId: params.id,
      departmentId: query.departmentId ?? null,
      teamId: query.teamId ?? null,
    })
    if (!resolved) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'member.invite', resolved.scope))) return
    let invitationsQuery = client
      .from('invitations')
      .select('id, organization_id, department_id, team_id, email, role, invited_by, expires_at, accepted_at, revoked_at, last_sent_at, send_count, created_at')
      .eq('organization_id', params.id)
      .is('accepted_at', null)
      .is('revoked_at', null)
    if (query.teamId) invitationsQuery = invitationsQuery.eq('team_id', query.teamId)
    else if (query.departmentId) invitationsQuery = invitationsQuery.eq('department_id', query.departmentId)
    const result = await invitationsQuery.order('created_at', { ascending: false })
    if (result.error) throw result.error
    return reply.code(200).send(result.data.map((row) => InvitationSchema.parse(mapInvitationRow(row))))
  })

  app.post('/v1/invitations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateInvitationRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const resolved = await resolveInvitationScope(client, input)
    if (!resolved) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const { scope } = resolved
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    const roles = await roleProvider.rolesForScope(request.auth!, scope)
    if (!canAssignRole(roles, input.role)) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const alreadyMember = await client.rpc('email_has_membership', {
      target_organization_id: scope.organizationId,
      target_department_id: scope.departmentId ?? null,
      target_team_id: scope.teamId ?? null,
      target_email: input.email,
    })
    if (alreadyMember.error) throw alreadyMember.error
    if (alreadyMember.data) return reply.code(409).send({ error: 'already_a_member', correlationId: request.id })

    const { rawToken, tokenHash } = generateInvitationToken()
    // create_invitation() ist eine security-definer-RPC statt eines direkten Inserts: sie
    // invalidiert eine abgelaufene, aber noch offene Einladung fuer dieselbe Adresse/denselben
    // Scope in derselben Transaktion (sonst blockiert invitations_open_unique eine neue
    // Einladung bis zum manuellen Widerruf, beim Vertraege-Review gefunden) und prueft
    // zusaetzlich das adressbezogene Rate-Limit ueber alle Einladungs-Zeilen hinweg (schliesst
    // eine Umgehung per revoke()+erneutem create(), siehe Plan 010 "Risiken").
    const rpc = await client.rpc('create_invitation', {
      target_organization_id: scope.organizationId,
      target_department_id: scope.departmentId ?? null,
      target_team_id: scope.teamId ?? null,
      target_email: input.email,
      target_role: input.role,
      target_token_hash: tokenHash,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('invitation_already_open')) return reply.code(409).send({ error: 'invitation_already_open', correlationId: request.id })
      if (rpc.error.message.includes('resend_limit_reached')) return reply.code(429).send({ error: 'resend_limit_reached', correlationId: request.id })
      if (rpc.error.message.includes('resent at most once per hour')) return reply.code(429).send({ error: 'resend_rate_limited', correlationId: request.id })
      // requirePermission oben kennt nur die Rollen des Anfragenden, nicht
      // `policy_settings.invite_allowed` (Paket 023) -- create_invitation() prueft das zusaetzlich
      // selbst und wirft dieselbe Meldung wie ein fehlendes member.invite, weil beides fuer den
      // Aufrufer gleich aussieht: er darf hier gerade niemanden einladen.
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'invite_not_allowed', correlationId: request.id })
      if (rpc.error.code === '23514' || rpc.error.code === '23503') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw rpc.error
    }
    const insertData = rpc.data as Record<string, unknown>

    const organization = await client.from('organizations').select('name').eq('id', scope.organizationId).single()
    if (organization.error) throw organization.error
    const organizationName = organization.data.name as string
    const acceptUrl = `${environment.WEB_BASE_URL ?? 'http://localhost:4200'}/einladung?token=${rawToken}`
    let emailDelivered = true
    try {
      await emailSender.send(
        buildInvitationEmail({ to: input.email, organizationName, scopeName: resolved.scopeName || organizationName, acceptUrl }),
      )
    } catch (error) {
      // Die Einladung besteht bereits in der Datenbank -- ein SMTP-Fehler soll den Request nicht
      // mit 500 scheitern lassen, sondern nur den Versandstatus sichtbar machen (beim
      // Stabilitaets-Review dieses Pakets gefunden: bisher lief der Versand ungefangen).
      emailDelivered = false
      request.log.error({ err: error, correlationId: request.id }, 'invitation email delivery failed')
    }
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId,
      actor_user_id: request.auth!.userId,
      action: 'invitation.created',
      entity_type: 'invitations',
      entity_id: insertData.id,
      correlation_id: request.id,
      metadata: { email: input.email, role: input.role, departmentId: scope.departmentId ?? null, teamId: scope.teamId ?? null, emailDelivered },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

    return reply.code(201).send({ ...InvitationSchema.parse(mapInvitationRow(insertData)), emailDelivered })
  })

  app.post('/v1/invitations/:id/resend', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client
      .from('invitations')
      .select('organization_id, department_id, team_id, email, send_count, accepted_at, revoked_at')
      .eq('id', params.id)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data || existing.data.accepted_at || existing.data.revoked_at) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    if ((existing.data.send_count as number) >= 10) return reply.code(429).send({ error: 'resend_limit_reached', correlationId: request.id })
    const { rawToken, tokenHash } = generateInvitationToken()
    // resend_invitation() ist eine security-definer-RPC: sie prueft und erhoeht dasselbe
    // adressbezogene Rate-Limit wie create_invitation() atomar mit dem Update selbst (siehe dort).
    const rpc = await client.rpc('resend_invitation', { target_invitation_id: params.id, target_token_hash: tokenHash })
    if (rpc.error) {
      if (rpc.error.message.includes('resend_limit_reached')) return reply.code(429).send({ error: 'resend_limit_reached', correlationId: request.id })
      if (rpc.error.message.includes('resent at most once per hour')) return reply.code(429).send({ error: 'resend_rate_limited', correlationId: request.id })
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw rpc.error
    }
    const updateData = rpc.data as Record<string, unknown>
    const organization = await client.from('organizations').select('name').eq('id', scope.organizationId).single()
    if (organization.error) throw organization.error
    const organizationName = organization.data.name as string
    const scopeName = await resolveScopeName(client, scope, organizationName)
    const acceptUrl = `${environment.WEB_BASE_URL ?? 'http://localhost:4200'}/einladung?token=${rawToken}`
    let emailDelivered = true
    try {
      await emailSender.send(buildInvitationEmail({ to: existing.data.email as string, organizationName, scopeName, acceptUrl }))
    } catch (error) {
      emailDelivered = false
      request.log.error({ err: error, correlationId: request.id }, 'invitation email delivery failed')
    }
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId,
      actor_user_id: request.auth!.userId,
      action: 'invitation.resent',
      entity_type: 'invitations',
      entity_id: params.id,
      correlation_id: request.id,
      metadata: { email: existing.data.email, emailDelivered },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(200).send({ ...InvitationSchema.parse(mapInvitationRow(updateData)), emailDelivered })
  })

  app.post('/v1/invitations/:id/revoke', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client
      .from('invitations')
      .select('organization_id, department_id, team_id, email, accepted_at, revoked_at')
      .eq('id', params.id)
      .maybeSingle()
    if (existing.error) throw existing.error
    // Dieselbe Bedingung wie /resend: nur eine offene Einladung ist widerrufbar. Ein Widerruf auf
    // einer bereits angenommenen Zeile aendert nichts an der entstandenen Mitgliedschaft, setzte
    // aber revoked_at und schrieb einen irrefuehrenden Audit-Eintrag; ein zweiter Widerruf
    // erzeugte nur Rauschen (im Nachfolge-Review dieses PRs gefunden).
    if (!existing.data || existing.data.accepted_at || existing.data.revoked_at) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const scope = toPermissionScope(
      existing.data.organization_id as string,
      existing.data.department_id as string | null,
      existing.data.team_id as string | null,
    )
    if (!(await requirePermission(request, reply, 'member.invite', scope))) return
    const update = await client
      .from('invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', params.id)
      .select('id, organization_id, department_id, team_id, email, role, invited_by, expires_at, accepted_at, revoked_at, last_sent_at, send_count, created_at')
      .single()
    if (update.error) throw update.error
    const audit = await supabaseClients.forService().from('audit_events').insert({
      organization_id: scope.organizationId,
      actor_user_id: request.auth!.userId,
      action: 'invitation.revoked',
      entity_type: 'invitations',
      entity_id: params.id,
      correlation_id: request.id,
      metadata: { email: existing.data.email },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(200).send(InvitationSchema.parse(mapInvitationRow(update.data)))
  })

  app.post('/v1/invitations/accept', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = AcceptInvitationRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('accept_invitation', { raw_token: input.token })
    if (rpc.error) {
      if (rpc.error.message.includes('invitation_not_found_or_expired')) return reply.code(410).send({ error: 'invitation_not_found_or_expired', correlationId: request.id })
      if (rpc.error.message.includes('invitation_email_mismatch')) return reply.code(403).send({ error: 'invitation_email_mismatch', correlationId: request.id })
      if (rpc.error.message.includes('platform_admin_cannot_hold_membership')) return reply.code(409).send({ error: 'platform_admin_cannot_hold_membership', correlationId: request.id })
      throw rpc.error
    }
    const data = rpc.data as { organizationId: string; departmentId: string | null; teamId: string | null; role: string }
    return reply.code(200).send(AcceptInvitationResponseSchema.parse(data))
  })

  // --- Plattform-Administration (Paket 022) -------------------------------------------
  // Alle Routen ab hier sind requirePlatformAdmin-gated und verwenden ausschliesslich den
  // Service-Role-Client: die betroffenen Tabellen haben keinerlei Grant/Policy fuer
  // authenticated (siehe 2026080502_platform_administration.sql).

  app.get('/v1/me/platform-admin-status', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const status = await platformAdminProvider.statusFor(request.auth!.userId)
    return reply.code(200).send(PlatformAdminStatusSchema.parse(status))
  })

  app.post('/v1/platform-admins', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const input = AddPlatformAdminRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const rpc = await service.rpc('add_platform_admin', { target_email: input.email, added_by: request.auth!.userId })
    if (rpc.error) {
      if (rpc.error.message.includes('no auth.users row')) return reply.code(404).send({ error: 'user_not_found', correlationId: request.id })
      if (rpc.error.message.includes('member_cannot_become_platform_admin')) return reply.code(409).send({ error: 'member_cannot_become_platform_admin', correlationId: request.id })
      throw rpc.error
    }
    const row = await service.from('platform_admins').select('user_id, is_default_admin, created_at').eq('user_id', rpc.data as string).single()
    if (row.error) throw row.error
    return reply.code(201).send(
      PlatformAdminSchema.parse({ userId: row.data.user_id, isDefaultAdmin: row.data.is_default_admin, createdAt: row.data.created_at }),
    )
  })

  app.get('/v1/platform-admins', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const result = await service.from('platform_admins').select('user_id, is_default_admin, created_at').order('created_at')
    if (result.error) throw result.error
    return reply.code(200).send(
      result.data.map((row) => PlatformAdminSchema.parse({ userId: row.user_id, isDefaultAdmin: row.is_default_admin, createdAt: row.created_at })),
    )
  })

  app.delete('/v1/platform-admins/:userId', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    if (!request.platformAdmin?.isDefaultAdmin) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    const params = z.object({ userId: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const del = await service.from('platform_admins').delete().eq('user_id', params.userId)
    if (del.error) {
      if (del.error.message.includes('cannot be deleted')) return reply.code(400).send({ error: 'cannot_delete_default_admin', correlationId: request.id })
      throw del.error
    }
    return reply.code(204).send()
  })

  app.get('/v1/platform-settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const result = await service.from('platform_settings').select('key, value, updated_at').order('key')
    if (result.error) throw result.error
    return reply.code(200).send(
      result.data.map((row) => PlatformSettingSchema.parse({ key: row.key, value: row.value, updatedAt: row.updated_at })),
    )
  })

  app.put('/v1/platform-settings/:key', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ key: PlatformSettingKeySchema }).parse(request.params)
    const body = UpdatePlatformSettingRequestSchema.parse(request.body)
    const value = PlatformSettingValueSchemas[params.key].parse(body.value)
    const service = supabaseClients.forService()
    const update = await service
      .from('platform_settings')
      .update({ value, updated_by: request.auth!.userId })
      .eq('key', params.key)
      .select('key, value, updated_at')
      .single()
    if (update.error) throw update.error
    return reply.code(200).send(
      PlatformSettingSchema.parse({ key: update.data.key, value: update.data.value, updatedAt: update.data.updated_at }),
    )
  })

  app.get('/v1/platform-admin/organizations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const orgs = await service.from('organizations').select('id, name, slug, created_at').order('created_at', { ascending: false })
    if (orgs.error) throw orgs.error
    // Zaehlt pro Organisation ueber `count: 'exact', head: true` statt alle Zeilen zu laden --
    // eine ungefilterte select() koennte an supabase/config.tomls max_rows=1000 abgeschnitten
    // werden und countByOrganization wuerde dann zu niedrige Werte liefern.
    const counts = await Promise.all(
      orgs.data.map((row) =>
        Promise.all([
          service.from('organization_memberships').select('*', { count: 'exact', head: true }).eq('organization_id', row.id as string),
          service.from('departments').select('*', { count: 'exact', head: true }).eq('organization_id', row.id as string),
        ]),
      ),
    )
    return reply.code(200).send(
      orgs.data.map((row, index) => {
        const [members, departments] = counts[index]!
        if (members.error) throw members.error
        if (departments.error) throw departments.error
        return PlatformAdminOrganizationSummarySchema.parse({
          organizationId: row.id,
          name: row.name,
          slug: row.slug,
          memberCount: members.count ?? 0,
          departmentCount: departments.count ?? 0,
          createdAt: row.created_at,
        })
      }),
    )
  })

  app.get('/v1/platform-admin/usage-metrics', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const query = UsageMetricsQuerySchema.parse(request.query)
    const service = supabaseClients.forService()
    const [posts, versions, workflowRuns, publications] = await Promise.all([
      service.from('posts').select('created_at').gte('created_at', query.from).lte('created_at', query.to),
      service.from('post_versions').select('created_at').eq('created_by_type', 'llm').gte('created_at', query.from).lte('created_at', query.to),
      service.from('workflow_runs').select('created_at').eq('technical_status', 'failed').gte('created_at', query.from).lte('created_at', query.to),
      service.from('publications').select('created_at').eq('status', 'failed').gte('created_at', query.from).lte('created_at', query.to),
    ])
    if (posts.error) throw posts.error
    if (versions.error) throw versions.error
    if (workflowRuns.error) throw workflowRuns.error
    if (publications.error) throw publications.error

    type BucketField = 'postsCreated' | 'llmGeneratedVersions' | 'workflowRunsFailed' | 'publicationsFailed'
    const buckets = new Map<string, Record<BucketField, number>>()
    const bump = (rows: readonly { created_at: string }[], field: BucketField) => {
      for (const row of rows) {
        const date = new Date(row.created_at).toISOString().slice(0, 10)
        const bucket = buckets.get(date) ?? { postsCreated: 0, llmGeneratedVersions: 0, workflowRunsFailed: 0, publicationsFailed: 0 }
        bucket[field] += 1
        buckets.set(date, bucket)
      }
    }
    bump(posts.data, 'postsCreated')
    bump(versions.data, 'llmGeneratedVersions')
    bump(workflowRuns.data, 'workflowRunsFailed')
    bump(publications.data, 'publicationsFailed')

    const sortedDates = Array.from(buckets.keys()).sort()
    return reply.code(200).send(
      UsageMetricsResponseSchema.parse({ buckets: sortedDates.map((date) => ({ date, ...buckets.get(date)! })) }),
    )
  })

  app.get('/v1/llm-providers', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const configs = await service
      .from('llm_provider_configurations')
      .select('id, label, protocol, base_url, model, purpose, priority, is_active, system_prompt_override')
      .order('priority')
    if (configs.error) throw configs.error
    const secrets = await service.from('llm_provider_secrets').select('llm_provider_configuration_id')
    if (secrets.error) throw secrets.error
    const hasSecretIds = new Set(secrets.data.map((row) => row.llm_provider_configuration_id as string))
    return reply.code(200).send(
      configs.data.map((row) => LlmProviderConfigurationSchema.parse(mapLlmProviderConfigurationRow(row, hasSecretIds.has(row.id as string)))),
    )
  })

  app.post('/v1/llm-providers', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const input = CreateLlmProviderConfigurationRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const insert = await service
      .from('llm_provider_configurations')
      .insert({
        label: input.label,
        protocol: input.protocol,
        base_url: input.baseUrl,
        model: input.model,
        purpose: input.purpose,
        priority: input.priority,
        is_active: input.isActive,
        system_prompt_override: input.systemPromptOverride ?? null,
      })
      .select('id, label, protocol, base_url, model, purpose, priority, is_active, system_prompt_override')
      .single()
    if (insert.error) throw insert.error
    const sealed = createSecretBoxFromEnvironment(environment).seal(input.apiKey, insert.data.id as string)
    const secretInsert = await service.from('llm_provider_secrets').insert({
      llm_provider_configuration_id: insert.data.id,
      api_key_ciphertext: ciphertextToBytea(sealed.ciphertext),
      key_version: sealed.keyVersion,
    })
    if (secretInsert.error) {
      // Ohne Rollback bliebe eine aktive Konfiguration ohne Schluessel zurueck.
      await service.from('llm_provider_configurations').delete().eq('id', insert.data.id)
      throw secretInsert.error
    }
    return reply.code(201).send(LlmProviderConfigurationSchema.parse(mapLlmProviderConfigurationRow(insert.data, true)))
  })

  app.patch('/v1/llm-providers/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateLlmProviderConfigurationRequestSchema.parse(request.body)
    const payload: Record<string, unknown> = {}
    if (input.label !== undefined) payload.label = input.label
    if (input.protocol !== undefined) payload.protocol = input.protocol
    if (input.baseUrl !== undefined) payload.base_url = input.baseUrl
    if (input.model !== undefined) payload.model = input.model
    if (input.purpose !== undefined) payload.purpose = input.purpose
    if (input.priority !== undefined) payload.priority = input.priority
    if (input.isActive !== undefined) payload.is_active = input.isActive
    if (input.systemPromptOverride !== undefined) payload.system_prompt_override = input.systemPromptOverride
    const service = supabaseClients.forService()
    const update = await service
      .from('llm_provider_configurations')
      .update(payload)
      .eq('id', params.id)
      .select('id, label, protocol, base_url, model, purpose, priority, is_active, system_prompt_override')
      .single()
    if (update.error) throw update.error
    if (input.apiKey !== undefined) {
      const sealed = createSecretBoxFromEnvironment(environment).seal(input.apiKey, params.id)
      const upsert = await service.from('llm_provider_secrets').upsert({
        llm_provider_configuration_id: params.id,
        api_key_ciphertext: ciphertextToBytea(sealed.ciphertext),
        key_version: sealed.keyVersion,
      })
      if (upsert.error) throw upsert.error
    }
    const hasSecret = await service
      .from('llm_provider_secrets')
      .select('llm_provider_configuration_id')
      .eq('llm_provider_configuration_id', params.id)
      .maybeSingle()
    if (hasSecret.error) throw hasSecret.error
    return reply.code(200).send(LlmProviderConfigurationSchema.parse(mapLlmProviderConfigurationRow(update.data, hasSecret.data !== null)))
  })

  app.delete('/v1/llm-providers/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const del = await service.from('llm_provider_configurations').delete().eq('id', params.id)
    if (del.error) throw del.error
    return reply.code(204).send()
  })

  // --- Paket 011: Durchsetzung an vier Stellen -- Freigabe anfordern, entscheiden, einplanen ---

  const ORG_ROLES_WITH_APPROVE = (['organization_owner', 'organization_admin', 'social_manager', 'billing_admin', 'organization_viewer'] as const).filter((role) => hasPermission([role], 'post.approve'))
  const DEPARTMENT_ROLES_WITH_APPROVE = (['department_admin', 'editor', 'approver', 'contributor', 'viewer'] as const).filter((role) => hasPermission([role], 'post.approve'))
  const TEAM_ROLES_WITH_APPROVE = (['team_manager', 'contributor', 'viewer'] as const).filter((role) => hasPermission([role], 'post.approve'))

  // "any_with_permission" ist keine feste Namensliste, sondern jede Person, die JETZT die
  // Berechtigung im Scope haelt (Plan 011, "Fachliches Modell") -- einschliesslich der aeusseren
  // Ebenen: authz.has_team_permission faellt auf has_department_permission zurueck, dieses auf
  // has_organization_permission. Eine Abteilungsstufe darf deshalb auch die Vereinsleitung
  // entscheiden, eine Teamstufe die Freigabeberechtigten der Elternabteilung. Ohne diese Kaskade
  // blieb der Pruefkreis einer Abteilung ohne eigene "approver"-Rolle leer, und resolveReviewRoute
  // meldete einen empty_reviewer_pool-Blocker (422) fuer eine Konfiguration, die tatsaechlich
  // erfuellbar ist -- der Normalfall in einem kleinen Verein, in dem nur die Vereinsleitung
  // freigibt (beim eigenen Review dieses Pakets gefunden).
  async function membersWithApprovePermission(
    client: SupabaseClient, organizationId: string, scope: ScopeLevel, departmentId: string | null, teamId: string | null,
  ): Promise<string[]> {
    const notExpired = notExpiredFilter()
    // Ueber fetchAllRows wie GET /v1/organizations/:id/members: max_rows=1000 wuerde den
    // Prueferkreis eines grossen Vereins still abschneiden und einzelne Berechtigte aus dem
    // eingefrorenen reviewer_snapshot fallen lassen.
    const pages = [
      ...(ORG_ROLES_WITH_APPROVE.length > 0
        ? [fetchAllRows<{ user_id: string }>((from, to) =>
            client.from('organization_memberships').select('user_id').eq('organization_id', organizationId).in('role', ORG_ROLES_WITH_APPROVE).or(notExpired).range(from, to),
          )]
        : []),
      ...(scope !== 'organization' && DEPARTMENT_ROLES_WITH_APPROVE.length > 0
        ? [fetchAllRows<{ user_id: string }>((from, to) =>
            client.from('department_memberships').select('user_id').eq('department_id', departmentId!).in('role', DEPARTMENT_ROLES_WITH_APPROVE).or(notExpired).range(from, to),
          )]
        : []),
      ...(scope === 'team' && TEAM_ROLES_WITH_APPROVE.length > 0
        ? [fetchAllRows<{ user_id: string }>((from, to) =>
            client.from('team_memberships').select('user_id').eq('team_id', teamId!).in('role', TEAM_ROLES_WITH_APPROVE).or(notExpired).range(from, to),
          )]
        : []),
    ]
    const userIds = new Set<string>()
    for (const rows of await Promise.all(pages)) {
      for (const row of rows) userIds.add(row.user_id)
    }
    return Array.from(userIds)
  }

  function mapReviewerRow(row: { kind: string; user_id: string | null; role: string | null; target_department_id: string | null; target_team_id: string | null }): DomainReviewerRef {
    if (row.kind === 'user') return { kind: 'user', userId: row.user_id! }
    if (row.kind === 'organization_role') return { kind: 'organization_role', role: row.role! }
    if (row.kind === 'department_role') return { kind: 'department_role', departmentId: row.target_department_id!, role: row.role! }
    return { kind: 'team_role', departmentId: row.target_department_id!, teamId: row.target_team_id!, role: row.role! }
  }

  // Grundlage der Prueferauflösung fuer "named"-Stufen -- eine abgelaufene Mitgliedschaft traegt
  // keine Rolle mehr und darf deshalb nicht als Pruefer in den reviewer_snapshot einfrieren.
  // request_approval wuerde eine solche Route ohnehin mit invalid_reviewer_snapshot ablehnen, weil
  // authz.is_user_member_of_organization dort denselben Ablauffilter anwendet.
  async function fetchAllMemberships(client: SupabaseClient, organizationId: string): Promise<MembershipRecord[]> {
    const notExpired = notExpiredFilter()
    // fetchAllRows aus demselben Grund wie in membersWithApprovePermission: eine benannte Rolle
    // duerfte in einem grossen Verein nicht daran scheitern, dass die Mitgliederseite abgeschnitten ist.
    const [orgRows, deptRows, teamRows] = await Promise.all([
      fetchAllRows<{ user_id: string; role: string }>((from, to) =>
        client.from('organization_memberships').select('user_id, role').eq('organization_id', organizationId).or(notExpired).range(from, to),
      ),
      fetchAllRows<{ user_id: string; role: string; department_id: string }>((from, to) =>
        client.from('department_memberships').select('user_id, role, department_id').eq('organization_id', organizationId).or(notExpired).range(from, to),
      ),
      fetchAllRows<{ user_id: string; role: string; team_id: string; department_id: string }>((from, to) =>
        client.from('team_memberships').select('user_id, role, team_id, department_id').eq('organization_id', organizationId).or(notExpired).range(from, to),
      ),
    ])
    return [
      ...orgRows.map((row) => ({ userId: row.user_id, scope: 'organization' as const, role: row.role })),
      ...deptRows.map((row) => ({ userId: row.user_id, scope: 'department' as const, departmentId: row.department_id, role: row.role })),
      ...teamRows.map((row) => ({ userId: row.user_id, scope: 'team' as const, departmentId: row.department_id, teamId: row.team_id, role: row.role })),
    ]
  }

  const DEFAULT_STAGE_LABEL: Record<ScopeLevel, string> = { organization: 'Verein', department: 'Abteilung', team: 'Team' }

  // Baut die Stufendefinitionen innen (Team) nach aussen (Verein) -- nur Ebenen, deren EIGENE
  // Zeile review_required = true setzt, tragen eine Stufe bei (Plan 011: additiv, nicht vererbt).
  async function buildStageDefinitions(
    client: SupabaseClient, ruleRows: PolicyRuleRows, organizationId: string, departmentId: string, teamId: string | null,
  ): Promise<StageDefinition[]> {
    const levels: { scope: ScopeLevel; scopeId: string; scopeDepartmentId: string | null; scopeTeamId: string | null }[] = [
      ...(teamId ? [{ scope: 'team' as const, scopeId: teamId, scopeDepartmentId: departmentId, scopeTeamId: teamId }] : []),
      { scope: 'department' as const, scopeId: departmentId, scopeDepartmentId: departmentId, scopeTeamId: null },
      { scope: 'organization' as const, scopeId: organizationId, scopeDepartmentId: null, scopeTeamId: null },
    ]
    const memberships = await fetchAllMemberships(client, organizationId)
    const stages: StageDefinition[] = []
    for (const level of levels) {
      const row = ownPolicyRuleRow(ruleRows, level.scope, level.scopeDepartmentId, level.scopeTeamId)
      if (!row?.review_required) continue
      const mode = row.review_mode ?? 'any_with_permission'
      let reviewerUserIds: string[]
      if (mode === 'named') {
        const reviewerRows = await client.from('policy_reviewers').select('kind, user_id, role, target_department_id, target_team_id').eq('policy_settings_id', row.id)
        if (reviewerRows.error) throw reviewerRows.error
        reviewerUserIds = resolveReviewers(reviewerRows.data.map(mapReviewerRow), memberships).userIds
      } else {
        reviewerUserIds = await membersWithApprovePermission(client, organizationId, level.scope, level.scopeDepartmentId, level.scopeTeamId)
      }
      stages.push({
        scope: level.scope,
        ...(level.scopeDepartmentId ? { scopeDepartmentId: level.scopeDepartmentId } : {}),
        ...(level.scopeTeamId ? { scopeTeamId: level.scopeTeamId } : {}),
        label: row.review_stage_label ?? DEFAULT_STAGE_LABEL[level.scope],
        mode,
        minimumApprovals: row.review_minimum_approvals ?? 1,
        ...(row.review_deadline_hours ? { deadlineHours: row.review_deadline_hours } : {}),
        reviewerUserIds,
      })
    }
    return stages
  }

  app.post('/v1/post-versions/:id/request-approval', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const version = await client.from('post_versions').select('id, post_id, created_by_user_id, safety_flags').eq('id', params.id).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const post = await client.from('posts').select('id, organization_id, department_id, team_id, status').eq('id', version.data.post_id).maybeSingle()
    if (post.error) throw post.error
    if (!post.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.submit', { organizationId: post.data.organization_id, departmentId: post.data.department_id }))) return

    const departmentId = post.data.department_id as string
    const teamId = post.data.team_id as string | null
    // Alle Ebenen einmal laden -- Stufenaufbau, die Vereinszeile (allow_review_exemptions) und die
    // effektive Konfiguration lesen dieselben Zeilen.
    const ruleRows = await fetchPolicyRuleRows(client, post.data.organization_id)
    const orgRow = ruleRows.orgRow
    const config = computeRuleEntry(ruleRows, teamId ? 'team' : 'department', teamId ?? departmentId, departmentId).config
    const stages = await buildStageDefinitions(client, ruleRows, post.data.organization_id, departmentId, teamId)
    const authorId = version.data.created_by_user_id as string
    const trust = await fetchMemberTrust(client, authorId, post.data.organization_id, departmentId, teamId)
    const containsMinors = ((version.data.safety_flags as string[]) ?? []).includes('minor')
    const minorReviewerUserIds = containsMinors ? await membersWithApprovePermission(client, post.data.organization_id, 'organization', null, null) : []

    const route = resolveReviewRoute({
      stages,
      trust,
      author: { userId: authorId },
      media: { containsMinors, reviewerUserIds: minorReviewerUserIds },
      selfApprovalAllowed: config.policies.selfApprovalAllowed,
      allowReviewExemptions: orgRow?.allow_review_exemptions ?? true,
    })
    if (route.blockers.length > 0) {
      return reply.code(422).send({ error: 'unfulfillable_stage', blockers: route.blockers, correlationId: request.id })
    }

    // self_approval_allowed/allow_same_reviewer_across_stages werden von request_approval selbst
    // aus policy_settings neu berechnet, nicht von hier uebernommen -- die RPC ist per Grant direkt
    // erreichbar und darf diese sicherheitsrelevanten Werte nicht vom Aufrufer entgegennehmen
    // (beim Rechte-/Mandantentrennung-Review gefunden).
    const rpc = await client.rpc('request_approval', {
      target_post_version_id: params.id,
      stages: route.stages.map((stage) => ({
        position: stage.position, scope: stage.scope, scopeDepartmentId: stage.scopeDepartmentId ?? null, scopeTeamId: stage.scopeTeamId ?? null,
        label: stage.label, mode: stage.mode, minimumApprovals: stage.minimumApprovals, isMinorStage: stage.isMinorStage,
        reviewerSnapshot: stage.reviewerUserIds.map((userId) => ({ userId })), deadlineHours: stage.deadlineHours ?? null,
      })),
    })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('invalid_status')) return reply.code(409).send({ error: 'invalid_status', correlationId: request.id })
      if (rpc.error.message.includes('minor_stage_required')) return reply.code(422).send({ error: 'minor_stage_required', correlationId: request.id })
      if (rpc.error.message.includes('review_required')) return reply.code(422).send({ error: 'review_required', correlationId: request.id })
      if (rpc.error.message.includes('invalid_reviewer_snapshot')) return reply.code(422).send({ error: 'invalid_reviewer_snapshot', correlationId: request.id })
      // Beide sind auf diesem Weg nicht erreichbar -- resolveReviewRoute nummeriert die Stufen selbst
      // von 1 an durch und meldet einen leeren Prueferkreis vorher als Blocker. request_approval ist
      // aber per Grant direkt per RPC erreichbar und prueft deshalb beides selbst.
      if (rpc.error.message.includes('invalid_stage_positions')) return reply.code(422).send({ error: 'invalid_stage_positions', correlationId: request.id })
      if (rpc.error.message.includes('empty_reviewer_snapshot')) return reply.code(422).send({ error: 'empty_reviewer_snapshot', correlationId: request.id })
      if (rpc.error.message.includes('only_author_as_reviewer')) return reply.code(403).send({ error: 'only_author_as_reviewer', correlationId: request.id })
      throw rpc.error
    }
    return reply.code(202).send(
      RequestApprovalResponseSchema.parse({ postId: rpc.data.postId, status: rpc.data.status, approvalRequestId: rpc.data.approvalRequestId ?? null }),
    )
  })

  app.post('/v1/approval-stages/:id/decide', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = DecideApprovalStageRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('decide_approval_stage', { target_stage_id: params.id, target_decision: input.decision, target_reason: input.reason ?? null })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('invalid_decision')) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw rpc.error
    }
    return reply.code(200).send(
      DecideApprovalStageResponseSchema.parse({
        stageId: rpc.data.stageId, stageStatus: rpc.data.stageStatus, postStatus: rpc.data.postStatus,
        ...(rpc.data.nextStageId ? { nextStageId: rpc.data.nextStageId } : {}),
      }),
    )
  })

  app.get('/v1/post-versions/:id/approval', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const version = await client.from('post_versions').select('id, created_by_user_id').eq('id', params.id).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const approvalRequest = await client.from('approval_requests').select('id, post_id, post_version_id').eq('post_version_id', params.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (approvalRequest.error) throw approvalRequest.error
    if (!approvalRequest.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const isAuthor = version.data.created_by_user_id === request.auth!.userId
    const [stagesResult, decisionsResult] = await Promise.all([
      client.from('approval_stages').select('id, position, scope, label, mode, minimum_approvals, is_minor_stage, status, reviewer_snapshot, deadline_at, opened_at').eq('approval_request_id', approvalRequest.data.id).order('position'),
      client.from('approval_decisions').select('id, approval_stage_id, decided_by, decision, reason, created_at').eq('approval_request_id', approvalRequest.data.id),
    ])
    if (stagesResult.error) throw stagesResult.error
    if (decisionsResult.error) throw decisionsResult.error
    const now = Date.now()
    return reply.code(200).send(
      ApprovalRequestSchema.parse({
        id: approvalRequest.data.id, postId: approvalRequest.data.post_id, postVersionId: approvalRequest.data.post_version_id,
        stages: stagesResult.data.map((stage) => ({
          id: stage.id, position: stage.position, scope: stage.scope, label: stage.label, mode: stage.mode,
          minimumApprovals: stage.minimum_approvals, isMinorStage: stage.is_minor_stage, status: stage.status,
          // Der Autor sieht die Zusammensetzung einer noch nicht geoeffneten Stufe nicht (Plan 011).
          // Ueber opened_at statt einzelner Statuswerte: eine abgelehnte innere Stufe skipped alle
          // FOLGENDEN Stufen direkt aus 'pending', ohne dass sie je 'open' waren -- ein Check nur
          // auf status === 'pending' haette das nach der Ablehnung wieder offengelegt (beim
          // Geheimnisse-Review gefunden).
          reviewerUserIds: isAuthor && stage.opened_at === null ? null : (stage.reviewer_snapshot as { userId: string }[]).map((entry) => entry.userId),
          deadlineAt: stage.deadline_at,
          // 'stalled' ist der markierte Fall derselben Sache -- sonst zeigte eine vom Job markierte
          // Stufe "nicht überfällig" an, obwohl sie es gerade deswegen ist.
          isOverdue: (stage.status === 'open' || stage.status === 'stalled') && stage.deadline_at !== null && new Date(stage.deadline_at as string).getTime() < now,
          // Paket 015: dieser Detail-Endpunkt zeigt (anders als /v1/approval-stages/mine) bewusst
          // keine Medien-Gate-Blocker -- Autor und Pruefende sehen hier den Freigabestatus, die
          // Blocker-Berechnung ist an die Review-Liste gebunden. Dokumentierte Vereinfachung, kein
          // Vergessen: eine spaetere Vereinheitlichung koennte computeMediaGateBlockersForPostVersion
          // auch hier aufrufen.
          mediaGateBlockers: [],
        })),
        decisions: decisionsResult.data.map((decision) => ({
          id: decision.id, approvalStageId: decision.approval_stage_id, decidedBy: decision.decided_by,
          decision: decision.decision, reason: decision.reason, createdAt: decision.created_at,
        })),
      }),
    )
  })

  // Fuer freigaben.vue ("wartet auf mich"): RLS liefert jede Stufe, die auth.uid() ueberhaupt sehen
  // darf (u. a. jedes Vereinsmitglied mit Organisationsrolle) -- der Filter auf den eigenen
  // reviewer_snapshot-Eintrag engt das hier auf tatsaechlich zugewiesene Stufen ein.
  // organizationId ist pflichtig: eine Person mit Pruefrollen in mehreren Vereinen saehe sonst die
  // Freigaben ALLER ihrer Vereine in der Liste eines einzelnen (beim Review dieses Pakets gefunden).
  // Paket 015: Medien-Gate-Blocker fuer den Beitrag hinter einer Stufe. Faltet
  // post_media -> media_derivatives -> media_assets -> face_regions -> consent_records zusammen
  // und ruft evaluateConsent je Gesicht auf. Bekannte, dokumentierte Grenze: verknuepfte Personen
  // fuer die Namensprüfung kommen ausschliesslich aus einwilligungsgeprueften Gesichtern der
  // Medien dieses Beitrags -- ein rein textlicher Beitrag ohne jedes Foto einer Person kann diese
  // Person nicht als "verknuepft" kennen, weil keine andere Verknuepfung von Beitragstext zu einer
  // konkreten Person existiert (siehe plans/015, "Umsetzung: Ergebnis und Abweichungen").
  // minorReviewConfirmed ist bewusst konservativ immer false: ein eigenes, freigabestufenbasiertes
  // Minderjaehrigenschutz existiert bereits seit Paket 011 (is_minor_stage) und bleibt die
  // eigentliche Durchsetzung; dieser Blocker ist eine zusaetzliche, informative Erinnerung.
  async function computeMediaGateBlockersForPostVersion(
    client: SupabaseClient, postVersionId: string, departmentId: string, policy: { consentExpiresOnLeave: boolean },
  ): Promise<MediaGateBlocker[]> {
    const postVersion = await client.from('post_versions').select('title, caption').eq('id', postVersionId).maybeSingle()
    if (postVersion.error) throw postVersion.error
    if (!postVersion.data) return []

    const postMedia = await client.from('post_media').select('media_derivative_id').eq('post_version_id', postVersionId)
    if (postMedia.error) throw postMedia.error
    const derivativeIds = postMedia.data.map((row) => row.media_derivative_id as string)

    if (derivativeIds.length === 0) {
      const scan = scanTextForSensitiveData(`${postVersion.data.title as string} ${postVersion.data.caption as string}`, [])
      return evaluateMediaGate({
        scanStatus: 'clean', facesConfirmedComplete: true, hasOriginalSelected: false, derivativeCurrent: true,
        faces: [], minorReviewConfirmed: false, namingNotAllowed: scan.namingNotAllowed, sensitiveTextData: scan.sensitiveTextData,
      }).blockers
    }

    const derivatives = await client.from('media_derivatives').select('id, media_asset_id, status').in('id', derivativeIds)
    if (derivatives.error) throw derivatives.error
    const assetIds = Array.from(new Set(derivatives.data.map((row) => row.media_asset_id as string)))
    const [assets, faces] = await Promise.all([
      client.from('media_assets').select('id, mime_type, scan_status').in('id', assetIds),
      client.from('face_regions').select('media_asset_id, subject_kind, decision, consent_record_id').in('media_asset_id', assetIds),
    ])
    if (assets.error) throw assets.error
    if (faces.error) throw faces.error

    const consentRecordIds = Array.from(new Set(faces.data.map((face) => face.consent_record_id as string | null).filter((id): id is string => id !== null)))
    const consents = consentRecordIds.length > 0
      ? await client.from('consent_records').select(CONSENT_RECORD_SELECT).in('id', consentRecordIds)
      : { data: [] as ConsentRecordRow[], error: null as null }
    if (consents.error) throw consents.error
    const consentById = new Map((consents.data as ConsentRecordRow[]).map((row) => [row.id, row]))

    const directoryPersonIds = Array.from(
      new Set((consents.data as ConsentRecordRow[]).map((row) => row.directory_person_id).filter((id): id is string => id !== null)),
    )
    const people = directoryPersonIds.length > 0
      ? await client.from('directory_people').select('id, first_name, last_name, status, is_minor').in('id', directoryPersonIds)
      : { data: [] as { id: string; first_name: string; last_name: string; status: string; is_minor: boolean }[], error: null as null }
    if (people.error) throw people.error
    const personById = new Map(people.data.map((row) => [row.id, row]))

    const now = new Date()
    const mediaKindByAssetId = new Map(
      assets.data.map((row) => [row.id as string, (row.mime_type as string).startsWith('video/') ? ('video' as const) : ('photo' as const)]),
    )

    const faceInputs = faces.data.map((face) => {
      const consent = face.consent_record_id ? consentById.get(face.consent_record_id as string) : undefined
      let consentValid: boolean | undefined
      let consentScopeMismatch: boolean | undefined
      if (face.decision === 'consented' && consent) {
        const person = consent.directory_person_id ? personById.get(consent.directory_person_id) : undefined
        const evaluation = evaluateConsent(
          {
            guardianConfirmed: consent.guardian_confirmed, signerRole: consent.signer_role, supersededBy: consent.superseded_by,
            revokedAt: consent.revoked_at, validFrom: consent.valid_from, validUntil: consent.valid_until,
            scopeStructured: consent.scope_structured, personLeft: person?.status === 'left',
            subjectIsMinor: person?.is_minor ?? false,
          },
          now,
          {
            purpose: 'social_media', platform: null,
            mediaKind: mediaKindByAssetId.get(face.media_asset_id as string) ?? 'photo',
            context: null, departmentId,
          },
          policy,
        )
        consentValid = !isConsentRecordInvalid(evaluation.reasons)
        consentScopeMismatch = isConsentScopeMismatch(evaluation.reasons)
      }
      return {
        subjectKind: face.subject_kind as 'adult' | 'minor' | 'unknown',
        decision: face.decision as 'pending' | 'consented' | 'obscure' | 'exclude',
        consentValid, consentScopeMismatch,
      }
    })

    const linkedPersons = Array.from(personById.values()).map((person) => {
      const consent = Array.from(consentById.values()).find((row) => row.directory_person_id === person.id)
      return { firstName: person.first_name, lastName: person.last_name, namingAllowed: consent?.scope_structured.namingAllowed ?? false }
    })
    const scan = scanTextForSensitiveData(`${postVersion.data.title as string} ${postVersion.data.caption as string}`, linkedPersons)

    const scanStatus: 'clean' | 'pending' | 'failed' = assets.data.some((row) => row.scan_status === 'failed')
      ? 'failed'
      : assets.data.every((row) => row.scan_status === 'clean')
        ? 'clean'
        : 'pending'
    const derivativeCurrent = derivatives.data.every((row) => row.status === 'ready')

    return evaluateMediaGate({
      scanStatus, facesConfirmedComplete: true, hasOriginalSelected: false, derivativeCurrent,
      faces: faceInputs, minorReviewConfirmed: false, namingNotAllowed: scan.namingNotAllowed, sensitiveTextData: scan.sensitiveTextData,
    }).blockers
  }

  app.get('/v1/approval-stages/mine', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // 'stalled' gehoert dazu: mark_stalled_approval_stages() markiert eine ueberfaellige Stufe, nimmt
    // ihr aber kein Recht (siehe authz.can_decide_stage). Ein Filter nur auf 'open' haette sie aus
    // genau der Liste verschwinden lassen, in der die zustaendige Person sie noch entscheiden soll.
    const rows = await client
      .from('approval_stages')
      .select('id, position, scope, label, mode, minimum_approvals, is_minor_stage, status, reviewer_snapshot, deadline_at, approval_request_id')
      .eq('organization_id', query.organizationId)
      .in('status', ['open', 'stalled'])
    if (rows.error) throw rows.error
    const userId = request.auth!.userId
    const now = Date.now()
    const mine = rows.data.filter((row) => (row.reviewer_snapshot as { userId: string }[]).some((entry) => entry.userId === userId))

    const approvalRequestIds = Array.from(new Set(mine.map((row) => row.approval_request_id as string | undefined).filter((id): id is string => Boolean(id))))
    const approvalRequests = approvalRequestIds.length > 0
      ? await client.from('approval_requests').select('id, post_id, post_version_id').in('id', approvalRequestIds)
      : { data: [] as { id: string; post_id: string; post_version_id: string }[], error: null as null }
    if (approvalRequests.error) throw approvalRequests.error
    const postVersionByRequestId = new Map(approvalRequests.data.map((row) => [row.id, row.post_version_id]))
    const postIds = Array.from(new Set(approvalRequests.data.map((row) => row.post_id)))
    const posts = postIds.length > 0
      ? await client.from('posts').select('id, department_id').in('id', postIds)
      : { data: [] as { id: string; department_id: string }[], error: null as null }
    if (posts.error) throw posts.error
    const departmentByPostId = new Map(posts.data.map((row) => [row.id, row.department_id]))
    const postIdByRequestId = new Map(approvalRequests.data.map((row) => [row.id, row.post_id]))

    // Kein unnoetiger Roundtrip auf policy_settings, wenn es (noch) keine einzige aufloesbare
    // Stufe gibt -- betrifft insbesondere den erwarteten Normalfall ohne Inhalts-Pipeline (siehe
    // plans/README.md), in dem approval_stages zwar existieren koennen, aber approval_request_id
    // ins Leere zeigt, solange kein echter Beitrag dahinter steht.
    const policyRows = postIds.length > 0 ? await fetchPolicyRuleRows(client, query.organizationId) : null
    const effectiveConfigByDepartmentId = new Map<string, ReturnType<typeof resolveEffectiveConfig>>()
    function effectivePolicyForDepartment(departmentId: string): { consentExpiresOnLeave: boolean } {
      let config = effectiveConfigByDepartmentId.get(departmentId)
      if (!config) {
        config = computeRuleEntry(policyRows!, 'department', departmentId, null).config
        effectiveConfigByDepartmentId.set(departmentId, config)
      }
      return { consentExpiresOnLeave: config.policies.consentExpiresOnLeave }
    }

    // Mehrere Stufen eines Freigabeantrags zeigen auf dieselbe post_version_id -- ohne Memoisierung
    // wuerden bis zu sieben Abfragen je Stufe unnoetig wiederholt (gefunden im Code-Review).
    const blockersByPostVersionId = new Map<string, Promise<MediaGateBlocker[]>>()
    const blockersByStage = await Promise.all(
      mine.map(async (row) => {
        const postVersionId = postVersionByRequestId.get(row.approval_request_id as string)
        const postId = postIdByRequestId.get(row.approval_request_id as string)
        const departmentId = postId ? departmentByPostId.get(postId) : undefined
        if (!postVersionId || !departmentId) return []
        let pending = blockersByPostVersionId.get(postVersionId)
        if (!pending) {
          pending = computeMediaGateBlockersForPostVersion(client, postVersionId, departmentId, effectivePolicyForDepartment(departmentId))
          blockersByPostVersionId.set(postVersionId, pending)
        }
        return pending
      }),
    )

    return reply.code(200).send(
      mine.map((row, index) =>
        ApprovalStageSchema.parse({
          id: row.id, position: row.position, scope: row.scope, label: row.label, mode: row.mode,
          minimumApprovals: row.minimum_approvals, isMinorStage: row.is_minor_stage, status: row.status,
          reviewerUserIds: (row.reviewer_snapshot as { userId: string }[]).map((entry) => entry.userId),
          deadlineAt: row.deadline_at, isOverdue: row.deadline_at !== null && new Date(row.deadline_at as string).getTime() < now,
          mediaGateBlockers: blockersByStage[index] ?? [],
        }),
      ),
    )
  })

  app.post('/v1/post-versions/:id/schedule', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = SchedulePublicationRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('schedule_publication', {
      target_post_version_id: params.id, target_social_connection_id: input.socialConnectionId, target_scheduled_for: input.scheduledFor,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      if (rpc.error.message.includes('invalid_status')) return reply.code(409).send({ error: 'invalid_status', correlationId: request.id })
      if (rpc.error.message.includes('channel_not_allowed')) return reply.code(422).send({ error: 'channel_not_allowed', correlationId: request.id })
      if (rpc.error.message.includes('quota_exceeded')) return reply.code(409).send({ error: 'quota_exceeded', detail: rpc.error.message, correlationId: request.id })
      throw rpc.error
    }
    return reply.code(201).send(
      PublicationSchema.parse({
        id: rpc.data.id, postVersionId: rpc.data.post_version_id, socialConnectionId: rpc.data.social_connection_id,
        platform: rpc.data.platform, status: rpc.data.status, scheduledFor: rpc.data.scheduled_for,
      }),
    )
  })

  // Paket 025: schedule_publication (oben) legt nur die Zeile an -- kein Code rief bisher
  // SocialPublisher.publish() ueberhaupt auf (plans/025, Ausgangslage). Kein Hatchet-Cron
  // verfuegbar (Paket 004 weiterhin "in Arbeit") -- dieser Endpunkt fuehrt eine FAELLIGE
  // Veroeffentlichung explizit und synchron aus, plant nichts automatisch zu einem kuenftigen
  // Zeitpunkt (dasselbe Muster wie POST /v1/integration-sources/:id/sync).
  app.post('/v1/publications/:id/execute', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const publication = await client
      .from('publications')
      .select('id, organization_id, post_version_id, social_connection_id, platform, status, scheduled_for, idempotency_key')
      .eq('id', params.id)
      .maybeSingle()
    if (publication.error) throw publication.error
    if (!publication.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const version = await client.from('post_versions').select('id, post_id, caption').eq('id', publication.data.post_version_id as string).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const post = await client.from('posts').select('id, department_id').eq('id', version.data.post_id as string).maybeSingle()
    if (post.error) throw post.error
    if (!post.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.publish', { organizationId: publication.data.organization_id as string, departmentId: post.data.department_id as string }))) return

    const scheduledFor = publication.data.scheduled_for as string | null
    if (scheduledFor !== null && new Date(scheduledFor).getTime() > Date.now()) {
      return reply.code(409).send({ error: 'not_due_yet', correlationId: request.id })
    }

    const service = supabaseClients.forService()
    // Dieselbe Compare-and-Set-Lehre wie bei consent_records' superseded_by (Paket 015): trifft das
    // update keine Zeile, hat ein gleichzeitiger Aufruf bereits gewonnen -- kein automatischer
    // Retry hier, ein fehlgeschlagener/bereits laufender Versuch braucht eine bewusste
    // Neuveroeffentlichung (aus Scope, siehe plans/025).
    const claim = await service.from('publications').update({ status: 'uploading' }).eq('id', params.id).eq('status', 'queued').select('id').maybeSingle()
    if (claim.error) throw claim.error
    if (!claim.data) return reply.code(409).send({ error: 'invalid_status', correlationId: request.id })

    // Nach dem CAS ist die Zeile beansprucht -- jeder Abbruch vor publisher.publish() muss sie
    // wieder freigeben, sonst haengt sie dauerhaft in 'uploading' und ist per CAS nie wieder
    // erreichbar (Code-Review zu PR #25).
    const releaseClaim = async (): Promise<void> => {
      const release = await service.from('publications').update({ status: 'queued' }).eq('id', params.id).eq('status', 'uploading')
      if (release.error) request.log.error({ err: release.error, correlationId: request.id }, 'publication claim release failed')
    }
    // Jeder erzeugte Grant bliebe sonst die volle TTL abrufbar, auch nach einem laengst
    // abgeschlossenen Veroeffentlichungsversuch -- Medien sind per Vorgabe standardmaessig privat
    // (Code-Review zu PR #25, plans/025 Abschnitt 2).
    const revokeGrants = async (): Promise<void> => {
      const revoke = await service.from('publication_media_grants').update({ revoked_at: new Date().toISOString() }).eq('publication_id', params.id).is('revoked_at', null)
      if (revoke.error) request.log.error({ err: revoke.error, correlationId: request.id }, 'publication_media_grants revoke failed')
    }

    let publicationInput: PublicationInput
    let publisher: SocialPublisher
    let validation: ValidationResult
    let nextAttemptNumber: number
    try {
      const connection = await service.from('social_connections').select('external_account_id').eq('id', publication.data.social_connection_id as string).maybeSingle()
      if (connection.error) throw connection.error
      if (!connection.data) { await releaseClaim(); return reply.code(404).send({ error: 'not_found', correlationId: request.id }) }
      const secretRow = await service.from('social_connection_secrets').select('token_ciphertext, token_key_version').eq('social_connection_id', publication.data.social_connection_id as string).maybeSingle()
      if (secretRow.error) throw secretRow.error
      if (!secretRow.data) { await releaseClaim(); return reply.code(404).send({ error: 'not_found', correlationId: request.id }) }
      const accessToken = createSecretBoxFromEnvironment(environment).open(
        byteaToBuffer(secretRow.data.token_ciphertext as string), secretRow.data.token_key_version as string, publication.data.social_connection_id as string,
      )

      // Ohne die Upload-/Freigabepipeline (Plaene 002/003) hat jede aus Plan 025 entstehende
      // post_version keine post_media-Zeilen -- media bleibt dann [], und validate() unten lehnt das
      // unconditional ab (FakePublisher/MetaPublisher, packages/publishing). Das ist korrektes,
      // erwartetes Verhalten, kein Fehler dieses Endpunkts (siehe plans/025, Ausgangslage).
      const mediaRows = await service.from('post_media').select('position, media_derivative_id').eq('post_version_id', version.data.id as string).order('position')
      if (mediaRows.error) throw mediaRows.error
      // Ohne diese Basis-URL entstuende eine unbrauchbare Grant-URL (`undefined/v1/media-grants/...`);
      // FakePublisher.validate() prueft grantUrl nicht, der Fehler bliebe sonst bis zum echten
      // Provider unsichtbar (Code-Review zu PR #25).
      if (mediaRows.data.length > 0 && !environment.API_PUBLIC_BASE_URL) {
        await releaseClaim()
        return reply.code(503).send({ error: 'api_public_base_url_not_configured', correlationId: request.id })
      }
      const media: PublicationMedia[] = []
      for (const row of mediaRows.data) {
        const derivative = await service.from('media_derivatives').select('id, sha256, mime_type, status').eq('id', row.media_derivative_id as string).maybeSingle()
        if (derivative.error) throw derivative.error
        if (!derivative.data || derivative.data.status !== 'ready') continue
        const token = randomBytes(32).toString('base64url')
        const grantInsert = await service.from('publication_media_grants').insert({
          organization_id: publication.data.organization_id, media_derivative_id: derivative.data.id, publication_id: params.id,
          token_hash: createHash('sha256').update(token).digest('hex'), expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        })
        if (grantInsert.error) throw grantInsert.error
        media.push({
          derivativeId: derivative.data.id as string, sha256: derivative.data.sha256 as string, mimeType: derivative.data.mime_type as string,
          grantUrl: `${environment.API_PUBLIC_BASE_URL}/v1/media-grants/${token}`, role: row.position === 0 ? 'primary' : 'slide',
        })
      }

      publicationInput = {
        publicationId: params.id, postVersionId: version.data.id as string, socialConnectionId: publication.data.social_connection_id as string,
        platform: publication.data.platform as 'instagram' | 'facebook', caption: version.data.caption as string, media,
        idempotencyKey: publication.data.idempotency_key as string,
      }
      publisher = createPublisherForConnection(publicationInput.platform, accessToken, connection.data.external_account_id as string)
      validation = await publisher.validate(publicationInput)

      // unique(publication_id, attempt_number) auf publication_attempts -- ein hartkodierter Wert 1
      // wuerde jeden erneuten Versuch derselben Publication an dieser Constraint scheitern lassen
      // (Code-Review zu PR #25).
      const previousAttempt = await service.from('publication_attempts').select('attempt_number').eq('publication_id', params.id).order('attempt_number', { ascending: false }).limit(1).maybeSingle()
      if (previousAttempt.error) throw previousAttempt.error
      nextAttemptNumber = ((previousAttempt.data?.attempt_number as number | undefined) ?? 0) + 1
    } catch (err) {
      await releaseClaim()
      await revokeGrants()
      throw err
    }

    if (!validation.valid) {
      await revokeGrants()
      const attemptInsert = await service.from('publication_attempts').insert({
        organization_id: publication.data.organization_id, publication_id: params.id, attempt_number: nextAttemptNumber,
        status: 'failed', error_class: 'validation', response_summary: { errors: validation.errors },
      })
      if (attemptInsert.error) request.log.error({ err: attemptInsert.error, correlationId: request.id }, 'publication_attempts insert failed')
      const markFailed = await service.from('publications').update({ status: 'failed' }).eq('id', params.id)
      if (markFailed.error) request.log.error({ err: markFailed.error, correlationId: request.id }, 'publications status update failed')
      return reply.code(422).send({ error: 'validation_failed', detail: validation.errors, correlationId: request.id })
    }

    try {
      const result = await publisher.publish(publicationInput)
      const markPublished = await service.from('publications').update({ status: result.status, provider_publication_id: result.externalId }).eq('id', params.id)
      if (markPublished.error) request.log.error({ err: markPublished.error, correlationId: request.id }, 'publications status update failed')
      const attemptInsert = await service.from('publication_attempts').insert({
        organization_id: publication.data.organization_id, publication_id: params.id, attempt_number: nextAttemptNumber,
        status: result.status, provider_container_id: result.externalId, response_summary: result.permalink ? { permalink: result.permalink } : {},
      })
      if (attemptInsert.error) request.log.error({ err: attemptInsert.error, correlationId: request.id }, 'publication_attempts insert failed')
      await recordAuditEvent(request, {
        organizationId: publication.data.organization_id as string, action: 'post.published', entityType: 'publications', entityId: params.id,
        metadata: { platform: publicationInput.platform, status: result.status },
      })
      await revokeGrants()
      return reply.code(200).send(PublicationExecuteResultSchema.parse({ id: params.id, status: result.status, externalId: result.externalId, permalink: result.permalink }))
    } catch (err) {
      // Klassifikation nach Plan 004: MetaPublisher kodiert den HTTP-Status im Fehlertext
      // ("... (404)"), da SocialPublisher.publish() keinen strukturierten Fehler liefert -- ein
      // 4xx vom Provider ist nicht retry-faehig (falsche Eingabe/Berechtigung), 5xx/Netzwerk schon,
      // ein nicht einordbarer Fehler bleibt unbekannt. Dokumentierte Grenze: haengt am
      // Nachrichtenformat von MetaPublisher, kein strukturierter Fehlertyp ueber SocialPublisher
      // (siehe plans/025, Abschnitt "Umsetzung: Ergebnis und Abweichungen vom Plan").
      const httpStatus = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined
      const classification: { errorClass: 'non_retryable' | 'retryable' | 'unknown'; status: 'failed' | 'action_required' } =
        httpStatus && Number(httpStatus) >= 400 && Number(httpStatus) < 500 ? { errorClass: 'non_retryable', status: 'failed' }
        : httpStatus && Number(httpStatus) >= 500 ? { errorClass: 'retryable', status: 'action_required' }
        : { errorClass: 'unknown', status: 'action_required' }
      const markStatus = await service.from('publications').update({ status: classification.status }).eq('id', params.id)
      if (markStatus.error) request.log.error({ err: markStatus.error, correlationId: request.id }, 'publications status update failed')
      const attemptInsert = await service.from('publication_attempts').insert({
        organization_id: publication.data.organization_id, publication_id: params.id, attempt_number: nextAttemptNumber,
        status: 'failed', error_class: classification.errorClass, response_summary: { message: err instanceof Error ? err.message : 'unknown_error' },
      })
      if (attemptInsert.error) request.log.error({ err: attemptInsert.error, correlationId: request.id }, 'publication_attempts insert failed')
      await revokeGrants()
      return reply.code(502).send({ error: 'publish_failed', correlationId: request.id })
    }
  })

  // Kein requireAuth: Meta ruft diese URL serverseitig ab (Plan 006, Abschnitt "Sichere
  // Medienuebergabe"). Nach demselben Muster wie die oeffentlichen Einwilligungs-Token-Seiten aus
  // Paket 015 -- Service Role fuer den Lookup, Hash- statt Rohtoken-Vergleich, keine Unterscheidung
  // zwischen ungueltig/abgelaufen/bereits widerrufen.
  app.get('/v1/media-grants/:token', async (request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow')
    // Wie die oeffentlichen Einwilligungs-Token-Seiten aus Paket 015 (checkRateLimit, weiter unten
    // in derselben Funktion definiert, aber zur Aufrufzeit laengst initialisiert): ohne Limit loest
    // jeder Aufruf eine unauthentifizierte DB-Abfrage und potenziell einen Storage-Download aus.
    if (!checkRateLimit(`media-grant:${request.ip}`, 60, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ token: z.string().min(1) }).parse(request.params)
    const service = supabaseClients.forService()
    const tokenHash = createHash('sha256').update(params.token).digest('hex')
    const grant = await service.from('publication_media_grants').select('media_derivative_id, expires_at, revoked_at').eq('token_hash', tokenHash).maybeSingle()
    if (grant.error) throw grant.error
    if (!grant.data || grant.data.revoked_at !== null || new Date(grant.data.expires_at as string).getTime() < Date.now()) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const derivative = await service.from('media_derivatives').select('bucket_id, object_path, mime_type, status').eq('id', grant.data.media_derivative_id as string).maybeSingle()
    if (derivative.error) throw derivative.error
    if (!derivative.data || derivative.data.status !== 'ready') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const download = await service.storage.from(derivative.data.bucket_id as string).download(derivative.data.object_path as string)
    if (download.error || !download.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const markAccessed = await service.from('publication_media_grants').update({ accessed_at: new Date().toISOString() }).eq('token_hash', tokenHash)
    if (markAccessed.error) request.log.error({ err: markAccessed.error, correlationId: request.id }, 'publication_media_grants accessed_at update failed')
    const bytes = Buffer.from(await download.data.arrayBuffer())
    return reply
      .header('content-type', derivative.data.mime_type as string)
      .header('content-length', bytes.byteLength)
      .header('x-content-type-options', 'nosniff')
      .send(bytes)
  })

  app.get('/v1/organizations/:id/channel-quotas', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const rows = await client.from('channel_quotas').select('id, scope, department_id, team_id, social_connection_id, period, max_publications').eq('organization_id', params.id)
    if (rows.error) throw rows.error
    return reply.code(200).send(
      rows.data.map((row) =>
        ChannelQuotaSchema.parse({
          id: row.id, scope: row.scope, scopeId: row.team_id ?? row.department_id ?? params.id, socialConnectionId: row.social_connection_id,
          period: row.period, maxPublications: row.max_publications,
        }),
      ),
    )
  })

  app.post('/v1/channel-quotas', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateChannelQuotaRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!scope) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[input.scope], scope))) return
    const insert = await client
      .from('channel_quotas')
      .insert({
        organization_id: scope.organizationId, scope: input.scope, department_id: scope.departmentId ?? null, team_id: scope.teamId ?? null,
        social_connection_id: input.socialConnectionId ?? null, period: input.period, max_publications: input.maxPublications,
      })
      .select('id, scope, department_id, team_id, social_connection_id, period, max_publications')
      .single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'quota_already_exists', correlationId: request.id })
      // 23503 = foreign_key_violation, z. B. ein nicht existierender socialConnectionId.
      if (insert.error.code === '23503') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw insert.error
    }
    return reply.code(201).send(
      ChannelQuotaSchema.parse({
        id: insert.data.id, scope: insert.data.scope, scopeId: input.scopeId, socialConnectionId: insert.data.social_connection_id,
        period: insert.data.period, maxPublications: insert.data.max_publications,
      }),
    )
  })

  app.patch('/v1/channel-quotas/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateChannelQuotaRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('channel_quotas').select('organization_id, scope, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[existing.data.scope as ScopeLevel], scope))) return
    const update = await client.from('channel_quotas').update({ max_publications: input.maxPublications }).eq('id', params.id).select('id, scope, department_id, team_id, social_connection_id, period, max_publications')
    if (update.error) throw update.error
    // Wie bei DELETE unten: filtert RLS die Zielzeile aus dem UPDATE, trifft die Anweisung null
    // Zeilen ohne Fehler. Ein abschliessendes .single() haette daraus einen 500 gemacht statt eines
    // 403 (derselbe Grund wie bei DELETE /v1/departments/:id, siehe Kommentar dort).
    const updated = update.data[0]
    if (!updated) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    return reply.code(200).send(
      ChannelQuotaSchema.parse({
        id: updated.id, scope: updated.scope, scopeId: updated.team_id ?? updated.department_id ?? existing.data.organization_id,
        socialConnectionId: updated.social_connection_id, period: updated.period, maxPublications: updated.max_publications,
      }),
    )
  })

  app.delete('/v1/channel-quotas/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('channel_quotas').select('organization_id, scope, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, POLICY_MANAGE_PERMISSION[existing.data.scope as ScopeLevel], scope))) return
    const del = await client.from('channel_quotas').delete().eq('id', params.id).select('id')
    if (del.error) throw del.error
    if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    return reply.code(204).send()
  })

  // --- Paket 012: Kanaele und Social-Accounts -----------------------------------------------

  app.get('/v1/organizations/:id/channels', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const [connections, scopes] = await Promise.all([
      client.from('social_connections').select(SOCIAL_CONNECTION_COLUMNS).eq('organization_id', params.id).order('created_at'),
      client.from('channel_scopes').select('id, social_connection_id, scope, department_id, team_id, can_schedule').eq('organization_id', params.id),
    ])
    if (connections.error) throw connections.error
    if (scopes.error) throw scopes.error
    return reply.code(200).send(
      connections.data.map((row) =>
        SocialConnectionSchema.parse({
          ...mapSocialConnectionRow(row),
          scopes: scopes.data.filter((scopeRow) => scopeRow.social_connection_id === row.id).map((scopeRow) => mapChannelScopeRow(scopeRow, params.id)),
        }),
      ),
    )
  })

  app.patch('/v1/channels/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateSocialConnectionRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('social_connections').select('organization_id, owner_scope, owner_department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    const scope = toPermissionScope(organizationId, existing.data.owner_scope === 'department' ? (existing.data.owner_department_id as string) : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    // responsible_profile_id hat nur einen Fremdschluessel auf profiles, keinen auf die
    // Mitgliedschaft -- ohne diese Pruefung liesse sich ein Mitglied eines FREMDEN Vereins als
    // verantwortliche Person eintragen und damit require_channel_responsible mit einer Person
    // erfuellen, die im Verein gar nicht existiert. Service-Client, weil die Antwort hier eine
    // Eingabevalidierung ist: eine per RLS unsichtbare Mitgliedschaftszeile duerfte nicht als
    // "kein Mitglied" durchgehen.
    if (input.responsibleProfileId) {
      const isMember = await isAnyMemberOfOrganization(supabaseClients.forService(), input.responsibleProfileId, organizationId)
      if (!isMember) return reply.code(422).send({ error: 'responsible_not_a_member', correlationId: request.id })
    }
    // Gleicher Grund wie bei responsibleProfileId: presserechtliche Verantwortung (§ 18 MStV,
    // Paket 020) darf nicht auf ein Mitglied eines fremden Vereins zeigen.
    if (input.editorialResponsibleProfileId) {
      const isMember = await isAnyMemberOfOrganization(supabaseClients.forService(), input.editorialResponsibleProfileId, organizationId)
      if (!isMember) return reply.code(422).send({ error: 'editorial_responsible_not_a_member', correlationId: request.id })
    }
    const payload: Record<string, unknown> = {}
    if (input.displayName !== undefined) payload.display_name = input.displayName
    if (input.purpose !== undefined) payload.purpose = input.purpose
    if (input.responsibleProfileId !== undefined) payload.responsible_profile_id = input.responsibleProfileId
    if (input.confidential !== undefined) payload.confidential = input.confidential
    if (input.imprintUrl !== undefined) payload.imprint_url = input.imprintUrl
    if (input.privacyUrl !== undefined) payload.privacy_url = input.privacyUrl
    if (input.editorialResponsibleProfileId !== undefined) payload.editorial_responsible_profile_id = input.editorialResponsibleProfileId
    if (input.editorialResponsibleNote !== undefined) payload.editorial_responsible_note = input.editorialResponsibleNote
    // Kein Grant fuer authenticated auf social_connections ausser select (Plan 012, "Sicherheitsbefund
    // zuerst") -- die Berechtigungspruefung sitzt hier in TS, der Schreibzugriff im Service-Client,
    // wie schon bei den LLM-Provider-Konfigurationen.
    const service = supabaseClients.forService()
    const update = await service.from('social_connections').update(payload).eq('id', params.id).select(SOCIAL_CONNECTION_COLUMNS).single()
    if (update.error) throw update.error
    await recordAuditEvent(request, {
      organizationId,
      action: 'channel.updated',
      entityType: 'social_connections',
      entityId: params.id,
      // Nur die geaenderten Feldnamen, keine Werte -- purpose und displayName sind Freitext.
      metadata: { fields: Object.keys(input) },
    })
    const scopesResult = await service.from('channel_scopes').select('id, scope, department_id, team_id, can_schedule').eq('social_connection_id', params.id)
    if (scopesResult.error) throw scopesResult.error
    return reply.code(200).send(
      SocialConnectionSchema.parse({
        ...mapSocialConnectionRow(update.data),
        scopes: scopesResult.data.map((scopeRow) => mapChannelScopeRow(scopeRow, organizationId)),
      }),
    )
  })

  app.delete('/v1/channels/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('social_connections').select('organization_id, owner_scope, owner_department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    const scope = toPermissionScope(organizationId, existing.data.owner_scope === 'department' ? (existing.data.owner_department_id as string) : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const service = supabaseClients.forService()
    // Die Zeile bleibt (publications verweist per FK darauf), nur Status/archived_at aendern sich --
    // Geheimnis wird geloescht, damit kein Ciphertext eines getrennten Kanals liegen bleibt.
    const update = await service.from('social_connections').update({ status: 'disconnected', archived_at: new Date().toISOString() }).eq('id', params.id)
    if (update.error) throw update.error
    const secretDelete = await service.from('social_connection_secrets').delete().eq('social_connection_id', params.id)
    if (secretDelete.error) throw secretDelete.error
    await recordAuditEvent(request, { organizationId, action: 'channel.disconnected', entityType: 'social_connections', entityId: params.id })
    return reply.code(204).send()
  })

  app.post('/v1/channels/:id/verify', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('social_connections').select('organization_id, owner_scope, owner_department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    const scope = toPermissionScope(organizationId, existing.data.owner_scope === 'department' ? (existing.data.owner_department_id as string) : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const service = supabaseClients.forService()
    const secretRow = await service.from('social_connection_secrets').select('token_ciphertext, token_key_version').eq('social_connection_id', params.id).maybeSingle()
    if (secretRow.error) throw secretRow.error
    if (!secretRow.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const token = createSecretBoxFromEnvironment(environment).open(byteaToBuffer(secretRow.data.token_ciphertext as string), secretRow.data.token_key_version as string, params.id)
    const verification = await metaOAuthClient.verifyToken(token)
    const update = await service
      .from('social_connections')
      .update({ status: verification.valid ? 'active' : 'action_required', last_verified_at: new Date().toISOString() })
      .eq('id', params.id)
      .select(SOCIAL_CONNECTION_COLUMNS)
      .single()
    if (update.error) throw update.error
    await recordAuditEvent(request, {
      organizationId,
      action: 'channel.verified',
      entityType: 'social_connections',
      entityId: params.id,
      metadata: { valid: verification.valid },
    })
    const scopesResult = await service.from('channel_scopes').select('id, scope, department_id, team_id, can_schedule').eq('social_connection_id', params.id)
    if (scopesResult.error) throw scopesResult.error
    return reply.code(200).send(
      SocialConnectionSchema.parse({
        ...mapSocialConnectionRow(update.data),
        scopes: scopesResult.data.map((scopeRow) => mapChannelScopeRow(scopeRow, organizationId)),
      }),
    )
  })

  app.post('/v1/channels/:id/scopes', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateChannelScopeRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const connection = await client.from('social_connections').select('organization_id, owner_scope, owner_department_id').eq('id', params.id).maybeSingle()
    if (connection.error) throw connection.error
    if (!connection.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    // Massgeblich ist der Kanalbesitz, nicht die Ziel-Scope-Berechtigung: ein Abteilungsadmin darf
    // ausschliesslich Kanaele freigeben, die seine EIGENE Abteilung besitzt (Plan 012, "Zuordnung
    // und Verantwortung") -- nicht jeden Kanal, fuer dessen Zielebene er zufaellig
    // department.manage/team.manage haelt. Dieselbe Bedingung wie channel_scopes_insert (RLS bleibt
    // Verteidigung in der Tiefe, kein zweiter Weg).
    const ownerScope = toPermissionScope(connection.data.organization_id as string, connection.data.owner_scope === 'department' ? (connection.data.owner_department_id as string) : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', ownerScope))) return
    const targetScope = await resolveMembershipScope(client, input.scope, input.scopeId)
    if (!targetScope || targetScope.organizationId !== connection.data.organization_id) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const insert = await client
      .from('channel_scopes')
      .insert({
        organization_id: connection.data.organization_id,
        social_connection_id: params.id,
        scope: input.scope,
        department_id: targetScope.departmentId ?? null,
        team_id: targetScope.teamId ?? null,
        can_schedule: input.canSchedule,
        created_by: request.auth!.userId,
      })
      .select('id, scope, department_id, team_id, can_schedule')
      .single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'scope_already_exists', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, {
      organizationId: connection.data.organization_id as string,
      action: 'channel_scope.granted',
      entityType: 'channel_scopes',
      entityId: insert.data.id as string,
      metadata: { socialConnectionId: params.id, scope: input.scope, scopeId: input.scopeId, canSchedule: input.canSchedule },
    })
    return reply.code(201).send(ChannelScopeAssignmentSchema.parse(mapChannelScopeRow(insert.data, connection.data.organization_id as string)))
  })

  app.delete('/v1/channel-scopes/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('channel_scopes').select('organization_id, social_connection_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const connection = await client.from('social_connections').select('owner_scope, owner_department_id').eq('id', existing.data.social_connection_id).maybeSingle()
    if (connection.error) throw connection.error
    if (!connection.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, connection.data.owner_scope === 'department' ? (connection.data.owner_department_id as string) : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const del = await client.from('channel_scopes').delete().eq('id', params.id).select('id')
    if (del.error) throw del.error
    if (del.data.length === 0) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: existing.data.organization_id as string,
      action: 'channel_scope.revoked',
      entityType: 'channel_scopes',
      entityId: params.id,
      metadata: { socialConnectionId: existing.data.social_connection_id },
    })
    return reply.code(204).send()
  })

  app.get('/v1/organizations/:id/channel-policy', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const row = await client
      .from('policy_settings')
      .select('allow_department_owned_channels, require_channel_responsible')
      .eq('organization_id', params.id)
      .eq('scope', 'organization')
      .maybeSingle()
    if (row.error) throw row.error
    return reply.code(200).send(
      ChannelPolicySchema.parse({
        allowDepartmentOwnedChannels: row.data?.allow_department_owned_channels ?? false,
        requireChannelResponsible: row.data?.require_channel_responsible ?? false,
      }),
    )
  })

  // Aufgerufen per fetch (nicht per Browser-Navigation): eine vollstaendige Seitennavigation traegt
  // keinen Authorization-Header, deshalb liefert dieser Endpunkt die Autorisierungs-URL als JSON
  // zurueck und die Oberflaeche navigiert selbst dorthin (window.location.href).
  app.get('/v1/channels/connect/:platform/start', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ platform: SocialPlatformSchema }).parse(request.params)
    // ownerDepartmentId kommt hier als Query-Parameter statt im Body (GET) -- der leere String ist
    // deshalb ein gueltiger Eingangswert und bedeutet "nicht gesetzt": ein null-Wert wird von der
    // Query-Serialisierung des Browsers (ufo/withQuery hinter $fetch) als schluessellosen Parameter
    // angehaengt, und Fastify liest den als ''. Ohne diese Normalisierung scheiterte jeder
    // vereinseigene Verbindungsstart aus der Oberflaeche an der UUID-Pruefung (400).
    const query = z
      .object({ organizationId: UuidSchema, ownerScope: ChannelOwnerScopeSchema, ownerDepartmentId: UuidSchema.or(z.literal('')).nullish() })
      .parse(request.query)
    // Die Bedingung zwischen ownerScope und ownerDepartmentId steht im Vertrag, nicht hier -- damit
    // gilt fuer diese Route dieselbe Regel wie fuer jeden anderen Aufrufer des Schemas.
    const start = ChannelConnectStartRequestSchema.parse({
      ownerScope: query.ownerScope,
      ownerDepartmentId: query.ownerDepartmentId ? query.ownerDepartmentId : null,
    })
    const ownerDepartmentId = start.ownerDepartmentId
    const scope = toPermissionScope(query.organizationId, ownerDepartmentId)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    if (start.ownerScope === 'department') {
      const policyRow = await supabaseClients
        .forUser(request.auth!.accessToken)
        .from('policy_settings')
        .select('allow_department_owned_channels')
        .eq('organization_id', query.organizationId)
        .eq('scope', 'organization')
        .maybeSingle()
      if (policyRow.error) throw policyRow.error
      if (!(policyRow.data?.allow_department_owned_channels ?? false)) {
        return reply.code(403).send({ error: 'department_owned_channels_not_allowed', correlationId: request.id })
      }
    }
    if (!environment.META_OAUTH_REDIRECT_URL) return reply.code(503).send({ error: 'meta_not_configured', correlationId: request.id })
    const nonce = randomUUID()
    const insert = await supabaseClients.forService().from('oauth_states').insert({
      organization_id: query.organizationId,
      platform: params.platform,
      owner_scope: start.ownerScope,
      owner_department_id: ownerDepartmentId,
      nonce,
      created_by: request.auth!.userId,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    if (insert.error) throw insert.error
    const redirectUri = metaRedirectUri(environment.META_OAUTH_REDIRECT_URL, params.platform)
    const authorizationUrl = metaOAuthClient.authorizationUrl({ state: nonce, redirectUri, platform: params.platform })
    return reply.code(200).send({ authorizationUrl })
  })

  // Meta leitet den Browser hierher um -- kein Authorization-Header, keine requireAuth. Die
  // Vertrauensgrenze ist state: unerraten, einmalig, kurzlebig, an Organisation/Besitzebene
  // gebunden (Plan 012: "state niemals ungeprueft zurueckvertrauen").
  app.get('/v1/channels/connect/:platform/callback', async (request, reply) => {
    const params = z.object({ platform: SocialPlatformSchema }).parse(request.params)
    const query = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(request.query)
    const webBaseUrl = environment.WEB_BASE_URL ?? 'http://localhost:4200'

    if (query.error || !query.code || !query.state) {
      return reply.redirect(`${webBaseUrl}/kanaele?oauthError=denied`, 302)
    }
    const service = supabaseClients.forService()
    const stateRow = await service
      .from('oauth_states')
      .select('id, organization_id, platform, owner_scope, owner_department_id, created_by, expires_at, consumed_at')
      .eq('nonce', query.state)
      .maybeSingle()
    if (stateRow.error) throw stateRow.error
    if (
      !stateRow.data ||
      stateRow.data.platform !== params.platform ||
      stateRow.data.consumed_at !== null ||
      new Date(stateRow.data.expires_at as string).getTime() < Date.now()
    ) {
      return reply.redirect(`${webBaseUrl}/kanaele?oauthError=invalid_state`, 302)
    }
    // .is('consumed_at', null): einmalig verbrauchbar, sonst koennte ein doppelt zugestelltes
    // Callback (Netzwerk-Retry, zwei Tabs) denselben Code zweimal einloesen.
    const consume = await service.from('oauth_states').update({ consumed_at: new Date().toISOString() }).eq('id', stateRow.data.id).is('consumed_at', null).select('id')
    if (consume.error) throw consume.error
    if (consume.data.length === 0) return reply.redirect(`${webBaseUrl}/kanaele?oauthError=invalid_state`, 302)

    if (!environment.META_OAUTH_REDIRECT_URL) return reply.redirect(`${webBaseUrl}/kanaele?oauthError=meta_not_configured`, 302)
    const redirectUri = metaRedirectUri(environment.META_OAUTH_REDIRECT_URL, params.platform)

    let availableAccounts: readonly { externalAccountId: string; displayName: string; pageAccessToken: string }[]
    try {
      const shortLived = await metaOAuthClient.exchangeCode(query.code, redirectUri)
      const longLived = await metaOAuthClient.exchangeForLongLivedToken(shortLived.accessToken)
      availableAccounts = await metaOAuthClient.listAvailableAccounts(longLived.accessToken, params.platform)
    } catch (error) {
      request.log.warn({ err: error, correlationId: request.id }, 'meta oauth exchange failed')
      return reply.redirect(`${webBaseUrl}/kanaele?oauthError=meta_exchange_failed`, 302)
    }
    if (availableAccounts.length === 0) return reply.redirect(`${webBaseUrl}/kanaele?oauthError=no_accounts`, 302)

    const pendingId = randomUUID()
    const secretBox = createSecretBoxFromEnvironment(environment)
    // Jeder Seiten-Token einzeln versiegelt (AAD = pendingId + externalAccountId) -- die Auswahl
    // entschluesselt spaeter nur den EINEN gewaehlten Token, nie die ganze Liste auf einmal.
    const sealedAccounts = availableAccounts.map((account) => {
      const sealed = secretBox.seal(account.pageAccessToken, `${pendingId}:${account.externalAccountId}`)
      return {
        externalAccountId: account.externalAccountId,
        displayName: account.displayName,
        pageAccessTokenCiphertext: ciphertextToBytea(sealed.ciphertext).slice(2),
        pageAccessTokenKeyVersion: sealed.keyVersion,
      }
    })
    const insert = await service.from('oauth_pending_connections').insert({
      id: pendingId,
      organization_id: stateRow.data.organization_id,
      platform: params.platform,
      owner_scope: stateRow.data.owner_scope,
      owner_department_id: stateRow.data.owner_department_id,
      available_accounts: sealedAccounts,
      created_by: stateRow.data.created_by,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    if (insert.error) throw insert.error
    return reply.redirect(`${webBaseUrl}/kanaele?pending=${pendingId}`, 302)
  })

  app.get('/v1/oauth-pending/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const pending = await service
      .from('oauth_pending_connections')
      .select('id, organization_id, platform, owner_scope, owner_department_id, available_accounts, expires_at')
      .eq('id', params.id)
      .maybeSingle()
    if (pending.error) throw pending.error
    if (!pending.data || new Date(pending.data.expires_at as string).getTime() < Date.now()) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const scope = toPermissionScope(pending.data.organization_id as string, pending.data.owner_scope === 'department' ? (pending.data.owner_department_id as string) : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const accounts = pending.data.available_accounts as { externalAccountId: string; displayName: string }[]
    return reply.code(200).send(
      OAuthPendingConnectionSchema.parse({
        id: pending.data.id,
        platform: pending.data.platform,
        availableAccounts: accounts.map((account) => ({ externalAccountId: account.externalAccountId, displayName: account.displayName })),
      }),
    )
  })

  app.post('/v1/oauth-pending/:id/select', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = SelectOAuthAccountRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const pending = await service
      .from('oauth_pending_connections')
      .select('id, organization_id, platform, owner_scope, owner_department_id, available_accounts, expires_at')
      .eq('id', params.id)
      .maybeSingle()
    if (pending.error) throw pending.error
    if (!pending.data || new Date(pending.data.expires_at as string).getTime() < Date.now()) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const organizationId = pending.data.organization_id as string
    const ownerScope = pending.data.owner_scope
    const ownerDepartmentId = pending.data.owner_department_id
    const platform = pending.data.platform
    const scope = toPermissionScope(organizationId, ownerScope === 'department' ? (ownerDepartmentId as string) : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const accounts = pending.data.available_accounts as {
      externalAccountId: string
      displayName: string
      pageAccessTokenCiphertext: string
      pageAccessTokenKeyVersion: string
    }[]
    const chosen = accounts.find((account) => account.externalAccountId === input.externalAccountId)
    if (!chosen) return reply.code(404).send({ error: 'not_found', correlationId: request.id })

    const secretBox = createSecretBoxFromEnvironment(environment)
    const pageAccessToken = secretBox.open(Buffer.from(chosen.pageAccessTokenCiphertext, 'hex'), chosen.pageAccessTokenKeyVersion, `${params.id}:${chosen.externalAccountId}`)

    const insert = await service
      .from('social_connections')
      .insert({
        organization_id: organizationId,
        platform,
        external_account_id: chosen.externalAccountId,
        display_name: chosen.displayName,
        status: 'active',
        owner_scope: ownerScope,
        owner_department_id: ownerDepartmentId,
      })
      .select(SOCIAL_CONNECTION_COLUMNS)
      .single()
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'already_connected', correlationId: request.id })
      throw insert.error
    }

    // Re-verschluesselt mit der social_connection_id als AAD (nicht mehr pendingId) -- damit ein
    // Ciphertext nicht auf eine andere Verbindung umgehaengt werden kann (Plan 012, packages/secrets).
    const sealed = secretBox.seal(pageAccessToken, insert.data.id as string)
    const secretInsert = await service.from('social_connection_secrets').insert({
      organization_id: organizationId,
      social_connection_id: insert.data.id,
      token_ciphertext: ciphertextToBytea(sealed.ciphertext),
      token_key_version: sealed.keyVersion,
    })
    if (secretInsert.error) {
      // Ohne Rollback bliebe eine Kanalzeile ohne Geheimnis zurueck.
      await service.from('social_connections').delete().eq('id', insert.data.id)
      throw secretInsert.error
    }

    // Eigene Ebene bekommt automatisch eine Freigabe (Plan 012: "beim Verbinden legt die API
    // automatisch einen Eintrag fuer die eigene Ebene an, alles Weitere ist eine bewusste Freigabe").
    const defaultScope = await service.from('channel_scopes').insert({
      organization_id: organizationId,
      social_connection_id: insert.data.id,
      scope: ownerScope,
      department_id: ownerDepartmentId,
      team_id: null,
      can_schedule: true,
      created_by: request.auth!.userId,
    })
    if (defaultScope.error) throw defaultScope.error

    await recordAuditEvent(request, {
      organizationId,
      action: 'channel.connected',
      entityType: 'social_connections',
      entityId: insert.data.id as string,
      metadata: { platform, ownerScope, externalAccountId: chosen.externalAccountId },
    })

    // Bleibt die Zeile stehen, liegen die versiegelten Seiten-Tokens der ABGELEHNTEN Konten bis
    // expires_at weiter in der Datenbank -- der Aufruf darf nicht stillschweigend scheitern.
    // Geloggt statt geworfen: der Kanal ist zu diesem Zeitpunkt bereits angelegt.
    const pendingDelete = await service.from('oauth_pending_connections').delete().eq('id', params.id)
    if (pendingDelete.error) request.log.error({ err: pendingDelete.error, correlationId: request.id }, 'oauth_pending_connections delete failed')

    const scopesResult = await service.from('channel_scopes').select('id, scope, department_id, team_id, can_schedule').eq('social_connection_id', insert.data.id)
    if (scopesResult.error) throw scopesResult.error
    return reply.code(201).send(
      SocialConnectionSchema.parse({
        ...mapSocialConnectionRow(insert.data),
        scopes: scopesResult.data.map((scopeRow) => mapChannelScopeRow(scopeRow, organizationId)),
      }),
    )
  })

  app.get('/v1/post-versions/:id/available-channels', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const version = await client.from('post_versions').select('id, post_id, effective_config_snapshot').eq('id', params.id).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const post = await client.from('posts').select('id, organization_id, department_id, team_id').eq('id', version.data.post_id).maybeSingle()
    if (post.error) throw post.error
    if (!post.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.publish', { organizationId: post.data.organization_id, departmentId: post.data.department_id }))) return

    const [connections, scopeRows, policyRow] = await Promise.all([
      client.from('social_connections').select('id, status, archived_at, responsible_profile_id').eq('organization_id', post.data.organization_id),
      client.from('channel_scopes').select('social_connection_id, scope, department_id, team_id, can_schedule').eq('organization_id', post.data.organization_id),
      client.from('policy_settings').select('require_channel_responsible').eq('organization_id', post.data.organization_id).eq('scope', 'organization').maybeSingle(),
    ])
    if (connections.error) throw connections.error
    if (scopeRows.error) throw scopeRows.error
    if (policyRow.error) throw policyRow.error

    const snapshotConfig = (version.data.effective_config_snapshot as { config?: { allowedChannelIds?: unknown } } | null)?.config
    const allowedChannelIds = Array.isArray(snapshotConfig?.allowedChannelIds) ? (snapshotConfig!.allowedChannelIds as string[]) : null

    const candidates: ChannelCandidate[] = connections.data.map((connection) => ({
      socialConnectionId: connection.id as string,
      status: connection.status as ChannelCandidate['status'],
      archivedAt: connection.archived_at as string | null,
      responsibleProfileId: connection.responsible_profile_id as string | null,
      scopeGrants: scopeRows.data
        .filter((row) => row.social_connection_id === connection.id)
        .map((row) => ({
          scope: row.scope as ScopeLevelName,
          ...(row.department_id ? { departmentId: row.department_id as string } : {}),
          ...(row.team_id ? { teamId: row.team_id as string } : {}),
          canSchedule: row.can_schedule as boolean,
        })),
    }))

    const available = resolveAvailableChannels({
      scope: post.data.team_id ? 'team' : 'department',
      departmentId: post.data.department_id as string,
      ...(post.data.team_id ? { teamId: post.data.team_id as string } : {}),
      channels: candidates,
      allowedChannelIds,
      requireChannelResponsible: policyRow.data?.require_channel_responsible ?? false,
    })
    return reply.code(200).send(AvailableChannelsResponseSchema.parse({ socialConnectionIds: available }))
  })

  // --- Paket 014: Integrationsquellen -------------------------------------------------------

  app.get('/v1/organizations/:id/integration-sources', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rows = await client
      .from('integration_sources')
      .select(
        'id, organization_id, transport, provider_key, display_name, enabled_domains, department_id, endpoint_url, field_mapping, sync_cron, loss_threshold_percent, enabled, last_sync_at, last_sync_status, created_at',
      )
      .eq('organization_id', params.id)
      .order('created_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map(mapIntegrationSourceRow))
  })

  app.post('/v1/organizations/:id/integration-sources', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateIntegrationSourceRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveDirectoryScope(client, params.id, input.departmentId ?? null, null)
    if (scope === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'integration.manage', scope))) return
    // Zieladresse schon hier pruefen, damit ein unzulaessiger Wert gar nicht erst gespeichert wird
    // (siehe outboundFetch.ts); der Sync-Lauf prueft zur Laufzeit erneut, weil ein Name spaeter
    // auf eine andere Adresse zeigen kann.
    if (input.endpointUrl !== undefined && !isAllowedOutboundUrl(input.endpointUrl)) {
      return reply.code(400).send({ error: 'endpoint_not_allowed', correlationId: request.id })
    }
    const insert = await supabaseClients
      .forService()
      .from('integration_sources')
      .insert({
        organization_id: params.id,
        transport: input.transport,
        provider_key: input.providerKey,
        display_name: input.displayName,
        enabled_domains: input.enabledDomains,
        department_id: input.departmentId ?? null,
        endpoint_url: input.endpointUrl ?? null,
        field_mapping: input.fieldMapping ?? {},
        loss_threshold_percent: input.lossThresholdPercent ?? 30,
        created_by: request.auth!.userId,
      })
      .select(
        'id, organization_id, transport, provider_key, display_name, enabled_domains, department_id, endpoint_url, field_mapping, sync_cron, loss_threshold_percent, enabled, last_sync_at, last_sync_status, created_at',
      )
      .single()
    if (insert.error) {
      if (insert.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, {
      organizationId: params.id, action: 'integration_source.created', entityType: 'integration_sources', entityId: insert.data.id as string,
      metadata: { transport: input.transport, providerKey: input.providerKey, departmentId: input.departmentId ?? null },
    })
    return reply.code(201).send(mapIntegrationSourceRow(insert.data))
  })

  app.patch('/v1/integration-sources/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateIntegrationSourceRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('integration_sources').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null)
    if (!(await requirePermission(request, reply, 'integration.manage', scope))) return
    if (input.endpointUrl !== undefined && !isAllowedOutboundUrl(input.endpointUrl)) {
      return reply.code(400).send({ error: 'endpoint_not_allowed', correlationId: request.id })
    }
    const update: Record<string, unknown> = {}
    if (input.displayName !== undefined) update.display_name = input.displayName
    if (input.enabledDomains !== undefined) update.enabled_domains = input.enabledDomains
    if (input.endpointUrl !== undefined) update.endpoint_url = input.endpointUrl
    if (input.fieldMapping !== undefined) update.field_mapping = input.fieldMapping
    if (input.lossThresholdPercent !== undefined) update.loss_threshold_percent = input.lossThresholdPercent
    if (input.enabled !== undefined) update.enabled = input.enabled
    const result = await supabaseClients
      .forService()
      .from('integration_sources')
      .update(update)
      .eq('id', params.id)
      .select(
        'id, organization_id, transport, provider_key, display_name, enabled_domains, department_id, endpoint_url, field_mapping, sync_cron, loss_threshold_percent, enabled, last_sync_at, last_sync_status, created_at',
      )
      .single()
    if (result.error) {
      if (result.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw result.error
    }
    await recordAuditEvent(request, { organizationId: scope.organizationId, action: 'integration_source.updated', entityType: 'integration_sources', entityId: params.id, metadata: update })
    return reply.code(200).send(mapIntegrationSourceRow(result.data))
  })

  app.get('/v1/integration-sources/:id/sync-runs', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rows = await client
      .from('integration_sync_runs')
      .select('id, organization_id, source_id, domain, mode, status, created_count, updated_count, retired_count, skipped_count, conflict_count, error_class, started_at, finished_at')
      .eq('source_id', params.id)
      .order('started_at', { ascending: false })
      .limit(50)
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map(mapSyncRunRow))
  })

  app.get('/v1/integration-sources/:id/conflicts', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z.object({ resolution: z.enum(['pending', 'keep_current', 'take_incoming', 'ignore_permanently']).optional() }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    let builder = client
      .from('integration_sync_conflicts')
      .select('id, organization_id, sync_run_id, source_id, domain, external_id, local_id, label, field, current_value, incoming_value, kind, resolution, resolved_at, created_at')
      .eq('source_id', params.id)
    if (query.resolution) builder = builder.eq('resolution', query.resolution)
    const rows = await builder.order('created_at', { ascending: false }).limit(200)
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map(mapSyncConflictRow))
  })

  app.patch('/v1/integration-sync-conflicts/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = ResolveSyncConflictRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('integration_sync_conflicts').select('organization_id, source_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const source = await client.from('integration_sources').select('department_id').eq('id', existing.data.source_id).maybeSingle()
    if (source.error) throw source.error
    if (!source.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, source.data.department_id as string | null)
    if (!(await requirePermission(request, reply, 'integration.manage', scope))) return
    // Setzt nur die Entscheidung -- ignore_permanently unterdrueckt denselben Fingerabdruck ab dem
    // naechsten Lauf (der eigentliche Zweck), keep_current/take_incoming veraendern hier noch keine
    // directory_people-Zeile. Eine tatsaechliche Uebernahme von take_incoming braucht mehr Kontext,
    // als eine einzelne Konfliktzeile traegt (siehe plans/014, "Risiken und offene Entscheidungen");
    // der Weg heute ist: Quelle/Zuordnung korrigieren und erneut synchronisieren, oder die Person
    // manuell bearbeiten.
    const update = await supabaseClients
      .forService()
      .from('integration_sync_conflicts')
      .update({ resolution: input.resolution, resolved_by: request.auth!.userId, resolved_at: new Date().toISOString() })
      .eq('id', params.id)
      .select('id, organization_id, sync_run_id, source_id, domain, external_id, local_id, label, field, current_value, incoming_value, kind, resolution, resolved_at, created_at')
      .single()
    if (update.error) {
      // 23505: derselbe Fingerabdruck dieser Quelle ist bereits dauerhaft ignoriert
      // (integration_sync_conflicts_ignored_unique). Der Teilindex greift nur fuer bereits
      // ignorierte Zeilen, zwei Laeufe koennen denselben Fingerabdruck also je einmal als
      // 'pending' anlegen -- die zweite Aufloesung laeuft dann in den Unique-Verstoss. Fachlich
      // ist das Ziel bereits erreicht, deshalb 409 statt 500.
      if (update.error.code === '23505') return reply.code(409).send({ error: 'fingerprint_already_ignored', correlationId: request.id })
      throw update.error
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'integration_sync_conflict.resolved', entityType: 'integration_sync_conflicts', entityId: params.id, metadata: { resolution: input.resolution },
    })
    return reply.code(200).send(mapSyncConflictRow(update.data))
  })

  app.post('/v1/integration-sources/:id/sync', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const source = await client
      .from('integration_sources')
      .select('organization_id, department_id, transport, endpoint_url, enabled_domains, field_mapping, loss_threshold_percent, enabled')
      .eq('id', params.id)
      .maybeSingle()
    if (source.error) throw source.error
    if (!source.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = source.data.organization_id as string
    const sourceDepartmentId = source.data.department_id as string | null
    const sourceTransport = source.data.transport as string
    const sourceEndpointUrl = source.data.endpoint_url as string | null
    const sourceEnabledDomains = source.data.enabled_domains as string[]
    const sourceFieldMapping = source.data.field_mapping as FieldMapping
    const sourceLossThresholdPercent = source.data.loss_threshold_percent as number
    const scope = toPermissionScope(organizationId, sourceDepartmentId)
    if (!(await requirePermission(request, reply, 'integration.manage', scope))) return
    if (!source.data!.enabled) return reply.code(409).send({ error: 'source_disabled', correlationId: request.id })
    // integration.manage und department.manage sind heute deckungsgleich (department_admin und
    // Organisationsrollen haben beide), aber nur zufaellig -- ohne diese eigene Pruefung koennte
    // eine kuenftige, engere Rolle mit nur integration.manage ueber einen Sync-Lauf Elternkontakte
    // schreiben, obwohl das Rechtekonzept dafuer ausdruecklich department.manage verlangt (beim
    // adversarialen Review als Haertungsluecke benannt). Import-Zeilen ohne Elternkontaktfelder
    // sind davon nicht betroffen.
    const canWriteGuardianContact = hasPermission(await roleProvider.rolesForScope(request.auth!, scope), 'department.manage')

    let mode: SyncMode
    let domain: IntegrationDomain
    let rawRows: Readonly<Record<string, unknown>>[]

    if (sourceTransport === 'file') {
      if (!request.isMultipart()) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      let filePart: Awaited<ReturnType<typeof request.file>>
      let buffer: Buffer
      try {
        filePart = await request.file()
        if (!filePart) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
        buffer = await filePart.toBuffer()
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
        }
        return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      }
      const modeField = filePart.fields.mode
      const domainField = filePart.fields.domain
      const modeParsed = SyncModeSchema.safeParse(modeField && 'value' in modeField ? modeField.value : undefined)
      const domainParsed = IntegrationDomainSchema.safeParse(domainField && 'value' in domainField ? domainField.value : undefined)
      if (!modeParsed.success || !domainParsed.success) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      mode = modeParsed.data
      domain = domainParsed.data
      const isXlsx = /\.xlsx?$/i.test(filePart.filename ?? '')
      try {
        rawRows = await collectRows(new FileSourceTransport({ key: params.id, format: isXlsx ? 'xlsx' : 'csv', buffer }))
      } catch (error) {
        // csv-parse/exceljs werfen bei kaputten oder falsch formatierten Dateien synchron --
        // ohne diesen Fang landete ein einzelner unlesbarer Upload im generischen 500-Handler statt
        // einer verstaendlichen Fehlermeldung (beim adversarialen Review gefunden).
        request.log.warn({ err: error, correlationId: request.id }, 'file transport parse failed')
        return reply.code(400).send({ error: 'invalid_file', correlationId: request.id })
      }
    } else if (sourceTransport === 'ical') {
      const body = z.object({ mode: SyncModeSchema, domain: IntegrationDomainSchema }).safeParse(request.body)
      if (!body.success) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      mode = body.data.mode
      domain = body.data.domain
      if (!sourceEndpointUrl) return reply.code(409).send({ error: 'source_missing_endpoint', correlationId: request.id })
      let text: string
      try {
        // fetchPublicUrl statt fetch: die Adresse stammt aus der Datenbank und wird aus dem Netz
        // der API abgerufen -- ohne Zieladressenpruefung waere das ein Server-zu-Server-Proxy in
        // Loopback, privates Netz und Cloud-Metadatendienst (siehe outboundFetch.ts). Zeit- und
        // Groessengrenze haengen an derselben Stelle.
        text = await fetchPublicUrl(sourceEndpointUrl)
        // Ein erfolgreicher Abruf sagt nichts darueber aus, ob der Inhalt tatsaechlich ein
        // iCal-Feed ist -- z. B. eine Login-Weiterleitung antwortet oft mit 200 und HTML. Ohne
        // diese Pruefung waere ein erster Sync (existing=[] greift die Verlustschwelle nicht)
        // still "erfolgreich" mit null Personen (beim adversarialen Review als Randfall benannt).
        if (!text.includes('BEGIN:VCALENDAR')) throw new Error('response is not an iCal feed')
      } catch (error) {
        request.log.warn({ err: error, correlationId: request.id }, 'ical fetch failed')
        if (error instanceof OutboundFetchError && error.reason === 'blocked_url') {
          return reply.code(400).send({ error: 'endpoint_not_allowed', correlationId: request.id })
        }
        return reply.code(502).send({ error: 'source_fetch_failed', correlationId: request.id })
      }
      rawRows = await collectRows(new IcalSourceTransport({ key: params.id, text }))
    } else {
      // http/webhook: kein Adapter in diesem Paket (plans/014, "Entscheidungen vor der Umsetzung").
      return reply.code(400).send({ error: 'transport_not_implemented', correlationId: request.id })
    }

    if (!sourceEnabledDomains.includes(domain)) {
      return reply.code(400).send({ error: 'domain_not_enabled', correlationId: request.id })
    }

    const service = supabaseClients.forService()
    const correlationId = randomUUID()
    const referenceYear = new Date().getFullYear()

    // teams/fixtures/events (Paket 019) sind eigene, top-level Funktionen statt weiterer
    // Verzweigungen in diesem ohnehin schon langen Handler -- die Personen-Logik direkt darunter
    // bleibt dadurch unangetastet (chirurgische Aenderung statt eines Neu-Einrueckens von 250
    // Zeilen fuer ein neues if-Level).
    if (domain === 'teams' || domain === 'fixtures' || domain === 'events') {
      // integration.manage (oben bereits geprueft) und team.manage/fixture.manage/event.manage
      // sind heute deckungsgleich (department_admin hat alle vier), aber nur zufaellig -- dieselbe
      // Haertung wie canWriteGuardianContact bei der Personen-Domaene: eine kuenftige, engere
      // Rolle mit ausschliesslich integration.manage duerfte sonst Spielplaene/Veranstaltungen
      // schreiben, obwohl das Rechtekonzept dafuer die jeweils eigene Permission vorsieht.
      const domainPermission = domain === 'teams' ? 'team.manage' : domain === 'fixtures' ? 'fixture.manage' : 'event.manage'
      if (!(await requirePermission(request, reply, domainPermission, scope))) return
      const organizationRow = await service.from('organizations').select('timezone').eq('id', organizationId).single()
      if (organizationRow.error) throw organizationRow.error
      const syncContext: SyncDomainContext = {
        request, reply, service, organizationId, sourceDepartmentId, sourceId: params.id,
        sourceFieldMapping, sourceLossThresholdPercent, mode, domain, correlationId, rawRows,
        organizationTimezone: organizationRow.data.timezone as string,
      }
      if (domain === 'teams') return handleTeamsSync(syncContext)
      if (domain === 'fixtures') return handleFixturesSync(syncContext)
      return handleEventsSync(syncContext)
    }

    // ab hier: domain === 'people' -- IntegrationDomainSchema laesst keinen anderen Wert mehr zu.

    // Zustaendigkeitsbereich dieser Quelle: Personen ohne Quelle (fuer den unscharfen Abgleich
    // gegen von Hand gepflegte Eintraege) plus Personen, die bereits DIESER Quelle zugeordnet sind.
    // Personen einer anderen Quelle bleiben aussen vor, damit ein Lauf nicht die Zustaendigkeit
    // einer fremden Quelle stilllegt.
    // Die Abteilungsgrenze einer abteilungsgebundenen Quelle gilt nur fuer FREMDE Datensaetze
    // (source_id null, reiner Abgleichskandidat). Eigene Datensaetze gehoeren immer dazu, egal wo
    // sie inzwischen liegen: eine geloeschte Abteilung setzt department_id auf null, und eine
    // manuelle Umhaengung verschiebt die Person -- in beiden Faellen faende der naechste Lauf sie
    // sonst nicht mehr, legte sie erneut an und liefe in den Unique-Index auf
    // (organization_id, source_id, external_id).
    const existingRows = await service
      .from('directory_people')
      .select('id, first_name, last_name, birth_year, department_id, team_id, status, source_id, external_id, source_updated_at, updated_at')
      .eq('organization_id', organizationId)
      .or(sourceDepartmentId ? `and(source_id.is.null,department_id.eq.${sourceDepartmentId}),source_id.eq.${params.id}` : `source_id.is.null,source_id.eq.${params.id}`)
    if (existingRows.error) throw existingRows.error
    const existingLocals: DirectoryPersonLocal[] = existingRows.data.map((row) => ({
      id: row.id as string,
      externalId: row.external_id as string | null,
      sourceId: row.source_id as string | null,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      birthYear: row.birth_year as number | null,
      departmentId: row.department_id as string | null,
      teamId: row.team_id as string | null,
      status: row.status as DirectoryPersonLocal['status'],
      sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at as string) : null,
      updatedAt: new Date(row.updated_at as string),
    }))

    // Eine abteilungsgebundene Quelle darf ausschliesslich in ihre eigene Abteilung schreiben --
    // sonst koennte eine Spalte der Importdatei (z. B. "Handball" in einer Fussball-Quelle) eine
    // Person in eine Abteilung verschieben, in der der verwaltende department_admin gar kein
    // integration.manage/directory.read hat (beim adversarialen Review gefunden). Der
    // Abteilungsname aus der Datei zaehlt bei einer abteilungsgebundenen Quelle deshalb nur noch
    // als Bestaetigung/Mannschaftshinweis, nie als Ziel fuer eine ANDERE Abteilung; jeder
    // abweichende Name wird zur unknown_structure-Konfliktzeile statt stillschweigend übernommen
    // zu werden.
    const [departmentRows, teamRows] = await Promise.all([
      sourceDepartmentId
        ? service.from('departments').select('id, name').eq('id', sourceDepartmentId)
        : service.from('departments').select('id, name').eq('organization_id', organizationId),
      sourceDepartmentId
        ? service.from('teams').select('id, name, department_id').eq('department_id', sourceDepartmentId)
        : service.from('teams').select('id, name, department_id').eq('organization_id', organizationId),
    ])
    if (departmentRows.error) throw departmentRows.error
    if (teamRows.error) throw teamRows.error
    const departmentIdByName = new Map(departmentRows.data.map((row) => [normalizeStructureName(row.name as string), row.id as string]))
    const teamIdByName = new Map(teamRows.data.map((row) => [`${row.department_id}:${normalizeStructureName(row.name as string)}`, row.id as string]))
    const resolver: DepartmentResolver = {
      resolveDepartmentId: (name) => departmentIdByName.get(normalizeStructureName(name)),
      resolveTeamId: (departmentId, name) => teamIdByName.get(`${departmentId}:${normalizeStructureName(name)}`),
    }

    // Rohzeilen normalisieren/validieren. Eine Zeile, die PersonExternalSchema nicht erfuellt (z. B.
    // fehlender Nachname), wird ein invalid_record-Konflikt statt eines geworfenen Fehlers -- ein
    // einzelner kaputter Datensatz darf den ganzen Import nicht abbrechen.
    const incoming: PersonExternal[] = []
    const invalidRecords: { label: string; reason: string }[] = []
    let rowIndex = 0
    for (const raw of rawRows) {
      rowIndex += 1
      const normalized = peopleDomainAdapter.normalize(raw, sourceFieldMapping) as Record<string, unknown>
      const parsed = PersonExternalSchema.safeParse(normalized)
      if (!parsed.success) {
        const guessedName = [normalized.firstName, normalized.lastName].filter((value) => typeof value === 'string').join(' ').trim()
        invalidRecords.push({ label: guessedName || `Zeile ${rowIndex}`, reason: parsed.error.issues.map((issue) => issue.message).join('; ') })
        continue
      }
      // Elternkontaktfelder duerfen nur ins Verzeichnis, wenn der Aufrufer department.manage hat --
      // siehe Kommentar bei canWriteGuardianContact oben. match.ts vergleicht diese Felder nicht,
      // das Entfernen hier beeinflusst den Abgleich selbst also nicht.
      incoming.push(canWriteGuardianContact ? parsed.data : { ...parsed.data, guardianName: undefined, guardianEmail: undefined })
    }

    const plan = planSync({
      existing: existingLocals,
      incoming,
      match: createPeopleMatchStrategy(resolver),
      policy: { lossThresholdPercent: sourceLossThresholdPercent },
    })

    if (plan.aborted) {
      const run = await service
        .from('integration_sync_runs')
        .insert({
          organization_id: organizationId, source_id: params.id, domain, mode, status: 'aborted_loss_threshold',
          correlation_id: correlationId, finished_at: new Date().toISOString(), triggered_by: request.auth!.userId,
        })
        .select('id, organization_id, source_id, domain, mode, status, created_count, updated_count, retired_count, skipped_count, conflict_count, error_class, started_at, finished_at')
        .single()
      if (run.error) throw run.error
      await service.from('integration_sources').update({ last_sync_at: new Date().toISOString(), last_sync_status: 'aborted_loss_threshold' }).eq('id', params.id)
      return reply.code(200).send(SyncSourceResponseSchema.parse({ run: mapSyncRunRow(run.data), conflicts: [] }))
    }

    // Der Lauf wird VOR dem ersten Schreibvorgang angelegt (status 'running', der Vorgabewert der
    // Tabelle). Es gibt keine Transaktion ueber Anlage, Aenderung und Austritt -- bricht einer
    // dieser Schritte ab, bleiben die bereits geschriebenen Personen bestehen. Wuerde der Lauf
    // erst am Ende entstehen, saehe der Verein die Aenderung, aber nirgends ihre Herkunft; so
    // bleibt in jedem Fall eine Zeile mit 'failed' und error_class zurueck.
    const startedRun = await service
      .from('integration_sync_runs')
      .insert({
        organization_id: organizationId, source_id: params.id, domain, mode,
        correlation_id: correlationId, triggered_by: request.auth!.userId,
      })
      .select('id')
      .single()
    if (startedRun.error) throw startedRun.error
    const runId = startedRun.data.id as string

    // Dauerhaft ignorierte Fingerabdruecke dieser Quelle: ein Konflikt mit demselben Fingerabdruck
    // wird nicht neu angelegt (plans/014: "wird beim naechsten Lauf nicht neu angelegt").
    const ignored = await service.from('integration_sync_conflicts').select('fingerprint').eq('source_id', params.id).eq('resolution', 'ignore_permanently')
    if (ignored.error) throw ignored.error
    const ignoredFingerprints = new Set(ignored.data.map((row) => row.fingerprint as string))

    interface PendingConflict {
      kind: SyncConflictKind
      label: string
      field: string
      externalId: string | null
      localId: string | null
      currentValue: string | null
      incomingValue: string | null
      fingerprint: string
    }
    const pendingConflicts: PendingConflict[] = []
    for (const conflict of plan.conflicts) {
      const identity = conflict.incoming ? peopleDomainAdapter.identityOf(conflict.incoming) : null
      const externalId = identity && 'externalId' in identity ? identity.externalId : null
      const localId = conflict.candidates?.[0]?.id ?? null
      const field = conflict.kind === 'unknown_structure' ? 'structure' : 'identity'
      const fingerprint = conflictFingerprint([params.id, domain, conflict.kind, field, externalId ?? localId ?? conflict.label])
      if (ignoredFingerprints.has(fingerprint)) continue
      // unknown_structure traegt in conflict.reason den unaufgeloesten Rohwert aus der Datei (z. B.
      // ein Abteilungsname) -- eine falsch zugeordnete Spalte (IBAN, Adresse, ...) wuerde diesen
      // Wert sonst ungeprueft in eine nur ueber integration.manage (nicht department.manage)
      // geschuetzte und unauditierte Tabelle schreiben (beim adversarialen Review gefunden). Die
      // Zeile bleibt trotzdem loesbar: field/label zeigen genug Kontext, um die eigene
      // Feldzuordnung oder Quelldatei zu pruefen, ohne den moeglicherweise sensiblen Rohwert hier
      // zu spiegeln.
      const incomingValue = conflict.kind === 'unknown_structure' ? null : (conflict.reason ?? null)
      pendingConflicts.push({ kind: conflict.kind, label: conflict.label, field, externalId, localId, currentValue: null, incomingValue, fingerprint })
    }
    for (const invalid of invalidRecords) {
      const fingerprint = conflictFingerprint([params.id, domain, 'invalid_record', 'record', invalid.label])
      if (ignoredFingerprints.has(fingerprint)) continue
      pendingConflicts.push({ kind: 'invalid_record', label: invalid.label, field: 'record', externalId: null, localId: null, currentValue: null, incomingValue: invalid.reason, fingerprint })
    }

    // Eine neu anzulegende minderjaehrige Person ohne Elternkontakt wuerde am CHECK auf
    // directory_people scheitern (Migration 2026080703) -- hier vorab als Konflikt behandeln statt
    // den ganzen Lauf an einer einzelnen Zeile scheitern zu lassen.
    const applicableCreated: PersonExternal[] = []
    for (const entity of plan.created) {
      const isMinor = entity.birthYear !== undefined && deriveIsMinor(entity.birthYear, referenceYear)
      if (isMinor && (entity.status ?? 'active') === 'active' && !entity.guardianEmail) {
        const identityKey = entity.externalId ?? `${entity.firstName} ${entity.lastName}`
        const fingerprint = conflictFingerprint([params.id, domain, 'invalid_record', 'guardianEmail', identityKey])
        if (!ignoredFingerprints.has(fingerprint)) {
          pendingConflicts.push({
            kind: 'invalid_record', label: `${entity.firstName} ${entity.lastName}`, field: 'guardianEmail',
            externalId: entity.externalId ?? null, localId: null, currentValue: null, incomingValue: 'minderjaehrig ohne Elternkontakt', fingerprint,
          })
        }
        continue
      }
      applicableCreated.push(entity)
    }

    // Fuer dry_run bleibt dies der reine Vorschauwert (plan.updated.length), da nichts geschrieben
    // wird und ein CHECK-Fehlschlag deshalb nicht auftreten kann. Fuer apply wird jeder tatsaechlich
    // fehlgeschlagene Schreibvorgang unten abgezogen -- siehe Fund aus dem adversarialen Review.
    let appliedUpdatedCount = plan.updated.length
    const applyPlan = async (): Promise<void> => {
      if (applicableCreated.length > 0) {
        const insertRows = applicableCreated.map((entity) => {
          const resolved = resolvePersonScope(entity, resolver)
          const isMinor = entity.birthYear !== undefined ? deriveIsMinor(entity.birthYear, referenceYear) : false
          return {
            organization_id: organizationId,
            department_id: resolved.departmentId ?? sourceDepartmentId,
            team_id: resolved.teamId ?? null,
            first_name: entity.firstName, last_name: entity.lastName, birth_year: entity.birthYear ?? null,
            is_minor: isMinor, status: entity.status ?? 'active', joined_at: entity.joinedAt ?? null,
            guardian_name: entity.guardianName ?? null, guardian_email: entity.guardianEmail ?? null,
            source_id: params.id, external_id: entity.externalId ?? null, source_updated_at: entity.sourceUpdatedAt ?? null,
          }
        })
        const insert = await service.from('directory_people').insert(insertRows)
        if (insert.error) throw insert.error
      }
      for (const update of plan.updated) {
        const resolved = resolvePersonScope(update.external, resolver)
        // Durchgaengig `?? lokal`: ein Feld, das die Quelle nicht liefert, bleibt stehen. Fuer
        // birth_year stand hier `?? null` -- eine Importdatei ohne Geburtsjahrspalte leerte damit
        // jedes bereits gepflegte Geburtsjahr und entzog der Minderjaehrigkeitspruefung ihre
        // Grundlage (dieselbe Regel setzt MatchStrategy.fieldsOf fuer die Aenderungserkennung um).
        const patch: Record<string, unknown> = {
          first_name: update.external.firstName, last_name: update.external.lastName,
          birth_year: update.external.birthYear ?? update.local.birthYear,
          department_id: resolved.departmentId ?? update.local.departmentId, team_id: resolved.teamId ?? update.local.teamId,
          status: update.external.status ?? update.local.status,
          source_updated_at: update.external.sourceUpdatedAt ?? update.local.sourceUpdatedAt?.toISOString() ?? null,
        }
        if (update.external.birthYear !== undefined) patch.is_minor = deriveIsMinor(update.external.birthYear, referenceYear)
        const result = await service.from('directory_people').update(patch).eq('id', update.local.id)
        if (result.error) {
          // 23514: eine aktive Minderjaehrige ohne Elternkontakt -- fuer neu angelegte Personen
          // oben bereits vorab abgefangen; bei einer Aenderung (z. B. Geburtsjahr korrigiert sich
          // rueckwirkend) kann das erst hier auffallen. Die Zeile bleibt unveraendert stehen, aber
          // -- anders als zuvor -- nicht mehr stillschweigend: sie zaehlt nicht als "geaendert" und
          // erzeugt einen echten Konflikt, damit ein fehlgeschlagenes Update sichtbar bleibt statt
          // im Zaehlwert zu verschwinden (beim adversarialen Review gefunden).
          if (result.error.code !== '23514') throw result.error
          appliedUpdatedCount -= 1
          const identityKey = update.local.externalId ?? update.local.id
          const fingerprint = conflictFingerprint([params.id, domain, 'invalid_record', 'guardianEmail', identityKey])
          if (!ignoredFingerprints.has(fingerprint)) {
            pendingConflicts.push({
              kind: 'invalid_record', label: `${update.external.firstName} ${update.external.lastName}`, field: 'guardianEmail',
              externalId: update.local.externalId, localId: update.local.id, currentValue: null,
              incomingValue: 'minderjaehrig ohne Elternkontakt', fingerprint,
            })
          }
        }
      }
      for (const retired of plan.retired) {
        const result = await service.from('directory_people').update({ status: 'left' }).eq('id', retired.id)
        if (result.error) throw result.error
        const backfillLeftAt = await service.from('directory_people').update({ left_at: new Date().toISOString().slice(0, 10) }).eq('id', retired.id).is('left_at', null)
        if (backfillLeftAt.error) throw backfillLeftAt.error
      }
    }

    if (mode === 'apply') {
      try {
        await applyPlan()
      } catch (error) {
        // Der Lauf bleibt als 'failed' stehen, statt mit dem Request zu verschwinden: die bereits
        // geschriebenen Personen sind sonst ohne jeden Nachweis im Verzeichnis.
        const errorClass = error instanceof Error ? error.name : 'unknown'
        await service.from('integration_sync_runs').update({ status: 'failed', error_class: errorClass, finished_at: new Date().toISOString() }).eq('id', runId)
        await service.from('integration_sources').update({ last_sync_at: new Date().toISOString(), last_sync_status: 'failed' }).eq('id', params.id)
        throw error
      }
    }

    const run = await service
      .from('integration_sync_runs')
      .update({
        status: 'succeeded',
        created_count: applicableCreated.length, updated_count: appliedUpdatedCount, retired_count: plan.retired.length,
        skipped_count: plan.skipped.length, conflict_count: pendingConflicts.length,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .select('id, organization_id, source_id, domain, mode, status, created_count, updated_count, retired_count, skipped_count, conflict_count, error_class, started_at, finished_at')
      .single()
    if (run.error) throw run.error

    let conflictRows: Record<string, unknown>[] = []
    if (pendingConflicts.length > 0) {
      const conflictInsert = await service
        .from('integration_sync_conflicts')
        .insert(
          pendingConflicts.map((conflict) => ({
            organization_id: organizationId, sync_run_id: runId, source_id: params.id, domain,
            external_id: conflict.externalId, local_id: conflict.localId, label: conflict.label, field: conflict.field,
            current_value: conflict.currentValue, incoming_value: conflict.incomingValue, kind: conflict.kind, fingerprint: conflict.fingerprint,
          })),
        )
        .select('id, organization_id, sync_run_id, source_id, domain, external_id, local_id, label, field, current_value, incoming_value, kind, resolution, resolved_at, created_at')
      if (conflictInsert.error) throw conflictInsert.error
      conflictRows = conflictInsert.data
    }

    await service.from('integration_sources').update({ last_sync_at: new Date().toISOString(), last_sync_status: 'succeeded' }).eq('id', params.id)
    await recordAuditEvent(request, {
      organizationId, action: `integration_source.sync_${mode}`, entityType: 'integration_sync_runs', entityId: runId,
      // appliedUpdatedCount, nicht plan.updated.length: der Audit-Eintrag darf nicht mehr
      // Aenderungen behaupten, als tatsaechlich geschrieben wurden.
      metadata: { created: applicableCreated.length, updated: appliedUpdatedCount, retired: plan.retired.length, conflicts: pendingConflicts.length },
    })

    return reply.code(200).send(SyncSourceResponseSchema.parse({ run: mapSyncRunRow(run.data), conflicts: conflictRows.map(mapSyncConflictRow) }))
  })

  // --- Paket 019: Mannschaften, Spielplaene, Ergebnisse und Veranstaltungen ------------------
  //
  // Lesezugriff laeuft ueber den Nutzer-Client -- fixtures_select/club_events_select sind
  // vereinsweit (authz.is_any_member_of_organization), kein eigener requirePermission-Aufruf
  // noetig, genau wie bei GET .../directory-people unten. Schreibzugriff (dismiss) verlangt
  // post.create im betroffenen Scope, weil eine weggeklickte Vorschlagszeile nur relevant ist,
  // wenn man selbst Beitraege erstellen kann.

  app.get('/v1/organizations/:id/fixtures', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z
      .object({ departmentId: UuidSchema.optional(), teamId: UuidSchema.optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() })
      .parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    let builder = client
      .from('fixtures')
      .select('id, organization_id, department_id, team_id, kind, competition, is_home, own_team_label, opponent_name, kickoff_at, kickoff_time_confirmed, venue_name, venue_address, status, home_score, away_score, note, announcement_dismissed_at, result_dismissed_at, source_id, source_updated_at, created_at, updated_at')
      .eq('organization_id', params.id)
    if (query.departmentId) builder = builder.eq('department_id', query.departmentId)
    if (query.teamId) builder = builder.eq('team_id', query.teamId)
    if (query.from) builder = builder.gte('kickoff_at', query.from)
    if (query.to) builder = builder.lte('kickoff_at', query.to)
    const rows = await builder.order('kickoff_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map(mapFixtureRow))
  })

  app.get('/v1/organizations/:id/club-events', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z
      .object({ departmentId: UuidSchema.optional(), teamId: UuidSchema.optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() })
      .parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    let builder = client
      .from('club_events')
      .select('id, organization_id, department_id, team_id, title, description, category, starts_at, ends_at, all_day, location_name, location_address, registration_url, status, invitation_dismissed_at, source_id, source_updated_at, created_at, updated_at')
      .eq('organization_id', params.id)
    if (query.departmentId) builder = builder.eq('department_id', query.departmentId)
    if (query.teamId) builder = builder.eq('team_id', query.teamId)
    if (query.from) builder = builder.gte('starts_at', query.from)
    if (query.to) builder = builder.lte('starts_at', query.to)
    const rows = await builder.order('starts_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map(mapClubEventRow))
  })

  app.post('/v1/fixtures/:id/dismiss-announcement', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('fixtures').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string)))) return
    const update = await supabaseClients.forService().from('fixtures').update({ announcement_dismissed_at: new Date().toISOString() }).eq('id', params.id).select('id, organization_id, department_id, team_id, kind, competition, is_home, own_team_label, opponent_name, kickoff_at, kickoff_time_confirmed, venue_name, venue_address, status, home_score, away_score, note, announcement_dismissed_at, result_dismissed_at, source_id, source_updated_at, created_at, updated_at').single()
    if (update.error) throw update.error
    return reply.code(200).send(mapFixtureRow(update.data))
  })

  app.post('/v1/fixtures/:id/dismiss-result', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('fixtures').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string)))) return
    const update = await supabaseClients.forService().from('fixtures').update({ result_dismissed_at: new Date().toISOString() }).eq('id', params.id).select('id, organization_id, department_id, team_id, kind, competition, is_home, own_team_label, opponent_name, kickoff_at, kickoff_time_confirmed, venue_name, venue_address, status, home_score, away_score, note, announcement_dismissed_at, result_dismissed_at, source_id, source_updated_at, created_at, updated_at').single()
    if (update.error) throw update.error
    return reply.code(200).send(mapFixtureRow(update.data))
  })

  app.post('/v1/club-events/:id/dismiss-invitation', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('club_events').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.create', toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null)))) return
    const update = await supabaseClients.forService().from('club_events').update({ invitation_dismissed_at: new Date().toISOString() }).eq('id', params.id).select('id, organization_id, department_id, team_id, title, description, category, starts_at, ends_at, all_day, location_name, location_address, registration_url, status, invitation_dismissed_at, source_id, source_updated_at, created_at, updated_at').single()
    if (update.error) throw update.error
    return reply.code(200).send(mapClubEventRow(update.data))
  })

  // Anlassvorschlaege: zustandslos aus reinen Lesevergleichen berechnet (plans/019,
  // "Entscheidungen vor der Umsetzung" -- kein taeglicher Job, keine Cron-Infrastruktur vorhanden,
  // Paket 004 weiterhin "in Arbeit"). Nur die drei ereignisgebundenen Regeln (Ankuendigung,
  // Ergebnis, Einladung) -- der vierte, allgemeine Kontingent-Anstoss aus dem Plan bleibt
  // bewusst offen (siehe Plan, "Umsetzung: Ergebnis und Abweichungen"): er braucht dieselbe
  // periodengenaue Kontingentberechnung wie public.schedule_publication, deren Duplizierung hier
  // ohne eigene Tests mehr Risiko als Nutzen waere.
  app.get('/v1/departments/:id/content-suggestions', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const department = await client.from('departments').select('organization_id').eq('id', params.id).maybeSingle()
    if (department.error) throw department.error
    if (!department.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(department.data.organization_id as string, params.id)
    if (!(await requirePermission(request, reply, 'post.create', scope))) return

    const now = new Date()
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const past48Hours = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
    const nowIso = now.toISOString()

    const [upcomingFixtures, playedFixtures, upcomingEvents, submissionsWithFixture, submissionsWithEvent] = await Promise.all([
      client.from('fixtures').select('id, opponent_name, kickoff_at, source_updated_at, announcement_dismissed_at')
        .eq('department_id', params.id).neq('status', 'cancelled').gte('kickoff_at', nowIso).lte('kickoff_at', in3Days),
      client.from('fixtures').select('id, opponent_name, kickoff_at, home_score, away_score, source_updated_at, result_dismissed_at')
        .eq('department_id', params.id).eq('status', 'played').gte('kickoff_at', past48Hours).lte('kickoff_at', nowIso),
      client.from('club_events').select('id, title, starts_at, source_updated_at, invitation_dismissed_at')
        .eq('department_id', params.id).neq('status', 'cancelled').gte('starts_at', nowIso).lte('starts_at', in14Days),
      // fetchAllRows aus demselben Grund wie bei membersWithApprovePermission: max_rows=1000
      // wuerde bei vielen bereits verknuepften Einreichungen einige stillschweigend abschneiden.
      fetchAllRows<{ fixture_id: string }>((from, to) =>
        client.from('submissions').select('fixture_id').eq('department_id', params.id).not('fixture_id', 'is', null).range(from, to),
      ),
      fetchAllRows<{ club_event_id: string }>((from, to) =>
        client.from('submissions').select('club_event_id').eq('department_id', params.id).not('club_event_id', 'is', null).range(from, to),
      ),
    ])
    if (upcomingFixtures.error) throw upcomingFixtures.error
    if (playedFixtures.error) throw playedFixtures.error
    if (upcomingEvents.error) throw upcomingEvents.error

    const fixtureIdsWithSubmission = new Set(submissionsWithFixture.map((row) => row.fixture_id))
    const eventIdsWithSubmission = new Set(submissionsWithEvent.map((row) => row.club_event_id))
    // Wiederkehr nach einer Korrektur in der Quelle: erscheint wieder, sobald source_updated_at
    // neuer ist als der Zeitstempel des Wegklickens -- ein verlegtes Spiel ist eine neue
    // Ankuendigung (plans/019, Abschnitt 4).
    const isDismissed = (dismissedAt: string | null, sourceUpdatedAt: string | null): boolean => {
      if (!dismissedAt) return false
      if (!sourceUpdatedAt) return true
      return new Date(sourceUpdatedAt) <= new Date(dismissedAt)
    }

    const suggestions: ContentSuggestion[] = []
    for (const fixture of upcomingFixtures.data) {
      if (fixtureIdsWithSubmission.has(fixture.id as string)) continue
      if (isDismissed(fixture.announcement_dismissed_at as string | null, fixture.source_updated_at as string | null)) continue
      suggestions.push({
        kind: 'fixture_announcement', departmentId: params.id, fixtureId: fixture.id as string,
        occursAt: fixture.kickoff_at as string,
        label: fixture.opponent_name ? `Spielankündigung gegen ${fixture.opponent_name as string} fehlt noch` : 'Spielankündigung fehlt noch',
      })
    }
    for (const fixture of playedFixtures.data) {
      if (fixtureIdsWithSubmission.has(fixture.id as string)) continue
      if (isDismissed(fixture.result_dismissed_at as string | null, fixture.source_updated_at as string | null)) continue
      suggestions.push({
        kind: 'fixture_result', departmentId: params.id, fixtureId: fixture.id as string,
        occursAt: fixture.kickoff_at as string,
        label: fixture.opponent_name ? `Ergebnis gegen ${fixture.opponent_name as string} noch nicht erzählt` : 'Ergebnis noch nicht erzählt',
      })
    }
    for (const event of upcomingEvents.data) {
      if (eventIdsWithSubmission.has(event.id as string)) continue
      if (isDismissed(event.invitation_dismissed_at as string | null, event.source_updated_at as string | null)) continue
      suggestions.push({ kind: 'event_invitation', departmentId: params.id, clubEventId: event.id as string, occursAt: event.starts_at as string, label: `Einladung zu „${event.title as string}“ fehlt noch` })
    }
    suggestions.sort((a, b) => (a.occursAt ?? '').localeCompare(b.occursAt ?? ''))

    return reply.code(200).send(ContentSuggestionsResponseSchema.parse({ suggestions }))
  })

  // --- Paket 014: Mitgliederverzeichnis ------------------------------------------------------

  app.get('/v1/organizations/:id/directory-people', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z
      .object({
        departmentId: UuidSchema.optional(), teamId: UuidSchema.optional(), status: DirectoryPersonStatusSchema.optional(),
        // z.stringbool() statt z.coerce.boolean(): letzteres ist Boolean(value), und damit ist
        // jeder nicht-leere String wahr -- '?isMinor=false' haette genau die Minderjaehrigen
        // geliefert, die es ausschliessen sollte.
        isMinor: z.stringbool().optional(), missingGuardian: z.stringbool().optional(),
      })
      .parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    let builder = client
      .from('directory_people')
      .select('id, organization_id, department_id, team_id, first_name, last_name, birth_year, is_minor, status, left_at, joined_at, profile_id, became_adult_at, source_id, created_at')
      .eq('organization_id', params.id)
    if (query.departmentId) builder = builder.eq('department_id', query.departmentId)
    if (query.teamId) builder = builder.eq('team_id', query.teamId)
    if (query.status) builder = builder.eq('status', query.status)
    if (query.isMinor !== undefined) builder = builder.eq('is_minor', query.isMinor)
    const rows = await builder.order('last_name').order('first_name')
    if (rows.error) throw rows.error
    let visible = rows.data
    if (query.missingGuardian) {
      // guardian_email ist fuer authenticated nicht selektierbar (Spaltenrechte, Migration
      // 2026080703) -- der Filter braucht deshalb die Service Role. Gefiltert wird aber erst
      // NACH der sichtbarkeitsbeschraenkten Abfrage, auf deren Ergebnis: die IDs gehen nie als
      // Query-String in eine zweite Abfrage (`.in('id', …)` mit einer unbegrenzten Liste
      // scheiterte ab einigen hundert Personen an der URL-Laenge und wurde zusaetzlich von
      // PostgREST' max_rows stillschweigend gekappt).
      const missing = await fetchAllRows<{ id: string }>((from, to) =>
        supabaseClients.forService().from('directory_people').select('id').eq('organization_id', params.id).is('guardian_email', null).range(from, to),
      )
      const missingIds = new Set(missing.map((row) => row.id))
      visible = visible.filter((row) => missingIds.has(row.id as string))
    }
    return reply.code(200).send(visible.map(mapDirectoryPersonRow))
  })

  app.post('/v1/organizations/:id/directory-people', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateDirectoryPersonRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveDirectoryScope(client, params.id, input.departmentId ?? null, input.teamId ?? null)
    if (scope === null) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'directory.read', scope))) return
    const touchesGuardianContact = input.guardianName !== undefined || input.guardianEmail !== undefined
    if (touchesGuardianContact && !(await requirePermission(request, reply, 'department.manage', scope))) return
    if (input.profileId && !(await isAnyMemberOfOrganization(client, input.profileId, params.id))) {
      return reply.code(400).send({ error: 'profile_not_a_member', correlationId: request.id })
    }
    const referenceYear = new Date().getFullYear()
    const isMinor = resolveIsMinor(input.isMinor, input.birthYear ?? null, referenceYear)
    const status = input.status ?? 'active'
    const insert = await supabaseClients
      .forService()
      .from('directory_people')
      .insert({
        organization_id: params.id, department_id: input.departmentId ?? null, team_id: input.teamId ?? null,
        first_name: input.firstName, last_name: input.lastName, birth_year: input.birthYear ?? null,
        is_minor: isMinor, status, joined_at: input.joinedAt ?? null,
        guardian_name: input.guardianName ?? null, guardian_email: input.guardianEmail ?? null, profile_id: input.profileId ?? null,
      })
      .select('id, organization_id, department_id, team_id, first_name, last_name, birth_year, is_minor, status, left_at, joined_at, profile_id, became_adult_at, source_id, created_at')
      .single()
    if (insert.error) {
      if (insert.error.code === '23514') return reply.code(400).send({ error: 'guardian_contact_required', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, {
      organizationId: params.id, action: 'directory_person.created', entityType: 'directory_people', entityId: insert.data.id as string,
      metadata: { departmentId: input.departmentId ?? null, teamId: input.teamId ?? null },
    })
    return reply.code(201).send(mapDirectoryPersonRow(insert.data))
  })

  app.patch('/v1/directory-people/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateDirectoryPersonRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('directory_people').select('organization_id, department_id, team_id, birth_year').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const currentScope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, 'directory.read', currentScope))) return

    let targetScope = currentScope
    if (input.departmentId !== undefined || input.teamId !== undefined) {
      const targetDepartmentId = input.departmentId !== undefined ? input.departmentId : (existing.data.department_id as string | null)
      const targetTeamId = input.teamId !== undefined ? input.teamId : (existing.data.team_id as string | null)
      const resolved = await resolveDirectoryScope(client, existing.data.organization_id as string, targetDepartmentId, targetTeamId)
      if (resolved === null) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      if (!(await requirePermission(request, reply, 'directory.read', resolved))) return
      targetScope = resolved
    }
    const touchesGuardianContact = input.guardianName !== undefined || input.guardianEmail !== undefined
    if (touchesGuardianContact) {
      if (!(await requirePermission(request, reply, 'department.manage', currentScope))) return
      if (targetScope !== currentScope && !(await requirePermission(request, reply, 'department.manage', targetScope))) return
    }
    if (input.profileId && !(await isAnyMemberOfOrganization(client, input.profileId, existing.data.organization_id as string))) {
      return reply.code(400).send({ error: 'profile_not_a_member', correlationId: request.id })
    }

    const referenceYear = new Date().getFullYear()
    const update: Record<string, unknown> = {}
    if (input.firstName !== undefined) update.first_name = input.firstName
    if (input.lastName !== undefined) update.last_name = input.lastName
    if (input.departmentId !== undefined) update.department_id = input.departmentId
    if (input.teamId !== undefined) update.team_id = input.teamId
    if (input.birthYear !== undefined) update.birth_year = input.birthYear
    if (input.status !== undefined) update.status = input.status
    if (input.leftAt !== undefined) update.left_at = input.leftAt
    if (input.joinedAt !== undefined) update.joined_at = input.joinedAt
    if (input.guardianName !== undefined) update.guardian_name = input.guardianName
    if (input.guardianEmail !== undefined) update.guardian_email = input.guardianEmail
    if (input.profileId !== undefined) update.profile_id = input.profileId
    // Massgeblich ist das Geburtsjahr nach dieser Aenderung, nicht die Angabe des Aufrufers --
    // siehe resolveIsMinor. Bleibt das Geburtsjahr unberuehrt, zaehlt das gespeicherte.
    const effectiveBirthYear = input.birthYear !== undefined ? input.birthYear : (existing.data.birth_year as number | null)
    if (input.isMinor !== undefined || input.birthYear !== undefined) {
      update.is_minor = resolveIsMinor(input.isMinor, effectiveBirthYear, referenceYear)
    }

    // createPeopleMatchStrategy.localUpdatedAtOf (packages/member-directory) vergleicht
    // source_updated_at, nicht updated_at -- sonst wuerde ein frischer Sync-Lauf (der
    // updated_at ueber den generischen Trigger ebenfalls anhebt) faelschlich als "lokal neuer"
    // gelten, obwohl nur die Quelle selbst geschrieben hat. Eine manuelle Aenderung an einem der
    // von planSync verglichenen Felder muss deshalb selbst source_updated_at auf jetzt setzen,
    // sonst gewinnt beim naechsten Sync-Lauf stillschweigend wieder die (aeltere) Quelle gegen die
    // gerade erst korrigierten Daten (beim adversarialen Review gefunden).
    const touchesSyncedField = ['first_name', 'last_name', 'birth_year', 'department_id', 'team_id', 'status'].some((field) => field in update)
    if (touchesSyncedField) update.source_updated_at = new Date().toISOString()

    const result = await supabaseClients
      .forService()
      .from('directory_people')
      .update(update)
      .eq('id', params.id)
      .select('id, organization_id, department_id, team_id, first_name, last_name, birth_year, is_minor, status, left_at, joined_at, profile_id, became_adult_at, source_id, created_at')
      .maybeSingle()
    if (result.error) {
      if (result.error.code === '23514') return reply.code(400).send({ error: 'guardian_contact_required', correlationId: request.id })
      throw result.error
    }
    if (!result.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    await recordAuditEvent(request, {
      organizationId: existing.data.organization_id as string, action: 'directory_person.updated', entityType: 'directory_people', entityId: params.id, metadata: { fields: Object.keys(update) },
    })
    return reply.code(200).send(mapDirectoryPersonRow(result.data))
  })

  app.get('/v1/directory-people/:id/guardian-contact', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('directory_people').select('organization_id, department_id, team_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null, existing.data.team_id as string | null)
    if (!(await requirePermission(request, reply, 'department.manage', scope))) return
    const guardian = await supabaseClients.forService().from('directory_people').select('guardian_name, guardian_email').eq('id', params.id).single()
    if (guardian.error) throw guardian.error
    await recordAuditEvent(request, { organizationId: scope.organizationId, action: 'directory_person.guardian_read', entityType: 'directory_people', entityId: params.id })
    return reply.code(200).send(DirectoryPersonGuardianContactSchema.parse({ guardianName: guardian.data.guardian_name, guardianEmail: guardian.data.guardian_email }))
  })

  // --- Paket 014: eigenes Profil (Selbstbedienung, keine Vereinsdaten) -----------------------

  app.get('/v1/me/profile', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const profile = await client.from('profiles').select('id, display_name, avatar_path').eq('id', request.auth!.userId).single()
    if (profile.error) throw profile.error
    return reply.code(200).send(ProfileSchema.parse({ id: profile.data.id, displayName: profile.data.display_name, avatarPath: profile.data.avatar_path }))
  })

  app.patch('/v1/me/profile', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = UpdateProfileRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const update: Record<string, unknown> = {}
    if (input.displayName !== undefined) update.display_name = input.displayName
    const result = await client.from('profiles').update(update).eq('id', request.auth!.userId).select('id, display_name, avatar_path').single()
    if (result.error) throw result.error
    return reply.code(200).send(ProfileSchema.parse({ id: result.data.id, displayName: result.data.display_name, avatarPath: result.data.avatar_path }))
  })

  // --- Paket 015: Einwilligungsverwaltung -----------------------------------------------------

  const CONSENT_RECORD_SELECT = 'id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, scope_structured, origin, source_id, signed_at, signer_name, signer_role, guardian_confirmed, valid_from, valid_until, revoked_at, revoked_by, revocation_reason, superseded_by, created_at'
  const CONSENT_REQUEST_SELECT = 'id, organization_id, department_id, directory_person_id, recipient_email, recipient_role, requested_scope, text_version, status, expires_at, responded_at, consent_record_id, send_count, last_sent_at, created_by, created_at'
  const ALLOWED_EVIDENCE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

  async function currentOrganizationConsentText(client: SupabaseClient, organizationId: string): Promise<{ id: string | null; body: string; createdAt: string | null }> {
    const latest = await client
      .from('organization_consent_texts')
      .select('id, body, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latest.error) throw latest.error
    if (!latest.data) return { id: null, body: DEFAULT_CONSENT_TEXT_TEMPLATE, createdAt: null }
    return { id: latest.data.id as string, body: latest.data.body as string, createdAt: latest.data.created_at as string }
  }

  // Herkunft eines directoryPersonId fuer den Rechtescope pruefen: gehoert die Person ueberhaupt
  // zum angegebenen organizationId, und in welcher Abteilung steht sie (fuer requirePermission).
  async function departmentOfDirectoryPerson(
    client: SupabaseClient, organizationId: string, directoryPersonId: string,
  ): Promise<string | null | 'not_found'> {
    const person = await client.from('directory_people').select('organization_id, department_id').eq('id', directoryPersonId).maybeSingle()
    if (person.error) throw person.error
    if (!person.data || person.data.organization_id !== organizationId) return 'not_found'
    return person.data.department_id as string | null
  }

  // Abteilung faellt auf Verein zurueck, wenn sie selbst keine Frist gesetzt hat (Plan 015:
  // "Aufbewahrungsfrist"-artiger Vorbelegungswert, anders als reviewMinimumApprovals oben, das
  // bewusst knotenlokal bleibt) -- nur fuer die Vorbelegung neuer Einwilligungen gebraucht, nicht
  // Teil der generischen Policy-Anzeige.
  async function resolveConsentValidityMonths(client: SupabaseClient, organizationId: string, departmentId: string | null): Promise<number | null> {
    const rows = await client.from('policy_settings').select('scope, department_id, consent_validity_months').eq('organization_id', organizationId)
    if (rows.error) throw rows.error
    const data = rows.data as { scope: ScopeLevel; department_id: string | null; consent_validity_months: number | null }[]
    const orgValue = data.find((row) => row.scope === 'organization')?.consent_validity_months ?? null
    const deptValue = departmentId ? data.find((row) => row.scope === 'department' && row.department_id === departmentId)?.consent_validity_months ?? null : null
    return deptValue ?? orgValue
  }

  app.get('/v1/organizations/:id/consent-text', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const text = await currentOrganizationConsentText(client, params.id)
    return reply.code(200).send(
      OrganizationConsentTextSchema.parse({
        id: text.id ?? 'default-template', organizationId: params.id, body: text.body,
        createdAt: text.createdAt, isDefaultTemplate: text.id === null,
      }),
    )
  })

  app.put('/v1/organizations/:id/consent-text', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateOrganizationConsentTextRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'consent.manage', { organizationId: params.id }))) return
    const service = supabaseClients.forService()
    const insert = await service.from('organization_consent_texts').insert({
      organization_id: params.id, body: input.body, created_by: request.auth!.userId,
    }).select('id, body, created_at').single()
    if (insert.error) throw insert.error
    await recordAuditEvent(request, { organizationId: params.id, action: 'consent_text.updated', entityType: 'organization_consent_texts', entityId: insert.data.id as string })
    return reply.code(201).send(
      OrganizationConsentTextSchema.parse({
        id: insert.data.id, organizationId: params.id, body: insert.data.body, createdAt: insert.data.created_at, isDefaultTemplate: false,
      }),
    )
  })

  // Registratur einer Papiererklaerung (Plan 015, Abschnitt 2). Multipart wie
  // POST /v1/brand/assets: Datei zuerst vollstaendig lesen, danach die begleitenden Felder
  // auswerten (busboy fuellt filePart.fields erst danach). Ohne Nachweisdatei kein Eintrag --
  // digitale Einwilligungen (origin='digital') entstehen ausschliesslich ueber den oeffentlichen
  // Anfrage-Antwort-Fluss unten, nicht hier.
  app.post('/v1/consents', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return

    const filePart = await request.file()
    if (!filePart) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })

    let fields: z.infer<typeof CreateConsentRecordFieldsSchema>
    let buffer: Buffer
    try {
      buffer = await filePart.toBuffer()
      const rawFields = Object.fromEntries(
        Object.entries(filePart.fields).map(([key, field]) => [key, field && 'value' in field ? field.value : undefined]),
      )
      const scopeStructuredRaw = rawFields.scopeStructured
      if (typeof scopeStructuredRaw === 'string') rawFields.scopeStructured = JSON.parse(scopeStructuredRaw)
      fields = CreateConsentRecordFieldsSchema.parse(rawFields)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw error
    }
    if (!ALLOWED_EVIDENCE_MIME.has(filePart.mimetype)) return reply.code(400).send({ error: 'invalid_file_type', correlationId: request.id })

    const client = supabaseClients.forUser(request.auth!.accessToken)
    let departmentId: string | null = fields.departmentId ?? null
    if (fields.directoryPersonId) {
      const person = await client.from('directory_people').select('organization_id, department_id, is_minor').eq('id', fields.directoryPersonId).maybeSingle()
      if (person.error) throw person.error
      if (!person.data || person.data.organization_id !== fields.organizationId) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      // Vertrauen gilt der Person, nicht dem Risiko fuer Dritte (plans/README.md) -- eine
      // minderjaehrige Person kann sich nicht selbst rechtsverbindlich einwilligen, auch nicht
      // auf Papier. Derselbe Fund/derselbe Guard wie bei POST /v1/consent-requests.
      if (person.data.is_minor && fields.signerRole !== 'guardian') {
        return reply.code(400).send({ error: 'guardian_required_for_minor', correlationId: request.id })
      }
      departmentId = person.data.department_id as string | null
    } else if (departmentId) {
      // Wie resolveInvitationScope/resolveDirectoryScope an anderer Stelle: departmentId kommt
      // hier ungeprueft vom Aufrufer und darf nicht ohne Verifikation gegen organizationId in den
      // Rechtescope einfliessen (gefunden im Code-Review).
      const resolved = await resolveDirectoryScope(client, fields.organizationId, departmentId, null)
      if (!resolved) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const scope = toPermissionScope(fields.organizationId, departmentId)
    if (!(await requirePermission(request, reply, 'consent.manage', scope))) return

    const validityMonths = await resolveConsentValidityMonths(client, fields.organizationId, departmentId)
    const validUntil = validityMonths === null ? null : addMonthsToIsoDate(fields.signedAt, validityMonths)

    const service = supabaseClients.forService()
    const consentId = randomUUID()
    const objectPath = `organizations/${fields.organizationId}/consents/${consentId}/nachweis`
    const upload = await service.storage.from('raw-media').upload(objectPath, buffer, { contentType: filePart.mimetype })
    if (upload.error) throw upload.error

    const insert = await service
      .from('consent_records')
      .insert({
        id: consentId,
        organization_id: fields.organizationId,
        directory_person_id: fields.directoryPersonId ?? null,
        // Pflichtfeld seit der urspruenglichen Content-Pipeline-Migration (not null, auch nach der
        // Ergaenzung von directory_person_id in Paket 014) -- bei einer echten Personenzuordnung
        // dient die stabile UUID selbst als Referenz, es wird kein zusaetzlicher Wert erfunden.
        pseudonymous_subject_ref: fields.pseudonymousSubjectRef ?? fields.directoryPersonId,
        scope: fields.scope,
        scope_structured: fields.scopeStructured,
        origin: 'paper',
        evidence_bucket: 'raw-media',
        evidence_path: objectPath,
        signed_at: fields.signedAt,
        signer_name: fields.signerName,
        signer_role: fields.signerRole,
        guardian_confirmed: fields.guardianConfirmed,
        valid_until: validUntil,
        created_by: request.auth!.userId,
      })
      .select(CONSENT_RECORD_SELECT)
      .single()
    if (insert.error) throw insert.error

    await recordAuditEvent(request, { organizationId: fields.organizationId, action: 'consent.registered', entityType: 'consent_records', entityId: consentId })
    return reply.code(201).send(mapConsentRecordRow(insert.data as ConsentRecordRow, new Date()))
  })

  app.get('/v1/consents', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema, departmentId: UuidSchema.optional(), directoryPersonId: UuidSchema.optional() }).parse(request.query)
    const scope = toPermissionScope(query.organizationId, query.departmentId)
    if (!(await requirePermission(request, reply, 'consent.manage', scope))) return

    const service = supabaseClients.forService()
    let directoryPersonIds: string[] | null = null
    if (query.directoryPersonId) {
      directoryPersonIds = [query.directoryPersonId]
    } else if (query.departmentId) {
      const people = await fetchAllRows<{ id: string }>((from, to) =>
        service.from('directory_people').select('id').eq('organization_id', query.organizationId).eq('department_id', query.departmentId!).range(from, to),
      )
      directoryPersonIds = people.map((person) => person.id)
      if (directoryPersonIds.length === 0) return reply.code(200).send([])
    }
    let select = service.from('consent_records').select(CONSENT_RECORD_SELECT).eq('organization_id', query.organizationId)
    if (directoryPersonIds) select = select.in('directory_person_id', directoryPersonIds)
    const rows = await select.order('created_at', { ascending: false })
    if (rows.error) throw rows.error
    const now = new Date()
    return reply.code(200).send((rows.data as ConsentRecordRow[]).map((row) => mapConsentRecordRow(row, now)))
  })

  async function loadConsentRecordForScope(
    client: SupabaseClient, params: { id: string },
  ): Promise<{ row: ConsentRecordRow; scope: PermissionScope } | 'not_found'> {
    const existing = await client.from('consent_records').select(CONSENT_RECORD_SELECT).eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return 'not_found'
    const row = existing.data as ConsentRecordRow
    let departmentId: string | null = null
    if (row.directory_person_id) {
      const person = await client.from('directory_people').select('department_id').eq('id', row.directory_person_id).maybeSingle()
      if (person.error) throw person.error
      departmentId = (person.data?.department_id as string | null) ?? null
    }
    return { row, scope: toPermissionScope(row.organization_id, departmentId) }
  }

  app.get('/v1/consents/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const loaded = await loadConsentRecordForScope(client, params)
    if (loaded === 'not_found') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'consent.manage', loaded.scope))) return
    return reply.code(200).send(mapConsentRecordRow(loaded.row, new Date()))
  })

  // Kurzlebige signierte URL statt eines dauerhaften Links (Plan 015, Abschnitt 2): Nachweise sind
  // private Dokumente mit Unterschriften. download:true erzwingt Content-Disposition: attachment
  // fuer PDFs -- ein PDF wird nie inline angezeigt (dieselbe Ueberlegung wie bei SVG in Paket 009).
  app.get('/v1/consents/:id/evidence-url', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const loaded = await loadConsentRecordForScope(client, params)
    if (loaded === 'not_found') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'consent.manage', loaded.scope))) return
    const service = supabaseClients.forService()
    const evidence = await service.from('consent_records').select('evidence_bucket, evidence_path').eq('id', params.id).single()
    if (evidence.error) throw evidence.error
    const signed = await service.storage.from(evidence.data.evidence_bucket as string).createSignedUrl(evidence.data.evidence_path as string, 300, { download: true })
    if (signed.error) throw signed.error
    await recordAuditEvent(request, { organizationId: loaded.row.organization_id, action: 'consent.evidence_viewed', entityType: 'consent_records', entityId: params.id })
    return reply.code(200).send({ signedUrl: signed.data.signedUrl, expiresAt: new Date(Date.now() + 300_000).toISOString() })
  })

  app.post('/v1/consents/:id/revoke', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = RevokeConsentRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const loaded = await loadConsentRecordForScope(client, params)
    if (loaded === 'not_found') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'consent.manage', loaded.scope))) return
    if (loaded.row.revoked_at !== null) return reply.code(409).send({ error: 'already_revoked', correlationId: request.id })

    const service = supabaseClients.forService()
    // .is('revoked_at', null) macht Pruefung und Schreibvorgang atomar -- der vorige Read-Check
    // allein liesse zwei gleichzeitige Widerrufe den zweiten Grund/Widerrufenden ueberschreiben
    // (gefunden im Code-Review, gleiches Muster wie die oeffentliche Widerrufsroute unten).
    const update = await service
      .from('consent_records')
      .update({ revoked_at: new Date().toISOString(), revoked_by: input.revokedBy, revocation_reason: input.reason ?? null })
      .eq('id', params.id)
      .is('revoked_at', null)
      .select(CONSENT_RECORD_SELECT)
      .maybeSingle()
    if (update.error) throw update.error
    if (!update.data) return reply.code(409).send({ error: 'already_revoked', correlationId: request.id })
    // Kaskade (offene Freigaben invalidieren, geplante Publikationen stornieren) laeuft im
    // Trigger invalidate_approval_after_consent_revocation, nicht hier -- dasselbe Muster wie bei
    // invalidate_approvals_for_media_change/invalidate_approvals_for_fixture_change.
    await recordAuditEvent(request, { organizationId: loaded.row.organization_id, action: 'consent.revoked', entityType: 'consent_records', entityId: params.id, metadata: { revokedBy: input.revokedBy } })
    return reply.code(200).send(mapConsentRecordRow(update.data as ConsentRecordRow, new Date()))
  })

  // Neue Version statt Bearbeitung (Plan 015: "eine Einwilligung wird nie bearbeitet"). Die alte
  // Zeile bleibt bestehen und wird per superseded_by verkettet -- evaluateConsent haelt eine
  // abgeloeste Zeile fuer nie gueltig, unabhaengig von jeder anderen Pruefung.
  app.post('/v1/consents/:id/supersede', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = SupersedeConsentRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const loaded = await loadConsentRecordForScope(client, params)
    if (loaded === 'not_found') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'consent.manage', loaded.scope))) return
    if (loaded.row.superseded_by !== null) return reply.code(409).send({ error: 'already_superseded', correlationId: request.id })

    // Derselbe Fund/derselbe Guard wie bei POST /v1/consents und POST /v1/consent-requests: die
    // Abloesung darf eine minderjaehrige Person nicht nachtraeglich auf signerRole='self' setzen.
    if (loaded.row.directory_person_id) {
      const person = await client.from('directory_people').select('is_minor').eq('id', loaded.row.directory_person_id).single()
      if (person.error) throw person.error
      if (person.data.is_minor && input.signerRole !== 'guardian') {
        return reply.code(400).send({ error: 'guardian_required_for_minor', correlationId: request.id })
      }
    }

    const service = supabaseClients.forService()
    const evidenceOfOriginal = await service.from('consent_records').select('evidence_bucket, evidence_path').eq('id', params.id).single()
    if (evidenceOfOriginal.error) throw evidenceOfOriginal.error

    const newId = randomUUID()
    // Eine Ablösung korrigiert den Umfang eines bereits dokumentierten Papier- oder digitalen
    // Nachweises -- sie laedt kein neues Dokument hoch und uebernimmt deshalb evidence_bucket/-path
    // unveraendert von der abgeloesten Zeile.
    const insert = await service
      .from('consent_records')
      .insert({
        id: newId,
        organization_id: loaded.row.organization_id,
        directory_person_id: loaded.row.directory_person_id,
        pseudonymous_subject_ref: loaded.row.pseudonymous_subject_ref,
        scope: input.scope,
        scope_structured: input.scopeStructured,
        origin: loaded.row.origin,
        evidence_bucket: evidenceOfOriginal.data.evidence_bucket,
        evidence_path: evidenceOfOriginal.data.evidence_path,
        signed_at: input.signedAt,
        signer_name: input.signerName,
        signer_role: input.signerRole,
        guardian_confirmed: input.guardianConfirmed,
        created_by: request.auth!.userId,
      })
      .select(CONSENT_RECORD_SELECT)
      .single()
    if (insert.error) throw insert.error

    // Wie bei POST /v1/consents/:id/revoke: .is('superseded_by', null) macht die Verkettung atomar.
    // Trifft sie keine Zeile, hat eine parallele Anfrage bereits abgeloest -- die eben angelegte
    // Zeile wird dann verworfen, statt zwei Nachfolgerinnen fuer dieselbe Einwilligung zu erzeugen.
    const linkBack = await service.from('consent_records').update({ superseded_by: newId }).eq('id', params.id).is('superseded_by', null).select('id').maybeSingle()
    if (linkBack.error) throw linkBack.error
    if (!linkBack.data) {
      await service.from('consent_records').delete().eq('id', newId)
      return reply.code(409).send({ error: 'already_superseded', correlationId: request.id })
    }
    await recordAuditEvent(request, { organizationId: loaded.row.organization_id, action: 'consent.superseded', entityType: 'consent_records', entityId: newId, metadata: { supersedes: params.id } })
    return reply.code(201).send(mapConsentRecordRow(insert.data as ConsentRecordRow, new Date()))
  })

  // Einfacher In-Prozess-Sliding-Window-Zaehler statt einer neuen Abhaengigkeit (@fastify/rate-limit):
  // die oeffentlichen Einwilligungsseiten unten sind die exponierteste Flaeche des Systems (Plan
  // 015, Abschnitt 3) und brauchen ein Rate-Limit pro IP und pro Token. Fuer einen einzelnen
  // API-Prozess ausreichend; ein mehrknotiges Produktions-Deployment braucht einen gemeinsamen
  // Speicher (Redis) statt dieser lokalen Map -- dokumentierte Grenze, kein stiller Kompromiss.
  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()
  function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now()
    // Diese Routen sind oeffentlich erreichbar; ohne Aufraeumen wuerde jede neue Quell-IP dauerhaft
    // einen Eintrag belegen (gefunden im Code-Review). Nur bei Bedarf durchsuchen, statt bei jedem
    // Aufruf ueber die ganze Map zu iterieren.
    if (rateLimitBuckets.size > 10_000) {
      for (const [bucketKey, entry] of rateLimitBuckets) {
        if (entry.resetAt < now) rateLimitBuckets.delete(bucketKey)
      }
    }
    const bucket = rateLimitBuckets.get(key)
    if (!bucket || bucket.resetAt < now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }
    if (bucket.count >= limit) return false
    bucket.count += 1
    return true
  }

  function buildConsentRequestEmail(options: { to: string; organizationName: string; personLabel: string; respondUrl: string }): EmailMessage {
    return {
      to: options.to,
      subject: `Einwilligung zur Veröffentlichung von Fotos/Videos – ${options.organizationName}`,
      text: `${options.organizationName} bittet um Ihre Einwilligung zur Veröffentlichung von Fotos/Videos von ${options.personLabel} in sozialen Medien.\n\nZur Anfrage: ${options.respondUrl}\n\nDer Link ist 14 Tage gültig. Eine Einwilligung ist freiwillig und jederzeit für die Zukunft widerrufbar.`,
    }
  }

  app.post('/v1/consent-requests', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = CreateConsentRequestRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const departmentId = await departmentOfDirectoryPerson(client, input.organizationId, input.directoryPersonId)
    if (departmentId === 'not_found') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(input.organizationId, departmentId)
    if (!(await requirePermission(request, reply, 'consent.manage', scope))) return

    const person = await client.from('directory_people').select('first_name, last_name, is_minor').eq('id', input.directoryPersonId).single()
    if (person.error) throw person.error
    // Vertrauen gilt der Person, nicht dem Risiko fuer Dritte (plans/README.md, "Keine Befreiung
    // entfaellt die Minderjaehrigenstufe") -- eine Anfrage direkt an eine minderjaehrige Person
    // selbst wuerde evaluateConsent NIE einen guardian_missing-Blocker auslösen lassen (der prueft
    // nur signerRole === 'guardian'), weil consent_requests.recipient_role hier ungeprueft in
    // consent_records.signer_role/guardian_confirmed uebernommen wird (Widerspruch, wenn hier
    // 'self' erlaubt waere).
    if (person.data.is_minor && input.recipientRole !== 'guardian') {
      return reply.code(400).send({ error: 'guardian_required_for_minor', correlationId: request.id })
    }

    const service = supabaseClients.forService()
    const text = await currentOrganizationConsentText(service, input.organizationId)
    const { rawToken, tokenHash } = generatePublicToken()
    const insert = await service
      .from('consent_requests')
      .insert({
        organization_id: input.organizationId,
        department_id: departmentId,
        directory_person_id: input.directoryPersonId,
        recipient_email: input.recipientEmail,
        recipient_role: input.recipientRole,
        requested_scope: input.requestedScope,
        text_version: text.id ?? 'default-template',
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        created_by: request.auth!.userId,
        correlation_id: request.id,
      })
      .select(CONSENT_REQUEST_SELECT)
      .single()
    if (insert.error) {
      // consent_requests_open_unique: schon eine offene Anfrage fuer diese Person und Adresse.
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'request_already_open', correlationId: request.id })
      throw insert.error
    }

    const organizationName = await service.from('organizations').select('name').eq('id', input.organizationId).single()
    if (organizationName.error) throw organizationName.error
    const respondUrl = `${environment.WEB_BASE_URL ?? 'http://localhost:4200'}/einwilligung/${rawToken}`
    // Die Anfrage besteht bereits in der Datenbank -- ein SMTP-Fehler soll den Request nicht mit
    // 500 scheitern lassen, sondern nur den Versandstatus sichtbar machen (dasselbe Muster wie bei
    // POST /v1/invitations, gefunden im Code-Review dieses Pakets).
    let emailDelivered = true
    try {
      await emailSender.send(
        buildConsentRequestEmail({
          to: input.recipientEmail, organizationName: organizationName.data.name as string,
          personLabel: `${person.data.first_name as string} ${(person.data.last_name as string).charAt(0)}.`, respondUrl,
        }),
      )
    } catch (error) {
      emailDelivered = false
      request.log.error({ err: error, correlationId: request.id }, 'consent request email delivery failed')
    }

    await recordAuditEvent(request, { organizationId: input.organizationId, action: 'consent_request.created', entityType: 'consent_requests', entityId: insert.data.id as string, metadata: { emailDelivered } })
    return reply.code(201).send({ ...mapConsentRequestRow(insert.data as ConsentRequestRow), emailDelivered })
  })

  app.get('/v1/consent-requests', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema, departmentId: UuidSchema.optional() }).parse(request.query)
    const scope = toPermissionScope(query.organizationId, query.departmentId)
    if (!(await requirePermission(request, reply, 'consent.manage', scope))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    let select = client.from('consent_requests').select(CONSENT_REQUEST_SELECT).eq('organization_id', query.organizationId)
    if (query.departmentId) select = select.eq('department_id', query.departmentId)
    const rows = await select.order('created_at', { ascending: false })
    if (rows.error) throw rows.error
    return reply.code(200).send((rows.data as ConsentRequestRow[]).map(mapConsentRequestRow))
  })

  app.post('/v1/consent-requests/:id/resend', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('consent_requests').select(CONSENT_REQUEST_SELECT).eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const row = existing.data as ConsentRequestRow
    const scope = toPermissionScope(row.organization_id, row.department_id)
    if (!(await requirePermission(request, reply, 'consent.manage', scope))) return
    if (row.status !== 'sent') return reply.code(409).send({ error: 'request_not_open', correlationId: request.id })

    const service = supabaseClients.forService()
    const { rawToken, tokenHash } = generatePublicToken()
    const update = await service
      .from('consent_requests')
      .update({ token_hash: tokenHash, send_count: row.send_count + 1, last_sent_at: new Date().toISOString() })
      .eq('id', params.id)
      .select(CONSENT_REQUEST_SELECT)
      .single()
    if (update.error) {
      if (update.error.code === '23514') return reply.code(409).send({ error: 'resend_limit_reached', correlationId: request.id })
      throw update.error
    }
    const [person, organizationName] = await Promise.all([
      service.from('directory_people').select('first_name, last_name').eq('id', row.directory_person_id).single(),
      service.from('organizations').select('name').eq('id', row.organization_id).single(),
    ])
    if (person.error) throw person.error
    if (organizationName.error) throw organizationName.error
    const respondUrl = `${environment.WEB_BASE_URL ?? 'http://localhost:4200'}/einwilligung/${rawToken}`
    // Der Token ist bereits rotiert, der alte Link damit ungueltig -- ein SMTP-Fehler darf den
    // Request trotzdem nicht mit 500 scheitern lassen (gleiches Muster wie beim erstmaligen Versand).
    let emailDelivered = true
    try {
      await emailSender.send(
        buildConsentRequestEmail({
          to: row.recipient_email, organizationName: organizationName.data.name as string,
          personLabel: `${person.data.first_name as string} ${(person.data.last_name as string).charAt(0)}.`, respondUrl,
        }),
      )
    } catch (error) {
      emailDelivered = false
      request.log.error({ err: error, correlationId: request.id }, 'consent request email delivery failed')
    }
    await recordAuditEvent(request, { organizationId: row.organization_id, action: 'consent_request.resent', entityType: 'consent_requests', entityId: params.id, metadata: { emailDelivered } })
    return reply.code(200).send({ ...mapConsentRequestRow(update.data as ConsentRequestRow), emailDelivered })
  })

  // --- Oeffentliche, unauthentifizierte Seiten (Plan 015, Abschnitt 3) ------------------------
  // Kein requireAuth: ein Erziehungsberechtigter hat kein Vereinskonto. Jede Antwort auf ein
  // ungueltiges, abgelaufenes oder bereits beantwortetes Token ist absichtlich identisch, damit
  // ein Token nicht durch unterschiedliche Fehlercodes erraten/bestaetigt werden kann.
  const CONSENT_TOKEN_INVALID_RESPONSE = { error: 'invalid_or_expired', correlationId: undefined as string | undefined }

  async function findOpenConsentRequestByToken(service: SupabaseClient, rawToken: string): Promise<ConsentRequestRow | null> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const found = await service.from('consent_requests').select(CONSENT_REQUEST_SELECT).eq('token_hash', tokenHash).maybeSingle()
    if (found.error) throw found.error
    if (!found.data) return null
    const row = found.data as ConsentRequestRow
    if (row.status !== 'sent') return null
    if (new Date(row.expires_at) < new Date()) return null
    return row
  }

  app.get('/v1/consent-requests/by-token/:token', async (request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow')
    if (!checkRateLimit(`consent-request-view:${request.ip}`, 30, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ token: z.string().min(1).max(200) }).parse(request.params)
    const service = supabaseClients.forService()
    const row = await findOpenConsentRequestByToken(service, params.token)
    if (!row) return reply.code(404).send({ ...CONSENT_TOKEN_INVALID_RESPONSE, correlationId: request.id })

    const [person, organizationName, text] = await Promise.all([
      service.from('directory_people').select('first_name, last_name').eq('id', row.directory_person_id).single(),
      service.from('organizations').select('name').eq('id', row.organization_id).single(),
      currentOrganizationConsentText(service, row.organization_id),
    ])
    if (person.error) throw person.error
    if (organizationName.error) throw organizationName.error
    return reply.code(200).send(
      PublicConsentRequestViewSchema.parse({
        organizationName: organizationName.data.name,
        personLabel: `${person.data.first_name as string} ${(person.data.last_name as string).charAt(0)}.`,
        textVersion: row.text_version,
        consentText: text.body,
        requestedScope: row.requested_scope,
        expiresAt: row.expires_at,
        status: row.status,
      }),
    )
  })

  app.post('/v1/consent-requests/by-token/:token/respond', async (request, reply) => {
    if (!checkRateLimit(`consent-request-respond:${request.ip}`, 10, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ token: z.string().min(1).max(200) }).parse(request.params)
    const input = RespondConsentRequestRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const row = await findOpenConsentRequestByToken(service, params.token)
    if (!row) return reply.code(404).send({ ...CONSENT_TOKEN_INVALID_RESPONSE, correlationId: request.id })

    // Datenschutzarmer Abgabenachweis: gehasht mit einem serverseitigen Pfeffer, sonst ist eine
    // IPv4-Adresse trivial rueckrechenbar (Plan 015, Abschnitt 3).
    const pepper = environment.CONSENT_RESPONSE_HASH_PEPPER ?? 'local-dev-pepper'
    const responseIpHash = createHash('sha256').update(`${pepper}:${request.ip}`).digest('hex')
    const responseUserAgentHash = createHash('sha256').update(`${pepper}:${request.headers['user-agent'] ?? ''}`).digest('hex')

    if (input.decision === 'declined') {
      const declined = await service
        .from('consent_requests')
        .update({ status: 'declined', responded_at: new Date().toISOString(), response_ip_hash: responseIpHash, response_user_agent_hash: responseUserAgentHash })
        .eq('id', row.id)
        .eq('status', 'sent')
      if (declined.error) throw declined.error
      return reply.code(200).send({ status: 'declined' })
    }

    const person = await service.from('directory_people').select('is_minor').eq('id', row.directory_person_id).single()
    if (person.error) throw person.error
    const { rawToken: revocationRawToken, tokenHash: revocationTokenHash } = generatePublicToken()
    const consentId = randomUUID()
    const consentInsert = await service
      .from('consent_records')
      .insert({
        id: consentId,
        organization_id: row.organization_id,
        directory_person_id: row.directory_person_id,
        pseudonymous_subject_ref: row.directory_person_id,
        scope: describeConsentScope(row.requested_scope).join(' '),
        scope_structured: row.requested_scope,
        origin: 'digital',
        evidence_bucket: 'raw-media',
        // Kein Dateiupload im digitalen Weg -- der Nachweis IST die Anfrage/Antwort-Zeile
        // (consent_requests) selbst, referenziert ueber denselben Pfad als Marker statt eines
        // erfundenen Dateiobjekts. Ehrliche Einordnung in der Oberfläche (Plan, Abschnitt 3):
        // ein E-Mail-Link belegt nicht die Identitaet des Erziehungsberechtigten.
        evidence_path: `digital-consent-requests/${row.id}`,
        signed_at: new Date().toISOString().slice(0, 10),
        signer_name: null,
        signer_role: row.recipient_role,
        guardian_confirmed: row.recipient_role === 'guardian',
        source_id: null,
        revocation_token_hash: revocationTokenHash,
        created_by: row.created_by,
      })
      .select(CONSENT_RECORD_SELECT)
      .single()
    if (consentInsert.error) throw consentInsert.error

    const granted = await service
      .from('consent_requests')
      .update({
        status: 'granted', responded_at: new Date().toISOString(), consent_record_id: consentId,
        response_ip_hash: responseIpHash, response_user_agent_hash: responseUserAgentHash,
      })
      .eq('id', row.id)
      .eq('status', 'sent')
    if (granted.error) throw granted.error

    return reply.code(200).send({
      status: 'granted',
      revocationUrl: `${environment.WEB_BASE_URL ?? 'http://localhost:4200'}/einwilligung/widerruf/${revocationRawToken}`,
    })
  })

  app.get('/v1/consents/by-revocation-token/:token', async (request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow')
    if (!checkRateLimit(`consent-revocation-view:${request.ip}`, 30, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ token: z.string().min(1).max(200) }).parse(request.params)
    const tokenHash = createHash('sha256').update(params.token).digest('hex')
    const service = supabaseClients.forService()
    const found = await service.from('consent_records').select(CONSENT_RECORD_SELECT).eq('revocation_token_hash', tokenHash).maybeSingle()
    if (found.error) throw found.error
    if (!found.data) return reply.code(404).send({ ...CONSENT_TOKEN_INVALID_RESPONSE, correlationId: request.id })
    const row = found.data as ConsentRecordRow
    const [person, organizationName] = await Promise.all([
      service.from('directory_people').select('first_name, last_name').eq('id', row.directory_person_id).single(),
      service.from('organizations').select('name').eq('id', row.organization_id).single(),
    ])
    if (person.error) throw person.error
    if (organizationName.error) throw organizationName.error
    return reply.code(200).send(
      PublicConsentRevocationViewSchema.parse({
        organizationName: organizationName.data.name,
        personLabel: `${person.data.first_name as string} ${(person.data.last_name as string).charAt(0)}.`,
        status: row.revoked_at === null ? 'active' : 'already_revoked',
      }),
    )
  })

  app.post('/v1/consents/by-revocation-token/:token', async (request, reply) => {
    if (!checkRateLimit(`consent-revocation-confirm:${request.ip}`, 10, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ token: z.string().min(1).max(200) }).parse(request.params)
    const tokenHash = createHash('sha256').update(params.token).digest('hex')
    const service = supabaseClients.forService()
    const found = await service.from('consent_records').select('id, organization_id, revoked_at').eq('revocation_token_hash', tokenHash).maybeSingle()
    if (found.error) throw found.error
    if (!found.data) return reply.code(404).send({ ...CONSENT_TOKEN_INVALID_RESPONSE, correlationId: request.id })
    if (found.data.revoked_at !== null) return reply.code(200).send({ status: 'already_revoked' })

    const update = await service
      .from('consent_records')
      .update({ revoked_at: new Date().toISOString(), revoked_by: 'guardian', revocation_reason: 'Öffentlicher Widerrufslink' })
      .eq('id', found.data.id)
      .is('revoked_at', null)
    if (update.error) throw update.error
    const audit = await service.from('audit_events').insert({
      organization_id: found.data.organization_id, actor_user_id: null, action: 'consent.revoked_via_public_link',
      entity_type: 'consent_records', entity_id: found.data.id, correlation_id: request.id,
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(200).send({ status: 'revoked' })
  })

  // Paket 020: Rechtliche Pflichten und Datenschutzbetrieb ----------------------------------------

  function mapRetentionSettingsRow(row: Record<string, unknown>) {
    return {
      organizationId: row.organization_id,
      rawMediaDays: row.raw_media_days,
      derivativeDays: row.derivative_days,
      auditEventDays: row.audit_event_days,
      consentEvidenceYears: row.consent_evidence_years,
      statusEventDays: row.status_event_days,
      updatedAt: row.updated_at,
    }
  }
  const RETENTION_SETTINGS_COLUMNS = 'organization_id, raw_media_days, derivative_days, audit_event_days, consent_evidence_years, status_event_days, updated_at'

  // Der Migrations-Nachtrag fuellt retention_settings nur fuer Bestandsvereine mit einer/einem
  // organization_owner (adversariale Pruefung: ein frischer db:reset laesst die Seed-Vereine ohne
  // Zeile, weil seed.sql sie per direktem INSERT statt ueber create_organization() anlegt, das
  // NACH dem Migrations-Nachtrag laeuft -- GET/PUT/run scheiterten dann mit einem generischen 500
  // statt einer nutzbaren Antwort). Statt auf eine perfekt synchronisierte Migrations-/Seed-
  // Reihenfolge fuer alle Zukunft zu vertrauen, legt jeder Zugriff die Zeile bei Bedarf selbst an.
  async function loadOrCreateRetentionSettings(service: SupabaseClient, organizationId: string, actorUserId: string): Promise<Record<string, unknown>> {
    const existing = await service.from('retention_settings').select(RETENTION_SETTINGS_COLUMNS).eq('organization_id', organizationId).maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) return existing.data
    // upsert statt insert: zwei gleichzeitige Aufrufe (die Oberflaeche laedt mehrere
    // Aufbewahrungsrouten parallel) liefen sonst im zweiten Aufruf in den Primaerschluessel
    // und antworteten mit 500 statt mit den Standardwerten.
    const inserted = await service
      .from('retention_settings')
      .upsert({ organization_id: organizationId, updated_by: actorUserId }, { onConflict: 'organization_id', ignoreDuplicates: true })
    if (inserted.error) throw inserted.error
    const reread = await service.from('retention_settings').select(RETENTION_SETTINGS_COLUMNS).eq('organization_id', organizationId).single()
    if (reread.error) throw reread.error
    return reread.data
  }

  app.get('/v1/organizations/:id/retention-settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const row = await loadOrCreateRetentionSettings(supabaseClients.forService(), params.id, request.auth!.userId)
    return reply.code(200).send(RetentionSettingsSchema.parse(mapRetentionSettingsRow(row)))
  })

  app.put('/v1/organizations/:id/retention-settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateRetentionSettingsRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const service = supabaseClients.forService()
    await loadOrCreateRetentionSettings(service, params.id, request.auth!.userId)
    const payload: Record<string, unknown> = { updated_by: request.auth!.userId }
    if (input.rawMediaDays !== undefined) payload.raw_media_days = input.rawMediaDays
    if (input.derivativeDays !== undefined) payload.derivative_days = input.derivativeDays
    if (input.auditEventDays !== undefined) payload.audit_event_days = input.auditEventDays
    if (input.consentEvidenceYears !== undefined) payload.consent_evidence_years = input.consentEvidenceYears
    if (input.statusEventDays !== undefined) payload.status_event_days = input.statusEventDays
    const update = await service.from('retention_settings').update(payload).eq('organization_id', params.id).select(RETENTION_SETTINGS_COLUMNS).single()
    if (update.error) throw update.error
    await recordAuditEvent(request, { organizationId: params.id, action: 'retention_settings.updated', entityType: 'retention_settings', entityId: params.id, metadata: { fields: Object.keys(input) } })
    return reply.code(200).send(RetentionSettingsSchema.parse(mapRetentionSettingsRow(update.data)))
  })

  app.get('/v1/organizations/:id/retention-deletions', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const rows = await supabaseClients
      .forService()
      .from('retention_deletions')
      .select('rule_key, entity_type, entity_count, cutoff_date, dry_run, executed_at')
      .eq('organization_id', params.id)
      .eq('dry_run', false)
      .order('executed_at', { ascending: false })
      .limit(200)
    if (rows.error) throw rows.error
    return reply.code(200).send(
      rows.data.map((row) => RetentionDeletionSchema.parse({ ruleKey: row.rule_key, entityType: row.entity_type, entityCount: row.entity_count, cutoffDate: row.cutoff_date })),
    )
  })

  // Kein Hatchet-Cron dafuer (Paket 004 "in Arbeit", gleiche Luecke wie bei jedem anderen
  // wiederkehrenden Job in diesem Plan) -- der Lauf ist bis dahin manuell ausloesbar, mit
  // Trockenlaufmodus. Storage-Loeschung und Datenbank-Aenderung laufen bewusst NICHT in einer
  // gemeinsamen Transaktion: ein Fehlschlag nach dem Storage-Aufruf wuerde sonst einen bereits
  // geloeschten Datenbestand mit einer zurueckgerollten Datenbankzeile hinterlassen. Storage zuerst,
  // Datenbank danach ist die sicherere Reihenfolge -- ein Fehler zwischen beiden hinterlaesst
  // bestenfalls eine Datenbankzeile, die auf ein bereits geloeschtes Objekt zeigt (beim naechsten
  // Lauf erneut als Kandidat erkannt, kein Datenverlust), nie umgekehrt ein referenziertes Objekt,
  // das schon fehlt.
  // Ein Kalenderjahr statt einer festen Tageszahl (365*Jahre wuerde Schaltjahre systematisch
  // verschieben) -- setUTCFullYear behandelt das korrekt, auch beim 29. Februar in einem
  // Nicht-Schaltjahr-Ziel (JS normalisiert das dann auf den 1. Maerz, dieselbe Semantik wie
  // Postgres' date + interval 'N years', die in diesem Paket bereits an anderer Stelle genutzt wird).
  function cutoffYearsAgo(nowMs: number, years: number): Date {
    const date = new Date(nowMs)
    date.setUTCFullYear(date.getUTCFullYear() - years)
    return date
  }

  app.post('/v1/organizations/:id/retention/run', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = RunRetentionRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return

    const service = supabaseClients.forService()
    const settingsRow = await loadOrCreateRetentionSettings(service, params.id, request.auth!.userId)
    const settings = settingsRow as { raw_media_days: number; derivative_days: number | null; audit_event_days: number; consent_evidence_years: number; status_event_days: number }
    const now = Date.now()
    // Eigene, lokal erzeugte correlationId statt request.id: Fastify ist mit requestIdHeader
    // konfiguriert, ein Aufrufer kann request.id also per x-correlation-id-Header auf einen
    // beliebigen String setzen (vorbestehende, projektweite Konfiguration) -- correlation_id ist
    // hier eine uuid-Spalte, ein nicht-UUID-Header haette den Datenbank-Insert erst NACH den
    // bereits ausgefuehrten Loeschungen scheitern lassen (adversariale Pruefung).
    const correlationId = randomUUID()
    const results: { ruleKey: string; entityType: string; entityCount: number; cutoffDate: string }[] = []

    const CHUNK_SIZE = 100
    function chunked<T>(values: readonly T[]): T[][] {
      const chunks: T[][] = []
      for (let offset = 0; offset < values.length; offset += CHUNK_SIZE) chunks.push(values.slice(offset, offset + CHUNK_SIZE))
      return chunks
    }

    async function removeStorageObjects(rows: readonly { bucket_id: string; object_path: string }[]): Promise<void> {
      const pathsByBucket = new Map<string, string[]>()
      for (const row of rows) pathsByBucket.set(row.bucket_id, [...(pathsByBucket.get(row.bucket_id) ?? []), row.object_path])
      for (const [bucketId, paths] of pathsByBucket) {
        for (const batch of chunked(paths)) {
          const removed = await service.storage.from(bucketId).remove(batch)
          if (removed.error) throw removed.error
        }
      }
    }

    // Die IDs stehen als Query-String in der URL -- eine unbegrenzte Liste reisst die
    // Header-Grenze des Gateways (dieselbe Grenze wie bei den Profil-Bloecken in GET /members).
    async function deleteByIds(table: string, ids: readonly string[]): Promise<void> {
      for (const batch of chunked(ids)) {
        const deleted = await service.from(table).delete().in('id', batch)
        if (deleted.error) throw deleted.error
      }
    }
    async function updateByIds(table: string, payload: Record<string, unknown>, ids: readonly string[]): Promise<void> {
      for (const batch of chunked(ids)) {
        const updated = await service.from(table).update(payload).in('id', batch)
        if (updated.error) throw updated.error
      }
    }

    // Rohmedien: Storage-Objekt loeschen, Zeile bleibt mit upload_status='deleted' (Metadaten
    // behalten -- Plan, Abschnitt "1. Aufbewahrung durchsetzen").
    const rawMediaCutoff = new Date(now - settings.raw_media_days * 86_400_000)
    const rawMediaCandidates = await service.rpc('select_expired_raw_media', { target_organization_id: params.id, cutoff: rawMediaCutoff.toISOString() })
    if (rawMediaCandidates.error) throw rawMediaCandidates.error
    const rawMediaRows = rawMediaCandidates.data as { media_asset_id: string; bucket_id: string; object_path: string }[]
    if (!input.dryRun && rawMediaRows.length > 0) {
      await removeStorageObjects(rawMediaRows)
      await updateByIds('media_assets', { upload_status: 'deleted' }, rawMediaRows.map((row) => row.media_asset_id))
    }
    results.push({ ruleKey: 'raw_media', entityType: 'media_assets', entityCount: rawMediaRows.length, cutoffDate: rawMediaCutoff.toISOString().slice(0, 10) })

    // Derivate: nur wenn eine Frist gesetzt ist (Default deaktiviert) -- geloescht statt aktualisiert,
    // weil es fuer media_derivatives keinen 'deleted'-Status gibt und der Immutabilitaetstrigger jedes
    // UPDATE auf eine 'ready'-Zeile ohnehin verweigert (Plan, Abschnitt "1. Aufbewahrung durchsetzen").
    if (settings.derivative_days !== null) {
      const derivativeCutoff = new Date(now - settings.derivative_days * 86_400_000)
      const derivativeCandidates = await service.rpc('select_expired_media_derivatives', { target_organization_id: params.id, cutoff: derivativeCutoff.toISOString() })
      if (derivativeCandidates.error) throw derivativeCandidates.error
      const derivativeRows = derivativeCandidates.data as { media_derivative_id: string; bucket_id: string; object_path: string }[]
      if (!input.dryRun && derivativeRows.length > 0) {
        await removeStorageObjects(derivativeRows)
        await deleteByIds('media_derivatives', derivativeRows.map((row) => row.media_derivative_id))
      }
      results.push({ ruleKey: 'media_derivatives', entityType: 'media_derivatives', entityCount: derivativeRows.length, cutoffDate: derivativeCutoff.toISOString().slice(0, 10) })
    }

    // Audit-Events: Einwilligungs-/Elternkontakt-bezogene Ereignisse werden nicht dauerhaft
    // ausgenommen, sondern erst nach der laengeren consent_evidence_years-Frist geloescht (Plan,
    // Tabelle in Abschnitt "1." -- "werden ueber consent_evidence_years gehalten", nicht "nie").
    // Filterung in JS statt per PostgREST-like-Operator, um keine Verwechslung zwischen SQL- und
    // PostgREST-Wildcard-Syntax zu riskieren.
    const auditCutoff = new Date(now - settings.audit_event_days * 86_400_000)
    const auditConsentExceptionCutoff = cutoffYearsAgo(now, settings.consent_evidence_years)
    // fetchAllRows aus demselben Grund wie in GET /members: max_rows haette den Loeschlauf
    // still nach 1000 Zeilen beendet und das Ergebnis trotzdem als erledigt gemeldet.
    const auditCandidates = await fetchAllRows<{ id: string; action: string; created_at: string }>((from, to) =>
      service.from('audit_events').select('id, action, created_at').eq('organization_id', params.id).lt('created_at', auditCutoff.toISOString()).range(from, to),
    )
    const auditIds = auditCandidates
      .filter((row) => {
        const isConsentOrGuardianRelated = row.action.startsWith('consent') || row.action.includes('guardian')
        return !isConsentOrGuardianRelated || new Date(row.created_at).getTime() < auditConsentExceptionCutoff.getTime()
      })
      .map((row) => row.id)
    if (!input.dryRun && auditIds.length > 0) {
      await deleteByIds('audit_events', auditIds)
    }
    results.push({ ruleKey: 'audit_events', entityType: 'audit_events', entityCount: auditIds.length, cutoffDate: auditCutoff.toISOString().slice(0, 10) })

    // Statushistorie (Paket 016): reine Datenbankloeschung, kein Storage-Objekt beteiligt --
    // deshalb kein RPC-Umweg wie bei Rohmedien/Derivaten, sondern direkt Kandidaten laden und
    // loeschen, gleiches Muster wie bei den abgelaufenen Token unten.
    const statusEventCutoff = new Date(now - settings.status_event_days * 86_400_000)
    const statusEventIds = (
      await fetchAllRows<{ id: string }>((from, to) =>
        service.from('post_status_events').select('id').eq('organization_id', params.id).lt('occurred_at', statusEventCutoff.toISOString()).range(from, to),
      )
    ).map((row) => row.id)
    if (!input.dryRun && statusEventIds.length > 0) await deleteByIds('post_status_events', statusEventIds)
    results.push({ ruleKey: 'status_events', entityType: 'post_status_events', entityCount: statusEventIds.length, cutoffDate: statusEventCutoff.toISOString().slice(0, 10) })

    // Einwilligungsnachweise: erst nach consent_evidence_years ab Ende der Gueltigkeit (adversariale
    // Pruefung: bislang stand das nur im Formular, kein Code hat je eine Nachweisdatei geloescht --
    // dieselbe Zusage-ohne-Job-Fehlerklasse wie die urspruengliche Dummy-Zeile, zu deren Beseitigung
    // dieses Paket existiert). Die Zeile selbst bleibt bestehen (Umfang, Unterzeichnungsdatum,
    // Widerruf), nur die Nachweisdatei mit Unterschrift/Kontaktdaten verschwindet.
    const consentEvidenceCutoff = cutoffYearsAgo(now, settings.consent_evidence_years)
    const consentEvidenceCandidates = await service.rpc('select_expired_consent_evidence', { target_organization_id: params.id, cutoff: consentEvidenceCutoff.toISOString() })
    if (consentEvidenceCandidates.error) throw consentEvidenceCandidates.error
    const consentEvidenceRows = consentEvidenceCandidates.data as { consent_record_id: string; bucket_id: string; object_path: string }[]
    if (!input.dryRun && consentEvidenceRows.length > 0) {
      await removeStorageObjects(consentEvidenceRows)
      await updateByIds(
        'consent_records',
        { evidence_path: null, evidence_deleted_at: new Date(now).toISOString() },
        consentEvidenceRows.map((row) => row.consent_record_id),
      )
    }
    results.push({ ruleKey: 'consent_evidence', entityType: 'consent_records', entityCount: consentEvidenceRows.length, cutoffDate: consentEvidenceCutoff.toISOString().slice(0, 10) })

    // Abgelaufene Token: eine bereits angenommene Einladung und eine bereits beantwortete
    // Einwilligungsanfrage bleiben trotz abgelaufenem expires_at bestehen -- expires_at ist bei
    // beiden bei der Erstellung fixiert, nicht bei der Antwort, sonst wuerde diese Regel den
    // Nachweis "wann wurde geantwortet" mit aufraeumen, den sie gar nicht betreffen sollte.
    const nowIso = new Date(now).toISOString()
    let expiredTokenCount = 0
    const invitationIds = (
      await fetchAllRows<{ id: string }>((from, to) =>
        service.from('invitations').select('id').eq('organization_id', params.id).lt('expires_at', nowIso).is('accepted_at', null).range(from, to),
      )
    ).map((row) => row.id)
    expiredTokenCount += invitationIds.length
    if (!input.dryRun && invitationIds.length > 0) await deleteByIds('invitations', invitationIds)

    const consentRequestIds = (
      await fetchAllRows<{ id: string }>((from, to) =>
        service.from('consent_requests').select('id').eq('organization_id', params.id).lt('expires_at', nowIso).in('status', ['sent', 'expired']).range(from, to),
      )
    ).map((row) => row.id)
    expiredTokenCount += consentRequestIds.length
    if (!input.dryRun && consentRequestIds.length > 0) await deleteByIds('consent_requests', consentRequestIds)

    const mediaGrantIds = (
      await fetchAllRows<{ id: string }>((from, to) =>
        service.from('publication_media_grants').select('id').eq('organization_id', params.id).lt('expires_at', nowIso).range(from, to),
      )
    ).map((row) => row.id)
    expiredTokenCount += mediaGrantIds.length
    if (!input.dryRun && mediaGrantIds.length > 0) await deleteByIds('publication_media_grants', mediaGrantIds)

    const idempotencyKeyIds = (
      await fetchAllRows<{ id: string }>((from, to) =>
        service.from('idempotency_keys').select('id').eq('organization_id', params.id).lt('expires_at', nowIso).range(from, to),
      )
    ).map((row) => row.id)
    expiredTokenCount += idempotencyKeyIds.length
    if (!input.dryRun && idempotencyKeyIds.length > 0) await deleteByIds('idempotency_keys', idempotencyKeyIds)

    results.push({ ruleKey: 'expired_tokens', entityType: 'multiple', entityCount: expiredTokenCount, cutoffDate: nowIso.slice(0, 10) })

    // Auskunftsbuendel (GET /v1/data-subjects/:personId/export) sind keiner Tabelle zugeordnet --
    // ohne diese Regel blieben vollstaendige Personendatensaetze (Name, Elternkontakt,
    // Einwilligungen) unbegrenzt im Storage liegen, auch nach einer Loeschung der Person selbst
    // (adversariale Pruefung). Fester, nicht konfigurierbarer Vorlauf von 7 Tagen: der Link ist nur
    // 300 Sekunden gueltig und soll sofort abgeholt werden, die Datei ist ein technisches
    // Zwischenprodukt, keine Aufbewahrungsentscheidung des Vereins. Ueber storage.list() ermittelt,
    // weil kein Tabelleneintrag je Export existiert.
    const staleExportsCutoff = new Date(now - 7 * 86_400_000)
    const exportsPrefix = `organizations/${params.id}/exports`
    const staleExportPaths: string[] = []
    // storage.list unterliegt keinem PostgREST-max_rows, aber demselben Prinzip: ohne Bloetterung
    // ueber offset wuerde ein Bestand jenseits von 1000 Dateien still auf die erste Seite gekappt.
    for (let offset = 0; ; offset += 1000) {
      const exportsPage = await service.storage.from('raw-media').list(exportsPrefix, { limit: 1000, offset })
      if (exportsPage.error) throw exportsPage.error
      const page = exportsPage.data ?? []
      for (const file of page) {
        if (file.created_at !== null && new Date(file.created_at).getTime() < staleExportsCutoff.getTime()) {
          staleExportPaths.push(`${exportsPrefix}/${file.name}`)
        }
      }
      if (page.length < 1000) break
    }
    if (!input.dryRun && staleExportPaths.length > 0) {
      for (const batch of chunked(staleExportPaths)) {
        const removed = await service.storage.from('raw-media').remove(batch)
        if (removed.error) throw removed.error
      }
    }
    results.push({ ruleKey: 'stale_exports', entityType: 'exports', entityCount: staleExportPaths.length, cutoffDate: staleExportsCutoff.toISOString().slice(0, 10) })

    // Auch ein Trockenlauf wird protokolliert (dry_run=true) -- vor dem ersten scharfen Lauf ist er
    // laut Plan obligatorisch, und "wer hat wann geprueft" ist selbst ein pruefbarer Vorgang.
    const logInsert = await service.from('retention_deletions').insert(
      results.map((result) => ({
        organization_id: params.id, entity_type: result.entityType, entity_count: result.entityCount,
        rule_key: result.ruleKey, cutoff_date: result.cutoffDate, dry_run: input.dryRun, correlation_id: correlationId,
      })),
    )
    if (logInsert.error) throw logInsert.error
    if (!input.dryRun) {
      await recordAuditEvent(request, { organizationId: params.id, action: 'retention.enforced', entityType: 'retention_settings', entityId: params.id, metadata: { results } })
    }

    return reply.code(200).send(
      RunRetentionResponseSchema.parse({ organizationId: params.id, dryRun: input.dryRun, correlationId, results }),
    )
  })

  // Betroffenenrechte: Auskunft, Loeschung, Berichtigung, Widerspruch, Datenuebertragbarkeit -------
  function mapDataSubjectRequestRow(row: Record<string, unknown>) {
    return {
      id: row.id, organizationId: row.organization_id, kind: row.kind, subjectKind: row.subject_kind,
      directoryPersonId: row.directory_person_id, subjectLabel: row.subject_label, receivedAt: row.received_at,
      dueAt: row.due_at, extendedUntil: row.extended_until, extensionReason: row.extension_reason,
      status: row.status, resolutionNote: row.resolution_note, handledBy: row.handled_by,
      completedAt: row.completed_at, createdAt: row.created_at,
    }
  }
  const DATA_SUBJECT_REQUEST_COLUMNS =
    'id, organization_id, kind, subject_kind, directory_person_id, subject_label, received_at, due_at, extended_until, extension_reason, status, resolution_note, handled_by, completed_at, created_at'

  app.get('/v1/organizations/:id/data-subject-requests', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const rows = await supabaseClients.forService().from('data_subject_requests').select(DATA_SUBJECT_REQUEST_COLUMNS).eq('organization_id', params.id).order('due_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map((row) => DataSubjectRequestSchema.parse(mapDataSubjectRequestRow(row))))
  })

  app.post('/v1/organizations/:id/data-subject-requests', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateDataSubjectRequestRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    if (input.directoryPersonId) {
      const person = await supabaseClients.forService().from('directory_people').select('id').eq('id', input.directoryPersonId).eq('organization_id', params.id).maybeSingle()
      if (person.error) throw person.error
      if (!person.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const insert = await supabaseClients
      .forService()
      .from('data_subject_requests')
      .insert({
        organization_id: params.id, kind: input.kind, subject_kind: input.subjectKind,
        directory_person_id: input.directoryPersonId ?? null, subject_label: input.subjectLabel,
        received_at: input.receivedAt, created_by: request.auth!.userId, correlation_id: request.id,
      })
      .select(DATA_SUBJECT_REQUEST_COLUMNS)
      .single()
    if (insert.error) throw insert.error
    await recordAuditEvent(request, { organizationId: params.id, action: 'data_subject_request.created', entityType: 'data_subject_requests', entityId: insert.data.id as string, metadata: { kind: input.kind } })
    return reply.code(201).send(DataSubjectRequestSchema.parse(mapDataSubjectRequestRow(insert.data)))
  })

  async function loadDataSubjectRequest(client: SupabaseClient, id: string): Promise<{ organizationId: string; dueAt: string } | null> {
    const existing = await client.from('data_subject_requests').select('organization_id, due_at').eq('id', id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return null
    return { organizationId: existing.data.organization_id as string, dueAt: existing.data.due_at as string }
  }

  app.patch('/v1/data-subject-requests/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateDataSubjectRequestRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await loadDataSubjectRequest(client, params.id)
    if (existing === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const { organizationId } = existing
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return
    // due_at ist nur aus der Datenbank bekannt, nicht aus dieser Teilanfrage -- ein Zod-Schema
    // allein kann "extendedUntil nach due_at" deshalb nicht pruefen (adversariale Pruefung: ohne
    // diese Pruefung liesse sich eine Verlaengerung VOR die eigentliche Frist legen und der
    // CHECK-Verstoss der Datenbank kam bislang als unbehandelter 500 durch).
    if (input.extendedUntil !== undefined && input.extendedUntil !== null && input.extendedUntil <= existing.dueAt) {
      return reply.code(400).send({ error: 'extended_until_before_due_at', correlationId: request.id })
    }
    const payload: Record<string, unknown> = {}
    if (input.status !== undefined) {
      payload.status = input.status
      payload.handled_by = request.auth!.userId
      if (input.status === 'completed' || input.status === 'rejected' || input.status === 'partially_completed') payload.completed_at = new Date().toISOString()
    }
    if (input.resolutionNote !== undefined) payload.resolution_note = input.resolutionNote
    if (input.extendedUntil !== undefined) {
      payload.extended_until = input.extendedUntil
      // Eine aufgehobene Verlaengerung (extendedUntil:null) nimmt ihre Begruendung mit -- sonst
      // verstoesst die Datenbank gegen "eine Begruendung ohne Verlaengerungsdatum ist unzulaessig",
      // auch wenn extensionReason gar nicht Teil dieser Anfrage war (adversariale Pruefung: ein
      // Zod-Schema kennt den bestehenden Datenbankwert nicht und kann diesen Fall nicht abfangen).
      if (input.extendedUntil === null) {
        payload.extension_reason = null
        payload.extension_notified_at = null
      }
    }
    if (input.extensionReason !== undefined) {
      payload.extension_reason = input.extensionReason
      if (input.extensionReason !== null) payload.extension_notified_at = new Date().toISOString()
    }
    const update = await supabaseClients.forService().from('data_subject_requests').update(payload).eq('id', params.id).select(DATA_SUBJECT_REQUEST_COLUMNS).single()
    if (update.error) {
      if (update.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw update.error
    }
    await recordAuditEvent(request, { organizationId, action: 'data_subject_request.updated', entityType: 'data_subject_requests', entityId: params.id, metadata: { fields: Object.keys(input) } })
    return reply.code(200).send(DataSubjectRequestSchema.parse(mapDataSubjectRequestRow(update.data)))
  })

  // Auskunft: als Job ausgefuehrt (hier synchron, da ohne Hatchet-Cron -- Paket 004), Ergebnis ueber
  // einen kurzlebigen signierten Link statt im Response-Body (das Bündel kann Rechtstexte und
  // mehrere Kategorien enthalten). Enthaelt Verweise und Metadaten, keine Medien Dritter (Plan,
  // Abschnitt "2. Betroffenenrechte bedienbar machen" -- "ein Export, der ein Gruppenfoto mit fuenf
  // Kindern enthaelt, ist ein Datenschutzvorfall im Namen der Auskunft").
  app.get('/v1/data-subjects/:personId/export', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ personId: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const person = await client.from('directory_people').select('organization_id, department_id, team_id, first_name, last_name, birth_year, is_minor, status, joined_at, left_at, guardian_name, guardian_email').eq('id', params.personId).maybeSingle()
    if (person.error) throw person.error
    if (!person.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = person.data.organization_id as string
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return

    const service = supabaseClients.forService()
    const [consents, accessLog] = await Promise.all([
      service.from('consent_records').select('id, scope, origin, signed_at, valid_until, revoked_at, superseded_by').eq('directory_person_id', params.personId),
      // organization_id-Filter zusaetzlich zu entity_id, obwohl heute jeder Schreiber mit
      // entityType='directory_people' die Organisation bereits korrekt aus der Personenzeile
      // ableitet (adversariale Pruefung: kein aktuell ausnutzbarer Pfad, aber diese Zeile soll ihre
      // Mandantensicherheit nicht von der Korrektheit einer fremden Route abhaengig machen).
      service.from('audit_events').select('action, created_at').eq('organization_id', organizationId).eq('entity_type', 'directory_people').eq('entity_id', params.personId).order('created_at', { ascending: false }).limit(500),
    ])
    if (consents.error) throw consents.error
    if (accessLog.error) throw accessLog.error
    const consentIds = consents.data.map((row) => row.id as string)
    const mediaUsages = consentIds.length === 0
      ? []
      : await (async () => {
          const result = await service.from('face_regions').select('media_asset_id, decision, obscuring_style, created_at').in('consent_record_id', consentIds)
          if (result.error) throw result.error
          return result.data
        })()

    const bundle = {
      exportedAt: new Date().toISOString(),
      person: {
        firstName: person.data.first_name, lastName: person.data.last_name, birthYear: person.data.birth_year,
        isMinor: person.data.is_minor, status: person.data.status, joinedAt: person.data.joined_at, leftAt: person.data.left_at,
      },
      guardianContact: { name: person.data.guardian_name, email: person.data.guardian_email },
      consents: consents.data.map((row) => ({ id: row.id, scope: row.scope, origin: row.origin, signedAt: row.signed_at, validUntil: row.valid_until, revokedAt: row.revoked_at, supersededBy: row.superseded_by })),
      mediaUsages: mediaUsages.map((row) => ({ mediaAssetId: row.media_asset_id, decision: row.decision, obscuringStyle: row.obscuring_style, createdAt: row.created_at })),
      accessLog: accessLog.data.map((row) => ({ action: row.action, occurredAt: row.created_at })),
    }
    const objectPath = `organizations/${organizationId}/exports/${randomUUID()}.json`
    const upload = await service.storage.from('raw-media').upload(objectPath, Buffer.from(JSON.stringify(bundle, null, 2), 'utf8'), { contentType: 'application/json' })
    if (upload.error) throw upload.error
    const signed = await service.storage.from('raw-media').createSignedUrl(objectPath, 300, { download: true })
    if (signed.error) throw signed.error
    await recordAuditEvent(request, { organizationId, action: 'data_subject.exported', entityType: 'directory_people', entityId: params.personId })
    return reply.code(200).send(DataSubjectExportResponseSchema.parse({ signedUrl: signed.data.signedUrl, expiresAt: new Date(Date.now() + 300_000).toISOString() }))
  })

  // Loeschung: entfernt den Verzeichniseintrag samt Elternkontakt. consent_records_person_fk ist seit
  // dieser Migration ON DELETE SET NULL -- der Einwilligungsnachweis bleibt bestehen, nur die
  // identifizierende Verknuepfung verschwindet, was auch die Gesichtszuordnung (face_regions ->
  // consent_record_id) von der Person entkoppelt, ohne die Mediendatei selbst anzufassen.
  app.post('/v1/data-subjects/:personId/erase', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ personId: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const person = await client.from('directory_people').select('organization_id').eq('id', params.personId).maybeSingle()
    if (person.error) throw person.error
    if (!person.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = person.data.organization_id as string
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return

    const service = supabaseClients.forService()
    const consentCount = await service.from('consent_records').select('id', { count: 'exact', head: true }).eq('directory_person_id', params.personId)
    if (consentCount.error) throw consentCount.error
    // Identitaet ueberlebte bislang in zwei weiteren Spalten derselben Zeile, obwohl die Antwort
    // "Verknuepfung zur Person entfernt" das Gegenteil behauptete (adversariale Pruefung):
    // pseudonymous_subject_ref ist beim Papierweg haeufig exakt die directory_person_id,
    // signer_name der Klarname der unterschreibenden Person bzw. eines Elternteils. Vor dem Loeschen
    // der Person, sonst hat die FK bereits directory_person_id genullt und dieser Filter trifft
    // keine Zeile mehr.
    if ((consentCount.count ?? 0) > 0) {
      const anonymized = await service.from('consent_records').update({ pseudonymous_subject_ref: null, signer_name: null }).eq('directory_person_id', params.personId)
      if (anonymized.error) throw anonymized.error
    }

    const deleted = await service.from('directory_people').delete().eq('id', params.personId)
    if (deleted.error) throw deleted.error

    await recordAuditEvent(request, { organizationId, action: 'data_subject.erased', entityType: 'directory_people', entityId: params.personId })
    const retained: { category: string; reason: string }[] = []
    if ((consentCount.count ?? 0) > 0) {
      retained.push({
        category: 'Einwilligungsnachweise',
        reason: 'Nachweispflicht -- Aufbewahrung gemäss retention_settings.consent_evidence_years ab Ende der Gültigkeit; Verknüpfung zur Person, Pseudonym und Name der unterzeichnenden Person wurden entfernt',
      })
    }
    retained.push({ category: 'Veröffentlichte Beiträge', reason: 'Löschung auf der Plattform ist eine Handlung des Vereins, nicht des Systems' })
    return reply.code(200).send(
      DataSubjectEraseResponseSchema.parse({
        erased: ['Verzeichniseintrag', 'Elternkontakt', 'Gesichtszuordnung (Verknüpfung zur Person)', 'Pseudonym und Name der unterzeichnenden Person in verknüpften Einwilligungsnachweisen'],
        retained,
      }),
    )
  })

  // Dokumentation der Verarbeitungen und Auftragsverarbeiter ---------------------------------------
  function mapProcessingRecordRow(row: Record<string, unknown>) {
    return {
      id: row.id, organizationId: row.organization_id, purpose: row.purpose, legalBasis: row.legal_basis,
      dataCategories: row.data_categories, subjectCategories: row.subject_categories, recipients: row.recipients,
      thirdCountryTransfer: row.third_country_transfer, transferSafeguard: row.transfer_safeguard,
      retentionNote: row.retention_note, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by, createdAt: row.created_at,
    }
  }
  const PROCESSING_RECORD_COLUMNS =
    'id, organization_id, purpose, legal_basis, data_categories, subject_categories, recipients, third_country_transfer, transfer_safeguard, retention_note, reviewed_at, reviewed_by, created_at'

  app.get('/v1/organizations/:id/processing-records', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const rows = await supabaseClients.forService().from('processing_records').select(PROCESSING_RECORD_COLUMNS).eq('organization_id', params.id).order('created_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map((row) => ProcessingRecordSchema.parse(mapProcessingRecordRow(row))))
  })

  app.post('/v1/organizations/:id/processing-records', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateProcessingRecordRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const insert = await supabaseClients
      .forService()
      .from('processing_records')
      .insert({
        organization_id: params.id, purpose: input.purpose, legal_basis: input.legalBasis,
        data_categories: input.dataCategories, subject_categories: input.subjectCategories, recipients: input.recipients,
        third_country_transfer: input.thirdCountryTransfer, transfer_safeguard: input.transferSafeguard ?? null, retention_note: input.retentionNote,
      })
      .select(PROCESSING_RECORD_COLUMNS)
      .single()
    if (insert.error) {
      if (insert.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, { organizationId: params.id, action: 'processing_record.created', entityType: 'processing_records', entityId: insert.data.id as string })
    return reply.code(201).send(ProcessingRecordSchema.parse(mapProcessingRecordRow(insert.data)))
  })

  app.patch('/v1/processing-records/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateProcessingRecordRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('processing_records').select('organization_id, third_country_transfer, transfer_safeguard').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return
    // Die Zod-Pruefung in UpdateProcessingRecordRequestSchema sieht nur diese Anfrage -- wenn
    // third_country_transfer bereits true in der Datenbank steht und nur transferSafeguard
    // genullt wird (ohne thirdCountryTransfer in derselben Anfrage zu erwaehnen), kann ein Schema
    // ohne Datenbankzugriff das nicht erkennen (adversariale Pruefung).
    const resultingThirdCountryTransfer = input.thirdCountryTransfer ?? (existing.data.third_country_transfer as boolean)
    const resultingTransferSafeguard = input.transferSafeguard !== undefined ? input.transferSafeguard : (existing.data.transfer_safeguard as string | null)
    if (resultingThirdCountryTransfer && !resultingTransferSafeguard) {
      return reply.code(400).send({ error: 'transfer_safeguard_required', correlationId: request.id })
    }
    const payload: Record<string, unknown> = {}
    if (input.purpose !== undefined) payload.purpose = input.purpose
    if (input.legalBasis !== undefined) payload.legal_basis = input.legalBasis
    if (input.dataCategories !== undefined) payload.data_categories = input.dataCategories
    if (input.subjectCategories !== undefined) payload.subject_categories = input.subjectCategories
    if (input.recipients !== undefined) payload.recipients = input.recipients
    if (input.thirdCountryTransfer !== undefined) payload.third_country_transfer = input.thirdCountryTransfer
    if (input.transferSafeguard !== undefined) payload.transfer_safeguard = input.transferSafeguard
    if (input.retentionNote !== undefined) payload.retention_note = input.retentionNote
    // Eine Bestaetigung ist eine bewusste Handlung, kein Nebeneffekt einer Textaenderung -- deshalb
    // ein eigenes Flag statt reviewed_at bei jedem Feld-Update automatisch mitzusetzen.
    if (input.confirmReviewed === true) {
      payload.reviewed_at = new Date().toISOString().slice(0, 10)
      payload.reviewed_by = request.auth!.userId
    }
    const update = await supabaseClients.forService().from('processing_records').update(payload).eq('id', params.id).select(PROCESSING_RECORD_COLUMNS).single()
    if (update.error) {
      if (update.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw update.error
    }
    await recordAuditEvent(request, { organizationId, action: 'processing_record.updated', entityType: 'processing_records', entityId: params.id, metadata: { fields: Object.keys(input) } })
    return reply.code(200).send(ProcessingRecordSchema.parse(mapProcessingRecordRow(update.data)))
  })

  function mapProcessorAgreementRow(row: Record<string, unknown>) {
    return {
      id: row.id, organizationId: row.organization_id, processorName: row.processor_name, purpose: row.purpose,
      signedAt: row.signed_at, validUntil: row.valid_until, hasDocument: row.document_path !== null, status: row.status, createdAt: row.created_at,
    }
  }
  const PROCESSOR_AGREEMENT_COLUMNS = 'id, organization_id, processor_name, purpose, signed_at, valid_until, document_path, status, created_at'
  const ALLOWED_AGREEMENT_MIME = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])

  app.get('/v1/organizations/:id/processor-agreements', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const rows = await supabaseClients.forService().from('processor_agreements').select(PROCESSOR_AGREEMENT_COLUMNS).eq('organization_id', params.id).order('created_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map((row) => ProcessorAgreementSchema.parse(mapProcessorAgreementRow(row))))
  })

  // Multipart mit optionaler Vertragsdatei (PDF/DOCX) -- gleiches Muster wie POST /v1/consents:
  // Datei zuerst vollstaendig lesen, danach die begleitenden Felder auswerten.
  app.post('/v1/organizations/:id/processor-agreements', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return

    let fields: z.infer<typeof CreateProcessorAgreementFieldsSchema>
    let buffer: Buffer | null = null
    let mimetype: string | null = null
    const filePart = request.isMultipart() ? await request.file() : undefined
    if (filePart) {
      try {
        buffer = await filePart.toBuffer()
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
        }
        throw error
      }
      if (!ALLOWED_AGREEMENT_MIME.has(filePart.mimetype)) return reply.code(400).send({ error: 'invalid_file_type', correlationId: request.id })
      mimetype = filePart.mimetype
      // Ein leeres Formularfeld (z. B. ein Datumsfeld, das im Browser nicht ausgefuellt wurde)
      // kommt als leerer String an, nicht als fehlendes Feld -- z.iso.date().optional() lehnt ''
      // ab, waehrend ein tatsaechlich weggelassenes Feld durchginge (dasselbe Muster wie der
      // Memory-Eintrag zu $fetch und null-Query-Parametern). Leere Strings werden deshalb vor dem
      // Parsen wie ein weggelassenes Feld behandelt.
      const rawFields = Object.fromEntries(
        Object.entries(filePart.fields).map(([key, field]) => {
          const value = field && 'value' in field ? field.value : undefined
          return [key, value === '' ? undefined : value]
        }),
      )
      fields = CreateProcessorAgreementFieldsSchema.parse(rawFields)
    } else {
      fields = CreateProcessorAgreementFieldsSchema.parse(request.body)
    }

    const service = supabaseClients.forService()
    const agreementId = randomUUID()
    let documentPath: string | null = null
    if (buffer && mimetype) {
      documentPath = `organizations/${params.id}/compliance/${agreementId}/vertrag`
      const upload = await service.storage.from('raw-media').upload(documentPath, buffer, { contentType: mimetype })
      if (upload.error) throw upload.error
    }
    const insert = await service
      .from('processor_agreements')
      .insert({
        id: agreementId, organization_id: params.id, processor_name: fields.processorName, purpose: fields.purpose,
        signed_at: fields.signedAt ?? null, valid_until: fields.validUntil ?? null, status: fields.status,
        document_path: documentPath, created_by: request.auth!.userId,
      })
      .select(PROCESSOR_AGREEMENT_COLUMNS)
      .single()
    if (insert.error) {
      if (insert.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, { organizationId: params.id, action: 'processor_agreement.created', entityType: 'processor_agreements', entityId: agreementId })
    return reply.code(201).send(ProcessorAgreementSchema.parse(mapProcessorAgreementRow(insert.data)))
  })

  app.patch('/v1/processor-agreements/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateProcessorAgreementRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('processor_agreements').select('organization_id, signed_at').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return
    // signedAt ist in diesem Schema nicht setzbar, der bestehende Wert steht nur in der Datenbank
    // -- ohne diese Pruefung kam ein zu frueh gesetztes validUntil bislang als unbehandelter 500
    // durch (adversariale Pruefung).
    const existingSignedAt = existing.data.signed_at as string | null
    if (input.validUntil && existingSignedAt && input.validUntil <= existingSignedAt) {
      return reply.code(400).send({ error: 'valid_until_before_signed_at', correlationId: request.id })
    }
    const payload: Record<string, unknown> = {}
    if (input.status !== undefined) payload.status = input.status
    if (input.validUntil !== undefined) payload.valid_until = input.validUntil
    const update = await supabaseClients.forService().from('processor_agreements').update(payload).eq('id', params.id).select(PROCESSOR_AGREEMENT_COLUMNS).single()
    if (update.error) {
      if (update.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw update.error
    }
    await recordAuditEvent(request, { organizationId, action: 'processor_agreement.updated', entityType: 'processor_agreements', entityId: params.id, metadata: { fields: Object.keys(input) } })
    return reply.code(200).send(ProcessorAgreementSchema.parse(mapProcessorAgreementRow(update.data)))
  })

  // Kurzlebige signierte URL statt eines dauerhaften Links -- gleiches Muster wie
  // GET /v1/consents/:id/evidence-url (Paket 015): jeder Abruf eines Vertragsdokuments erzeugt einen
  // audit_events-Eintrag (Plan, Abschnitt "Verifikation" -- "der Abruf erzeugt einen
  // audit_events-Eintrag").
  app.get('/v1/processor-agreements/:id/document-url', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('processor_agreements').select('organization_id, document_path').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return
    if (!existing.data.document_path) return reply.code(404).send({ error: 'no_document', correlationId: request.id })
    const service = supabaseClients.forService()
    const signed = await service.storage.from('raw-media').createSignedUrl(existing.data.document_path as string, 300, { download: true })
    if (signed.error) throw signed.error
    await recordAuditEvent(request, { organizationId, action: 'processor_agreement.document_viewed', entityType: 'processor_agreements', entityId: params.id })
    return reply.code(200).send({ signedUrl: signed.data.signedUrl, expiresAt: new Date(Date.now() + 300_000).toISOString() })
  })

  // Manipulationssicherer Audit-Trail: signieren (periodischer Lauf, manuell bis Paket 004) und
  // pruefen ------------------------------------------------------------------------------------------
  app.post('/v1/organizations/:id/audit-chain/sign', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const service = supabaseClients.forService()
    const head = await service.from('audit_events').select('hash').eq('organization_id', params.id).order('chain_seq', { ascending: false }).limit(1).maybeSingle()
    if (head.error) throw head.error
    const countResult = await service.from('audit_events').select('id', { count: 'exact', head: true }).eq('organization_id', params.id)
    if (countResult.error) throw countResult.error
    const headHash = (head.data?.hash as string | undefined) ?? null
    const signer = createChainSignerFromEnvironment(environment)
    const signed = signer.sign(headHash ?? '')
    const insert = await service
      .from('audit_chain_signatures')
      .insert({ organization_id: params.id, event_count: countResult.count ?? 0, head_hash: headHash, key_version: signed.keyVersion, signature: signed.signature })
      .select('signed_at')
      .single()
    if (insert.error) throw insert.error
    return reply.code(201).send(
      SignAuditChainResponseSchema.parse({
        organizationId: params.id, eventCount: countResult.count ?? 0, headHash, keyVersion: signed.keyVersion, signedAt: insert.data.signed_at,
      }),
    )
  })

  app.get('/v1/organizations/:id/audit-chain/verify', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const service = supabaseClients.forService()
    const result = await service.rpc('verify_audit_chain', { target_organization_id: params.id })
    if (result.error) throw result.error
    const row = (result.data as { checked_count: number; tampered_count: number; unlinked_count: number }[])[0]!
    const lastSignature = await service
      .from('audit_chain_signatures')
      .select('signed_at, head_hash, signature, key_version')
      .eq('organization_id', params.id)
      .order('signed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastSignature.error) throw lastSignature.error
    // Der eigentliche Zweck der externen Signatur: ein Angreifer mit Datenbankzugriff kann
    // audit_chain_signatures beliebig umschreiben (service_role hat volle Rechte), aber nicht den
    // Schluessel faelschen, der nicht in der Datenbank liegt. Ohne diese Pruefung war die Signatur
    // bislang reine Schreiblast -- verify_audit_chain rechnet nur lokal aus denselben, potenziell
    // manipulierten Zeilen nach und haette einen so vertuschten Eingriff nie erkannt (adversariale
    // Pruefung).
    let signatureValid: boolean | null = null
    if (lastSignature.data) {
      const signer = createChainSignerFromEnvironment(environment)
      signatureValid = signer.verify(lastSignature.data.head_hash ?? '', lastSignature.data.signature as string, lastSignature.data.key_version as string)
      // Eine unveraenderte Signaturzeile allein beweist nichts: sie muss auch zum heutigen
      // Kettenzustand passen. Eine Aufbewahrungsloeschung entfernt nur alte Zeilen und laesst
      // den signierten Kopf-Hash bestehen -- fehlt er, wurde am Kopf der Kette eingegriffen.
      const signedHeadHash = lastSignature.data.head_hash as string | null
      if (signatureValid && signedHeadHash !== null) {
        const stillPresent = await service.from('audit_events').select('id').eq('organization_id', params.id).eq('hash', signedHeadHash).limit(1)
        if (stillPresent.error) throw stillPresent.error
        signatureValid = stillPresent.data.length > 0
      }
    }
    return reply.code(200).send(
      AuditChainVerificationSchema.parse({
        organizationId: params.id, checkedCount: row.checked_count, tamperedCount: row.tampered_count, unlinkedCount: row.unlinked_count,
        lastSignedAt: lastSignature.data?.signed_at ?? null, signatureValid,
      }),
    )
  })

  // Oeffentlich, ohne Anmeldung -- ein Verein kann diese URL aus seiner Instagram-/Facebook-Bio
  // verlinken (Plan, Abschnitt "3. Pflichtangaben und Verantwortung").
  app.get('/v1/organizations/:id/imprint', async (request, reply) => {
    if (!checkRateLimit(`imprint:${request.ip}`, 60, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const [organization, profile] = await Promise.all([
      service.from('organizations').select('name').eq('id', params.id).maybeSingle(),
      service
        .from('organization_profiles')
        .select('legal_name, legal_form, register_court, register_number, street, house_number, postal_code, city, country_code, contact_email, contact_phone, website_url, responsible_person_profile_id, imprint_published')
        .eq('organization_id', params.id)
        .maybeSingle(),
    ])
    if (organization.error) throw organization.error
    if (profile.error) throw profile.error
    if (!organization.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    // Ohne ausdrueckliche Freigabe (Default false) veroeffentlicht diese Route nichts -- ein Verein,
    // der Kontakt-/Adress-/Registerangaben nur zur internen Verwaltung eingetragen hat, soll sie
    // nicht ungefragt jedem zeigen, der die Organisations-UUID kennt (adversariale Pruefung).
    if (!profile.data?.imprint_published) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    let responsiblePersonName: string | null = null
    if (profile.data?.responsible_person_profile_id) {
      const responsible = await service.from('profiles').select('display_name').eq('id', profile.data.responsible_person_profile_id).maybeSingle()
      if (responsible.error) throw responsible.error
      responsiblePersonName = (responsible.data?.display_name as string | undefined) ?? null
    }
    return reply.code(200).send(
      PublicOrganizationImprintSchema.parse({
        organizationName: organization.data.name,
        legalName: profile.data?.legal_name ?? null,
        legalForm: profile.data?.legal_form ?? null,
        registerCourt: profile.data?.register_court ?? null,
        registerNumber: profile.data?.register_number ?? null,
        street: profile.data?.street ?? null,
        houseNumber: profile.data?.house_number ?? null,
        postalCode: profile.data?.postal_code ?? null,
        city: profile.data?.city ?? null,
        countryCode: profile.data?.country_code ?? 'DE',
        contactEmail: profile.data?.contact_email ?? null,
        contactPhone: profile.data?.contact_phone ?? null,
        websiteUrl: profile.data?.website_url ?? null,
        responsiblePersonName,
      }),
    )
  })

  // Paket 016: Auswertung: interne Kennzahlen -------------------------------------------------------
  // Kein metrics_daily-Cache, kein Aggregationsjob: jede Anfrage berechnet live aus den
  // Rohtabellen (post_status_events, approval_decisions, publications, workflow_runs,
  // post_versions, posts, submissions). Siehe plans/016-auswertung-interne-kennzahlen.md,
  // "Abweichungen vom Plan" Punkt 4, fuer die Begruendung.
  interface AnalyticsScope {
    organizationId: string
    departmentId?: string
    teamId?: string
  }
  function toAnalyticsScope(query: { organizationId: string; departmentId?: string | undefined; teamId?: string | undefined }): AnalyticsScope {
    return { organizationId: query.organizationId, ...(query.departmentId ? { departmentId: query.departmentId } : {}), ...(query.teamId ? { teamId: query.teamId } : {}) }
  }

  // KRITISCHER FUND (adversariale Pruefung): auth.ts' rolesForScope prueft organization_memberships,
  // department_memberships und team_memberships voellig unabhaengig voneinander -- nirgends wird
  // geprueft, dass die drei IDs ueberhaupt zusammengehoeren. Ein Aufrufer mit einer echten
  // Abteilungsrolle (analytics.view) in Verein A koennte sonst organizationId=<fremder Verein B> mit
  // seiner eigenen, echten departmentId aus A kombinieren: requirePermission wuerde ueber die reale
  // Abteilungsrolle in A durchgehen, obwohl die Anfrage inhaltlich Verein B gilt. Die meisten Loader
  // unten filtern zusammengesetzt nach organization_id UND department_id und liefern bei einem
  // solchen inkonsistenten Paar zufaellig leer -- die Kontingentauslastung in GET .../summary filtert
  // channel_quotas dagegen ausschliesslich nach organizationId und haette echte Konfigurations- und
  // Nutzungsdaten eines fremden Vereins zurueckgegeben. Statt den gemeinsam genutzten RoleProvider
  // projektweit zu aendern (groesserer, eigenstaendiger Eingriff), wird hier vor jeder Rechtepruefung
  // separat sichergestellt, dass departmentId tatsaechlich zu organizationId gehoert und teamId zu
  // departmentId -- dasselbe Muster wie resolveMembershipScope() oben, nur in die andere Richtung
  // (IDs vom Aufrufer, nicht aus scope+scopeId aufgeloest).
  //
  // Ueber den Nutzer-Client (RLS), nicht die Service Role: departments_select_member/
  // teams_select_member lassen jedes Mitglied die eigene Abteilung/das eigene Team sehen (mit
  // Fallback auf eine Vereinsrolle) -- fuer eine echte Kombination liefert das dieselbe Zeile wie
  // die Service Role, fuer eine vorgetaeuschte liefert RLS entweder eine ANDERE organization_id
  // (Mismatch erkannt) oder gar keine Zeile (ebenfalls erkannt). So bleibt der etablierte Aufbau
  // dieser Datei erhalten: kein Supabase-Zugriff, bevor requirePermission entschieden hat -- nur
  // aufgerufen, wenn tatsaechlich eine departmentId angegeben ist.
  async function verifyDepartmentAndTeamBelongToOrganization(
    client: SupabaseClient,
    query: { organizationId: string; departmentId: string; teamId?: string | undefined },
  ): Promise<boolean> {
    const department = await client.from('departments').select('organization_id').eq('id', query.departmentId).maybeSingle()
    if (department.error) throw department.error
    if (!department.data || department.data.organization_id !== query.organizationId) return false
    if (query.teamId) {
      const team = await client.from('teams').select('organization_id, department_id').eq('id', query.teamId).maybeSingle()
      if (team.error) throw team.error
      if (!team.data || team.data.organization_id !== query.organizationId || team.data.department_id !== query.departmentId) return false
    }
    return true
  }
  async function assertAnalyticsScopeConsistency(
    request: FastifyRequest,
    reply: FastifyReply,
    query: { organizationId: string; departmentId?: string | undefined; teamId?: string | undefined },
  ): Promise<boolean> {
    if (!query.departmentId) return true
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const consistent = await verifyDepartmentAndTeamBelongToOrganization(client, { organizationId: query.organizationId, departmentId: query.departmentId, teamId: query.teamId })
    if (!consistent) {
      reply.code(404).send({ error: 'not_found', correlationId: request.id })
      return false
    }
    return true
  }

  // null statt Wurf, wenn die Organisation nicht (mehr) existiert -- ein geworfener Error waere ueber
  // den generischen Fehler-Handler als 500 internal_error beantwortet worden, obwohl jede andere
  // Route dieser Datei eine fehlende Organisation mit 404 not_found beantwortet (CodeRabbit-Fund zu
  // PR #28). In der Praxis greift zuvor meist requirePermission mit 403, der Pfad bleibt aber
  // erreichbar, sobald eine Rollenzeile eine inzwischen geloeschte Organisation referenziert.
  async function loadOrganizationTimezone(service: SupabaseClient, organizationId: string): Promise<string | null> {
    const organization = await service.from('organizations').select('timezone').eq('id', organizationId).maybeSingle()
    if (organization.error) throw organization.error
    if (!organization.data) return null
    return organization.data.timezone as string
  }

  // Fruehestes submissions.created_at im Scope -- "ab wann liegen ueberhaupt Daten vor" (Plan,
  // Abschnitt "Endpunkte", "coverage"). null, solange kein einziger Beitrag eingereicht wurde. Auch
  // die Grundlage dafuer, ob eine Vorperiode fuer einen Trend ueberhaupt vollstaendig ist.
  async function loadMeasurementStart(service: SupabaseClient, scope: AnalyticsScope): Promise<string | null> {
    let query = service.from('submissions').select('created_at').eq('organization_id', scope.organizationId)
    if (scope.teamId) query = query.eq('team_id', scope.teamId)
    else if (scope.departmentId) query = query.eq('department_id', scope.departmentId)
    const result = await query.order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (result.error) throw result.error
    return result.data ? (result.data.created_at as string).slice(0, 10) : null
  }

  async function loadPostsInScope(service: SupabaseClient, scope: AnalyticsScope): Promise<{ id: string; createdAt: string; departmentId: string }[]> {
    const rows = await fetchAllRows<{ id: string; created_at: string; department_id: string }>((from, to) => {
      let query = service.from('posts').select('id, created_at, department_id').eq('organization_id', scope.organizationId)
      if (scope.teamId) query = query.eq('team_id', scope.teamId)
      else if (scope.departmentId) query = query.eq('department_id', scope.departmentId)
      return query.range(from, to)
    })
    return rows.map((row) => ({ id: row.id, createdAt: row.created_at, departmentId: row.department_id }))
  }

  // to_status IN (...) filtert serverseitig auf die fuenf fuer Kennzahlen relevanten Uebergaenge --
  // post_status_events ist laut Plan die am schnellsten wachsende Tabelle, ein unnoetig
  // uebertragener Uebergang (z. B. draft_ready -> render_queued) kostet ohne Nutzen.
  const RELEVANT_TRANSITION_STATUSES = ['awaiting_approval', 'approved', 'changes_requested', 'scheduled', 'published']
  async function loadStatusTransitionsInScope(service: SupabaseClient, scope: AnalyticsScope): Promise<{ postId: string; toStatus: string; occurredAt: string }[]> {
    const rows = await fetchAllRows<{ post_id: string; to_status: string; occurred_at: string }>((from, to) => {
      let query = service
        .from('post_status_events')
        .select('post_id, to_status, occurred_at')
        .eq('organization_id', scope.organizationId)
        .in('to_status', RELEVANT_TRANSITION_STATUSES)
      if (scope.teamId) query = query.eq('team_id', scope.teamId)
      else if (scope.departmentId) query = query.eq('department_id', scope.departmentId)
      return query.range(from, to)
    })
    return rows.map((row) => ({ postId: row.post_id, toStatus: row.to_status, occurredAt: row.occurred_at }))
  }

  async function loadApprovalDecisionsInScope(service: SupabaseClient, postIds: readonly string[]): Promise<{ decision: 'approved' | 'changes_requested' | 'rejected'; createdAt: string }[]> {
    if (postIds.length === 0) return []
    const requestIds = (
      await fetchAllRowsForIds<{ id: string }>(postIds, (batch, from, to) => service.from('approval_requests').select('id').in('post_id', batch).range(from, to))
    ).map((row) => row.id)
    if (requestIds.length === 0) return []
    const decisions = await fetchAllRowsForIds<{ decision: 'approved' | 'changes_requested' | 'rejected'; created_at: string }>(requestIds, (batch, from, to) =>
      service.from('approval_decisions').select('decision, created_at').in('approval_request_id', batch).range(from, to),
    )
    return decisions.map((row) => ({ decision: row.decision, createdAt: row.created_at }))
  }

  // publications hat kein department_id/team_id (Plan, "Risiken": "dieselbe Einschraenkung wie in
  // Paket 011") -- Scoping laeuft ueber die post_version_id-Liste der bereits geladenen Beitraege.
  // postId/socialConnectionId bleiben erhalten, damit "aktive Abteilungen" und die Kanal-
  // Aufschluesselung dieselbe Ladung wiederverwenden koennen statt ein zweites Mal zu joinen. `since`
  // ist die untere Fenstergrenze des Aufrufers (Vorperiode fuer Trends eingeschlossen) -- posts/
  // post_status_events brauchen die volle Historie (erste published-Transition, Durchlaufzeit), aber
  // publications hat dafuer keinen fachlichen Grund und wuerde sonst bei jeder Anfrage die gesamte
  // Vereinshistorie uebertragen (CodeRabbit-Nitpick zu PR #28).
  async function loadPublicationsForPosts(
    service: SupabaseClient,
    postIds: readonly string[],
    since: string,
  ): Promise<{ postId: string; socialConnectionId: string; status: string; updatedAt: string }[]> {
    if (postIds.length === 0) return []
    const versions = await fetchAllRowsForIds<{ id: string; post_id: string }>(postIds, (batch, from, to) => service.from('post_versions').select('id, post_id').in('post_id', batch).range(from, to))
    const versionToPost = new Map(versions.map((version) => [version.id, version.post_id]))
    const versionIds = versions.map((version) => version.id)
    if (versionIds.length === 0) return []
    const publications = await fetchAllRowsForIds<{ post_version_id: string; social_connection_id: string; status: string; updated_at: string }>(versionIds, (batch, from, to) =>
      service.from('publications').select('post_version_id, social_connection_id, status, updated_at').in('post_version_id', batch).gte('updated_at', since).range(from, to),
    )
    return publications.map((row) => ({
      postId: versionToPost.get(row.post_version_id) ?? '',
      socialConnectionId: row.social_connection_id,
      status: row.status,
      updatedAt: row.updated_at,
    }))
  }

  async function loadPostVersionsForPosts(service: SupabaseClient, postIds: readonly string[]): Promise<{ postId: string; versionNumber: number }[]> {
    if (postIds.length === 0) return []
    const rows = await fetchAllRowsForIds<{ post_id: string; version_number: number }>(postIds, (batch, from, to) => service.from('post_versions').select('post_id, version_number').in('post_id', batch).range(from, to))
    return rows.map((row) => ({ postId: row.post_id, versionNumber: row.version_number }))
  }

  // workflow_runs hat department_id, aber kein team_id (Schema seit der ersten Content-Pipeline-
  // Migration, ausserhalb des Scopes dieses Pakets) -- eine team-gescopte Anfrage bekommt hier
  // bestenfalls Abteilungsgranularitaet: ein team_manager ohne eigene Abteilungsrolle sieht in
  // workflowRuns/workflowFailures/workflowFailureRate die Zaehlwerte der GESAMTEN Abteilung, nicht
  // nur des eigenen Teams (adversariale Pruefung, als bewusst nicht behobene Einschraenkung
  // eingeordnet: reine technische Zaehlwerte ohne Personenbezug oder Inhalt, eine Behebung
  // bräuchte eine Schemaerweiterung ausserhalb dieses Pakets). Ehrlich unveraendert statt erfunden
  // praezisiert. `since` wie bei loadPublicationsForPosts: workflow_runs traegt keine posts.id-
  // Historienabhaengigkeit, ein Zeitfilter ab der unteren Fenstergrenze verliert keine Information.
  async function loadWorkflowRunsInScope(service: SupabaseClient, scope: AnalyticsScope, since: string): Promise<{ technicalStatus: string; updatedAt: string }[]> {
    const rows = await fetchAllRows<{ technical_status: string; updated_at: string }>((from, to) => {
      let query = service.from('workflow_runs').select('technical_status, updated_at').eq('organization_id', scope.organizationId).gte('updated_at', since)
      if (scope.departmentId) query = query.eq('department_id', scope.departmentId)
      return query.range(from, to)
    })
    return rows.map((row) => ({ technicalStatus: row.technical_status, updatedAt: row.updated_at }))
  }

  app.get('/v1/analytics/summary', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = AnalyticsScopeQuerySchema.parse(request.query)
    if (!(await assertAnalyticsScopeConsistency(request, reply, query))) return
    if (!(await requirePermission(request, reply, 'analytics.view', toPermissionScope(query.organizationId, query.departmentId, query.teamId)))) return

    const service = supabaseClients.forService()
    const scope = toAnalyticsScope(query)
    const timezone = await loadOrganizationTimezone(service, query.organizationId)
    if (timezone === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const measurementStartsAt = await loadMeasurementStart(service, scope)
    const window = rangeWindow(query.from, addDays(query.to, 1), timezone)
    // Vorab berechnet, weil publications/workflow_runs weiter unten schon ab der unteren Grenze der
    // Vorperiode geladen werden -- der Trend-Block weiter unten braucht dieselbe previousWindow.
    const spanDays = daysBetween(query.from, query.to) + 1
    const previousFrom = addDays(query.from, -spanDays)
    const previousWindow = rangeWindow(previousFrom, query.from, timezone)

    const posts = await loadPostsInScope(service, scope)
    const postIds = posts.map((post) => post.id)
    const transitions = await loadStatusTransitionsInScope(service, scope)
    const publishedTransitions = transitions.filter((transition) => transition.toStatus === 'published').map(({ postId, occurredAt }) => ({ postId, occurredAt }))
    const [approvalDecisions, publicationsWithPost, postVersions, workflowRuns] = await Promise.all([
      loadApprovalDecisionsInScope(service, postIds),
      loadPublicationsForPosts(service, postIds, previousWindow.startUtc),
      loadPostVersionsForPosts(service, postIds),
      loadWorkflowRunsInScope(service, scope, previousWindow.startUtc),
    ])
    const publications = publicationsWithPost.map(({ status, updatedAt }) => ({ status, updatedAt }))

    const current = computeCountMetrics({ window, postsCreated: posts, publishedTransitions, approvalDecisions, publications, workflowRuns, postVersions })
    const leadTimeSamples = leadTimeSecondsSamples(window, posts, publishedTransitions)
    const approvalSamples = approvalDurationSecondsSamples(window, transitions)
    const leadTimeMedian = median(leadTimeSamples)

    const decidedCount = current.approvalsGranted + current.approvalsChangesRequested + current.approvalsRejected
    const approvalRate = decidedCount > 0 ? current.approvalsGranted / decidedCount : null
    const changeRequestRate = decidedCount > 0 ? current.approvalsChangesRequested / decidedCount : null
    const workflowFailureRate = current.workflowRuns > 0 ? current.workflowFailures / current.workflowRuns : null
    const averageRevisionsPerPost = current.revisionsCount > 0 ? current.revisionsSum / current.revisionsCount : null

    // "Aktive Einheiten" ist nur auf Vereinsebene eine sinnvolle Aussage -- bei einer bereits auf
    // eine Abteilung eingeschraenkten Anfrage waere das Ergebnis immer 0 oder 1 und keine Information.
    let activeDepartments: number | null = null
    if (!query.departmentId) {
      const departmentByPost = new Map(posts.map((post) => [post.id, post.departmentId]))
      const active = new Set<string>()
      for (const publication of publicationsWithPost) {
        if (publication.status !== 'published' || !isInWindow(publication.updatedAt, window)) continue
        const departmentId = departmentByPost.get(publication.postId)
        if (departmentId) active.add(departmentId)
      }
      activeDepartments = active.size
    }

    // Trend nur bei vollstaendiger Vorperiode -- eine Vorperiode, die vor measurementStartsAt
    // beginnt, ist per Definition unvollstaendig (Plan, Abschnitt "Metrikdefinitionen"). Kein
    // Fallback auf 0 %.
    let postsCreatedTrend: number | null = null
    let postsPublishedTrend: number | null = null
    let publicationsPublishedTrend: number | null = null
    let approvalRateTrend: number | null = null
    let leadTimeSecondsMedianTrend: number | null = null
    if (measurementStartsAt !== null && previousFrom >= measurementStartsAt) {
      const previous = computeCountMetrics({ window: previousWindow, postsCreated: posts, publishedTransitions, approvalDecisions, publications, workflowRuns, postVersions })
      const previousDecided = previous.approvalsGranted + previous.approvalsChangesRequested + previous.approvalsRejected
      const previousApprovalRate = previousDecided > 0 ? previous.approvalsGranted / previousDecided : null
      const previousLeadTimeMedian = median(leadTimeSecondsSamples(previousWindow, posts, publishedTransitions))
      postsCreatedTrend = computeTrend(current.postsCreated, previous.postsCreated)
      postsPublishedTrend = computeTrend(current.postsPublished, previous.postsPublished)
      publicationsPublishedTrend = computeTrend(current.publicationsPublished, previous.publicationsPublished)
      approvalRateTrend = approvalRate !== null ? computeTrend(approvalRate, previousApprovalRate) : null
      leadTimeSecondsMedianTrend = leadTimeMedian !== null ? computeTrend(leadTimeMedian, previousLeadTimeMedian) : null
    }

    // Kontingentauslastung: aktuelle Periode (nicht der angefragte Auswertungszeitraum) -- eine
    // Quote bezieht sich immer auf "gerade jetzt", nicht auf einen frei gewaehlten Vergangenheits-
    // zeitraum (Plan, Abschnitt "Oberflaeche", eigener Punkt neben der Kennzahlenzeile).
    const quotaRows = await fetchAllRows<{
      id: string; scope: string; department_id: string | null; team_id: string | null; social_connection_id: string | null; period: 'day' | 'week' | 'month'; max_publications: number
    }>((from, to) => service.from('channel_quotas').select('id, scope, department_id, team_id, social_connection_id, period, max_publications').eq('organization_id', query.organizationId).range(from, to))
    const nowIso = new Date().toISOString()
    const quotas = await Promise.all(
      quotaRows.map(async (row) => {
        const usage = await service.rpc('count_publications_in_period', {
          target_organization: query.organizationId, target_department: row.department_id, target_team: row.team_id,
          target_connection: row.social_connection_id, quota_period: row.period, reference: nowIso,
        })
        if (usage.error) throw usage.error
        return {
          id: row.id, scope: row.scope, scopeId: row.team_id ?? row.department_id ?? query.organizationId,
          socialConnectionId: row.social_connection_id, period: row.period, maxPublications: row.max_publications, used: usage.data as number,
        }
      }),
    )

    return reply.code(200).send(
      AnalyticsSummarySchema.parse({
        coverage: { measurementStartsAt, requestedFrom: query.from, requestedTo: query.to },
        postsCreated: current.postsCreated, postsCreatedTrend,
        postsPublished: current.postsPublished, postsPublishedTrend,
        publicationsPublished: current.publicationsPublished, publicationsPublishedTrend,
        publicationsFailed: current.publicationsFailed,
        approvalRate, approvalRateTrend, changeRequestRate,
        leadTimeSecondsMedian: leadTimeMedian, leadTimeSecondsMedianTrend,
        approvalSecondsMedian: median(approvalSamples),
        averageRevisionsPerPost, workflowFailureRate, activeDepartments,
        quotas,
      }),
    )
  })

  app.get('/v1/analytics/timeseries', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = AnalyticsTimeseriesQuerySchema.parse(request.query)
    if (!(await assertAnalyticsScopeConsistency(request, reply, query))) return
    if (!(await requirePermission(request, reply, 'analytics.view', toPermissionScope(query.organizationId, query.departmentId, query.teamId)))) return

    const service = supabaseClients.forService()
    const scope = toAnalyticsScope(query)
    const timezone = await loadOrganizationTimezone(service, query.organizationId)
    if (timezone === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const measurementStartsAt = await loadMeasurementStart(service, scope)
    const requestWindowStart = rangeWindow(query.from, addDays(query.to, 1), timezone).startUtc

    const posts = await loadPostsInScope(service, scope)
    const postIds = posts.map((post) => post.id)
    const transitions = await loadStatusTransitionsInScope(service, scope)
    const publishedTransitions = transitions.filter((transition) => transition.toStatus === 'published').map(({ postId, occurredAt }) => ({ postId, occurredAt }))
    const [approvalDecisions, publicationsWithPost, postVersions, workflowRuns] = await Promise.all([
      loadApprovalDecisionsInScope(service, postIds),
      loadPublicationsForPosts(service, postIds, requestWindowStart),
      loadPostVersionsForPosts(service, postIds),
      loadWorkflowRunsInScope(service, scope, requestWindowStart),
    ])
    const publications = publicationsWithPost.map(({ status, updatedAt }) => ({ status, updatedAt }))

    // Bucket-Start ist immer ein Kalendertag (bzw. bei "month" der 1. des Monats) in der
    // Vereinszeitzone -- ein krummer erster Balken waere zwischen zwei Aufrufen mit leicht
    // verschobenem "from" nicht vergleichbar.
    function bucketStartDays(): string[] {
      const days: string[] = []
      if (query.granularity === 'month') {
        let cursor = `${query.from.slice(0, 7)}-01`
        while (cursor <= query.to) {
          days.push(cursor)
          const year = Number(cursor.slice(0, 4))
          const month = Number(cursor.slice(5, 7))
          cursor = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
        }
        return days
      }
      const step = query.granularity === 'week' ? 7 : 1
      for (let cursor = query.from; cursor <= query.to; cursor = addDays(cursor, step)) days.push(cursor)
      return days
    }
    const bucketStarts = bucketStartDays()
    const bucketWindows = bucketStarts.map((bucketStart, index) => {
      const nextBucketStart = bucketStarts[index + 1]
      const bucketEndExclusive = nextBucketStart ?? addDays(query.to, 1)
      return rangeWindow(bucketStart, bucketEndExclusive, timezone)
    })
    const bucketMetrics = computeCountMetricsSeries(bucketWindows, { postsCreated: posts, publishedTransitions, approvalDecisions, publications, workflowRuns, postVersions })
    const points = bucketStarts.map((bucketStart, index) => ({ bucketStart, value: (bucketMetrics[index] as CountMetrics)[query.metric] }))

    return reply.code(200).send(
      AnalyticsTimeseriesResponseSchema.parse({
        metric: query.metric, granularity: query.granularity,
        coverage: { measurementStartsAt, requestedFrom: query.from, requestedTo: query.to },
        points,
      }),
    )
  })

  app.get('/v1/analytics/breakdown', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = AnalyticsBreakdownQuerySchema.parse(request.query)
    if (!(await assertAnalyticsScopeConsistency(request, reply, query))) return
    if (!(await requirePermission(request, reply, 'analytics.view', toPermissionScope(query.organizationId, query.departmentId, query.teamId)))) return

    const service = supabaseClients.forService()
    const scope = toAnalyticsScope(query)
    const timezone = await loadOrganizationTimezone(service, query.organizationId)
    if (timezone === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const measurementStartsAt = await loadMeasurementStart(service, scope)
    const window = rangeWindow(query.from, addDays(query.to, 1), timezone)

    let entries: { key: string; label: string; count: number }[]
    if (query.dimension === 'channel') {
      const posts = await loadPostsInScope(service, scope)
      const publications = await loadPublicationsForPosts(service, posts.map((post) => post.id), window.startUtc)
      const counts = new Map<string, number>()
      for (const publication of publications) {
        if (!isInWindow(publication.updatedAt, window)) continue
        counts.set(publication.socialConnectionId, (counts.get(publication.socialConnectionId) ?? 0) + 1)
      }
      const connectionIds = [...counts.keys()]
      const connections = connectionIds.length > 0 ? await service.from('social_connections').select('id, display_name, platform').in('id', connectionIds) : { data: [] as Record<string, unknown>[], error: null }
      if (connections.error) throw connections.error
      const labelById = new Map(connections.data.map((row) => [row.id as string, `${row.display_name as string} (${row.platform as string})`]))
      entries = connectionIds.map((id) => ({ key: id, label: labelById.get(id) ?? id, count: counts.get(id) ?? 0 }))
    } else {
      // department/team/preset/goal/format: aus submissions, nicht aus posts -- "was machen wir
      // eigentlich am meisten" (Plan) ist eine Frage an das, was Menschen einreichen, nicht nur an
      // das, was am Ende als vollstaendiger Post entstand.
      const submissions = await fetchAllRows<{
        id: string; department_id: string; team_id: string | null; preset_slug: string; communication_goal: string; requested_formats: string[]; created_at: string
      }>((from, to) => {
        let submissionQuery = service.from('submissions').select('id, department_id, team_id, preset_slug, communication_goal, requested_formats, created_at').eq('organization_id', query.organizationId)
        if (scope.teamId) submissionQuery = submissionQuery.eq('team_id', scope.teamId)
        else if (scope.departmentId) submissionQuery = submissionQuery.eq('department_id', scope.departmentId)
        return submissionQuery.range(from, to)
      })
      const inWindow = submissions.filter((submission) => isInWindow(submission.created_at, window))
      const counts = new Map<string, number>()
      if (query.dimension === 'preset') for (const submission of inWindow) counts.set(submission.preset_slug, (counts.get(submission.preset_slug) ?? 0) + 1)
      if (query.dimension === 'goal') for (const submission of inWindow) counts.set(submission.communication_goal, (counts.get(submission.communication_goal) ?? 0) + 1)
      if (query.dimension === 'format') for (const submission of inWindow) for (const format of submission.requested_formats) counts.set(format, (counts.get(format) ?? 0) + 1)
      if (query.dimension === 'department') for (const submission of inWindow) counts.set(submission.department_id, (counts.get(submission.department_id) ?? 0) + 1)
      if (query.dimension === 'team') for (const submission of inWindow) if (submission.team_id) counts.set(submission.team_id, (counts.get(submission.team_id) ?? 0) + 1)

      let labelById = new Map<string, string>()
      if (query.dimension === 'department') {
        const ids = [...counts.keys()]
        const rows = ids.length > 0 ? await service.from('departments').select('id, name').in('id', ids) : { data: [] as Record<string, unknown>[], error: null }
        if (rows.error) throw rows.error
        labelById = new Map(rows.data.map((row) => [row.id as string, row.name as string]))
      } else if (query.dimension === 'team') {
        const ids = [...counts.keys()]
        const rows = ids.length > 0 ? await service.from('teams').select('id, name').in('id', ids) : { data: [] as Record<string, unknown>[], error: null }
        if (rows.error) throw rows.error
        labelById = new Map(rows.data.map((row) => [row.id as string, row.name as string]))
      }
      entries = [...counts.entries()].map(([key, count]) => ({ key, label: labelById.get(key) ?? key, count }))
    }

    entries.sort((a, b) => b.count - a.count)
    return reply.code(200).send(
      AnalyticsBreakdownResponseSchema.parse({
        dimension: query.dimension,
        coverage: { measurementStartsAt, requestedFrom: query.from, requestedTo: query.to },
        entries,
      }),
    )
  })

  app.get('/v1/analytics/funnel', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = AnalyticsFunnelQuerySchema.parse(request.query)
    if (!(await assertAnalyticsScopeConsistency(request, reply, query))) return
    if (!(await requirePermission(request, reply, 'analytics.view', toPermissionScope(query.organizationId, query.departmentId, query.teamId)))) return

    const service = supabaseClients.forService()
    const scope = toAnalyticsScope(query)
    const timezone = await loadOrganizationTimezone(service, query.organizationId)
    if (timezone === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const measurementStartsAt = await loadMeasurementStart(service, scope)
    const window = rangeWindow(query.from, addDays(query.to, 1), timezone)

    const posts = await loadPostsInScope(service, scope)
    const transitions = await loadStatusTransitionsInScope(service, scope)
    const stages = computeFunnel(window, posts, transitions)

    return reply.code(200).send(
      AnalyticsFunnelResponseSchema.parse({
        coverage: { measurementStartsAt, requestedFrom: query.from, requestedTo: query.to },
        stages,
      }),
    )
  })

  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ err: error, correlationId: request.id }, 'request rejected')
    const isValidation = error instanceof Error && error.name === 'ZodError'
    return reply.code(isValidation ? 400 : 500).send({
      error: isValidation ? 'invalid_request' : 'internal_error',
      correlationId: request.id,
    })
  })

  return app
}
