import type { Permission } from '@vereinsfunk/authorization'
import type { ApiEnvironment } from '@vereinsfunk/config'
import type { MetaOAuthClient, SocialPublisher } from '@vereinsfunk/publishing'
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
  createPublisherForConnection(platform: 'instagram' | 'facebook', accessToken: string, externalAccountId: string): SocialPublisher
}
