import { createPeopleMatchStrategy, deriveIsMinor, peopleDomainAdapter, PersonExternalSchema, type DepartmentResolver, type DirectoryPersonLocal, type PersonExternal } from '@vereinsfunk/member-directory'
import { planSync } from '@vereinsfunk/integrations'
import type { FastifyReply } from 'fastify'
import { addUniquePendingConflict, buildPendingConflicts, conflictFingerprint, finishSyncRun, handleAbortedSync, loadIgnoredFingerprints, normalizeStructureName, parseIncomingRows, type SyncDomainContext } from '../integrationSync.js'
import { resolvePersonScope } from '../integrationSync.js'

// Personen (Paket 014) -- dieselbe Form wie die drei Domaenen oben. Bis zur Zerlegung stand dieser
// Ablauf direkt im Routen-Handler und trug eine eigene, wortgleiche Kopie von
// loadIgnoredFingerprints/buildPendingConflicts; die Vereinheitlichung ist der eigentliche Grund,
// warum es diese Datei gibt.
// Ohne organizationTimezone: Personen tragen keinen Zeitpunkt, den eine Quelle in der
// Vereinszeitzone aufloesen muesste (anders als Spiele/Veranstaltungen). Der Aufrufer spart sich
// dadurch denselben Abruf, den er vor der Zerlegung ebenfalls nur fuer die drei anderen Bereiche
// gemacht hat.
export interface PeopleSyncContext extends Omit<SyncDomainContext, 'organizationTimezone'> {
  // integration.manage und department.manage sind heute deckungsgleich, aber nur zufaellig -- ohne
  // diese Unterscheidung koennte eine kuenftige, engere Rolle mit nur integration.manage ueber
  // einen Sync-Lauf Elternkontakte schreiben, obwohl das Rechtekonzept dafuer ausdruecklich
  // department.manage verlangt (beim adversarialen Review als Haertungsluecke benannt).
  canWriteGuardianContact: boolean
}

export async function handlePeopleSync(ctx: PeopleSyncContext): Promise<FastifyReply> {
  const { request, reply, service, organizationId, sourceDepartmentId, sourceId, sourceFieldMapping, sourceLossThresholdPercent, mode, domain, runId, idempotencyKey, rawRows, canWriteGuardianContact } = ctx
  const referenceYear = new Date().getFullYear()

  // Zustaendigkeitsbereich dieser Quelle: Personen ohne Quelle (fuer den unscharfen Abgleich
  // gegen von Hand gepflegte Eintraege) plus Personen, die bereits DIESER Quelle zugeordnet sind.
  // Personen einer anderen Quelle bleiben aussen vor, damit ein Lauf nicht die Zustaendigkeit
  // einer fremden Quelle stilllegt.
  // Die Abteilungsgrenze einer abteilungsgebundenen Quelle gilt nur fuer FREMDE Datensaetze
  // (source_id null, reiner Abgleichskandidat). Eigene Datensaetze gehoeren immer dazu, egal wo
  // sie inzwischen liegen: eine geloeschte Abteilung setzt department_id auf null, und eine
  // manuelle Umhaengung verschiebt die Person -- in beiden Faellen faende der naechste Lauf sie
  // sonst nicht mehr, legte sie erneut an und liefe in den Unique-Index auf
  // (organization_id, source_id, external_id).
  const existingRows = await service
    .from('directory_people')
    .select('id, first_name, last_name, birth_year, department_id, team_id, status, source_id, external_id, source_updated_at, updated_at')
    .eq('organization_id', organizationId)
    .or(sourceDepartmentId ? `and(source_id.is.null,department_id.eq.${sourceDepartmentId}),source_id.eq.${sourceId}` : `source_id.is.null,source_id.eq.${sourceId}`)
  if (existingRows.error) throw existingRows.error
  const existingLocals: DirectoryPersonLocal[] = existingRows.data.map((row) => ({
    id: row.id as string,
    externalId: row.external_id as string | null,
    sourceId: row.source_id as string | null,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    birthYear: row.birth_year as number | null,
    departmentId: row.department_id as string | null,
    teamId: row.team_id as string | null,
    status: row.status as DirectoryPersonLocal['status'],
    sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at as string) : null,
    updatedAt: new Date(row.updated_at as string),
  }))

  // Eine abteilungsgebundene Quelle darf ausschliesslich in ihre eigene Abteilung schreiben --
  // sonst koennte eine Spalte der Importdatei (z. B. "Handball" in einer Fussball-Quelle) eine
  // Person in eine Abteilung verschieben, in der der verwaltende department_admin gar kein
  // integration.manage/directory.read hat (beim adversarialen Review gefunden). Der
  // Abteilungsname aus der Datei zaehlt bei einer abteilungsgebundenen Quelle deshalb nur noch
  // als Bestaetigung/Mannschaftshinweis, nie als Ziel fuer eine ANDERE Abteilung; jeder
  // abweichende Name wird zur unknown_structure-Konfliktzeile statt stillschweigend uebernommen
  // zu werden.
  const [departmentRows, teamRows] = await Promise.all([
    sourceDepartmentId
      ? service.from('departments').select('id, name').eq('id', sourceDepartmentId)
      : service.from('departments').select('id, name').eq('organization_id', organizationId),
    sourceDepartmentId
      ? service.from('teams').select('id, name, department_id').eq('department_id', sourceDepartmentId)
      : service.from('teams').select('id, name, department_id').eq('organization_id', organizationId),
  ])
  if (departmentRows.error) throw departmentRows.error
  if (teamRows.error) throw teamRows.error
  const departmentIdByName = new Map(departmentRows.data.map((row) => [normalizeStructureName(row.name as string), row.id as string]))
  const teamIdByName = new Map(teamRows.data.map((row) => [`${row.department_id}:${normalizeStructureName(row.name as string)}`, row.id as string]))
  const resolver: DepartmentResolver = {
    resolveDepartmentId: (name) => departmentIdByName.get(normalizeStructureName(name)),
    resolveTeamId: (departmentId, name) => teamIdByName.get(`${departmentId}:${normalizeStructureName(name)}`),
  }

  const parsedRows = parseIncomingRows<PersonExternal>({
    rawRows, fieldMapping: sourceFieldMapping, normalize: peopleDomainAdapter.normalize, schema: PersonExternalSchema,
    labelOf: (normalized, rowIndex) =>
      [normalized.firstName, normalized.lastName].filter((value) => typeof value === 'string').join(' ').trim() || `Zeile ${rowIndex}`,
  })
  const invalidRecords = parsedRows.invalidRecords
  // Elternkontaktfelder duerfen nur ins Verzeichnis, wenn der Aufrufer department.manage hat --
  // siehe canWriteGuardianContact. match.ts vergleicht diese Felder nicht, das Entfernen hier
  // beeinflusst den Abgleich selbst also nicht.
  const incoming = canWriteGuardianContact
    ? parsedRows.incoming
    : parsedRows.incoming.map((entity) => ({ ...entity, guardianName: undefined, guardianEmail: undefined }))

  const plan = planSync({
    existing: existingLocals,
    incoming,
    match: createPeopleMatchStrategy(resolver),
    policy: { lossThresholdPercent: sourceLossThresholdPercent },
  })

  if (plan.aborted) {
    return reply.code(200).send(await handleAbortedSync({ service, runId, organizationId, sourceId, domain, mode, idempotencyKey }))
  }

  const ignoredFingerprints = await loadIgnoredFingerprints(service, sourceId)
  const pendingConflicts = buildPendingConflicts({
    plan, sourceId, domain, identityOf: peopleDomainAdapter.identityOf, invalidRecords, ignoredFingerprints,
  })

  // Eine neu anzulegende minderjaehrige Person ohne Elternkontakt wuerde am CHECK auf
  // directory_people scheitern (Migration 2026080703) -- hier vorab als Konflikt behandeln statt
  // den ganzen Lauf an einer einzelnen Zeile scheitern zu lassen.
  const applicableCreated: PersonExternal[] = []
  for (const entity of plan.created) {
    const isMinor = entity.birthYear !== undefined && deriveIsMinor(entity.birthYear, referenceYear)
    if (isMinor && (entity.status ?? 'active') === 'active' && !entity.guardianEmail) {
      const identityKey = entity.externalId ?? `${entity.firstName} ${entity.lastName}`
      const fingerprint = conflictFingerprint([sourceId, domain, 'invalid_record', 'guardianEmail', identityKey])
      if (!ignoredFingerprints.has(fingerprint)) {
        addUniquePendingConflict(pendingConflicts, {
          kind: 'invalid_record', label: `${entity.firstName} ${entity.lastName}`, field: 'guardianEmail',
          externalId: entity.externalId ?? null, localId: null, currentValue: null,
          incomingValue: 'minderjaehrig ohne Elternkontakt', fingerprint,
        })
      }
      continue
    }
    applicableCreated.push(entity)
  }

  // Fuer dry_run bleibt dies der reine Vorschauwert (plan.updated.length), da nichts geschrieben
  // wird und ein CHECK-Fehlschlag deshalb nicht auftreten kann. Fuer apply wird jeder tatsaechlich
  // fehlgeschlagene Schreibvorgang unten abgezogen -- siehe Fund aus dem adversarialen Review.
  let appliedUpdatedCount = plan.updated.length
  if (mode === 'apply') {
    if (applicableCreated.length > 0) {
      const insertRows = applicableCreated.map((entity) => {
        const resolved = resolvePersonScope(entity, resolver)
        const isMinor = entity.birthYear !== undefined ? deriveIsMinor(entity.birthYear, referenceYear) : false
        return {
          organization_id: organizationId,
          department_id: resolved.departmentId ?? sourceDepartmentId,
          team_id: resolved.teamId ?? null,
          first_name: entity.firstName, last_name: entity.lastName, birth_year: entity.birthYear ?? null,
          is_minor: isMinor, status: entity.status ?? 'active', joined_at: entity.joinedAt ?? null,
          guardian_name: entity.guardianName ?? null, guardian_email: entity.guardianEmail ?? null,
          source_id: sourceId, external_id: entity.externalId ?? null, source_updated_at: entity.sourceUpdatedAt ?? null,
        }
      })
      const insert = await service.from('directory_people').insert(insertRows)
      if (insert.error) throw insert.error
    }
    for (const update of plan.updated) {
      const resolved = resolvePersonScope(update.external, resolver)
      // Durchgaengig `?? lokal`: ein Feld, das die Quelle nicht liefert, bleibt stehen. Fuer
      // birth_year stand hier `?? null` -- eine Importdatei ohne Geburtsjahrspalte leerte damit
      // jedes bereits gepflegte Geburtsjahr und entzog der Minderjaehrigkeitspruefung ihre
      // Grundlage (dieselbe Regel setzt MatchStrategy.fieldsOf fuer die Aenderungserkennung um).
      const patch: Record<string, unknown> = {
        first_name: update.external.firstName, last_name: update.external.lastName,
        birth_year: update.external.birthYear ?? update.local.birthYear,
        department_id: resolved.departmentId ?? update.local.departmentId, team_id: resolved.teamId ?? update.local.teamId,
        status: update.external.status ?? update.local.status,
        source_updated_at: update.external.sourceUpdatedAt ?? update.local.sourceUpdatedAt?.toISOString() ?? null,
      }
      if (update.external.birthYear !== undefined) patch.is_minor = deriveIsMinor(update.external.birthYear, referenceYear)
      const result = await service.from('directory_people').update(patch).eq('id', update.local.id)
      if (result.error) {
        // 23514: eine aktive Minderjaehrige ohne Elternkontakt -- fuer neu angelegte Personen
        // oben bereits vorab abgefangen; bei einer Aenderung (z. B. Geburtsjahr korrigiert sich
        // rueckwirkend) kann das erst hier auffallen. Die Zeile bleibt unveraendert stehen, aber
        // -- anders als zuvor -- nicht mehr stillschweigend: sie zaehlt nicht als "geaendert" und
        // erzeugt einen echten Konflikt, damit ein fehlgeschlagenes Update sichtbar bleibt statt
        // im Zaehlwert zu verschwinden (beim adversarialen Review gefunden).
        if (result.error.code !== '23514') throw result.error
        appliedUpdatedCount -= 1
        const identityKey = update.local.externalId ?? update.local.id
        const fingerprint = conflictFingerprint([sourceId, domain, 'invalid_record', 'guardianEmail', identityKey])
        if (!ignoredFingerprints.has(fingerprint)) {
          addUniquePendingConflict(pendingConflicts, {
            kind: 'invalid_record', label: `${update.external.firstName} ${update.external.lastName}`, field: 'guardianEmail',
            externalId: update.local.externalId, localId: update.local.id, currentValue: null,
            incomingValue: 'minderjaehrig ohne Elternkontakt', fingerprint,
          })
        }
      }
    }
    for (const retired of plan.retired) {
      const result = await service.from('directory_people').update({ status: 'left' }).eq('id', retired.id)
      if (result.error) throw result.error
      const backfillLeftAt = await service.from('directory_people').update({ left_at: new Date().toISOString().slice(0, 10) }).eq('id', retired.id).is('left_at', null)
      if (backfillLeftAt.error) throw backfillLeftAt.error
    }
  }

  return reply.code(200).send(await finishSyncRun({
    service, request, runId, organizationId, sourceId, domain, mode, idempotencyKey,
    createdCount: applicableCreated.length, updatedCount: appliedUpdatedCount, retiredCount: plan.retired.length,
    skippedCount: plan.skipped.length, pendingConflicts,
  }))
}
