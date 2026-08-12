import {
  CreateDataSubjectRequestRequestSchema,
  DataSubjectEraseResponseSchema,
  DataSubjectExportResponseSchema,
  DataSubjectRequestSchema,
  UpdateDataSubjectRequestRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, toPermissionScope } from './shared.js'

export function registerDataSubjectRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)


  // Betroffenenrechte: Auskunft, Loeschung, Berichtigung, Widerspruch, Datenuebertragbarkeit -------
  function mapDataSubjectRequestRow(row: Record<string, unknown>) {
    return {
      id: row.id, organizationId: row.organization_id, kind: row.kind, subjectKind: row.subject_kind,
      directoryPersonId: row.directory_person_id, subjectLabel: row.subject_label, receivedAt: row.received_at,
      dueAt: row.due_at, extendedUntil: row.extended_until, extensionReason: row.extension_reason,
      status: row.status, resolutionNote: row.resolution_note, handledBy: row.handled_by,
      completedAt: row.completed_at, createdAt: row.created_at,
    }
  }
  const DATA_SUBJECT_REQUEST_COLUMNS =
    'id, organization_id, kind, subject_kind, directory_person_id, subject_label, received_at, due_at, extended_until, extension_reason, status, resolution_note, handled_by, completed_at, created_at'

  app.get('/v1/organizations/:id/data-subject-requests', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const rows = await supabaseClients.forService().from('data_subject_requests').select(DATA_SUBJECT_REQUEST_COLUMNS).eq('organization_id', params.id).order('due_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map((row) => DataSubjectRequestSchema.parse(mapDataSubjectRequestRow(row))))
  })

  app.post('/v1/organizations/:id/data-subject-requests', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateDataSubjectRequestRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    if (input.directoryPersonId) {
      const person = await supabaseClients.forService().from('directory_people').select('id').eq('id', input.directoryPersonId).eq('organization_id', params.id).maybeSingle()
      if (person.error) throw person.error
      if (!person.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const insert = await supabaseClients
      .forService()
      .from('data_subject_requests')
      .insert({
        organization_id: params.id, kind: input.kind, subject_kind: input.subjectKind,
        directory_person_id: input.directoryPersonId ?? null, subject_label: input.subjectLabel,
        received_at: input.receivedAt, created_by: request.auth!.userId, correlation_id: request.id,
      })
      .select(DATA_SUBJECT_REQUEST_COLUMNS)
      .single()
    if (insert.error) throw insert.error
    await recordAuditEvent(request, { organizationId: params.id, action: 'data_subject_request.created', entityType: 'data_subject_requests', entityId: insert.data.id as string, metadata: { kind: input.kind } })
    return reply.code(201).send(DataSubjectRequestSchema.parse(mapDataSubjectRequestRow(insert.data)))
  })

  async function loadDataSubjectRequest(client: SupabaseClient, id: string): Promise<{ organizationId: string; dueAt: string } | null> {
    const existing = await client.from('data_subject_requests').select('organization_id, due_at').eq('id', id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return null
    return { organizationId: existing.data.organization_id as string, dueAt: existing.data.due_at as string }
  }

  app.patch('/v1/data-subject-requests/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateDataSubjectRequestRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await loadDataSubjectRequest(client, params.id)
    if (existing === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const { organizationId } = existing
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return
    // due_at ist nur aus der Datenbank bekannt, nicht aus dieser Teilanfrage -- ein Zod-Schema
    // allein kann "extendedUntil nach due_at" deshalb nicht pruefen (adversariale Pruefung: ohne
    // diese Pruefung liesse sich eine Verlaengerung VOR die eigentliche Frist legen und der
    // CHECK-Verstoss der Datenbank kam bislang als unbehandelter 500 durch).
    if (input.extendedUntil !== undefined && input.extendedUntil !== null && input.extendedUntil <= existing.dueAt) {
      return reply.code(400).send({ error: 'extended_until_before_due_at', correlationId: request.id })
    }
    const payload: Record<string, unknown> = {}
    if (input.status !== undefined) {
      payload.status = input.status
      payload.handled_by = request.auth!.userId
      if (input.status === 'completed' || input.status === 'rejected' || input.status === 'partially_completed') payload.completed_at = new Date().toISOString()
    }
    if (input.resolutionNote !== undefined) payload.resolution_note = input.resolutionNote
    if (input.extendedUntil !== undefined) {
      payload.extended_until = input.extendedUntil
      // Eine aufgehobene Verlaengerung (extendedUntil:null) nimmt ihre Begruendung mit -- sonst
      // verstoesst die Datenbank gegen "eine Begruendung ohne Verlaengerungsdatum ist unzulaessig",
      // auch wenn extensionReason gar nicht Teil dieser Anfrage war (adversariale Pruefung: ein
      // Zod-Schema kennt den bestehenden Datenbankwert nicht und kann diesen Fall nicht abfangen).
      if (input.extendedUntil === null) {
        payload.extension_reason = null
        payload.extension_notified_at = null
      }
    }
    if (input.extensionReason !== undefined) {
      payload.extension_reason = input.extensionReason
      if (input.extensionReason !== null) payload.extension_notified_at = new Date().toISOString()
    }
    const update = await supabaseClients.forService().from('data_subject_requests').update(payload).eq('id', params.id).select(DATA_SUBJECT_REQUEST_COLUMNS).single()
    if (update.error) {
      if (update.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw update.error
    }
    await recordAuditEvent(request, { organizationId, action: 'data_subject_request.updated', entityType: 'data_subject_requests', entityId: params.id, metadata: { fields: Object.keys(input) } })
    return reply.code(200).send(DataSubjectRequestSchema.parse(mapDataSubjectRequestRow(update.data)))
  })

  // Auskunft: als Job ausgefuehrt (hier synchron, da ohne Hatchet-Cron -- Paket 004), Ergebnis ueber
  // einen kurzlebigen signierten Link statt im Response-Body (das Bündel kann Rechtstexte und
  // mehrere Kategorien enthalten). Enthaelt Verweise und Metadaten, keine Medien Dritter (Plan,
  // Abschnitt "2. Betroffenenrechte bedienbar machen" -- "ein Export, der ein Gruppenfoto mit fuenf
  // Kindern enthaelt, ist ein Datenschutzvorfall im Namen der Auskunft").
  app.get('/v1/data-subjects/:personId/export', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ personId: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const person = await client.from('directory_people').select('organization_id, department_id, team_id, first_name, last_name, birth_year, is_minor, status, joined_at, left_at, guardian_name, guardian_email').eq('id', params.personId).maybeSingle()
    if (person.error) throw person.error
    if (!person.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = person.data.organization_id as string
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return

    const service = supabaseClients.forService()
    const [consents, accessLog] = await Promise.all([
      service.from('consent_records').select('id, scope, origin, signed_at, valid_until, revoked_at, superseded_by').eq('directory_person_id', params.personId),
      // organization_id-Filter zusaetzlich zu entity_id, obwohl heute jeder Schreiber mit
      // entityType='directory_people' die Organisation bereits korrekt aus der Personenzeile
      // ableitet (adversariale Pruefung: kein aktuell ausnutzbarer Pfad, aber diese Zeile soll ihre
      // Mandantensicherheit nicht von der Korrektheit einer fremden Route abhaengig machen).
      service.from('audit_events').select('action, created_at').eq('organization_id', organizationId).eq('entity_type', 'directory_people').eq('entity_id', params.personId).order('created_at', { ascending: false }).limit(500),
    ])
    if (consents.error) throw consents.error
    if (accessLog.error) throw accessLog.error
    const consentIds = consents.data.map((row) => row.id as string)
    const mediaUsages = consentIds.length === 0
      ? []
      : await (async () => {
          const result = await service.from('face_regions').select('media_asset_id, decision, obscuring_style, created_at').in('consent_record_id', consentIds)
          if (result.error) throw result.error
          return result.data
        })()

    const bundle = {
      exportedAt: new Date().toISOString(),
      person: {
        firstName: person.data.first_name, lastName: person.data.last_name, birthYear: person.data.birth_year,
        isMinor: person.data.is_minor, status: person.data.status, joinedAt: person.data.joined_at, leftAt: person.data.left_at,
      },
      guardianContact: { name: person.data.guardian_name, email: person.data.guardian_email },
      consents: consents.data.map((row) => ({ id: row.id, scope: row.scope, origin: row.origin, signedAt: row.signed_at, validUntil: row.valid_until, revokedAt: row.revoked_at, supersededBy: row.superseded_by })),
      mediaUsages: mediaUsages.map((row) => ({ mediaAssetId: row.media_asset_id, decision: row.decision, obscuringStyle: row.obscuring_style, createdAt: row.created_at })),
      accessLog: accessLog.data.map((row) => ({ action: row.action, occurredAt: row.created_at })),
    }
    const objectPath = `organizations/${organizationId}/exports/${randomUUID()}.json`
    const upload = await service.storage.from('raw-media').upload(objectPath, Buffer.from(JSON.stringify(bundle, null, 2), 'utf8'), { contentType: 'application/json' })
    if (upload.error) throw upload.error
    const signed = await service.storage.from('raw-media').createSignedUrl(objectPath, 300, { download: true })
    if (signed.error) throw signed.error
    await recordAuditEvent(request, { organizationId, action: 'data_subject.exported', entityType: 'directory_people', entityId: params.personId })
    return reply.code(200).send(DataSubjectExportResponseSchema.parse({ signedUrl: signed.data.signedUrl, expiresAt: new Date(Date.now() + 300_000).toISOString() }))
  })

  // Loeschung: entfernt den Verzeichniseintrag samt Elternkontakt. consent_records_person_fk ist seit
  // dieser Migration ON DELETE SET NULL -- der Einwilligungsnachweis bleibt bestehen, nur die
  // identifizierende Verknuepfung verschwindet, was auch die Gesichtszuordnung (face_regions ->
  // consent_record_id) von der Person entkoppelt, ohne die Mediendatei selbst anzufassen.
  app.post('/v1/data-subjects/:personId/erase', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ personId: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const person = await client.from('directory_people').select('organization_id').eq('id', params.personId).maybeSingle()
    if (person.error) throw person.error
    if (!person.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = person.data.organization_id as string
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(organizationId)))) return

    const service = supabaseClients.forService()
    const consentCount = await service.from('consent_records').select('id', { count: 'exact', head: true }).eq('directory_person_id', params.personId)
    if (consentCount.error) throw consentCount.error
    // Identitaet ueberlebte bislang in zwei weiteren Spalten derselben Zeile, obwohl die Antwort
    // "Verknuepfung zur Person entfernt" das Gegenteil behauptete (adversariale Pruefung):
    // pseudonymous_subject_ref ist beim Papierweg haeufig exakt die directory_person_id,
    // signer_name der Klarname der unterschreibenden Person bzw. eines Elternteils. Vor dem Loeschen
    // der Person, sonst hat die FK bereits directory_person_id genullt und dieser Filter trifft
    // keine Zeile mehr.
    if ((consentCount.count ?? 0) > 0) {
      const anonymized = await service.from('consent_records').update({ pseudonymous_subject_ref: null, signer_name: null }).eq('directory_person_id', params.personId)
      if (anonymized.error) throw anonymized.error
    }

    const deleted = await service.from('directory_people').delete().eq('id', params.personId)
    if (deleted.error) throw deleted.error

    await recordAuditEvent(request, { organizationId, action: 'data_subject.erased', entityType: 'directory_people', entityId: params.personId })
    const retained: { category: string; reason: string }[] = []
    if ((consentCount.count ?? 0) > 0) {
      retained.push({
        category: 'Einwilligungsnachweise',
        reason: 'Nachweispflicht -- Aufbewahrung gemäss retention_settings.consent_evidence_years ab Ende der Gültigkeit; Verknüpfung zur Person, Pseudonym und Name der unterzeichnenden Person wurden entfernt',
      })
    }
    retained.push({ category: 'Veröffentlichte Beiträge', reason: 'Löschung auf der Plattform ist eine Handlung des Vereins, nicht des Systems' })
    return reply.code(200).send(
      DataSubjectEraseResponseSchema.parse({
        erased: ['Verzeichniseintrag', 'Elternkontakt', 'Gesichtszuordnung (Verknüpfung zur Person)', 'Pseudonym und Name der unterzeichnenden Person in verknüpften Einwilligungsnachweisen'],
        retained,
      }),
    )
  })
}
