import { createTeamMatchStrategy, ExternalTeamSchema, teamDomainAdapter, type ExternalTeam, type TeamDepartmentResolver, type TeamLocal } from '@vereinsfunk/club-schedule'
import { planSync } from '@vereinsfunk/integrations'
import type { FastifyReply } from 'fastify'
import { addUniquePendingConflict, buildPendingConflicts, conflictFingerprint, finishSyncRun, handleAbortedSync, loadIgnoredFingerprints, normalizeStructureName, parseIncomingRows, type SyncDomainContext } from '../integrationSync.js'

export async function handleTeamsSync(ctx: SyncDomainContext): Promise<FastifyReply> {
  const { request, reply, service, organizationId, sourceDepartmentId, sourceId, sourceFieldMapping, sourceLossThresholdPercent, mode, domain, runId, idempotencyKey, rawRows } = ctx

  // Wie bei Personen (Paket 014): Mannschaften ohne Quelle (Duplikatvermeidung gegen von Hand
  // gepflegte Eintraege) plus bereits dieser Quelle zugeordnete Mannschaften. Anders als
  // directory_people (department_id dort "on delete set null", plus eine Umhaenge-Moeglichkeit
  // per PATCH) hat teams.department_id "on delete cascade" (Loeschen der Abteilung loescht das
  // Team mit, es entsteht keine Waise) und keinen Schreibpfad, der department_id nachtraeglich
  // aendert -- der 014-Review-Fund "eigene Quellzeile verschwindet aus dem naechsten existing"
  // wurde deshalb bewusst NICHT auf teams uebertragen; die Ausgangslage, die ihn ausloeste, gibt
  // es hier nicht.
  let existingQuery = service
    .from('teams')
    .select('id, name, department_id, age_group, competition, source_id, external_id, source_updated_at, updated_at')
    .eq('organization_id', organizationId)
    .or(`source_id.is.null,source_id.eq.${sourceId}`)
  if (sourceDepartmentId) existingQuery = existingQuery.eq('department_id', sourceDepartmentId)
  const existingRows = await existingQuery
  if (existingRows.error) throw existingRows.error
  const existingLocals: TeamLocal[] = existingRows.data.map((row) => ({
    id: row.id as string, externalId: row.external_id as string | null, sourceId: row.source_id as string | null,
    name: row.name as string, departmentId: row.department_id as string, ageGroup: row.age_group as string | null,
    competition: row.competition as string | null,
    sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at as string) : null,
    updatedAt: new Date(row.updated_at as string),
  }))

  // Dieselbe Abteilungs-Scope-Einschraenkung wie bei Personen (Fund aus 014): eine
  // abteilungsgebundene Quelle loest Abteilungsnamen nur innerhalb der eigenen Abteilung auf.
  const departmentRows = sourceDepartmentId
    ? await service.from('departments').select('id, name').eq('id', sourceDepartmentId)
    : await service.from('departments').select('id, name').eq('organization_id', organizationId)
  if (departmentRows.error) throw departmentRows.error
  const departmentIdByName = new Map(departmentRows.data.map((row) => [normalizeStructureName(row.name as string), row.id as string]))
  const resolver: TeamDepartmentResolver = { resolveDepartmentId: (name) => departmentIdByName.get(normalizeStructureName(name)) }

  const { incoming, invalidRecords } = parseIncomingRows<ExternalTeam>({
    rawRows, fieldMapping: sourceFieldMapping, normalize: teamDomainAdapter.normalize, schema: ExternalTeamSchema,
    labelOf: (normalized, rowIndex) => (typeof normalized.name === 'string' ? normalized.name : `Zeile ${rowIndex}`),
  })

  const match = createTeamMatchStrategy(resolver)
  const plan = planSync({ existing: existingLocals, incoming, match, policy: { lossThresholdPercent: sourceLossThresholdPercent } })
  if (plan.aborted) {
    return reply.code(200).send(await handleAbortedSync({ service, runId, organizationId, sourceId, domain, mode, idempotencyKey }))
  }

  const ignoredFingerprints = await loadIgnoredFingerprints(service, sourceId)
  const pendingConflicts = buildPendingConflicts({ plan, sourceId, domain, identityOf: teamDomainAdapter.identityOf, invalidRecords, ignoredFingerprints })

  // Ein neu anzulegendes/zu aktualisierendes Team ohne aufloesbare Abteilung UND ohne
  // abteilungsgebundene Quelle haette keinen department_id-Wert -- die Spalte ist not null. Statt
  // eines ungefangenen DB-Fehlers wird das ein Konflikt (dieselbe Vorsicht wie bei Personen ohne
  // Elternkontakt in Paket 014).
  const applicableCreated: ExternalTeam[] = []
  for (const entity of plan.created) {
    const resolvedDepartmentId = (match.fieldsOf(entity) as { departmentId: string | null }).departmentId ?? sourceDepartmentId
    if (!resolvedDepartmentId) {
      addUniquePendingConflict(pendingConflicts, {
        kind: 'invalid_record', label: entity.name, field: 'departmentId', externalId: entity.externalId ?? null, localId: null,
        currentValue: null, incomingValue: 'keine Abteilung zuordenbar',
        fingerprint: conflictFingerprint([sourceId, domain, 'invalid_record', 'departmentId', entity.externalId ?? entity.name]),
      })
      continue
    }
    applicableCreated.push(entity)
  }

  const appliedUpdatedCount = plan.updated.length
  if (mode === 'apply') {
    if (applicableCreated.length > 0) {
      const insertRows = applicableCreated.map((entity) => {
        const resolved = match.fieldsOf(entity) as { departmentId: string | null }
        return {
          organization_id: organizationId, department_id: resolved.departmentId ?? sourceDepartmentId, name: entity.name,
          age_group: entity.ageGroup ?? null, competition: entity.competition ?? null,
          source_id: sourceId, external_id: entity.externalId ?? null, source_updated_at: entity.sourceUpdatedAt ?? null,
        }
      })
      const insert = await service.from('teams').insert(insertRows)
      if (insert.error) throw insert.error
    }
    for (const update of plan.updated) {
      const resolved = match.fieldsOf(update.external) as { departmentId: string | null }
      const result = await service
        .from('teams')
        .update({
          name: update.external.name, department_id: resolved.departmentId ?? update.local.departmentId,
          age_group: update.external.ageGroup ?? update.local.ageGroup, competition: update.external.competition ?? update.local.competition,
          source_updated_at: update.external.sourceUpdatedAt ?? update.local.sourceUpdatedAt?.toISOString() ?? null,
        })
        .eq('id', update.local.id)
      if (result.error) throw result.error
    }
    for (const retired of plan.retired) {
      const result = await service.from('teams').update({ archived_at: new Date().toISOString() }).eq('id', retired.id).is('archived_at', null)
      if (result.error) throw result.error
    }
  }

  return reply.code(200).send(await finishSyncRun({
    service, request, runId, organizationId, sourceId, domain, mode, idempotencyKey,
    createdCount: applicableCreated.length, updatedCount: appliedUpdatedCount, retiredCount: plan.retired.length,
    skippedCount: plan.skipped.length, pendingConflicts,
  }))
}

