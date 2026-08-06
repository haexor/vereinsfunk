import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { parseApiEnvironment } from '@vereinsfunk/config'
import { FakeContentGenerator } from '@vereinsfunk/content-engine'
import {
  AcceptInvitationRequestSchema,
  AcceptInvitationResponseSchema,
  AddPlatformAdminRequestSchema,
  BrandLogoUploadResponseSchema,
  BrandLogoVariantSchema,
  CreateDepartmentRequestSchema,
  CreateInvitationRequestSchema,
  CreateLlmProviderConfigurationRequestSchema,
  CreateMembershipRequestSchema,
  CreateOrganizationRequestSchema,
  CreateOrganizationResponseSchema,
  CreateSubmissionSchema,
  CreateTeamRequestSchema,
  DepartmentSchema,
  HealthSchema,
  InvitationSchema,
  LlmProviderConfigurationSchema,
  MemberRoleEntrySchema,
  rolesForScopeLevel,
  MemberSchema,
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
  ScopeLevelSchema,
  SubmissionAcceptedSchema,
  TeamSchema,
  UpdateDepartmentRequestSchema,
  UpdateLlmProviderConfigurationRequestSchema,
  UpdateMembershipRequestSchema,
  UpdatePlatformSettingRequestSchema,
  UpdateTeamRequestSchema,
  UsageMetricsQuerySchema,
  UsageMetricsResponseSchema,
  UuidSchema,
  type ScopeLevel,
} from '@vereinsfunk/contracts'
import { canAssignRole, canRemoveRole, type Role } from '@vereinsfunk/authorization'
import { createIdempotencyKey, evaluateMediaGate } from '@vereinsfunk/domain'
import { FakeOrchestrator, priorityToHatchet, type Orchestrator } from '@vereinsfunk/orchestration'
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAuthGuards, SupabasePlatformAdminProvider, SupabaseRoleProvider, type PermissionScope, type PlatformAdminProvider, type RoleProvider } from './auth.js'
import { hashLogoBuffer, LogoDimensionsError, processBrandLogoUpload, UnsupportedLogoFormatError } from './brandLogo.js'
import { createEmailSender, type EmailSender } from './email.js'
import { buildInvitationEmail, generateInvitationToken } from './invitations.js'
import { ciphertextToBytea, createSecretBoxFromEnvironment, mapLlmProviderConfigurationRow } from './llmProviders.js'
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
  const emailSender =
    options.emailSender ??
    // Ohne echten Versand ist der Log die einzige Stelle, an der der Einladungslink (inkl.
    // Rohtoken) ueberhaupt sichtbar wird -- ohne message.text waere die Einladung lokal nicht
    // einloesbar, obwohl sie serverseitig korrekt erzeugt wurde.
    createEmailSender(environment, (message) => app.log.info({ to: message.to, subject: message.subject, text: message.text }, 'invitation email (fake provider)'))
  const { requireAuth, requirePermission, requirePlatformAdmin } = createAuthGuards(environment, roleProvider, platformAdminProvider)

  await app.register(cors, {
    origin: environment.NODE_ENV === 'production' ? false : ['http://localhost:4200'],
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
    const submissionId = randomUUID()
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
      fetchAllRows<{ id: string; user_id: string; role: string; expires_at: string | null; team_id: string }>((from, to) =>
        client.from('team_memberships').select('id, user_id, role, expires_at, team_id').eq('organization_id', params.id).range(from, to),
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

    const membersById = new Map<string, { userId: string; displayName: string; roles: unknown[] }>()
    const addRole = (userId: string, entry: unknown) => {
      const existing = membersById.get(userId)
      if (existing) existing.roles.push(entry)
      else membersById.set(userId, { userId, displayName: displayNameById.get(userId) ?? 'Unbekannt', roles: [entry] })
    }
    for (const row of orgRows) addRole(row.user_id, { membershipId: row.id, scope: 'organization', scopeId: params.id, role: row.role, expiresAt: row.expires_at })
    for (const row of deptRows) addRole(row.user_id, { membershipId: row.id, scope: 'department', scopeId: row.department_id, role: row.role, expiresAt: row.expires_at })
    for (const row of teamRows) addRole(row.user_id, { membershipId: row.id, scope: 'team', scopeId: row.team_id, role: row.role, expiresAt: row.expires_at })

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
    return reply.code(201).send(
      MemberRoleEntrySchema.parse({ membershipId: insert.data.id, scope: input.scope, scopeId: input.scopeId, role: insert.data.role, expiresAt: insert.data.expires_at }),
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
    return reply.code(200).send(
      MemberRoleEntrySchema.parse({ membershipId: result.membershipId, scope: query.scope, scopeId, role: result.role, expiresAt: result.expiresAt }),
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
