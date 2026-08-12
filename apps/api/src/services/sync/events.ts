import { clubEventDomainAdapter, createClubEventMatchStrategy, ExternalClubEventSchema, type ClubEventLocal, type ExternalClubEvent } from '@vereinsfunk/club-schedule'
import { planSync } from '@vereinsfunk/integrations'
import type { FastifyReply } from 'fastify'
import { addUniquePendingConflict, buildPendingConflicts, conflictFingerprint, finishSyncRun, handleAbortedSync, loadIgnoredFingerprints, parseIncomingRows, resolveScheduleDateTime, type SyncDomainContext } from '../integrationSync.js'

export async function handleEventsSync(ctx: SyncDomainContext): Promise<FastifyReply> {
  const { request, reply, service, organizationId, sourceDepartmentId, sourceId, sourceFieldMapping, sourceLossThresholdPercent, mode, domain, runId, idempotencyKey, rawRows, organizationTimezone } = ctx

  let existingQuery = service
    .from('club_events')
    .select('id, external_id, recurrence_key, source_id, title, description, category, starts_at, ends_at, all_day, location_name, location_address, registration_url, status, source_updated_at, updated_at')
    .eq('organization_id', organizationId)
    .or(`source_id.is.null,source_id.eq.${sourceId}`)
  if (sourceDepartmentId) existingQuery = existingQuery.eq('department_id', sourceDepartmentId)
  else existingQuery = existingQuery.is('department_id', null)
  const existingRows = await existingQuery
  if (existingRows.error) throw existingRows.error
  const existingLocals: ClubEventLocal[] = existingRows.data.map((row) => ({
    id: row.id as string, externalId: row.external_id as string | null, recurrenceKey: row.recurrence_key as string | null,
    sourceId: row.source_id as string | null,
    title: row.title as string, description: row.description as string | null, category: row.category as string,
    startsAt: new Date(row.starts_at as string), endsAt: row.ends_at ? new Date(row.ends_at as string) : null,
    allDay: row.all_day as boolean, locationName: row.location_name as string | null, locationAddress: row.location_address as string | null,
    registrationUrl: row.registration_url as string | null, status: row.status as string,
    sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at as string) : null,
    updatedAt: new Date(row.updated_at as string),
  }))

  const { incoming, invalidRecords } = parseIncomingRows<ExternalClubEvent>({
    rawRows, fieldMapping: sourceFieldMapping, normalize: clubEventDomainAdapter.normalize, schema: ExternalClubEventSchema,
    labelOf: (normalized, rowIndex) => (typeof normalized.title === 'string' ? normalized.title : `Zeile ${rowIndex}`),
  })

  const plan = planSync({ existing: existingLocals, incoming, match: createClubEventMatchStrategy(), policy: { lossThresholdPercent: sourceLossThresholdPercent } })
  if (plan.aborted) {
    return reply.code(200).send(await handleAbortedSync({ service, runId, organizationId, sourceId, domain, mode, idempotencyKey }))
  }

  const ignoredFingerprints = await loadIgnoredFingerprints(service, sourceId)
  const pendingConflicts = buildPendingConflicts({ plan, sourceId, domain, identityOf: clubEventDomainAdapter.identityOf, invalidRecords, ignoredFingerprints })

  // Eine Veranstaltung ohne aufloesbaren Start-Zeitpunkt (kaputtes Datumsformat) wuerde an der
  // not-null-Spalte starts_at scheitern -- als Konflikt behandeln statt ungefangen zu werfen.
  const applicableCreated: { entity: ExternalClubEvent; startsAt: string; startsAtConfirmed: boolean }[] = []
  for (const entity of plan.created) {
    const resolved = resolveScheduleDateTime(entity.startsAt, entity.startsAtTzid, organizationTimezone)
    if (!resolved) {
      addUniquePendingConflict(pendingConflicts, {
        kind: 'invalid_record', label: entity.title, field: 'startsAt', externalId: entity.externalId ?? null, localId: null,
        currentValue: null, incomingValue: entity.startsAt,
        fingerprint: conflictFingerprint([sourceId, domain, 'invalid_record', 'startsAt', entity.externalId ?? entity.title]),
      })
      continue
    }
    applicableCreated.push({ entity, startsAt: resolved.iso, startsAtConfirmed: resolved.confirmed })
  }

  // Wie beim Anlegen (oben): ein nicht aufloesbares Datum wird schon hier, VOR dem apply-Zweig,
  // ein invalid_record-Konflikt. Vorher stand diese Pruefung innerhalb von if (mode === 'apply'),
  // die Vorschau meldete die Zeile deshalb faelschlich als aktualisierbar, und derselbe Lauf im
  // apply-Modus widersprach seiner eigenen Vorschau mit einem Konflikt.
  let appliedUpdatedCount = plan.updated.length
  const applicableUpdated: { update: (typeof plan.updated)[number]; startsAt: { iso: string; confirmed: boolean } | undefined; endsAt: { iso: string; confirmed: boolean } | undefined }[] = []
  for (const update of plan.updated) {
    let unresolvedDateField: 'startsAt' | 'endsAt' | undefined
    let startsAt: { iso: string; confirmed: boolean } | undefined
    let endsAt: { iso: string; confirmed: boolean } | undefined
    if (update.external.startsAt !== undefined) {
      const resolved = resolveScheduleDateTime(update.external.startsAt, update.external.startsAtTzid, organizationTimezone)
      if (resolved) startsAt = resolved
      else unresolvedDateField = 'startsAt'
    }
    if (!unresolvedDateField && update.external.endsAt !== undefined) {
      const resolved = resolveScheduleDateTime(update.external.endsAt, update.external.endsAtTzid, organizationTimezone)
      if (resolved) endsAt = resolved
      else unresolvedDateField = 'endsAt'
    }
    if (unresolvedDateField) {
      const incomingValue = unresolvedDateField === 'startsAt' ? update.external.startsAt : update.external.endsAt
      addUniquePendingConflict(pendingConflicts, {
        kind: 'invalid_record', label: update.local.title, field: unresolvedDateField,
        externalId: update.external.externalId ?? null, localId: update.local.id, currentValue: null,
        incomingValue: incomingValue ?? null,
        fingerprint: conflictFingerprint([sourceId, domain, 'invalid_record', unresolvedDateField, update.external.externalId ?? update.local.id]),
      })
      appliedUpdatedCount -= 1
      continue
    }
    applicableUpdated.push({ update, startsAt, endsAt })
  }

  if (mode === 'apply') {
    if (applicableCreated.length > 0) {
      const insertRows = applicableCreated.map(({ entity, startsAt }) => {
        const end = entity.endsAt ? resolveScheduleDateTime(entity.endsAt, entity.endsAtTzid, organizationTimezone) : undefined
        return {
          organization_id: organizationId, department_id: sourceDepartmentId,
          title: entity.title, description: entity.description ?? null, category: entity.category ?? 'other',
          starts_at: startsAt, ends_at: end?.iso ?? null, all_day: entity.allDay ?? false,
          location_name: entity.locationName ?? null, location_address: entity.locationAddress ?? null,
          registration_url: entity.registrationUrl ?? null, status: entity.status ?? 'scheduled',
          source_id: sourceId, external_id: entity.externalId ?? null, recurrence_key: entity.recurrenceKey ?? null,
          source_updated_at: entity.sourceUpdatedAt ?? null,
        }
      })
      const insert = await service.from('club_events').insert(insertRows)
      if (insert.error) throw insert.error
    }
    for (const { update, startsAt, endsAt } of applicableUpdated) {
      const patch: Record<string, unknown> = {
        source_updated_at: update.external.sourceUpdatedAt ?? update.local.sourceUpdatedAt?.toISOString() ?? null,
      }
      if (update.external.title !== undefined) patch.title = update.external.title
      if (update.external.description !== undefined) patch.description = update.external.description
      if (update.external.category !== undefined) patch.category = update.external.category
      if (startsAt) patch.starts_at = startsAt.iso
      if (endsAt) patch.ends_at = endsAt.iso
      if (update.external.allDay !== undefined) patch.all_day = update.external.allDay
      if (update.external.locationName !== undefined) patch.location_name = update.external.locationName
      if (update.external.locationAddress !== undefined) patch.location_address = update.external.locationAddress
      if (update.external.registrationUrl !== undefined) patch.registration_url = update.external.registrationUrl
      if (update.external.status !== undefined) patch.status = update.external.status
      const result = await service.from('club_events').update(patch).eq('id', update.local.id)
      if (result.error) throw result.error
    }
    for (const retired of plan.retired) {
      const result = await service.from('club_events').update({ status: 'cancelled' }).eq('id', retired.id)
      if (result.error) throw result.error
    }
  }

  return reply.code(200).send(await finishSyncRun({
    service, request, runId, organizationId, sourceId, domain, mode, idempotencyKey,
    createdCount: applicableCreated.length, updatedCount: appliedUpdatedCount, retiredCount: plan.retired.length,
    skippedCount: plan.skipped.length, pendingConflicts,
  }))
}

