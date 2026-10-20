import {
  CreateConsentRequestRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  buildConsentRequestEmail,
  CONSENT_REQUEST_SELECT,
  consentRequestExpiresAt,
  currentOrganizationConsentText,
  DEFAULT_CONSENT_TEXT_VERSION,
  departmentOfDirectoryPerson,
  generatePublicToken,
  mapConsentRequestRow,
  shortPersonLabel,
  type ConsentRequestRow,
} from '../services/consent.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder } from './shared.js'
import { toPermissionScope } from '../services/scopeAuthorization.js'

export function registerConsentRequestRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, emailSender, environment } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

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
    // consent_requests_open_unique gilt fuer status='sent'. Ohne Ablaufjob bliebe eine abgelaufene
    // Anfrage dort fuer immer "offen", und jede neue Anfrage an dieselbe Adresse scheiterte an 409.
    const now = new Date()
    const expired = await service
      .from('consent_requests')
      .update({ status: 'expired' })
      .eq('organization_id', input.organizationId)
      .eq('directory_person_id', input.directoryPersonId)
      .eq('recipient_email', input.recipientEmail)
      .eq('status', 'sent')
      .lt('expires_at', now.toISOString())
    if (expired.error) throw expired.error
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
        text_version: text.id ?? DEFAULT_CONSENT_TEXT_VERSION,
        token_hash: tokenHash,
        expires_at: consentRequestExpiresAt(now),
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
          personLabel: shortPersonLabel(person.data.first_name as string, person.data.last_name as string), respondUrl,
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
    const now = new Date()
    // Compare-and-Set auf status und send_count: eine inzwischen beantwortete Anfrage bekommt
    // keinen neuen Token, und zwei gleichzeitige Versendungen koennen nicht beide denselben
    // gelesenen Zaehler hochsetzen und so am Limit (CHECK send_count <= 5) vorbeisenden. Der
    // neue Link bekommt die volle Frist, die die E-Mail verspricht.
    const update = await service
      .from('consent_requests')
      .update({ token_hash: tokenHash, send_count: row.send_count + 1, last_sent_at: now.toISOString(), expires_at: consentRequestExpiresAt(now) })
      .eq('organization_id', row.organization_id)
      .eq('id', params.id)
      .eq('status', 'sent')
      .eq('send_count', row.send_count)
      .select(CONSENT_REQUEST_SELECT)
      .maybeSingle()
    if (update.error) {
      if (update.error.code === '23514') return reply.code(409).send({ error: 'resend_limit_reached', correlationId: request.id })
      throw update.error
    }
    if (!update.data) return reply.code(409).send({ error: 'request_not_open', correlationId: request.id })
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
          personLabel: shortPersonLabel(person.data.first_name as string, person.data.last_name as string), respondUrl,
        }),
      )
    } catch (error) {
      emailDelivered = false
      request.log.error({ err: error, correlationId: request.id }, 'consent request email delivery failed')
    }
    await recordAuditEvent(request, { organizationId: row.organization_id, action: 'consent_request.resent', entityType: 'consent_requests', entityId: params.id, metadata: { emailDelivered } })
    return reply.code(200).send({ ...mapConsentRequestRow(update.data as ConsentRequestRow), emailDelivered })
  })
}
