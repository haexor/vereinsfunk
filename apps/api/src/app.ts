import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { parseApiEnvironment } from '@vereinsfunk/config'
import { FakeContentGenerator } from '@vereinsfunk/content-engine'
import {
  AddPlatformAdminRequestSchema,
  BrandLogoUploadResponseSchema,
  BrandLogoVariantSchema,
  CreateLlmProviderConfigurationRequestSchema,
  CreateOrganizationRequestSchema,
  CreateOrganizationResponseSchema,
  CreateSubmissionSchema,
  HealthSchema,
  LlmProviderConfigurationSchema,
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
  SubmissionAcceptedSchema,
  UpdateLlmProviderConfigurationRequestSchema,
  UpdatePlatformSettingRequestSchema,
  UsageMetricsQuerySchema,
  UsageMetricsResponseSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { createIdempotencyKey, evaluateMediaGate } from '@vereinsfunk/domain'
import { FakeOrchestrator, priorityToHatchet, type Orchestrator } from '@vereinsfunk/orchestration'
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAuthGuards, SupabasePlatformAdminProvider, SupabaseRoleProvider, type PlatformAdminProvider, type RoleProvider } from './auth.js'
import { hashLogoBuffer, LogoDimensionsError, processBrandLogoUpload, UnsupportedLogoFormatError } from './brandLogo.js'
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
  return {
    organizationId: row.organization_id,
    legalName: row.legal_name,
    legalForm: row.legal_form,
    registerCourt: row.register_court,
    registerNumber: row.register_number,
    street: row.street,
    houseNumber: row.house_number,
    postalCode: row.postal_code,
    city: row.city,
    countryCode: row.country_code,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    websiteUrl: row.website_url,
    foundedYear: row.founded_year,
    responsiblePersonProfileId: row.responsible_person_profile_id,
  }
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

// Zaehlt Zeilen pro organization_id in JS statt per SQL GROUP BY -- PostgREST hat keine
// generische Aggregations-API. Bei der heutigen Datengroesse unproblematisch; bei
// wachsender Mandantenzahl waere eine dedizierte SQL-Funktion faellig.
function countByOrganization(rows: readonly { organization_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.organization_id, (counts.get(row.organization_id) ?? 0) + 1)
  return counts
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
    const variantField = filePart.fields.variant
    const variantValue = variantField && 'value' in variantField ? variantField.value : undefined
    const variant = BrandLogoVariantSchema.parse(variantValue)

    let processed
    try {
      const buffer = await filePart.toBuffer()
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

    await service.from('audit_events').insert({
      organization_id: params.id,
      actor_user_id: request.auth!.userId,
      action: 'organization.brand_logo_uploaded',
      entity_type: 'organization_brand_profiles',
      entity_id: params.id,
      correlation_id: request.id,
      metadata: { variant, sanitized: processed.sanitized },
    })

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
    const [members, departments] = await Promise.all([
      service.from('organization_memberships').select('organization_id'),
      service.from('departments').select('organization_id'),
    ])
    if (members.error) throw members.error
    if (departments.error) throw departments.error
    const memberCounts = countByOrganization(members.data)
    const departmentCounts = countByOrganization(departments.data)
    return reply.code(200).send(
      orgs.data.map((row) =>
        PlatformAdminOrganizationSummarySchema.parse({
          organizationId: row.id,
          name: row.name,
          slug: row.slug,
          memberCount: memberCounts.get(row.id as string) ?? 0,
          departmentCount: departmentCounts.get(row.id as string) ?? 0,
          createdAt: row.created_at,
        }),
      ),
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
    if (secretInsert.error) throw secretInsert.error
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
