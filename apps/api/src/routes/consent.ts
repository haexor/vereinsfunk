import {
  CreateConsentRecordFieldsSchema,
  CreateConsentRequestRequestSchema,
  OrganizationConsentTextSchema,
  RevokeConsentRequestSchema,
  SupersedeConsentRequestSchema,
  UpdateOrganizationConsentTextRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ALLOWED_EVIDENCE_MIME,
  addMonthsToIsoDate,
  buildConsentRequestEmail,
  currentOrganizationConsentText,
  CONSENT_REQUEST_SELECT,
  departmentOfDirectoryPerson,
  generatePublicToken,
  loadConsentRecordForScope,
  mapConsentRecordRow,
  mapConsentRequestRow,
  resolveConsentValidityMonths,
  shortPersonLabel,
  type ConsentRequestRow,
} from '../services/consent.js'
import type { ApiRouteContext } from './context.js'
import {
  CONSENT_RECORD_SELECT,
  createAuditRecorder,
  fetchAllRows,
  isAnyMemberOfOrganization,
  resolveDirectoryScope,
  toPermissionScope,
  type ConsentRecordRow,
} from './shared.js'

export function registerConsentRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, emailSender, environment } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.get('/v1/organizations/:id/consent-text', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    if (!(await isAnyMemberOfOrganization(client, request.auth!.userId, params.id))) {
      return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
    }
    const text = await currentOrganizationConsentText(client, params.id)
    return reply.code(200).send(
      OrganizationConsentTextSchema.parse({
        id: text.id ?? 'default-template', organizationId: params.id, body: text.body,
        createdAt: text.createdAt, isDefaultTemplate: text.id === null,
      }),
    )
  })

  app.put('/v1/organizations/:id/consent-text', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateOrganizationConsentTextRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'consent.manage', { organizationId: params.id }))) return
    const service = supabaseClients.forService()
    const insert = await service.from('organization_consent_texts').insert({
      organization_id: params.id, body: input.body, created_by: request.auth!.userId,
    }).select('id, body, created_at').single()
    if (insert.error) throw insert.error
    await recordAuditEvent(request, { organizationId: params.id, action: 'consent_text.updated', entityType: 'organization_consent_texts', entityId: insert.data.id as string })
    return reply.code(201).send(
      OrganizationConsentTextSchema.parse({
        id: insert.data.id, organizationId: params.id, body: insert.data.body, createdAt: insert.data.created_at, isDefaultTemplate: false,
      }),
    )
  })

  // Registratur einer Papiererklaerung (Plan 015, Abschnitt 2). Multipart wie
  // POST /v1/brand/assets: Datei zuerst vollstaendig lesen, danach die begleitenden Felder
  // auswerten (busboy fuellt filePart.fields erst danach). Ohne Nachweisdatei kein Eintrag --
  // digitale Einwilligungen (origin='digital') entstehen ausschliesslich ueber den oeffentlichen
  // Anfrage-Antwort-Fluss unten, nicht hier.
  app.post('/v1/consents', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return

    const filePart = await request.file()
    if (!filePart) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })

    let fields: z.infer<typeof CreateConsentRecordFieldsSchema>
    let buffer: Buffer
    try {
      buffer = await filePart.toBuffer()
      const rawFields = Object.fromEntries(
        Object.entries(filePart.fields).map(([key, field]) => [key, field && 'value' in field ? field.value : undefined]),
      )
      const scopeStructuredRaw = rawFields.scopeStructured
      if (typeof scopeStructuredRaw === 'string') rawFields.scopeStructured = JSON.parse(scopeStructuredRaw)
      fields = CreateConsentRecordFieldsSchema.parse(rawFields)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw error
    }
    if (!ALLOWED_EVIDENCE_MIME.has(filePart.mimetype)) return reply.code(400).send({ error: 'invalid_file_type', correlationId: request.id })

    const client = supabaseClients.forUser(request.auth!.accessToken)
    let departmentId: string | null = fields.departmentId ?? null
    if (fields.directoryPersonId) {
      const person = await client.from('directory_people').select('organization_id, department_id, is_minor').eq('id', fields.directoryPersonId).maybeSingle()
      if (person.error) throw person.error
      if (!person.data || person.data.organization_id !== fields.organizationId) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      // Vertrauen gilt der Person, nicht dem Risiko fuer Dritte (plans/README.md) -- eine
      // minderjaehrige Person kann sich nicht selbst rechtsverbindlich einwilligen, auch nicht
      // auf Papier. Derselbe Fund/derselbe Guard wie bei POST /v1/consent-requests.
      if (person.data.is_minor && fields.signerRole !== 'guardian') {
        return reply.code(400).send({ error: 'guardian_required_for_minor', correlationId: request.id })
      }
      departmentId = person.data.department_id as string | null
    } else if (departmentId) {
      // Wie resolveInvitationScope/resolveDirectoryScope an anderer Stelle: departmentId kommt
      // hier ungeprueft vom Aufrufer und darf nicht ohne Verifikation gegen organizationId in den
      // Rechtescope einfliessen (gefunden im Code-Review).
      const resolved = await resolveDirectoryScope(client, fields.organizationId, departmentId, null)
      if (!resolved) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const scope = toPermissionScope(fields.organizationId, departmentId)
    if (!(await requirePermission(request, reply, 'consent.manage', scope))) return

    const validityMonths = await resolveConsentValidityMonths(client, fields.organizationId, departmentId)
    const validUntil = validityMonths === null ? null : addMonthsToIsoDate(fields.signedAt, validityMonths)

    const service = supabaseClients.forService()
    const consentId = randomUUID()
    const objectPath = `organizations/${fields.organizationId}/consents/${consentId}/nachweis`
    const upload = await service.storage.from('raw-media').upload(objectPath, buffer, { contentType: filePart.mimetype })
    if (upload.error) throw upload.error

    const insert = await service
      .from('consent_records')
      .insert({
        id: consentId,
        organization_id: fields.organizationId,
        directory_person_id: fields.directoryPersonId ?? null,
        // Pflichtfeld seit der urspruenglichen Content-Pipeline-Migration (not null, auch nach der
        // Ergaenzung von directory_person_id in Paket 014) -- bei einer echten Personenzuordnung
        // dient die stabile UUID selbst als Referenz, es wird kein zusaetzlicher Wert erfunden.
        pseudonymous_subject_ref: fields.pseudonymousSubjectRef ?? fields.directoryPersonId,
        scope: fields.scope,
        scope_structured: fields.scopeStructured,
        origin: 'paper',
        evidence_bucket: 'raw-media',
        evidence_path: objectPath,
        signed_at: fields.signedAt,
        signer_name: fields.signerName,
        signer_role: fields.signerRole,
        guardian_confirmed: fields.guardianConfirmed,
        valid_until: validUntil,
        created_by: request.auth!.userId,
      })
      .select(CONSENT_RECORD_SELECT)
      .single()
    if (insert.error) throw insert.error

    await recordAuditEvent(request, { organizationId: fields.organizationId, action: 'consent.registered', entityType: 'consent_records', entityId: consentId })
    return reply.code(201).send(mapConsentRecordRow(insert.data as ConsentRecordRow, new Date()))
  })

  app.get('/v1/consents', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const query = z.object({ organizationId: UuidSchema, departmentId: UuidSchema.optional(), directoryPersonId: UuidSchema.optional() }).parse(request.query)
    const scope = toPermissionScope(query.organizationId, query.departmentId)
    if (!(await requirePermission(request, reply, 'consent.manage', scope))) return

    const service = supabaseClients.forService()
    let directoryPersonIds: string[] | null = null
    if (query.directoryPersonId) {
      directoryPersonIds = [query.directoryPersonId]
    } else if (query.departmentId) {
      const people = await fetchAllRows<{ id: string }>((from, to) =>
        service.from('directory_people').select('id').eq('organization_id', query.organizationId).eq('department_id', query.departmentId!).range(from, to),
      )
      directoryPersonIds = people.map((person) => person.id)
      if (directoryPersonIds.length === 0) return reply.code(200).send([])
    }
    let select = service.from('consent_records').select(CONSENT_RECORD_SELECT).eq('organization_id', query.organizationId)
    if (directoryPersonIds) select = select.in('directory_person_id', directoryPersonIds)
    const rows = await select.order('created_at', { ascending: false })
    if (rows.error) throw rows.error
    const now = new Date()
    return reply.code(200).send((rows.data as ConsentRecordRow[]).map((row) => mapConsentRecordRow(row, now)))
  })

  app.get('/v1/consents/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const loaded = await loadConsentRecordForScope(client, params)
    if (loaded === 'not_found') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'consent.manage', loaded.scope))) return
    return reply.code(200).send(mapConsentRecordRow(loaded.row, new Date()))
  })

  // Kurzlebige signierte URL statt eines dauerhaften Links (Plan 015, Abschnitt 2): Nachweise sind
  // private Dokumente mit Unterschriften. download:true erzwingt Content-Disposition: attachment
  // fuer PDFs -- ein PDF wird nie inline angezeigt (dieselbe Ueberlegung wie bei SVG in Paket 009).
  app.get('/v1/consents/:id/evidence-url', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const loaded = await loadConsentRecordForScope(client, params)
    if (loaded === 'not_found') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'consent.manage', loaded.scope))) return
    const service = supabaseClients.forService()
    const evidence = await service.from('consent_records').select('evidence_bucket, evidence_path').eq('id', params.id).single()
    if (evidence.error) throw evidence.error
    const signed = await service.storage.from(evidence.data.evidence_bucket as string).createSignedUrl(evidence.data.evidence_path as string, 300, { download: true })
    if (signed.error) throw signed.error
    await recordAuditEvent(request, { organizationId: loaded.row.organization_id, action: 'consent.evidence_viewed', entityType: 'consent_records', entityId: params.id })
    return reply.code(200).send({ signedUrl: signed.data.signedUrl, expiresAt: new Date(Date.now() + 300_000).toISOString() })
  })

  app.post('/v1/consents/:id/revoke', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = RevokeConsentRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const loaded = await loadConsentRecordForScope(client, params)
    if (loaded === 'not_found') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'consent.manage', loaded.scope))) return
    if (loaded.row.revoked_at !== null) return reply.code(409).send({ error: 'already_revoked', correlationId: request.id })

    const service = supabaseClients.forService()
    // .is('revoked_at', null) macht Pruefung und Schreibvorgang atomar -- der vorige Read-Check
    // allein liesse zwei gleichzeitige Widerrufe den zweiten Grund/Widerrufenden ueberschreiben
    // (gefunden im Code-Review, gleiches Muster wie die oeffentliche Widerrufsroute unten).
    const update = await service
      .from('consent_records')
      .update({ revoked_at: new Date().toISOString(), revoked_by: input.revokedBy, revocation_reason: input.reason ?? null })
      .eq('id', params.id)
      .is('revoked_at', null)
      .select(CONSENT_RECORD_SELECT)
      .maybeSingle()
    if (update.error) throw update.error
    if (!update.data) return reply.code(409).send({ error: 'already_revoked', correlationId: request.id })
    // Kaskade (offene Freigaben invalidieren, geplante Publikationen stornieren) laeuft im
    // Trigger invalidate_approval_after_consent_revocation, nicht hier -- dasselbe Muster wie bei
    // invalidate_approvals_for_media_change/invalidate_approvals_for_fixture_change.
    await recordAuditEvent(request, { organizationId: loaded.row.organization_id, action: 'consent.revoked', entityType: 'consent_records', entityId: params.id, metadata: { revokedBy: input.revokedBy } })
    return reply.code(200).send(mapConsentRecordRow(update.data as ConsentRecordRow, new Date()))
  })

  // Neue Version statt Bearbeitung (Plan 015: "eine Einwilligung wird nie bearbeitet"). Die alte
  // Zeile bleibt bestehen und wird per superseded_by verkettet -- evaluateConsent haelt eine
  // abgeloeste Zeile fuer nie gueltig, unabhaengig von jeder anderen Pruefung.
  app.post('/v1/consents/:id/supersede', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = SupersedeConsentRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const loaded = await loadConsentRecordForScope(client, params)
    if (loaded === 'not_found') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'consent.manage', loaded.scope))) return
    if (loaded.row.superseded_by !== null) return reply.code(409).send({ error: 'already_superseded', correlationId: request.id })

    // Derselbe Fund/derselbe Guard wie bei POST /v1/consents und POST /v1/consent-requests: die
    // Abloesung darf eine minderjaehrige Person nicht nachtraeglich auf signerRole='self' setzen.
    if (loaded.row.directory_person_id) {
      const person = await client.from('directory_people').select('is_minor').eq('id', loaded.row.directory_person_id).single()
      if (person.error) throw person.error
      if (person.data.is_minor && input.signerRole !== 'guardian') {
        return reply.code(400).send({ error: 'guardian_required_for_minor', correlationId: request.id })
      }
    }

    const service = supabaseClients.forService()
    const evidenceOfOriginal = await service.from('consent_records').select('evidence_bucket, evidence_path').eq('id', params.id).single()
    if (evidenceOfOriginal.error) throw evidenceOfOriginal.error

    const newId = randomUUID()
    // Eine Ablösung korrigiert den Umfang eines bereits dokumentierten Papier- oder digitalen
    // Nachweises -- sie laedt kein neues Dokument hoch und uebernimmt deshalb evidence_bucket/-path
    // unveraendert von der abgeloesten Zeile.
    const insert = await service
      .from('consent_records')
      .insert({
        id: newId,
        organization_id: loaded.row.organization_id,
        directory_person_id: loaded.row.directory_person_id,
        pseudonymous_subject_ref: loaded.row.pseudonymous_subject_ref,
        scope: input.scope,
        scope_structured: input.scopeStructured,
        origin: loaded.row.origin,
        evidence_bucket: evidenceOfOriginal.data.evidence_bucket,
        evidence_path: evidenceOfOriginal.data.evidence_path,
        signed_at: input.signedAt,
        signer_name: input.signerName,
        signer_role: input.signerRole,
        guardian_confirmed: input.guardianConfirmed,
        created_by: request.auth!.userId,
      })
      .select(CONSENT_RECORD_SELECT)
      .single()
    if (insert.error) throw insert.error

    // Wie bei POST /v1/consents/:id/revoke: .is('superseded_by', null) macht die Verkettung atomar.
    // Trifft sie keine Zeile, hat eine parallele Anfrage bereits abgeloest -- die eben angelegte
    // Zeile wird dann verworfen, statt zwei Nachfolgerinnen fuer dieselbe Einwilligung zu erzeugen.
    const linkBack = await service.from('consent_records').update({ superseded_by: newId }).eq('id', params.id).is('superseded_by', null).select('id').maybeSingle()
    if (linkBack.error) throw linkBack.error
    if (!linkBack.data) {
      await service.from('consent_records').delete().eq('id', newId)
      return reply.code(409).send({ error: 'already_superseded', correlationId: request.id })
    }
    await recordAuditEvent(request, { organizationId: loaded.row.organization_id, action: 'consent.superseded', entityType: 'consent_records', entityId: newId, metadata: { supersedes: params.id } })
    return reply.code(201).send(mapConsentRecordRow(insert.data as ConsentRecordRow, new Date()))
  })


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
        text_version: text.id ?? 'default-template',
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
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
    const update = await service
      .from('consent_requests')
      .update({ token_hash: tokenHash, send_count: row.send_count + 1, last_sent_at: new Date().toISOString() })
      .eq('id', params.id)
      .select(CONSENT_REQUEST_SELECT)
      .single()
    if (update.error) {
      if (update.error.code === '23514') return reply.code(409).send({ error: 'resend_limit_reached', correlationId: request.id })
      throw update.error
    }
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
