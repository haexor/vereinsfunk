import {
  AcceptPlatformAdminInvitationRequestSchema,
  AddPlatformAdminRequestSchema,
  PlatformAdminInvitationSchema,
  PlatformAdminSchema,
  PlatformAdminStatusSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { mapPlatformAdminInvitationRow } from '../apiMappers.js'
import { generateInvitationToken, invitationCallbackUrls, sendInvitationThroughSupabaseAuth } from '../invitations.js'
import type { ApiRouteContext } from './context.js'

/** Erstellt den Auth-Callback zur Plattform-Admin-Einladung mit dem URL-kodierten Einladungstoken. */
function platformAdminInvitationUrls(webBaseUrl: string, rawToken: string): { accept: string } {
  return invitationCallbackUrls(webBaseUrl, `/plattform-admin-einladung?token=${encodeURIComponent(rawToken)}`)
}

export function registerPlatformAdminRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePlatformAdmin, supabaseClients, platformAdminProvider, environment } = context

  // Anlegen und erneutes Senden verschicken dieselbe Einladung. Ein Zustellfehler bricht die
  // Anfrage nicht ab -- die Einladung existiert bereits und laesst sich erneut senden.
  async function deliverPlatformAdminInvitation(
    request: FastifyRequest,
    service: SupabaseClient,
    email: string,
    rawToken: string,
  ): Promise<boolean> {
    const urls = platformAdminInvitationUrls(environment.WEB_BASE_URL ?? 'http://localhost:4200', rawToken)
    try {
      await sendInvitationThroughSupabaseAuth(service, email, urls)
      return true
    } catch (error) {
      request.log.error({ err: error, correlationId: request.id }, 'Supabase platform admin invitation email delivery failed')
      return false
    }
  }

  // --- Plattform-Administration (Paket 022) -------------------------------------------
  // Alle Routen ab hier sind requirePlatformAdmin-gated und verwenden ausschliesslich den
  // Service-Role-Client: die betroffenen Tabellen haben keinerlei Grant/Policy fuer
  // authenticated (siehe 2026080502_platform_administration.sql).

  app.get('/v1/me/platform-admin-status', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const status = await platformAdminProvider.statusFor(request.auth!.userId)
    return reply.code(200).send(PlatformAdminStatusSchema.parse(status))
  })

  // Einladungsflow statt eines synchronen Sofort-Hinzufuegens (Paket 046): add_platform_admin()
  // verlangte ein bereits existierendes auth.users-Konto, es gab keinen Weg, eine noch nie
  // registrierte Person als Plattform-Admin einzuladen. Siehe
  // 2026081901_platform_admin_invitations.sql.
  //
  // Bewusst ohne Audit-Trail (im Code-Review dieses PRs angemerkt): audit_events.organization_id
  // ist NOT NULL und traegt eine pro-Verein manipulationssichere Hash-Kette (Paket 020) -- laesst
  // sich nicht ohne Eingriff in diese Kette um organisationslose Zeilen erweitern. Die gesamte
  // Plattform-Administration (platform_admins, platform_settings) hat laut Plan 022 ohnehin noch
  // keinen eigenen Audit-Trail; dieselbe Zurueckstellung wie beim LLM-Provider-CRUD (PR #53).
  app.post('/v1/platform-admin-invitations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const input = AddPlatformAdminRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const { rawToken, tokenHash } = generateInvitationToken()
    const rpc = await service.rpc('create_platform_admin_invitation', {
      target_email: input.email,
      target_token_hash: tokenHash,
      added_by: request.auth!.userId,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('already_platform_admin')) return reply.code(409).send({ error: 'already_platform_admin', correlationId: request.id })
      if (rpc.error.message.includes('member_cannot_become_platform_admin')) return reply.code(409).send({ error: 'member_cannot_become_platform_admin', correlationId: request.id })
      if (rpc.error.message.includes('invitation_already_open')) return reply.code(409).send({ error: 'invitation_already_open', correlationId: request.id })
      throw rpc.error
    }
    const insertData = rpc.data as Record<string, unknown>

    const emailDelivered = await deliverPlatformAdminInvitation(request, service, input.email, rawToken)
    return reply.code(201).send({ ...PlatformAdminInvitationSchema.parse(mapPlatformAdminInvitationRow(insertData)), emailDelivered })
  })

  app.get('/v1/platform-admin-invitations', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const result = await service
      .from('platform_admin_invitations')
      .select('id, email, invited_by, expires_at, accepted_at, revoked_at, last_sent_at, send_count, created_at')
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
    if (result.error) throw result.error
    return reply.code(200).send(result.data.map((row) => PlatformAdminInvitationSchema.parse(mapPlatformAdminInvitationRow(row))))
  })

  app.post('/v1/platform-admin-invitations/:id/resend', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const existing = await service.from('platform_admin_invitations').select('email, accepted_at, revoked_at').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data || existing.data.accepted_at || existing.data.revoked_at) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const { rawToken, tokenHash } = generateInvitationToken()
    const rpc = await service.rpc('resend_platform_admin_invitation', { target_invitation_id: params.id, target_token_hash: tokenHash })
    if (rpc.error) {
      if (rpc.error.message.includes('resend_limit_reached')) return reply.code(429).send({ error: 'resend_limit_reached', correlationId: request.id })
      if (rpc.error.message.includes('resent at most once per hour')) return reply.code(429).send({ error: 'resend_rate_limited', correlationId: request.id })
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      throw rpc.error
    }
    const updateData = rpc.data as Record<string, unknown>
    const emailDelivered = await deliverPlatformAdminInvitation(request, service, existing.data.email as string, rawToken)
    return reply.code(200).send({ ...PlatformAdminInvitationSchema.parse(mapPlatformAdminInvitationRow(updateData)), emailDelivered })
  })

  app.post('/v1/platform-admin-invitations/:id/revoke', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const existing = await service.from('platform_admin_invitations').select('accepted_at, revoked_at').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data || existing.data.accepted_at || existing.data.revoked_at) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    // Bedingung im update() selbst statt nur in der vorigen Pruefung: sonst kann die eingeladene
    // Person zwischen dem select() oben und diesem update() annehmen, und der Widerruf setzt
    // revoked_at auf einer bereits angenommenen Zeile (im Code-Review gefunden).
    const update = await service
      .from('platform_admin_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', params.id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .select('id, email, invited_by, expires_at, accepted_at, revoked_at, last_sent_at, send_count, created_at')
      .maybeSingle()
    if (update.error) throw update.error
    if (!update.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    return reply.code(200).send(PlatformAdminInvitationSchema.parse(mapPlatformAdminInvitationRow(update.data)))
  })

  // Bewusst kein requirePlatformAdmin: die annehmende Person ist zu diesem Zeitpunkt noch keine
  // Plattform-Admin. accept_platform_admin_invitation() ermittelt den Aufrufer selbst ueber
  // auth.uid() im User-Client-Kontext, nie aus dem Request-Body.
  app.post('/v1/platform-admin-invitations/accept', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const input = AcceptPlatformAdminInvitationRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('accept_platform_admin_invitation', { raw_token: input.token })
    if (rpc.error) {
      if (rpc.error.message.includes('invitation_not_found_or_expired')) return reply.code(410).send({ error: 'invitation_not_found_or_expired', correlationId: request.id })
      if (rpc.error.message.includes('invitation_email_mismatch')) return reply.code(403).send({ error: 'invitation_email_mismatch', correlationId: request.id })
      if (rpc.error.message.includes('member_cannot_become_platform_admin')) return reply.code(409).send({ error: 'member_cannot_become_platform_admin', correlationId: request.id })
      throw rpc.error
    }
    // Nicht hartkodiert: accept_platform_admin_invitation() insertiert mit "on conflict (user_id)
    // do nothing" -- ist die annehmende Person zwischendurch bereits Default-Admin geworden,
    // meldete eine hartkodierte Antwort einen falschen Status (im Code-Review gefunden).
    const status = await platformAdminProvider.statusFor(request.auth!.userId)
    return reply.code(200).send(PlatformAdminStatusSchema.parse(status))
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
}
