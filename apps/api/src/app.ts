import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { parseApiEnvironment } from '@vereinsfunk/config'
import { HealthSchema } from '@vereinsfunk/contracts'
import { FakePublisher, MetaPublisher, RealMetaOAuthClient, type MetaOAuthClient, type SocialPublisher } from '@vereinsfunk/publishing'
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { randomUUID } from 'node:crypto'
import { createAuthGuards, SupabasePlatformAdminProvider, SupabaseRoleProvider, type PlatformAdminProvider, type RoleProvider } from './auth.js'
import { createEmailSender, type EmailSender } from './email.js'
import { createServiceClient, createUserClient } from './supabase.js'
import { registerAnalyticsRoutes } from './routes/analytics.js'
import { registerApprovalRoutes } from './routes/approvals.js'
import { registerChannelQuotaRoutes } from './routes/channelQuotas.js'
import { registerBrandRoutes } from './routes/brand.js'
import { registerChannelOAuthRoutes } from './routes/channelOAuth.js'
import { registerChannelRoutes } from './routes/channels.js'
import { registerClubScheduleRoutes } from './routes/clubSchedule.js'
import { registerComplianceRoutes } from './routes/compliance.js'
import { registerConsentRoutes } from './routes/consent.js'
import { registerConsentPublicRoutes } from './routes/consentPublic.js'
import { registerContentRoutes } from './routes/content.js'
import { registerDataSubjectRoutes } from './routes/dataSubjects.js'
import { registerDirectoryRoutes } from './routes/directory.js'
import { registerIntegrationRoutes } from './routes/integrations.js'
import { registerLlmProviderRoutes } from './routes/llmProviders.routes.js'
import { registerInvitationRoutes } from './routes/invitations.js'
import { registerMemberRoutes } from './routes/members.js'
import { registerOrganizationRoutes } from './routes/organization.js'
import { registerPlatformAdminRoutes } from './routes/platformAdmin.js'
import { registerPolicyRoutes } from './routes/policies.js'
import { registerPublishingRoutes } from './routes/publishing.js'
import { registerRetentionRoutes } from './routes/retention.js'
import { registerStructureRoutes } from './routes/structure.js'
import type { ApiRouteContext, MediaUploadService, SupabaseClientFactory } from './routes/context.js'

export type { MediaUploadService, SupabaseClientFactory } from './routes/context.js'

// Injectable the same way orchestrator/uploads/roleProvider already are: routes that create
// an organization or its profile need a real Postgres round-trip (RLS, the owner-limit
// enforced inside create_organization, the responsible-person trigger), which a test should
// fake rather than require a live Supabase instance for `pnpm test`.
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

class LocalUploadService implements MediaUploadService {
  async create(input: { organizationId: string; departmentId: string; assetId: string; filename: string; mimeType: string; byteSize: number }) { return { uploadUrl: `https://storage.invalid/upload/${input.assetId}`, objectPath: `organizations/${input.organizationId}/departments/${input.departmentId}/assets/${input.assetId}/${input.filename}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() } }
  async complete(): Promise<{ accepted: true }> { return { accepted: true } }
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
  const context: ApiRouteContext = {
    environment,
    uploads,
    supabaseClients,
    roleProvider,
    platformAdminProvider,
    emailSender,
    metaOAuthClient,
    requireAuth,
    requirePermission,
    requirePlatformAdmin,
    createPublisherForConnection,
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

  registerContentRoutes(app, context)

  registerOrganizationRoutes(app, context)
  registerBrandRoutes(app, context)

  // --- Abteilungen, Teams, Mitgliedschaften und Einladungen (Paket 010) ----------------

  registerStructureRoutes(app, context)
  registerMemberRoutes(app, context)
  registerInvitationRoutes(app, context)
  registerPolicyRoutes(app, context)
  registerApprovalRoutes(app, context)
  registerPublishingRoutes(app, context)
  registerChannelQuotaRoutes(app, context)

  registerPlatformAdminRoutes(app, context)

  registerLlmProviderRoutes(app, context)

  registerChannelRoutes(app, context)
  registerChannelOAuthRoutes(app, context)

  registerIntegrationRoutes(app, context)

  registerClubScheduleRoutes(app, context)

  registerDirectoryRoutes(app, context)

  registerConsentRoutes(app, context)
  registerConsentPublicRoutes(app, context)

  registerRetentionRoutes(app, context)
  registerDataSubjectRoutes(app, context)
  registerComplianceRoutes(app, context)

  registerAnalyticsRoutes(app, context)

  // Fastify wirft eigene Fehler mit gesetztem statusCode, bevor ueberhaupt ein Handler laeuft:
  // fehlerhaftes JSON (400), leerer Rumpf (400), unpassender Content-Type (415), zu grosser Rumpf
  // (413). Die wurden hier pauschal zu "500 internal_error" -- der Aufrufer konnte "meine Anfrage
  // war kaputt" nicht von "der Server ist kaputt" unterscheiden, und echte Serverfehler gingen in
  // der Ueberwachung zwischen falsch etikettierten Client-Fehlern unter. Uebernommen wird nur 4xx:
  // ein 5xx aus einer Bibliothek bleibt bewusst generisch, weil error.message Interna tragen kann.
  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ err: error, correlationId: request.id }, 'request rejected')
    const isValidation = error instanceof Error && error.name === 'ZodError'
    const thrownStatus = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : null
    const clientStatus = thrownStatus !== null && thrownStatus >= 400 && thrownStatus < 500 ? thrownStatus : null
    const statusCode = isValidation ? 400 : (clientStatus ?? 500)
    return reply.code(statusCode).send({
      error: statusCode === 500 ? 'internal_error' : 'invalid_request',
      correlationId: request.id,
    })
  })

  return app
}
