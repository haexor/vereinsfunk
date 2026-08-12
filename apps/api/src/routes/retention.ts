import {
  RetentionDeletionSchema,
  RetentionSettingsSchema,
  RunRetentionRequestSchema,
  RunRetentionResponseSchema,
  UpdateRetentionSettingsRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, fetchAllRows, toPermissionScope } from './shared.js'

export function registerRetentionRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // Paket 020: Rechtliche Pflichten und Datenschutzbetrieb ----------------------------------------

  function mapRetentionSettingsRow(row: Record<string, unknown>) {
    return {
      organizationId: row.organization_id,
      rawMediaDays: row.raw_media_days,
      derivativeDays: row.derivative_days,
      auditEventDays: row.audit_event_days,
      consentEvidenceYears: row.consent_evidence_years,
      statusEventDays: row.status_event_days,
      updatedAt: row.updated_at,
    }
  }
  const RETENTION_SETTINGS_COLUMNS = 'organization_id, raw_media_days, derivative_days, audit_event_days, consent_evidence_years, status_event_days, updated_at'

  // Der Migrations-Nachtrag fuellt retention_settings nur fuer Bestandsvereine mit einer/einem
  // organization_owner (adversariale Pruefung: ein frischer db:reset laesst die Seed-Vereine ohne
  // Zeile, weil seed.sql sie per direktem INSERT statt ueber create_organization() anlegt, das
  // NACH dem Migrations-Nachtrag laeuft -- GET/PUT/run scheiterten dann mit einem generischen 500
  // statt einer nutzbaren Antwort). Statt auf eine perfekt synchronisierte Migrations-/Seed-
  // Reihenfolge fuer alle Zukunft zu vertrauen, legt jeder Zugriff die Zeile bei Bedarf selbst an.
  async function loadOrCreateRetentionSettings(service: SupabaseClient, organizationId: string, actorUserId: string): Promise<Record<string, unknown>> {
    const existing = await service.from('retention_settings').select(RETENTION_SETTINGS_COLUMNS).eq('organization_id', organizationId).maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) return existing.data
    // upsert statt insert: zwei gleichzeitige Aufrufe (die Oberflaeche laedt mehrere
    // Aufbewahrungsrouten parallel) liefen sonst im zweiten Aufruf in den Primaerschluessel
    // und antworteten mit 500 statt mit den Standardwerten.
    const inserted = await service
      .from('retention_settings')
      .upsert({ organization_id: organizationId, updated_by: actorUserId }, { onConflict: 'organization_id', ignoreDuplicates: true })
    if (inserted.error) throw inserted.error
    const reread = await service.from('retention_settings').select(RETENTION_SETTINGS_COLUMNS).eq('organization_id', organizationId).single()
    if (reread.error) throw reread.error
    return reread.data
  }

  app.get('/v1/organizations/:id/retention-settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const row = await loadOrCreateRetentionSettings(supabaseClients.forService(), params.id, request.auth!.userId)
    return reply.code(200).send(RetentionSettingsSchema.parse(mapRetentionSettingsRow(row)))
  })

  app.put('/v1/organizations/:id/retention-settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateRetentionSettingsRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const service = supabaseClients.forService()
    await loadOrCreateRetentionSettings(service, params.id, request.auth!.userId)
    const payload: Record<string, unknown> = { updated_by: request.auth!.userId }
    if (input.rawMediaDays !== undefined) payload.raw_media_days = input.rawMediaDays
    if (input.derivativeDays !== undefined) payload.derivative_days = input.derivativeDays
    if (input.auditEventDays !== undefined) payload.audit_event_days = input.auditEventDays
    if (input.consentEvidenceYears !== undefined) payload.consent_evidence_years = input.consentEvidenceYears
    if (input.statusEventDays !== undefined) payload.status_event_days = input.statusEventDays
    const update = await service.from('retention_settings').update(payload).eq('organization_id', params.id).select(RETENTION_SETTINGS_COLUMNS).single()
    if (update.error) throw update.error
    await recordAuditEvent(request, { organizationId: params.id, action: 'retention_settings.updated', entityType: 'retention_settings', entityId: params.id, metadata: { fields: Object.keys(input) } })
    return reply.code(200).send(RetentionSettingsSchema.parse(mapRetentionSettingsRow(update.data)))
  })

  app.get('/v1/organizations/:id/retention-deletions', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return
    const rows = await supabaseClients
      .forService()
      .from('retention_deletions')
      .select('rule_key, entity_type, entity_count, cutoff_date, dry_run, executed_at')
      .eq('organization_id', params.id)
      .eq('dry_run', false)
      .order('executed_at', { ascending: false })
      .limit(200)
    if (rows.error) throw rows.error
    return reply.code(200).send(
      rows.data.map((row) => RetentionDeletionSchema.parse({ ruleKey: row.rule_key, entityType: row.entity_type, entityCount: row.entity_count, cutoffDate: row.cutoff_date })),
    )
  })

  // Kein Hatchet-Cron dafuer (Paket 004 "in Arbeit", gleiche Luecke wie bei jedem anderen
  // wiederkehrenden Job in diesem Plan) -- der Lauf ist bis dahin manuell ausloesbar, mit
  // Trockenlaufmodus. Storage-Loeschung und Datenbank-Aenderung laufen bewusst NICHT in einer
  // gemeinsamen Transaktion: ein Fehlschlag nach dem Storage-Aufruf wuerde sonst einen bereits
  // geloeschten Datenbestand mit einer zurueckgerollten Datenbankzeile hinterlassen. Storage zuerst,
  // Datenbank danach ist die sicherere Reihenfolge -- ein Fehler zwischen beiden hinterlaesst
  // bestenfalls eine Datenbankzeile, die auf ein bereits geloeschtes Objekt zeigt (beim naechsten
  // Lauf erneut als Kandidat erkannt, kein Datenverlust), nie umgekehrt ein referenziertes Objekt,
  // das schon fehlt.
  // Ein Kalenderjahr statt einer festen Tageszahl (365*Jahre wuerde Schaltjahre systematisch
  // verschieben) -- setUTCFullYear behandelt das korrekt, auch beim 29. Februar in einem
  // Nicht-Schaltjahr-Ziel (JS normalisiert das dann auf den 1. Maerz, dieselbe Semantik wie
  // Postgres' date + interval 'N years', die in diesem Paket bereits an anderer Stelle genutzt wird).
  function cutoffYearsAgo(nowMs: number, years: number): Date {
    const date = new Date(nowMs)
    date.setUTCFullYear(date.getUTCFullYear() - years)
    return date
  }

  app.post('/v1/organizations/:id/retention/run', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = RunRetentionRequestSchema.parse(request.body)
    if (!(await requirePermission(request, reply, 'organization.manage', toPermissionScope(params.id)))) return

    const service = supabaseClients.forService()
    const settingsRow = await loadOrCreateRetentionSettings(service, params.id, request.auth!.userId)
    const settings = settingsRow as { raw_media_days: number; derivative_days: number | null; audit_event_days: number; consent_evidence_years: number; status_event_days: number }
    const now = Date.now()
    // Eigene, lokal erzeugte correlationId statt request.id: Fastify ist mit requestIdHeader
    // konfiguriert, ein Aufrufer kann request.id also per x-correlation-id-Header auf einen
    // beliebigen String setzen (vorbestehende, projektweite Konfiguration) -- correlation_id ist
    // hier eine uuid-Spalte, ein nicht-UUID-Header haette den Datenbank-Insert erst NACH den
    // bereits ausgefuehrten Loeschungen scheitern lassen (adversariale Pruefung).
    const correlationId = randomUUID()
    const results: { ruleKey: string; entityType: string; entityCount: number; cutoffDate: string }[] = []

    const CHUNK_SIZE = 100
    function chunked<T>(values: readonly T[]): T[][] {
      const chunks: T[][] = []
      for (let offset = 0; offset < values.length; offset += CHUNK_SIZE) chunks.push(values.slice(offset, offset + CHUNK_SIZE))
      return chunks
    }

    async function removeStorageObjects(rows: readonly { bucket_id: string; object_path: string }[]): Promise<void> {
      const pathsByBucket = new Map<string, string[]>()
      for (const row of rows) pathsByBucket.set(row.bucket_id, [...(pathsByBucket.get(row.bucket_id) ?? []), row.object_path])
      for (const [bucketId, paths] of pathsByBucket) {
        for (const batch of chunked(paths)) {
          const removed = await service.storage.from(bucketId).remove(batch)
          if (removed.error) throw removed.error
        }
      }
    }

    // Die IDs stehen als Query-String in der URL -- eine unbegrenzte Liste reisst die
    // Header-Grenze des Gateways (dieselbe Grenze wie bei den Profil-Bloecken in GET /members).
    async function deleteByIds(table: string, ids: readonly string[]): Promise<void> {
      for (const batch of chunked(ids)) {
        const deleted = await service.from(table).delete().in('id', batch)
        if (deleted.error) throw deleted.error
      }
    }
    async function updateByIds(table: string, payload: Record<string, unknown>, ids: readonly string[]): Promise<void> {
      for (const batch of chunked(ids)) {
        const updated = await service.from(table).update(payload).in('id', batch)
        if (updated.error) throw updated.error
      }
    }

    // Rohmedien: Storage-Objekt loeschen, Zeile bleibt mit upload_status='deleted' (Metadaten
    // behalten -- Plan, Abschnitt "1. Aufbewahrung durchsetzen").
    const rawMediaCutoff = new Date(now - settings.raw_media_days * 86_400_000)
    const rawMediaCandidates = await service.rpc('select_expired_raw_media', { target_organization_id: params.id, cutoff: rawMediaCutoff.toISOString() })
    if (rawMediaCandidates.error) throw rawMediaCandidates.error
    const rawMediaRows = rawMediaCandidates.data as { media_asset_id: string; bucket_id: string; object_path: string }[]
    if (!input.dryRun && rawMediaRows.length > 0) {
      await removeStorageObjects(rawMediaRows)
      await updateByIds('media_assets', { upload_status: 'deleted' }, rawMediaRows.map((row) => row.media_asset_id))
    }
    results.push({ ruleKey: 'raw_media', entityType: 'media_assets', entityCount: rawMediaRows.length, cutoffDate: rawMediaCutoff.toISOString().slice(0, 10) })

    // Derivate: nur wenn eine Frist gesetzt ist (Default deaktiviert) -- geloescht statt aktualisiert,
    // weil es fuer media_derivatives keinen 'deleted'-Status gibt und der Immutabilitaetstrigger jedes
    // UPDATE auf eine 'ready'-Zeile ohnehin verweigert (Plan, Abschnitt "1. Aufbewahrung durchsetzen").
    if (settings.derivative_days !== null) {
      const derivativeCutoff = new Date(now - settings.derivative_days * 86_400_000)
      const derivativeCandidates = await service.rpc('select_expired_media_derivatives', { target_organization_id: params.id, cutoff: derivativeCutoff.toISOString() })
      if (derivativeCandidates.error) throw derivativeCandidates.error
      const derivativeRows = derivativeCandidates.data as { media_derivative_id: string; bucket_id: string; object_path: string }[]
      if (!input.dryRun && derivativeRows.length > 0) {
        await removeStorageObjects(derivativeRows)
        await deleteByIds('media_derivatives', derivativeRows.map((row) => row.media_derivative_id))
      }
      results.push({ ruleKey: 'media_derivatives', entityType: 'media_derivatives', entityCount: derivativeRows.length, cutoffDate: derivativeCutoff.toISOString().slice(0, 10) })
    }

    // Audit-Events: Einwilligungs-/Elternkontakt-bezogene Ereignisse werden nicht dauerhaft
    // ausgenommen, sondern erst nach der laengeren consent_evidence_years-Frist geloescht (Plan,
    // Tabelle in Abschnitt "1." -- "werden ueber consent_evidence_years gehalten", nicht "nie").
    // Filterung in JS statt per PostgREST-like-Operator, um keine Verwechslung zwischen SQL- und
    // PostgREST-Wildcard-Syntax zu riskieren.
    const auditCutoff = new Date(now - settings.audit_event_days * 86_400_000)
    const auditConsentExceptionCutoff = cutoffYearsAgo(now, settings.consent_evidence_years)
    // fetchAllRows aus demselben Grund wie in GET /members: max_rows haette den Loeschlauf
    // still nach 1000 Zeilen beendet und das Ergebnis trotzdem als erledigt gemeldet.
    const auditCandidates = await fetchAllRows<{ id: string; action: string; created_at: string }>((from, to) =>
      service.from('audit_events').select('id, action, created_at').eq('organization_id', params.id).lt('created_at', auditCutoff.toISOString()).order('id', { ascending: true }).range(from, to),
    )
    const auditIds = auditCandidates
      .filter((row) => {
        const isConsentOrGuardianRelated = row.action.startsWith('consent') || row.action.includes('guardian')
        return !isConsentOrGuardianRelated || new Date(row.created_at).getTime() < auditConsentExceptionCutoff.getTime()
      })
      .map((row) => row.id)
    if (!input.dryRun && auditIds.length > 0) {
      await deleteByIds('audit_events', auditIds)
    }
    results.push({ ruleKey: 'audit_events', entityType: 'audit_events', entityCount: auditIds.length, cutoffDate: auditCutoff.toISOString().slice(0, 10) })

    // Statushistorie (Paket 016): reine Datenbankloeschung, kein Storage-Objekt beteiligt --
    // deshalb kein RPC-Umweg wie bei Rohmedien/Derivaten, sondern direkt Kandidaten laden und
    // loeschen, gleiches Muster wie bei den abgelaufenen Token unten.
    const statusEventCutoff = new Date(now - settings.status_event_days * 86_400_000)
    const statusEventIds = (
      await fetchAllRows<{ id: string }>((from, to) =>
        service.from('post_status_events').select('id').eq('organization_id', params.id).lt('occurred_at', statusEventCutoff.toISOString()).order('id', { ascending: true }).range(from, to),
      )
    ).map((row) => row.id)
    if (!input.dryRun && statusEventIds.length > 0) await deleteByIds('post_status_events', statusEventIds)
    results.push({ ruleKey: 'status_events', entityType: 'post_status_events', entityCount: statusEventIds.length, cutoffDate: statusEventCutoff.toISOString().slice(0, 10) })

    // Einwilligungsnachweise: erst nach consent_evidence_years ab Ende der Gueltigkeit (adversariale
    // Pruefung: bislang stand das nur im Formular, kein Code hat je eine Nachweisdatei geloescht --
    // dieselbe Zusage-ohne-Job-Fehlerklasse wie die urspruengliche Dummy-Zeile, zu deren Beseitigung
    // dieses Paket existiert). Die Zeile selbst bleibt bestehen (Umfang, Unterzeichnungsdatum,
    // Widerruf), nur die Nachweisdatei mit Unterschrift/Kontaktdaten verschwindet.
    const consentEvidenceCutoff = cutoffYearsAgo(now, settings.consent_evidence_years)
    const consentEvidenceCandidates = await service.rpc('select_expired_consent_evidence', { target_organization_id: params.id, cutoff: consentEvidenceCutoff.toISOString() })
    if (consentEvidenceCandidates.error) throw consentEvidenceCandidates.error
    const consentEvidenceRows = consentEvidenceCandidates.data as { consent_record_id: string; bucket_id: string; object_path: string }[]
    if (!input.dryRun && consentEvidenceRows.length > 0) {
      await removeStorageObjects(consentEvidenceRows)
      await updateByIds(
        'consent_records',
        { evidence_path: null, evidence_deleted_at: new Date(now).toISOString() },
        consentEvidenceRows.map((row) => row.consent_record_id),
      )
    }
    results.push({ ruleKey: 'consent_evidence', entityType: 'consent_records', entityCount: consentEvidenceRows.length, cutoffDate: consentEvidenceCutoff.toISOString().slice(0, 10) })

    // Abgelaufene Token: eine bereits angenommene Einladung und eine bereits beantwortete
    // Einwilligungsanfrage bleiben trotz abgelaufenem expires_at bestehen -- expires_at ist bei
    // beiden bei der Erstellung fixiert, nicht bei der Antwort, sonst wuerde diese Regel den
    // Nachweis "wann wurde geantwortet" mit aufraeumen, den sie gar nicht betreffen sollte.
    const nowIso = new Date(now).toISOString()
    let expiredTokenCount = 0
    const invitationIds = (
      await fetchAllRows<{ id: string }>((from, to) =>
        service.from('invitations').select('id').eq('organization_id', params.id).lt('expires_at', nowIso).is('accepted_at', null).order('id', { ascending: true }).range(from, to),
      )
    ).map((row) => row.id)
    expiredTokenCount += invitationIds.length
    if (!input.dryRun && invitationIds.length > 0) await deleteByIds('invitations', invitationIds)

    const consentRequestIds = (
      await fetchAllRows<{ id: string }>((from, to) =>
        service.from('consent_requests').select('id').eq('organization_id', params.id).lt('expires_at', nowIso).in('status', ['sent', 'expired']).order('id', { ascending: true }).range(from, to),
      )
    ).map((row) => row.id)
    expiredTokenCount += consentRequestIds.length
    if (!input.dryRun && consentRequestIds.length > 0) await deleteByIds('consent_requests', consentRequestIds)

    const mediaGrantIds = (
      await fetchAllRows<{ id: string }>((from, to) =>
        service.from('publication_media_grants').select('id').eq('organization_id', params.id).lt('expires_at', nowIso).order('id', { ascending: true }).range(from, to),
      )
    ).map((row) => row.id)
    expiredTokenCount += mediaGrantIds.length
    if (!input.dryRun && mediaGrantIds.length > 0) await deleteByIds('publication_media_grants', mediaGrantIds)

    const idempotencyKeyIds = (
      await fetchAllRows<{ id: string }>((from, to) =>
        service.from('idempotency_keys').select('id').eq('organization_id', params.id).lt('expires_at', nowIso).order('id', { ascending: true }).range(from, to),
      )
    ).map((row) => row.id)
    expiredTokenCount += idempotencyKeyIds.length
    if (!input.dryRun && idempotencyKeyIds.length > 0) await deleteByIds('idempotency_keys', idempotencyKeyIds)

    results.push({ ruleKey: 'expired_tokens', entityType: 'multiple', entityCount: expiredTokenCount, cutoffDate: nowIso.slice(0, 10) })

    // Auskunftsbuendel (GET /v1/data-subjects/:personId/export) sind keiner Tabelle zugeordnet --
    // ohne diese Regel blieben vollstaendige Personendatensaetze (Name, Elternkontakt,
    // Einwilligungen) unbegrenzt im Storage liegen, auch nach einer Loeschung der Person selbst
    // (adversariale Pruefung). Fester, nicht konfigurierbarer Vorlauf von 7 Tagen: der Link ist nur
    // 300 Sekunden gueltig und soll sofort abgeholt werden, die Datei ist ein technisches
    // Zwischenprodukt, keine Aufbewahrungsentscheidung des Vereins. Ueber storage.list() ermittelt,
    // weil kein Tabelleneintrag je Export existiert.
    const staleExportsCutoff = new Date(now - 7 * 86_400_000)
    const exportsPrefix = `organizations/${params.id}/exports`
    const staleExportPaths: string[] = []
    // storage.list unterliegt keinem PostgREST-max_rows, aber demselben Prinzip: ohne Bloetterung
    // ueber offset wuerde ein Bestand jenseits von 1000 Dateien still auf die erste Seite gekappt.
    for (let offset = 0; ; offset += 1000) {
      const exportsPage = await service.storage.from('raw-media').list(exportsPrefix, { limit: 1000, offset })
      if (exportsPage.error) throw exportsPage.error
      const page = exportsPage.data ?? []
      for (const file of page) {
        if (file.created_at !== null && new Date(file.created_at).getTime() < staleExportsCutoff.getTime()) {
          staleExportPaths.push(`${exportsPrefix}/${file.name}`)
        }
      }
      if (page.length < 1000) break
    }
    if (!input.dryRun && staleExportPaths.length > 0) {
      for (const batch of chunked(staleExportPaths)) {
        const removed = await service.storage.from('raw-media').remove(batch)
        if (removed.error) throw removed.error
      }
    }
    results.push({ ruleKey: 'stale_exports', entityType: 'exports', entityCount: staleExportPaths.length, cutoffDate: staleExportsCutoff.toISOString().slice(0, 10) })

    // Auch ein Trockenlauf wird protokolliert (dry_run=true) -- vor dem ersten scharfen Lauf ist er
    // laut Plan obligatorisch, und "wer hat wann geprueft" ist selbst ein pruefbarer Vorgang.
    const logInsert = await service.from('retention_deletions').insert(
      results.map((result) => ({
        organization_id: params.id, entity_type: result.entityType, entity_count: result.entityCount,
        rule_key: result.ruleKey, cutoff_date: result.cutoffDate, dry_run: input.dryRun, correlation_id: correlationId,
      })),
    )
    if (logInsert.error) throw logInsert.error
    if (!input.dryRun) {
      await recordAuditEvent(request, { organizationId: params.id, action: 'retention.enforced', entityType: 'retention_settings', entityId: params.id, metadata: { results } })
    }

    return reply.code(200).send(
      RunRetentionResponseSchema.parse({ organizationId: params.id, dryRun: input.dryRun, correlationId, results }),
    )
  })
}
