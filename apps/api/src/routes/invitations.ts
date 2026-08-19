import { AcceptInvitationRequestSchema, AcceptInvitationResponseSchema, CreateInvitationRequestSchema, InvitationSchema, UuidSchema } from '@vereinsfunk/contracts'
import { canAssignRole } from '@vereinsfunk/authorization'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mapInvitationRow } from '../apiMappers.js'
import { generateInvitationToken, invitationCallbackUrls, sendInvitationThroughSupabaseAuth } from '../invitations.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, resolveInvitationScope, toPermissionScope } from './shared.js'

function invitationUrls(webBaseUrl: string, rawToken: string): { accept: string; setPassword: string } {
  return invitationCallbackUrls(webBaseUrl, `/einladung?token=${encodeURIComponent(rawToken)}`)
}

export function registerInvitationRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, roleProvider, environment } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

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

    const urls = invitationUrls(environment.WEB_BASE_URL ?? 'http://localhost:4200', rawToken)
    let emailDelivered = true
    try {
      await sendInvitationThroughSupabaseAuth(supabaseClients.forService(), input.email, urls)
    } catch (error) {
      // Die Einladung besteht bereits in der Datenbank -- ein Fehler bei Supabase Auth/Brevo
      // soll den Request nicht mit 500 scheitern lassen, sondern nur den Versandstatus sichtbar
      // machen. Ein erneuter Versand rotiert den fachlichen Token und startet einen neuen
      // Auth-Link.
      emailDelivered = false
      request.log.error({ err: error, correlationId: request.id }, 'Supabase invitation email delivery failed')
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'invitation.created',
      entityType: 'invitations',
      entityId: insertData.id as string,
      metadata: { email: input.email, role: input.role, departmentId: scope.departmentId ?? null, teamId: scope.teamId ?? null, emailDelivered },
    })

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
    const urls = invitationUrls(environment.WEB_BASE_URL ?? 'http://localhost:4200', rawToken)
    let emailDelivered = true
    try {
      await sendInvitationThroughSupabaseAuth(supabaseClients.forService(), existing.data.email as string, urls)
    } catch (error) {
      emailDelivered = false
      request.log.error({ err: error, correlationId: request.id }, 'Supabase invitation email delivery failed')
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'invitation.resent',
      entityType: 'invitations',
      entityId: params.id,
      metadata: { email: existing.data.email, emailDelivered },
    })
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
    await recordAuditEvent(request, {
      organizationId: scope.organizationId,
      action: 'invitation.revoked',
      entityType: 'invitations',
      entityId: params.id,
      metadata: { email: existing.data.email },
    })
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
}
