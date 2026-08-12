import { PublicConsentRequestViewSchema, PublicConsentRevocationViewSchema, RespondConsentRequestRequestSchema } from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  CONSENT_TOKEN_INVALID_RESPONSE,
  currentOrganizationConsentText,
  describeConsentScope,
  findOpenConsentRequestByToken,
  generatePublicToken,
  hashPublicToken,
  shortPersonLabel,
} from '../services/consent.js'
import type { ApiRouteContext } from './context.js'
import { CONSENT_RECORD_SELECT, checkRateLimit, type ConsentRecordRow } from './shared.js'

export function registerConsentPublicRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { supabaseClients, environment } = context

  // --- Oeffentliche, unauthentifizierte Seiten (Plan 015, Abschnitt 3) ------------------------
  // Kein requireAuth: ein Erziehungsberechtigter hat kein Vereinskonto. Jede Antwort auf ein

  app.get('/v1/consent-requests/by-token/:token', async (request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow')
    if (!checkRateLimit(`consent-request-view:${request.ip}`, 30, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ token: z.string().min(1).max(200) }).parse(request.params)
    const service = supabaseClients.forService()
    const row = await findOpenConsentRequestByToken(service, params.token)
    if (!row) return reply.code(404).send({ ...CONSENT_TOKEN_INVALID_RESPONSE, correlationId: request.id })

    const [person, organizationName, text] = await Promise.all([
      service.from('directory_people').select('first_name, last_name').eq('id', row.directory_person_id).single(),
      service.from('organizations').select('name').eq('id', row.organization_id).single(),
      currentOrganizationConsentText(service, row.organization_id),
    ])
    if (person.error) throw person.error
    if (organizationName.error) throw organizationName.error
    return reply.code(200).send(
      PublicConsentRequestViewSchema.parse({
        organizationName: organizationName.data.name,
        personLabel: shortPersonLabel(person.data.first_name as string, person.data.last_name as string),
        textVersion: row.text_version,
        consentText: text.body,
        requestedScope: row.requested_scope,
        expiresAt: row.expires_at,
        status: row.status,
      }),
    )
  })

  app.post('/v1/consent-requests/by-token/:token/respond', async (request, reply) => {
    if (!checkRateLimit(`consent-request-respond:${request.ip}`, 10, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ token: z.string().min(1).max(200) }).parse(request.params)
    const input = RespondConsentRequestRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    const row = await findOpenConsentRequestByToken(service, params.token)
    if (!row) return reply.code(404).send({ ...CONSENT_TOKEN_INVALID_RESPONSE, correlationId: request.id })

    // Datenschutzarmer Abgabenachweis: gehasht mit einem serverseitigen Pfeffer, sonst ist eine
    // IPv4-Adresse trivial rueckrechenbar (Plan 015, Abschnitt 3).
    const pepper = environment.CONSENT_RESPONSE_HASH_PEPPER ?? 'local-dev-pepper'
    const responseIpHash = createHash('sha256').update(`${pepper}:${request.ip}`).digest('hex')
    const responseUserAgentHash = createHash('sha256').update(`${pepper}:${request.headers['user-agent'] ?? ''}`).digest('hex')

    if (input.decision === 'declined') {
      // .select().maybeSingle() statt eines blinden Updates: trifft der Compare-and-Set keine
      // Zeile, hat eine gleichzeitige Anfrage dieselbe Einwilligungsanfrage bereits beantwortet.
      // Ohne diese Pruefung meldete diese Antwort "abgelehnt", waehrend tatsaechlich eine
      // Einwilligung erteilt wurde (gefunden im Code-Review) -- dieselbe uniforme Fehlerantwort wie
      // bei jedem anderen ungueltigen Token, damit der Ausgang nicht ueber Fehlercodes erratbar ist.
      const declined = await service
        .from('consent_requests')
        .update({ status: 'declined', responded_at: new Date().toISOString(), response_ip_hash: responseIpHash, response_user_agent_hash: responseUserAgentHash })
        .eq('id', row.id)
        .eq('status', 'sent')
        .select('id')
        .maybeSingle()
      if (declined.error) throw declined.error
      if (!declined.data) return reply.code(404).send({ ...CONSENT_TOKEN_INVALID_RESPONSE, correlationId: request.id })
      return reply.code(200).send({ status: 'declined' })
    }

    const person = await service.from('directory_people').select('is_minor').eq('id', row.directory_person_id).single()
    if (person.error) throw person.error
    const { rawToken: revocationRawToken, tokenHash: revocationTokenHash } = generatePublicToken()
    const consentId = randomUUID()
    const consentInsert = await service
      .from('consent_records')
      .insert({
        id: consentId,
        organization_id: row.organization_id,
        directory_person_id: row.directory_person_id,
        pseudonymous_subject_ref: row.directory_person_id,
        scope: describeConsentScope(row.requested_scope).join(' '),
        scope_structured: row.requested_scope,
        origin: 'digital',
        evidence_bucket: 'raw-media',
        // Kein Dateiupload im digitalen Weg -- der Nachweis IST die Anfrage/Antwort-Zeile
        // (consent_requests) selbst, referenziert ueber denselben Pfad als Marker statt eines
        // erfundenen Dateiobjekts. Ehrliche Einordnung in der Oberfläche (Plan, Abschnitt 3):
        // ein E-Mail-Link belegt nicht die Identitaet des Erziehungsberechtigten.
        evidence_path: `digital-consent-requests/${row.id}`,
        signed_at: new Date().toISOString().slice(0, 10),
        signer_name: null,
        signer_role: row.recipient_role,
        guardian_confirmed: row.recipient_role === 'guardian',
        source_id: null,
        revocation_token_hash: revocationTokenHash,
        created_by: row.created_by,
      })
      .select(CONSENT_RECORD_SELECT)
      .single()
    if (consentInsert.error) throw consentInsert.error

    // Wie bei POST /v1/consents/:id/supersede: der Compare-and-Set auf status='sent' entscheidet,
    // welche von zwei gleichzeitigen Antworten gewinnt -- die Verliererin nimmt ihre eben angelegte
    // Einwilligung wieder mit. Ohne diese Kompensation blieb bei jedem Rennen eine zweite, an keine
    // Anfrage gebundene consent_records-Zeile mit eigenem Widerrufstoken zurueck: dauerhaft
    // gueltig, ueber die Oberflaeche der Anfrage nicht auffindbar und deshalb praktisch nicht mehr
    // widerrufbar (gefunden im Code-Review).
    const granted = await service
      .from('consent_requests')
      .update({
        status: 'granted', responded_at: new Date().toISOString(), consent_record_id: consentId,
        response_ip_hash: responseIpHash, response_user_agent_hash: responseUserAgentHash,
      })
      .eq('id', row.id)
      .eq('status', 'sent')
      .select('id')
      .maybeSingle()
    if (granted.error) throw granted.error
    if (!granted.data) {
      await service.from('consent_records').delete().eq('id', consentId)
      return reply.code(404).send({ ...CONSENT_TOKEN_INVALID_RESPONSE, correlationId: request.id })
    }

    return reply.code(200).send({
      status: 'granted',
      revocationUrl: `${environment.WEB_BASE_URL ?? 'http://localhost:4200'}/einwilligung/widerruf/${revocationRawToken}`,
    })
  })

  app.get('/v1/consents/by-revocation-token/:token', async (request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow')
    if (!checkRateLimit(`consent-revocation-view:${request.ip}`, 30, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ token: z.string().min(1).max(200) }).parse(request.params)
    const tokenHash = hashPublicToken(params.token)
    const service = supabaseClients.forService()
    const found = await service.from('consent_records').select(CONSENT_RECORD_SELECT).eq('revocation_token_hash', tokenHash).maybeSingle()
    if (found.error) throw found.error
    if (!found.data) return reply.code(404).send({ ...CONSENT_TOKEN_INVALID_RESPONSE, correlationId: request.id })
    const row = found.data as ConsentRecordRow
    const [person, organizationName] = await Promise.all([
      service.from('directory_people').select('first_name, last_name').eq('id', row.directory_person_id).single(),
      service.from('organizations').select('name').eq('id', row.organization_id).single(),
    ])
    if (person.error) throw person.error
    if (organizationName.error) throw organizationName.error
    return reply.code(200).send(
      PublicConsentRevocationViewSchema.parse({
        organizationName: organizationName.data.name,
        personLabel: shortPersonLabel(person.data.first_name as string, person.data.last_name as string),
        status: row.revoked_at === null ? 'active' : 'already_revoked',
      }),
    )
  })

  app.post('/v1/consents/by-revocation-token/:token', async (request, reply) => {
    if (!checkRateLimit(`consent-revocation-confirm:${request.ip}`, 10, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ token: z.string().min(1).max(200) }).parse(request.params)
    const tokenHash = hashPublicToken(params.token)
    const service = supabaseClients.forService()
    const found = await service.from('consent_records').select('id, organization_id, revoked_at').eq('revocation_token_hash', tokenHash).maybeSingle()
    if (found.error) throw found.error
    if (!found.data) return reply.code(404).send({ ...CONSENT_TOKEN_INVALID_RESPONSE, correlationId: request.id })
    if (found.data.revoked_at !== null) return reply.code(200).send({ status: 'already_revoked' })

    const update = await service
      .from('consent_records')
      .update({ revoked_at: new Date().toISOString(), revoked_by: 'guardian', revocation_reason: 'Öffentlicher Widerrufslink' })
      .eq('id', found.data.id)
      .is('revoked_at', null)
    if (update.error) throw update.error
    const audit = await service.from('audit_events').insert({
      organization_id: found.data.organization_id, actor_user_id: null, action: 'consent.revoked_via_public_link',
      entity_type: 'consent_records', entity_id: found.data.id, correlation_id: request.id,
    })
    if (audit.error) request.log.error({ err: audit.error, correlationId: request.id }, 'audit_events insert failed')
    return reply.code(200).send({ status: 'revoked' })
  })
}
