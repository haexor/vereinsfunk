import {
  CreateIntegrationSourceRequestSchema,
  IntegrationDomainSchema,
  ResolveSyncConflictRequestSchema,
  SyncIdempotencyKeySchema,
  SyncModeSchema,
  UpdateIntegrationSourceRequestSchema,
  UuidSchema,
  type FieldMapping,
  type IntegrationDomain,
  type SyncMode,
} from '@vereinsfunk/contracts'
import { hasPermission } from '@vereinsfunk/authorization'
import { FileSourceTransport, IcalSourceTransport } from '@vereinsfunk/integrations'
import { fetchPublicUrl, isAllowedOutboundUrl, OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  INTEGRATION_SOURCE_COLUMNS,
  mapIntegrationSourceRow,
  mapSyncConflictRow,
  mapSyncRunRow,
  SYNC_CONFLICT_COLUMNS,
  SYNC_RUN_COLUMNS,
} from '../apiMappers.js'
import { collectRows, failSyncRun, loadSyncSourceResponse, type SyncDomainContext } from '../services/integrationSync.js'
import { handleEventsSync } from '../services/sync/events.js'
import { handleFixturesSync } from '../services/sync/fixtures.js'
import { handlePeopleSync } from '../services/sync/people.js'
import { handleTeamsSync } from '../services/sync/teams.js'
import type { ApiRouteContext } from './context.js'
import { createAuditRecorder, resolveDirectoryScope, toPermissionScope } from './shared.js'

export function registerIntegrationRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, roleProvider } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  app.get('/v1/organizations/:id/integration-sources', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rows = await client.from('integration_sources').select(INTEGRATION_SOURCE_COLUMNS).eq('organization_id', params.id).order('created_at')
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map(mapIntegrationSourceRow))
  })

  app.post('/v1/organizations/:id/integration-sources', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = CreateIntegrationSourceRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const scope = await resolveDirectoryScope(client, params.id, input.departmentId ?? null, null)
    if (scope === null) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'integration.manage', scope))) return
    // Zieladresse schon hier pruefen, damit ein unzulaessiger Wert gar nicht erst gespeichert wird
    // (siehe @vereinsfunk/outbound-fetch); der Sync-Lauf prueft zur Laufzeit erneut, weil ein Name
    // spaeter auf eine andere Adresse zeigen kann.
    if (input.endpointUrl !== undefined && !isAllowedOutboundUrl(input.endpointUrl)) {
      return reply.code(400).send({ error: 'endpoint_not_allowed', correlationId: request.id })
    }
    const insert = await supabaseClients
      .forService()
      .from('integration_sources')
      .insert({
        organization_id: params.id,
        transport: input.transport,
        provider_key: input.providerKey,
        display_name: input.displayName,
        enabled_domains: input.enabledDomains,
        department_id: input.departmentId ?? null,
        endpoint_url: input.endpointUrl ?? null,
        field_mapping: input.fieldMapping ?? {},
        loss_threshold_percent: input.lossThresholdPercent ?? 30,
        created_by: request.auth!.userId,
      })
      .select(INTEGRATION_SOURCE_COLUMNS)
      .single()
    if (insert.error) {
      if (insert.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw insert.error
    }
    await recordAuditEvent(request, {
      organizationId: params.id, action: 'integration_source.created', entityType: 'integration_sources', entityId: insert.data.id as string,
      metadata: { transport: input.transport, providerKey: input.providerKey, departmentId: input.departmentId ?? null },
    })
    return reply.code(201).send(mapIntegrationSourceRow(insert.data))
  })

  app.patch('/v1/integration-sources/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateIntegrationSourceRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('integration_sources').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, existing.data.department_id as string | null)
    if (!(await requirePermission(request, reply, 'integration.manage', scope))) return
    if (input.endpointUrl !== undefined && !isAllowedOutboundUrl(input.endpointUrl)) {
      return reply.code(400).send({ error: 'endpoint_not_allowed', correlationId: request.id })
    }
    const update: Record<string, unknown> = {}
    if (input.displayName !== undefined) update.display_name = input.displayName
    if (input.enabledDomains !== undefined) update.enabled_domains = input.enabledDomains
    if (input.endpointUrl !== undefined) update.endpoint_url = input.endpointUrl
    if (input.fieldMapping !== undefined) update.field_mapping = input.fieldMapping
    if (input.lossThresholdPercent !== undefined) update.loss_threshold_percent = input.lossThresholdPercent
    if (input.enabled !== undefined) update.enabled = input.enabled
    const result = await supabaseClients.forService().from('integration_sources').update(update).eq('id', params.id).select(INTEGRATION_SOURCE_COLUMNS).single()
    if (result.error) {
      if (result.error.code === '23514') return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      throw result.error
    }
    await recordAuditEvent(request, { organizationId: scope.organizationId, action: 'integration_source.updated', entityType: 'integration_sources', entityId: params.id, metadata: update })
    return reply.code(200).send(mapIntegrationSourceRow(result.data))
  })

  app.get('/v1/integration-sources/:id/sync-runs', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rows = await client.from('integration_sync_runs').select(SYNC_RUN_COLUMNS).eq('source_id', params.id).order('started_at', { ascending: false }).limit(50)
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map(mapSyncRunRow))
  })

  app.get('/v1/integration-sources/:id/conflicts', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const query = z.object({ resolution: z.enum(['pending', 'keep_current', 'take_incoming', 'ignore_permanently']).optional() }).parse(request.query)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    let builder = client.from('integration_sync_conflicts').select(SYNC_CONFLICT_COLUMNS).eq('source_id', params.id)
    if (query.resolution) builder = builder.eq('resolution', query.resolution)
    const rows = await builder.order('created_at', { ascending: false }).limit(200)
    if (rows.error) throw rows.error
    return reply.code(200).send(rows.data.map(mapSyncConflictRow))
  })

  app.patch('/v1/integration-sync-conflicts/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = ResolveSyncConflictRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const existing = await client.from('integration_sync_conflicts').select('organization_id, source_id').eq('id', params.id).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const source = await client.from('integration_sources').select('department_id').eq('id', existing.data.source_id).maybeSingle()
    if (source.error) throw source.error
    if (!source.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(existing.data.organization_id as string, source.data.department_id as string | null)
    if (!(await requirePermission(request, reply, 'integration.manage', scope))) return
    // Setzt nur die Entscheidung -- ignore_permanently unterdrueckt denselben Fingerabdruck ab dem
    // naechsten Lauf (der eigentliche Zweck), keep_current/take_incoming veraendern hier noch keine
    // directory_people-Zeile. Eine tatsaechliche Uebernahme von take_incoming braucht mehr Kontext,
    // als eine einzelne Konfliktzeile traegt (siehe plans/014, "Risiken und offene Entscheidungen");
    // der Weg heute ist: Quelle/Zuordnung korrigieren und erneut synchronisieren, oder die Person
    // manuell bearbeiten.
    const update = await supabaseClients
      .forService()
      .from('integration_sync_conflicts')
      .update({ resolution: input.resolution, resolved_by: request.auth!.userId, resolved_at: new Date().toISOString() })
      .eq('id', params.id)
      .select(SYNC_CONFLICT_COLUMNS)
      .single()
    if (update.error) {
      // 23505: derselbe Fingerabdruck dieser Quelle ist bereits dauerhaft ignoriert
      // (integration_sync_conflicts_ignored_unique). Der Teilindex greift nur fuer bereits
      // ignorierte Zeilen, zwei Laeufe koennen denselben Fingerabdruck also je einmal als
      // 'pending' anlegen -- die zweite Aufloesung laeuft dann in den Unique-Verstoss. Fachlich
      // ist das Ziel bereits erreicht, deshalb 409 statt 500.
      if (update.error.code === '23505') return reply.code(409).send({ error: 'fingerprint_already_ignored', correlationId: request.id })
      throw update.error
    }
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'integration_sync_conflict.resolved', entityType: 'integration_sync_conflicts', entityId: params.id, metadata: { resolution: input.resolution },
    })
    return reply.code(200).send(mapSyncConflictRow(update.data))
  })

  // Recovery ist bewusst explizit statt eines stillen Leases: Nur wer den abgestuerzten Prozess
  // operativ geprueft hat, darf seinen laufenden Slot beenden. Der Abschluss ist auditiert; ein
  // nachfolgender Lauf sieht deshalb immer den vorherigen Status, nie eine ueberschriebene Zeile.
  app.post('/v1/integration-sources/:id/sync-runs/:runId/cancel', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema, runId: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const source = await client.from('integration_sources').select('organization_id, department_id').eq('id', params.id).maybeSingle()
    if (source.error) throw source.error
    if (!source.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const scope = toPermissionScope(source.data.organization_id as string, source.data.department_id as string | null)
    if (!(await requirePermission(request, reply, 'integration.manage', scope))) return

    const service = supabaseClients.forService()
    const existing = await service
      .from('integration_sync_runs')
      .select('id, status')
      .eq('id', params.runId)
      .eq('source_id', params.id)
      .eq('organization_id', scope.organizationId)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (existing.data.status !== 'running') return reply.code(409).send({ error: 'sync_not_running', correlationId: request.id })

    const cancelled = await service
      .from('integration_sync_runs')
      .update({ status: 'cancelled', error_class: 'cancelled_by_operator', finished_at: new Date().toISOString() })
      .eq('id', params.runId)
      .eq('status', 'running')
      .select(SYNC_RUN_COLUMNS)
      .maybeSingle()
    if (cancelled.error) throw cancelled.error
    if (!cancelled.data) return reply.code(409).send({ error: 'sync_not_running', correlationId: request.id })
    const sourceUpdate = await service.from('integration_sources').update({ last_sync_at: new Date().toISOString(), last_sync_status: 'cancelled' }).eq('id', params.id)
    if (sourceUpdate.error) throw sourceUpdate.error
    await recordAuditEvent(request, {
      organizationId: scope.organizationId, action: 'integration_source.sync_cancelled', entityType: 'integration_sync_runs', entityId: params.runId,
      metadata: { recovery: 'manual_confirmed_process_failure' },
    })
    return reply.code(200).send(mapSyncRunRow(cancelled.data))
  })

  app.post('/v1/integration-sources/:id/sync', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const source = await client
      .from('integration_sources')
      .select('organization_id, department_id, transport, endpoint_url, enabled_domains, field_mapping, loss_threshold_percent, enabled')
      .eq('id', params.id)
      .maybeSingle()
    if (source.error) throw source.error
    if (!source.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const organizationId = source.data.organization_id as string
    const sourceDepartmentId = source.data.department_id as string | null
    const sourceTransport = source.data.transport as string
    const sourceEndpointUrl = source.data.endpoint_url as string | null
    const sourceEnabledDomains = source.data.enabled_domains as string[]
    const sourceFieldMapping = source.data.field_mapping as FieldMapping
    const sourceLossThresholdPercent = source.data.loss_threshold_percent as number
    const scope = toPermissionScope(organizationId, sourceDepartmentId)
    if (!(await requirePermission(request, reply, 'integration.manage', scope))) return
    if (!source.data.enabled) return reply.code(409).send({ error: 'source_disabled', correlationId: request.id })
    // integration.manage und department.manage sind heute deckungsgleich (department_admin und
    // Organisationsrollen haben beide), aber nur zufaellig -- ohne diese eigene Pruefung koennte
    // eine kuenftige, engere Rolle mit nur integration.manage ueber einen Sync-Lauf Elternkontakte
    // schreiben, obwohl das Rechtekonzept dafuer ausdruecklich department.manage verlangt (beim
    // adversarialen Review als Haertungsluecke benannt). Import-Zeilen ohne Elternkontaktfelder
    // sind davon nicht betroffen.
    const canWriteGuardianContact = hasPermission(await roleProvider.rolesForScope(request.auth!, scope), 'department.manage')

    let mode: SyncMode
    let domain: IntegrationDomain
    let filePart: Awaited<ReturnType<typeof request.file>> | undefined

    if (sourceTransport === 'file') {
      if (!request.isMultipart()) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      try {
        filePart = await request.file()
        if (!filePart) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
        // `filePart.fields` is populated as busboy parses the multipart stream, so a field
        // declared after the file part is only present once the file's stream -- drained here
        // via toBuffer() -- has fully flushed (same pattern as the brand-logo upload).
        await filePart.toBuffer()
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
        }
        return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      }
      const modeField = filePart.fields.mode
      const domainField = filePart.fields.domain
      const modeParsed = SyncModeSchema.safeParse(modeField && 'value' in modeField ? modeField.value : undefined)
      const domainParsed = IntegrationDomainSchema.safeParse(domainField && 'value' in domainField ? domainField.value : undefined)
      if (!modeParsed.success || !domainParsed.success) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      mode = modeParsed.data
      domain = domainParsed.data
    } else if (sourceTransport === 'ical') {
      const body = z.object({ mode: SyncModeSchema, domain: IntegrationDomainSchema }).safeParse(request.body)
      if (!body.success) return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
      mode = body.data.mode
      domain = body.data.domain
      if (!sourceEndpointUrl) return reply.code(409).send({ error: 'source_missing_endpoint', correlationId: request.id })
    } else {
      // http/webhook: kein Adapter in diesem Paket (plans/014, "Entscheidungen vor der Umsetzung").
      return reply.code(400).send({ error: 'transport_not_implemented', correlationId: request.id })
    }

    if (!sourceEnabledDomains.includes(domain)) {
      return reply.code(400).send({ error: 'domain_not_enabled', correlationId: request.id })
    }

    const service = supabaseClients.forService()
    const correlationId = randomUUID()

    const headerIdempotencyKey = request.headers['idempotency-key']
    if (Array.isArray(headerIdempotencyKey)) {
      return reply.code(400).send({ error: 'invalid_idempotency_key', correlationId: request.id })
    }
    const parsedIdempotencyKey = SyncIdempotencyKeySchema.safeParse(
      typeof headerIdempotencyKey === 'string' ? headerIdempotencyKey : randomUUID(),
    )
    if (!parsedIdempotencyKey.success) return reply.code(400).send({ error: 'invalid_idempotency_key', correlationId: request.id })
    const idempotencyKey = parsedIdempotencyKey.data

    // Der fachliche Bereich braucht dieselbe explizite Berechtigung wie der spätere Schreibpfad.
    // Diese Prüfung liegt vor dem atomaren Guard, damit ein abgewiesener Request keinen Lauf belegt.
    if (domain === 'teams' || domain === 'fixtures' || domain === 'events') {
      const domainPermission = domain === 'teams' ? 'team.manage' : domain === 'fixtures' ? 'fixture.manage' : 'event.manage'
      if (!(await requirePermission(request, reply, domainPermission, scope))) return
      if (domain === 'fixtures' && !sourceDepartmentId) {
        return reply.code(409).send({ error: 'source_missing_department', correlationId: request.id })
      }
    }

    // Atomar vor jedem iCal-Abruf und jeder fachlichen Leseabfrage: dieselbe RPC muss der
    // künftige Hatchet-Cron benutzen. Dry-Runs sind bewusst parallel, Apply-Läufe nicht.
    const acquired = await service.rpc('acquire_integration_sync_run', {
      target_organization_id: organizationId,
      target_source_id: params.id,
      target_domain: domain,
      target_mode: mode,
      target_request_idempotency_key: idempotencyKey,
      target_correlation_id: correlationId,
      target_triggered_by: request.auth!.userId,
    })
    if (acquired.error) throw acquired.error
    const guard = acquired.data?.[0] as { result: 'acquired' | 'replay' | 'already_running'; run_id: string } | undefined
    if (!guard) throw new Error('sync run guard returned no result')
    if (guard.result === 'replay') return reply.code(200).send(await loadSyncSourceResponse({ service, runId: guard.run_id, idempotencyKey }))
    if (guard.result === 'already_running') {
      return reply.code(409).send({ error: 'sync_already_running', correlationId: request.id, idempotencyKey })
    }
    const runId = guard.run_id

    try {
      let rawRows: Readonly<Record<string, unknown>>[]
      if (filePart) {
        let buffer: Buffer
        try {
          buffer = await filePart.toBuffer()
        } catch (error) {
          await failSyncRun({ service, runId, sourceId: params.id, error })
          if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
            return reply.code(413).send({ error: 'file_too_large', correlationId: request.id })
          }
          return reply.code(400).send({ error: 'invalid_request', correlationId: request.id })
        }
        const isXlsx = /\.xlsx?$/i.test(filePart.filename ?? '')
        try {
          rawRows = await collectRows(new FileSourceTransport({ key: params.id, format: isXlsx ? 'xlsx' : 'csv', buffer }))
        } catch (error) {
          request.log.warn({ err: error, correlationId: request.id }, 'file transport parse failed')
          await failSyncRun({ service, runId, sourceId: params.id, error })
          return reply.code(400).send({ error: 'invalid_file', correlationId: request.id })
        }
      } else {
        try {
          const text = await fetchPublicUrl(sourceEndpointUrl!)
          if (!text.includes('BEGIN:VCALENDAR')) throw new Error('response is not an iCal feed')
          rawRows = await collectRows(new IcalSourceTransport({ key: params.id, text }))
        } catch (error) {
          request.log.warn({ err: error, correlationId: request.id }, 'ical fetch failed')
          await failSyncRun({ service, runId, sourceId: params.id, error })
          if (error instanceof OutboundFetchError && error.reason === 'blocked_url') {
            return reply.code(400).send({ error: 'endpoint_not_allowed', correlationId: request.id })
          }
          return reply.code(502).send({ error: 'source_fetch_failed', correlationId: request.id })
        }
      }

      const baseContext = {
        request, reply, service, organizationId, sourceDepartmentId, sourceId: params.id,
        sourceFieldMapping, sourceLossThresholdPercent, mode, domain, correlationId, runId, idempotencyKey, rawRows,
      }
      // await ist hier Pflicht, nicht Stil: "return handleTeamsSync(...)" ohne await verlaesst den
      // umgebenden try-Block sofort und die spaetere Ablehnung liefe am catch (failSyncRun) vorbei --
      // der Lauf bliebe fuer immer auf 'running' stehen und blockierte jeden weiteren Apply-Lauf.
      //
      // Personen zuerst: nur die drei terminbehafteten Bereiche brauchen die Vereinszeitzone,
      // deshalb steht deren Abruf hinter dieser Verzweigung (unveraendert gegenueber vorher).
      if (domain === 'people') return await handlePeopleSync({ ...baseContext, canWriteGuardianContact })
      const organizationRow = await service.from('organizations').select('timezone').eq('id', organizationId).single()
      if (organizationRow.error) throw organizationRow.error
      const syncContext: SyncDomainContext = { ...baseContext, organizationTimezone: organizationRow.data.timezone as string }
      if (domain === 'teams') return await handleTeamsSync(syncContext)
      if (domain === 'fixtures') return await handleFixturesSync(syncContext)
      return await handleEventsSync(syncContext)
    } catch (error) {
      await failSyncRun({ service, runId, sourceId: params.id, error })
      throw error
    }
  })
}
