import {
  AuditChainVerificationSchema,
  CreateProcessingRecordRequestSchema,
  CreateProcessorAgreementFieldsSchema,
  ProcessingRecordSchema,
  ProcessorAgreementSchema,
  PublicOrganizationImprintSchema,
  SignAuditChainResponseSchema,
  UpdateProcessingRecordRequestSchema,
  UpdateProcessorAgreementRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createChainSignerFromEnvironment } from '../secretBox.js'
import type { ApiRouteContext } from './context.js'
import { checkRateLimit, createAuditRecorder, toPermissionScope } from './shared.js'

export function registerComplianceRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, environment } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)


  // Dokumentation der Verarbeitungen und Auftragsverarbeiter ---------------------------------------
  function mapProcessingRecordRow(row: Record<string, unknown>) {
    return {
      id: row.id, organizationId: row.organization_id, purpose: row.purpose, legalBasis: row.legal_basis,
      dataCategories: row.data_categories, subjectCategories: row.subject_categories, recipients: row.recipients,
      thirdCountryTransfer: row.third_country_transfer, transferSafeguard: row.transfer_safeguard,
      retentionNote: row.retention_note, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by, createdAt: row.created_at,
    }
  }
  const PROCESSING_RECORD_COLUMNS =
    'id, organization_id, purpose, legal_basis, data_categories, subject_categories, recipients, third_country_transfer, transfer_safeguard, retention_note, reviewed_at, reviewed_by, created_at'

  app.get('/v1/organizations/:id/processing-records', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const rows = await supabaseClients.forService().from('processing_records').select(PROCESSING_RECORD_COLUMNS).eq('organization_id', params.id).order('created_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map((row) => ProcessingRecordSchema.parse(mapProcessingRecordRow(row))))
  })

  app.post('/v1/organizations/:id/processing-records', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateProcessingRecordRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const insert = await supabaseClients
      .forService()
      .from('processing_records')
      .insert({
        organization_id: params.id, purpose: input.purpose, legal_basis: input.legalBasis,
        data_categories: input.dataCategories, subject_categories: input.subjectCategories, recipients: input.recipients,
        third_country_transfer: input.thirdCountryTransfer, transfer_safeguard: input.transferSafeguard ?? null, retention_note: input.retentionNote,
      })
      .select(PROCESSING_RECORD_COLUMNS)
      .single()
    if (insert.error) {
      if (insert.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, { organizationId: params.id, action: 'processing_record.created', entityType: 'processing_records', entityId: insert.data.id as string })
    return reply.code(201).send(ProcessingRecordSchema.parse(mapProcessingRecordRow(insert.data)))
  })

  app.patch('/v1/processing-records/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateProcessingRecordRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('processing_records').select('organization_id, third_country_transfer, transfer_safeguard').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return
    // Die Zod-Pruefung in UpdateProcessingRecordRequestSchema sieht nur diese Anfrage -- wenn
    // third_country_transfer bereits true in der Datenbank steht und nur transferSafeguard
    // genullt wird (ohne thirdCountryTransfer in derselben Anfrage zu erwaehnen), kann ein Schema
    // ohne Datenbankzugriff das nicht erkennen (adversariale Pruefung).
    const resultingThirdCountryTransfer = input.thirdCountryTransfer ?? (existing.data.third_country_transfer as boolean)
    const resultingTransferSafeguard = input.transferSafeguard !== undefined ? input.transferSafeguard : (existing.data.transfer_safeguard as string | null)
    if (resultingThirdCountryTransfer && !resultingTransferSafeguard) {
      return reply.code(400).send({ error: 'transfer_safeguard_required', correlationId: request.id })
    }
    const payload: Record<string, unknown> = {}
    if (input.purpose !== undefined) payload.purpose = input.purpose
    if (input.legalBasis !== undefined) payload.legal_basis = input.legalBasis
    if (input.dataCategories !== undefined) payload.data_categories = input.dataCategories
    if (input.subjectCategories !== undefined) payload.subject_categories = input.subjectCategories
    if (input.recipients !== undefined) payload.recipients = input.recipients
    if (input.thirdCountryTransfer !== undefined) payload.third_country_transfer = input.thirdCountryTransfer
    if (input.transferSafeguard !== undefined) payload.transfer_safeguard = input.transferSafeguard
    if (input.retentionNote !== undefined) payload.retention_note = input.retentionNote
    // Eine Bestaetigung ist eine bewusste Handlung, kein Nebeneffekt einer Textaenderung -- deshalb
    // ein eigenes Flag statt reviewed_at bei jedem Feld-Update automatisch mitzusetzen.
    if (input.confirmReviewed === true) {
      payload.reviewed_at = new Date().toISOString().slice(0, 10)
      payload.reviewed_by = request.auth!.userId
    }
    const update = await supabaseClients.forService().from('processing_records').update(payload).eq('id', params.id).select(PROCESSING_RECORD_COLUMNS).single()
    if (update.error) {
      if (update.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw update.error
    }
    await recordAuditEvent(request, { organizationId, action: 'processing_record.updated', entityType: 'processing_records', entityId: params.id, metadata: { fields: Object.keys(input) } })
    return reply.code(200).send(ProcessingRecordSchema.parse(mapProcessingRecordRow(update.data)))
  })

  function mapProcessorAgreementRow(row: Record<string, unknown>) {
    return {
      id: row.id, organizationId: row.organization_id, processorName: row.processor_name, purpose: row.purpose,
      signedAt: row.signed_at, validUntil: row.valid_until, hasDocument: row.document_path !== null, status: row.status, createdAt: row.created_at,
    }
  }
  const PROCESSOR_AGREEMENT_COLUMNS = 'id, organization_id, processor_name, purpose, signed_at, valid_until, document_path, status, created_at'
  const ALLOWED_AGREEMENT_MIME = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])

  app.get('/v1/organizations/:id/processor-agreements', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const rows = await supabaseClients.forService().from('processor_agreements').select(PROCESSOR_AGREEMENT_COLUMNS).eq('organization_id', params.id).order('created_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map((row) => ProcessorAgreementSchema.parse(mapProcessorAgreementRow(row))))
  })

  // Multipart mit optionaler Vertragsdatei (PDF/DOCX) -- gleiches Muster wie POST /v1/consents:
  // Datei zuerst vollstaendig lesen, danach die begleitenden Felder auswerten.
  app.post('/v1/organizations/:id/processor-agreements', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return

    let fields: z.infer<typeof CreateProcessorAgreementFieldsSchema>
    let buffer: Buffer | null = null
    let mimetype: string | null = null
    const filePart = request.isMultipart() ? await request.file() : undefined
    if (filePart) {
      try {
        buffer = await filePart.toBuffer()
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
        }
        throw error
      }
      if (!ALLOWED_AGREEMENT_MIME.has(filePart.mimetype)) return reply.code(400).send({ error: 'invalid_file_type', correlationId: request.id })
      mimetype = filePart.mimetype
      // Ein leeres Formularfeld (z. B. ein Datumsfeld, das im Browser nicht ausgefuellt wurde)
      // kommt als leerer String an, nicht als fehlendes Feld -- z.iso.date().optional() lehnt ''
      // ab, waehrend ein tatsaechlich weggelassenes Feld durchginge (dasselbe Muster wie der
      // Memory-Eintrag zu $fetch und null-Query-Parametern). Leere Strings werden deshalb vor dem
      // Parsen wie ein weggelassenes Feld behandelt.
      const rawFields = Object.fromEntries(
        Object.entries(filePart.fields).map(([key, field]) => {
          const value = field && 'value' in field ? field.value : undefined
          return [key, value === '' ? undefined : value]
        }),
      )
      fields = CreateProcessorAgreementFieldsSchema.parse(rawFields)
    } else {
      fields = CreateProcessorAgreementFieldsSchema.parse(request.body)
    }

    const service = supabaseClients.forService()
    const agreementId = randomUUID()
    let documentPath: string | null = null
    if (buffer && mimetype) {
      documentPath = `organizations/${params.id}/compliance/${agreementId}/vertrag`
      const upload = await service.storage.from('raw-media').upload(documentPath, buffer, { contentType: mimetype })
      if (upload.error) throw upload.error
    }
    const insert = await service
      .from('processor_agreements')
      .insert({
        id: agreementId, organization_id: params.id, processor_name: fields.processorName, purpose: fields.purpose,
        signed_at: fields.signedAt ?? null, valid_until: fields.validUntil ?? null, status: fields.status,
        document_path: documentPath, created_by: request.auth!.userId,
      })
      .select(PROCESSOR_AGREEMENT_COLUMNS)
      .single()
    if (insert.error) {
      if (insert.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, { organizationId: params.id, action: 'processor_agreement.created', entityType: 'processor_agreements', entityId: agreementId })
    return reply.code(201).send(ProcessorAgreementSchema.parse(mapProcessorAgreementRow(insert.data)))
  })

  app.patch('/v1/processor-agreements/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateProcessorAgreementRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('processor_agreements').select('organization_id, signed_at').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return
    // signedAt ist in diesem Schema nicht setzbar, der bestehende Wert steht nur in der Datenbank
    // -- ohne diese Pruefung kam ein zu frueh gesetztes validUntil bislang als unbehandelter 500
    // durch (adversariale Pruefung).
    const existingSignedAt = existing.data.signed_at as string | null
    if (input.validUntil && existingSignedAt && input.validUntil <= existingSignedAt) {
      return reply.code(400).send({ error: 'valid_until_before_signed_at', correlationId: request.id })
    }
    const payload: Record<string, unknown> = {}
    if (input.status !== undefined) payload.status = input.status
    if (input.validUntil !== undefined) payload.valid_until = input.validUntil
    const update = await supabaseClients.forService().from('processor_agreements').update(payload).eq('id', params.id).select(PROCESSOR_AGREEMENT_COLUMNS).single()
    if (update.error) {
      if (update.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw update.error
    }
    await recordAuditEvent(request, { organizationId, action: 'processor_agreement.updated', entityType: 'processor_agreements', entityId: params.id, metadata: { fields: Object.keys(input) } })
    return reply.code(200).send(ProcessorAgreementSchema.parse(mapProcessorAgreementRow(update.data)))
  })

  // Kurzlebige signierte URL statt eines dauerhaften Links -- gleiches Muster wie
  // GET /v1/consents/:id/evidence-url (Paket 015): jeder Abruf eines Vertragsdokuments erzeugt einen
  // audit_events-Eintrag (Plan, Abschnitt "Verifikation" -- "der Abruf erzeugt einen
  // audit_events-Eintrag").
  app.get('/v1/processor-agreements/:id/document-url', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('processor_agreements').select('organization_id, document_path').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = existing.data.organization_id as string
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return
    if (!existing.data.document_path) return reply.code(404).send({ error: 'no_document', correlationId: request.id })
    const service = supabaseClients.forService()
    const signed = await service.storage.from('raw-media').createSignedUrl(existing.data.document_path as string, 300, { download: true })
    if (signed.error) throw signed.error
    await recordAuditEvent(request, { organizationId, action: 'processor_agreement.document_viewed', entityType: 'processor_agreements', entityId: params.id })
    return reply.code(200).send({ signedUrl: signed.data.signedUrl, expiresAt: new Date(Date.now() + 300_000).toISOString() })
  })

  // Manipulationssicherer Audit-Trail: signieren (periodischer Lauf, manuell bis Paket 004) und
  // pruefen ------------------------------------------------------------------------------------------
  app.post('/v1/organizations/:id/audit-chain/sign', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const service = supabaseClients.forService()
    const head = await service.from('audit_events').select('hash').eq('organization_id', params.id).order('chain_seq', { ascending: false }).limit(1).maybeSingle()
    if (head.error) throw head.error
    const countResult = await service.from('audit_events').select('id', { count: 'exact', head: true }).eq('organization_id', params.id)
    if (countResult.error) throw countResult.error
    const headHash = (head.data?.hash as string | undefined) ?? null
    const signer = createChainSignerFromEnvironment(environment)
    const signed = signer.sign(headHash ?? '')
    const insert = await service
      .from('audit_chain_signatures')
      .insert({ organization_id: params.id, event_count: countResult.count ?? 0, head_hash: headHash, key_version: signed.keyVersion, signature: signed.signature })
      .select('signed_at')
      .single()
    if (insert.error) throw insert.error
    return reply.code(201).send(
      SignAuditChainResponseSchema.parse({
        organizationId: params.id, eventCount: countResult.count ?? 0, headHash, keyVersion: signed.keyVersion, signedAt: insert.data.signed_at,
      }),
    )
  })

  app.get('/v1/organizations/:id/audit-chain/verify', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const service = supabaseClients.forService()
    const result = await service.rpc('verify_audit_chain', { target_organization_id: params.id })
    if (result.error) throw result.error
    const row = (result.data as { checked_count: number; tampered_count: number; unlinked_count: number }[])[0]!
    const lastSignature = await service
      .from('audit_chain_signatures')
      .select('signed_at, head_hash, signature, key_version')
      .eq('organization_id', params.id)
      .order('signed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastSignature.error) throw lastSignature.error
    // Der eigentliche Zweck der externen Signatur: ein Angreifer mit Datenbankzugriff kann
    // audit_chain_signatures beliebig umschreiben (service_role hat volle Rechte), aber nicht den
    // Schluessel faelschen, der nicht in der Datenbank liegt. Ohne diese Pruefung war die Signatur
    // bislang reine Schreiblast -- verify_audit_chain rechnet nur lokal aus denselben, potenziell
    // manipulierten Zeilen nach und haette einen so vertuschten Eingriff nie erkannt (adversariale
    // Pruefung).
    let signatureValid: boolean | null = null
    if (lastSignature.data) {
      const signer = createChainSignerFromEnvironment(environment)
      signatureValid = signer.verify(lastSignature.data.head_hash ?? '', lastSignature.data.signature as string, lastSignature.data.key_version as string)
      // Eine unveraenderte Signaturzeile allein beweist nichts: sie muss auch zum heutigen
      // Kettenzustand passen. Eine Aufbewahrungsloeschung entfernt nur alte Zeilen und laesst
      // den signierten Kopf-Hash bestehen -- fehlt er, wurde am Kopf der Kette eingegriffen.
      const signedHeadHash = lastSignature.data.head_hash as string | null
      if (signatureValid && signedHeadHash !== null) {
        const stillPresent = await service.from('audit_events').select('id').eq('organization_id', params.id).eq('hash', signedHeadHash).limit(1)
        if (stillPresent.error) throw stillPresent.error
        signatureValid = stillPresent.data.length > 0
      }
    }
    return reply.code(200).send(
      AuditChainVerificationSchema.parse({
        organizationId: params.id, checkedCount: row.checked_count, tamperedCount: row.tampered_count, unlinkedCount: row.unlinked_count,
        lastSignedAt: lastSignature.data?.signed_at ?? null, signatureValid,
      }),
    )
  })

  // Oeffentlich, ohne Anmeldung -- ein Verein kann diese URL aus seiner Instagram-/Facebook-Bio
  // verlinken (Plan, Abschnitt "3. Pflichtangaben und Verantwortung").
  app.get('/v1/organizations/:id/imprint', async (request, reply) => {
    if (!checkRateLimit(`imprint:${request.ip}`, 60, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const [organization, profile] = await Promise.all([
      service.from('organizations').select('name').eq('id', params.id).maybeSingle(),
      service
        .from('organization_profiles')
        .select('legal_name, legal_form, register_court, register_number, street, house_number, postal_code, city, country_code, contact_email, contact_phone, website_url, responsible_person_profile_id, imprint_published')
        .eq('organization_id', params.id)
        .maybeSingle(),
    ])
    if (organization.error) throw organization.error
    if (profile.error) throw profile.error
    if (!organization.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    // Ohne ausdrueckliche Freigabe (Default false) veroeffentlicht diese Route nichts -- ein Verein,
    // der Kontakt-/Adress-/Registerangaben nur zur internen Verwaltung eingetragen hat, soll sie
    // nicht ungefragt jedem zeigen, der die Organisations-UUID kennt (adversariale Pruefung).
    if (!profile.data?.imprint_published) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    let responsiblePersonName: string | null = null
    if (profile.data?.responsible_person_profile_id) {
      const responsible = await service.from('profiles').select('display_name').eq('id', profile.data.responsible_person_profile_id).maybeSingle()
      if (responsible.error) throw responsible.error
      responsiblePersonName = (responsible.data?.display_name as string | undefined) ?? null
    }
    return reply.code(200).send(
      PublicOrganizationImprintSchema.parse({
        organizationName: organization.data.name,
        legalName: profile.data?.legal_name ?? null,
        legalForm: profile.data?.legal_form ?? null,
        registerCourt: profile.data?.register_court ?? null,
        registerNumber: profile.data?.register_number ?? null,
        street: profile.data?.street ?? null,
        houseNumber: profile.data?.house_number ?? null,
        postalCode: profile.data?.postal_code ?? null,
        city: profile.data?.city ?? null,
        countryCode: profile.data?.country_code ?? 'DE',
        contactEmail: profile.data?.contact_email ?? null,
        contactPhone: profile.data?.contact_phone ?? null,
        websiteUrl: profile.data?.website_url ?? null,
        responsiblePersonName,
      }),
    )
  })
}
