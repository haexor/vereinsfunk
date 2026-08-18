import type { Permission } from '@vereinsfunk/authorization'
import type { ApiEnvironment } from '@vereinsfunk/config'
import type { StructuredContentGenerator } from '@vereinsfunk/content-engine'
import type { LinkedInOAuthClient, MetaOAuthClient, Platform, SocialPublisher, TwitterOAuthClient } from '@vereinsfunk/publishing'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { EmailSender } from '../email.js'
import type { PermissionScope, PlatformAdminProvider, RoleProvider } from '../auth.js'

// All privileged dependencies are created exactly once by buildApp and supplied to route
// modules explicitly. Keeping this type close to the route boundary makes accidental module
// level service-role clients impossible.
export interface SupabaseClientFactory {
  forUser(accessToken: string): SupabaseClient
  forService(): SupabaseClient
}

export interface MediaUploadService {
  create(input: { organizationId: string; departmentId: string; assetId: string; filename: string; mimeType: string; byteSize: number }): Promise<{ uploadUrl: string; objectPath: string; expiresAt: string }>
  complete(input: { assetId: string; sha256: string }): Promise<{ accepted: true }>
}

export interface ApiRouteGuards {
  requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<boolean>
  requirePermission(request: FastifyRequest, reply: FastifyReply, permission: Permission, scope: PermissionScope): Promise<boolean>
  requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean>
}

export interface ApiRouteContext extends ApiRouteGuards {
  environment: ApiEnvironment
  uploads: MediaUploadService
  supabaseClients: SupabaseClientFactory
  roleProvider: RoleProvider
  platformAdminProvider: PlatformAdminProvider
  emailSender: EmailSender
  metaOAuthClient: MetaOAuthClient
  // Paket 045: Twitter/LinkedIn haben strukturell andere OAuth-Flows als der gemeinsame
  // Meta-Adapter (PKCE bei Twitter, Organisations-Listing bei LinkedIn) -- eigene Client-Felder statt
  // eines vereinheitlichten Interface, das die Unterschiede nur verstecken wuerde.
  twitterOAuthClient: TwitterOAuthClient
  linkedinOAuthClient: LinkedInOAuthClient
  createPublisherForConnection(platform: Platform, accessToken: string, externalAccountId: string): SocialPublisher
  // Plan 040: "Persona/Stilprofil testen" ueberschreibt die Protokollauswahl vollstaendig, genau
  // wie TextGenerationExecutor.generator im Worker (apps/worker/src/textGeneration.ts) -- ein Test
  // kann so eine echte Provider-Zeile faken (fuer model/baseUrl/apiKey), ohne einen echten
  // ausgehenden Fetch ueber createGuardedFetch() ausloesen zu muessen. Ausserhalb von Tests immer
  // undefined; previewStyleProfile (routes/shared.ts) waehlt dann anhand des Provider-Protokolls.
  textGenerator?: StructuredContentGenerator
}
