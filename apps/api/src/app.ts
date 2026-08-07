import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { parseApiEnvironment } from '@vereinsfunk/config'
import { FakeContentGenerator } from '@vereinsfunk/content-engine'
import {
  AcceptInvitationRequestSchema,
  AcceptInvitationResponseSchema,
  AddPlatformAdminRequestSchema,
  ApprovalRequestSchema,
  ApprovalStageSchema,
  AvailableChannelsResponseSchema,
  BrandLogoUploadResponseSchema,
  BrandLogoVariantSchema,
  ChannelOwnerScopeSchema,
  ChannelPolicySchema,
  ChannelQuotaSchema,
  ChannelScopeAssignmentSchema,
  CreateChannelQuotaRequestSchema,
  CreateChannelScopeRequestSchema,
  CreateDepartmentRequestSchema,
  CreateInvitationRequestSchema,
  CreateLlmProviderConfigurationRequestSchema,
  CreateMembershipRequestSchema,
  CreateOrganizationRequestSchema,
  CreateOrganizationResponseSchema,
  CreatePolicyReviewerRequestSchema,
  CreateSubmissionSchema,
  CreateTeamRequestSchema,
  DecideApprovalStageRequestSchema,
  DecideApprovalStageResponseSchema,
  DepartmentSchema,
  HealthSchema,
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
  PublicationSchema,
  RequestApprovalResponseSchema,
  ScopeLevelSchema,
  SchedulePublicationRequestSchema,
  SelectOAuthAccountRequestSchema,
  SetMemberReviewTrustRequestSchema,
  SocialConnectionSchema,
  SocialPlatformSchema,
  SubmissionAcceptedSchema,
  TeamSchema,
  UpdateChannelQuotaRequestSchema,
  UpdateDepartmentRequestSchema,
  UpdateLlmProviderConfigurationRequestSchema,
  UpdateMembershipExpiryRequestSchema,
  UpdateMembershipRequestSchema,
  UpdatePlatformSettingRequestSchema,
  UpdatePolicyRulesRequestSchema,
  UpdatePolicySettingRequestSchema,
  UpdateSocialConnectionRequestSchema,
  UpdateTeamRequestSchema,
  UsageMetricsQuerySchema,
  UsageMetricsResponseSchema,
  UuidSchema,
  type OutputFormat,
  type PolicyFlagState,
  type PolicyRuleValues,
  type ReviewerRef,
  type ScopeLevel,
} from '@vereinsfunk/contracts'
import { canAssignRole, canRemoveRole, hasPermission, type Permission, type Role } from '@vereinsfunk/authorization'
import {
  createIdempotencyKey,
  evaluateMediaGate,
  evaluateSubmitPermission,
  mergeEffectiveConfig,
  resolveAvailableChannels,
  resolveEffectiveConfig,
  resolveReviewers,
  resolveReviewRoute,
  type ChannelCandidate,
  type ConfigOverride,
  type MembershipRecord,
  type ReviewerRef as DomainReviewerRef,
  type ScopeLevelName,
  type StageDefinition,
  type TrustRecord,
} from '@vereinsfunk/domain'
import { FakeOrchestrator, priorityToHatchet, type Orchestrator } from '@vereinsfunk/orchestration'
import { RealMetaOAuthClient, type MetaOAuthClient } from '@vereinsfunk/publishing'
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAuthGuards, SupabasePlatformAdminProvider, SupabaseRoleProvider, type PermissionScope, type PlatformAdminProvider, type RoleProvider } from './auth.js'
import { hashLogoBuffer, LogoDimensionsError, processBrandLogoUpload, UnsupportedLogoFormatError } from './brandLogo.js'
import { createEmailSender, type EmailSender } from './email.js'
import { buildInvitationEmail, generateInvitationToken } from './invitations.js'
import { mapLlmProviderConfigurationRow } from './llmProviders.js'
import { byteaToBuffer, ciphertextToBytea, createSecretBoxFromEnvironment } from './secretBox.js'
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
  orchestrator?: Orchestrator
  uploads?: MediaUploadService
  roleProvider?: RoleProvider
  supabaseClients?: SupabaseClientFactory
  platformAdminProvider?: PlatformAdminProvider
  emailSender?: EmailSender
  metaOAuthClient?: MetaOAuthClient
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
    tone: row.tone,
    displayFontKey: row.display_font_key,
    bodyFontKey: row.body_font_key,
    logoPath: row.logo_path,
    logoDarkPath: row.logo_dark_path,
  }
}

function mapDepartmentRow(row: Record<string, unknown>) {
  return { id: row.id, organizationId: row.organization_id, name: row.name, slug: row.slug, archivedAt: row.archived_at, createdAt: row.created_at }
}

function mapTeamRow(row: Record<string, unknown>) {
  return { id: row.id, organizationId: row.organization_id, departmentId: row.department_id, name: row.name, archivedAt: row.archived_at, createdAt: row.created_at }
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
  }
}

const SOCIAL_CONNECTION_COLUMNS =
  'id, platform, external_account_id, display_name, status, token_expires_at, last_verified_at, owner_scope, owner_department_id, responsible_profile_id, purpose, confidential, archived_at, created_at'

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
  const orchestrator = options.orchestrator ?? new FakeOrchestrator()
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
        created_by: request.auth!.userId,
      })
      .select('id, status')
      .single()
    if (insert.error) throw insert.error
    const submissionId = insert.data.id as string
    const correlationId = request.id
    const generated = await new FakeContentGenerator().generate(input)
    const accepted = SubmissionAcceptedSchema.parse({
      submissionId,
      correlationId,
      status: generated.missingFacts.length > 0 ? 'facts_required' : 'queued',
      idempotencyKey: createIdempotencyKey('submission', submissionId, input.sourceRevision),
    })
    if (accepted.status === 'queued') await orchestrator.trigger('process-submission', {
      submissionId, entityId: submissionId, organizationId: input.organizationId, departmentId: input.departmentId,
      correlationId, sourceRevision: input.sourceRevision, idempotencyKey: accepted.idempotencyKey,
    }, { priority: priorityToHatchet(input.priority) })

    request.log.info(
      {
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        submissionId,
        correlationId,
        missingFactsCount: generated.missingFacts.length,
      },
      'submission accepted by local fake adapter',
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
    const input = z.object({ scanStatus: z.enum(['pending', 'clean', 'failed']), facesConfirmedComplete: z.boolean(), hasOriginalSelected: z.boolean(), derivativeCurrent: z.boolean(), minorReviewConfirmed: z.boolean(), faces: z.array(z.object({ subjectKind: z.enum(['adult', 'minor', 'unknown']), decision: z.enum(['pending', 'consented', 'obscure', 'exclude']), consentValid: z.boolean().optional() })) }).parse(request.body)
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
    if (!(await requirePermission(request, reply, 'organization.manage', { organizationId: params.id }))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const update = await client
      .from('organization_brand_profiles')
      .update({
        primary_color: input.primaryColor,
        accent_color: input.accentColor,
        tone: input.tone,
        display_font_key: input.displayFontKey,
        body_font_key: input.bodyFontKey,
      })
      .eq('organization_id', params.id)
      .select()
      .single()
    if (update.error) throw update.error
    return reply.code(200).send(OrganizationBrandSchema.parse(mapBrandRow(update.data)))
  })

  app.post('/v1/organizations/:id/brand/logo', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', { organizationId: params.id }))) return

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

    const audit = await service.from('audit_events').insert({
      organization_id: params.id,
      actor_user_id: request.auth!.userId,
      action: 'organization.brand_logo_uploaded',
      entity_type: 'organization_brand_profiles',
      entity_id: params.id,
      correlation_id: request.id,
      metadata: { variant, sanitized: processed.sanitized },
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')

    return reply.code(201).send(
      BrandLogoUploadResponseSchema.parse({ variant, path: objectPath, signedUrl: signed.data.signedUrl, sanitized: processed.sanitized }),
    )
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
      .select('id, organization_id, department_id, name, archived_at, created_at')
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
    const update = await client.from('teams').update(payload).eq('id', params.id).select('id, organization_id, department_id, name, archived_at, created_at').single()
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
    'id, submit_requires_permission, review_required, review_mode, review_stage_label, review_minimum_approvals, review_deadline_hours, minor_approval_required, self_approval_allowed, allow_same_reviewer_across_stages, allow_review_exemptions, media_requires_consent_check, allowed_presets, allowed_formats, allowed_channel_ids, forbidden_topics, required_hashtags, tone'
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
  app.get('/v1/approval-stages/mine', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    // 'stalled' gehoert dazu: mark_stalled_approval_stages() markiert eine ueberfaellige Stufe, nimmt
    // ihr aber kein Recht (siehe authz.can_decide_stage). Ein Filter nur auf 'open' haette sie aus
    // genau der Liste verschwinden lassen, in der die zustaendige Person sie noch entscheiden soll.
    const rows = await client
      .from('approval_stages')
      .select('id, position, scope, label, mode, minimum_approvals, is_minor_stage, status, reviewer_snapshot, deadline_at')
      .eq('organization_id', query.organizationId)
      .in('status', ['open', 'stalled'])
    if (rows.error) throw rows.error
    const userId = request.auth!.userId
    const now = Date.now()
    const mine = rows.data.filter((row) => (row.reviewer_snapshot as { userId: string }[]).some((entry) => entry.userId === userId))
    return reply.code(200).send(
      mine.map((row) =>
        ApprovalStageSchema.parse({
          id: row.id, position: row.position, scope: row.scope, label: row.label, mode: row.mode,
          minimumApprovals: row.minimum_approvals, isMinorStage: row.is_minor_stage, status: row.status,
          reviewerUserIds: (row.reviewer_snapshot as { userId: string }[]).map((entry) => entry.userId),
          deadlineAt: row.deadline_at, isOverdue: row.deadline_at !== null && new Date(row.deadline_at as string).getTime() < now,
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
    const payload: Record<string, unknown> = {}
    if (input.displayName !== undefined) payload.display_name = input.displayName
    if (input.purpose !== undefined) payload.purpose = input.purpose
    if (input.responsibleProfileId !== undefined) payload.responsible_profile_id = input.responsibleProfileId
    if (input.confidential !== undefined) payload.confidential = input.confidential
    // Kein Grant fuer authenticated auf social_connections ausser select (Plan 012, "Sicherheitsbefund
    // zuerst") -- die Berechtigungspruefung sitzt hier in TS, der Schreibzugriff im Service-Client,
    // wie schon bei den LLM-Provider-Konfigurationen.
    const service = supabaseClients.forService()
    const update = await service.from('social_connections').update(payload).eq('id', params.id).select(SOCIAL_CONNECTION_COLUMNS).single()
    if (update.error) throw update.error
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
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.owner_scope === 'department' ? (existing.data.owner_department_id as string) : null)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    const service = supabaseClients.forService()
    // Die Zeile bleibt (publications verweist per FK darauf), nur Status/archived_at aendern sich --
    // Geheimnis wird geloescht, damit kein Ciphertext eines getrennten Kanals liegen bleibt.
    const update = await service.from('social_connections').update({ status: 'disconnected', archived_at: new Date().toISOString() }).eq('id', params.id)
    if (update.error) throw update.error
    const secretDelete = await service.from('social_connection_secrets').delete().eq('social_connection_id', params.id)
    if (secretDelete.error) throw secretDelete.error
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
    const query = z
      .object({ organizationId: UuidSchema, ownerScope: ChannelOwnerScopeSchema, ownerDepartmentId: UuidSchema.nullish() })
      .parse(request.query)
    const ownerDepartmentId = query.ownerDepartmentId ?? null
    if ((query.ownerScope === 'organization') !== (ownerDepartmentId === null)) {
      return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
    }
    const scope = toPermissionScope(query.organizationId, ownerDepartmentId)
    if (!(await requirePermission(request, reply, 'social_account.manage', scope))) return
    if (query.ownerScope === 'department') {
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
      owner_scope: query.ownerScope,
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

    await service.from('oauth_pending_connections').delete().eq('id', params.id)

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
