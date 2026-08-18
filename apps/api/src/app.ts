import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { parseApiEnvironment } from '@vereinsfunk/config'
import type { StructuredContentGenerator } from '@vereinsfunk/content-engine'
import { HealthSchema } from '@vereinsfunk/contracts'
import {
  FakeLinkedInOAuthClient,
  FakeMetaOAuthClient,
  FakePublisher,
  FakeTwitterOAuthClient,
  MetaPublisher,
  RealMetaOAuthClient,
  type LinkedInOAuthClient,
  type MetaOAuthClient,
  type Platform,
  type SocialPublisher,
  type TwitterOAuthClient,
} from '@vereinsfunk/publishing'
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { byteaToBuffer, createSecretBoxFromEnvironment } from './secretBox.js'
import { createAuthGuards, SupabasePlatformAdminProvider, SupabaseRoleProvider, type PlatformAdminProvider, type RoleProvider } from './auth.js'
import { createEmailSender, type EmailSender } from './email.js'
import { SupabaseUploadService } from './mediaUpload.js'
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
import { registerPlatformPersonaRoutes } from './routes/platformPersonas.routes.js'
import { registerPolicyRoutes } from './routes/policies.js'
import { registerPublishingRoutes } from './routes/publishing.js'
import { registerRetentionRoutes } from './routes/retention.js'
import { registerStructureRoutes } from './routes/structure.js'
import { registerSubscriptionRoutes } from './routes/subscriptions.js'
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
  twitterOAuthClient?: TwitterOAuthClient
  linkedinOAuthClient?: LinkedInOAuthClient
  // Paket 025: Ueberschreibung fuer Tests. Ausserhalb von Tests entscheidet PUBLISHING_PROVIDER,
  // welcher echte Adapter je Social-Connection gebaut wird (siehe createPublisherForConnection) --
  // ein MetaPublisher braucht das entschluesselte Connection-Token, kann also nicht einmalig beim
  // Start konstruiert werden wie die anderen Injectables hier.
  publisher?: SocialPublisher
  // Plan 040: Ueberschreibung fuer Tests, analog zu TextGenerationExecutor.generator im Worker --
  // laesst "Persona/Stilprofil testen" ohne echten ausgehenden Fetch testen.
  textGenerator?: StructuredContentGenerator
}

// Form der embedded PostgREST-Abfrage in loadMetaConfiguration -- publishing_provider_secrets ist
// null, solange fuer den Provider noch kein Secret hinterlegt wurde.
const MetaProviderConfigurationRowSchema = z.object({
  client_id: z.string(),
  graph_version: z.string().nullable(),
  publishing_provider_secrets: z.object({ client_secret_ciphertext: z.string(), key_version: z.string() }).nullable(),
})

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
  const roleProvider = options.roleProvider ?? new SupabaseRoleProvider(environment)
  const supabaseClients: SupabaseClientFactory = options.supabaseClients ?? {
    forUser: (accessToken) => createUserClient(environment, accessToken),
    forService: () => createServiceClient(environment),
  }
  const uploads = options.uploads ?? new SupabaseUploadService(() => supabaseClients.forService())
  const platformAdminProvider = options.platformAdminProvider ?? new SupabasePlatformAdminProvider(() => supabaseClients.forService())
  const useFakePublishing = environment.PUBLISHING_MODE === 'fake'
  async function loadMetaConfiguration(): Promise<{ clientId: string; clientSecret: string; graphVersion: string }> {
    if (environment.PUBLISHING_MODE !== 'live') return { clientId: '', clientSecret: '', graphVersion: environment.META_GRAPH_VERSION }
    const service = supabaseClients.forService()
    // Konfiguration und Secret in EINER Abfrage (PostgREST-Embedding ueber die FK auf provider) --
    // zwei getrennte maybeSingle()-Aufrufe liefen in getrennten Snapshots und konnten bei einer
    // Rotation zwischen beiden eine alte Client-ID mit einem neuen Secret kombinieren, obwohl das
    // Update selbst atomar war (upsert_publishing_provider_configuration).
    const result = await service
      .from('publishing_provider_configurations')
      .select('client_id, graph_version, publishing_provider_secrets(client_secret_ciphertext, key_version)')
      .eq('provider', 'meta')
      .maybeSingle()
    if (result.error) throw result.error
    if (!result.data) throw new Error('meta provider is not configured')
    const row = MetaProviderConfigurationRowSchema.parse(result.data)
    if (!row.publishing_provider_secrets) throw new Error('meta provider is not configured')
    return {
      clientId: row.client_id,
      clientSecret: createSecretBoxFromEnvironment(environment).open(
        byteaToBuffer(row.publishing_provider_secrets.client_secret_ciphertext),
        row.publishing_provider_secrets.key_version,
        'publishing-provider:meta',
      ),
      graphVersion: row.graph_version ?? environment.META_GRAPH_VERSION,
    }
  }
  async function getMetaOAuthClient(): Promise<MetaOAuthClient> {
    if (options.metaOAuthClient) return options.metaOAuthClient
    if (environment.PUBLISHING_MODE !== 'live') return new FakeMetaOAuthClient()
    const configuration = await loadMetaConfiguration()
    return new RealMetaOAuthClient({ appId: configuration.clientId, appSecret: configuration.clientSecret, graphVersion: configuration.graphVersion })
  }
  // Twitter/LinkedIn koennen ausschliesslich im expliziten Fake-Modus konstruiert werden. Die
  // Konfiguration lehnt ihre Live-Aktivierung ab, solange die echten Adapter noch fehlen.
  const twitterOAuthClient: TwitterOAuthClient = options.twitterOAuthClient ?? new FakeTwitterOAuthClient()
  const linkedinOAuthClient: LinkedInOAuthClient = options.linkedinOAuthClient ?? new FakeLinkedInOAuthClient()
  const emailSender =
    options.emailSender ??
    // Ohne echten Versand ist der Log die einzige Stelle, an der der Einladungslink (inkl.
    // Rohtoken) ueberhaupt sichtbar wird -- ohne message.text waere die Einladung lokal nicht
    // einloesbar, obwohl sie serverseitig korrekt erzeugt wurde.
    createEmailSender(environment, (message) => app.log.info({ to: message.to, subject: message.subject, text: message.text }, 'invitation email (fake provider)'))
  const { requireAuth, requirePermission, requirePermissionAnyOf, requirePlatformAdmin } = createAuthGuards(environment, roleProvider, platformAdminProvider)

  // Paket 025: ein MetaPublisher braucht das entschluesselte Token GENAU dieser Social-Connection
  // (anders als metaOAuthClient oben, das appId/appSecret-Ebene bleibt) -- deshalb keine einmalige
  // Instanz, sondern eine Fabrik je Aufruf. options.publisher ueberschreibt vollstaendig (Tests).
  async function createPublisherForConnection(platform: Platform, accessToken: string, externalAccountId: string): Promise<SocialPublisher> {
    if (options.publisher) return options.publisher
    switch (platform) {
      case 'instagram':
      case 'facebook':
        if (environment.PUBLISHING_MODE !== 'live') return new FakePublisher()
        return new MetaPublisher({
          graphVersion: (await loadMetaConfiguration()).graphVersion,
          accessToken,
          ...(platform === 'instagram' ? { instagramAccountId: externalAccountId } : { facebookPageId: externalAccountId }),
        })
      case 'twitter':
      case 'linkedin':
        if (!useFakePublishing) throw new Error(`${platform} publisher is not available in live mode`)
        return new FakePublisher()
    }
  }
  const context: ApiRouteContext = {
    environment,
    uploads,
    supabaseClients,
    roleProvider,
    platformAdminProvider,
    emailSender,
    getMetaOAuthClient,
    twitterOAuthClient,
    linkedinOAuthClient,
    requireAuth,
    requirePermission,
    requirePermissionAnyOf,
    requirePlatformAdmin,
    createPublisherForConnection,
    ...(options.textGenerator ? { textGenerator: options.textGenerator } : {}),
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
  registerSubscriptionRoutes(app, context)

  registerPlatformAdminRoutes(app, context)

  registerLlmProviderRoutes(app, context)
  registerPlatformPersonaRoutes(app, context)

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
