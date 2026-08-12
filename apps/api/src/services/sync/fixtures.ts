import { createFixtureMatchStrategy, ExternalFixtureSchema, fixtureDomainAdapter, type ExternalFixture, type FixtureLocal, type FixtureStatus, type TeamNameResolver } from '@vereinsfunk/club-schedule'
import { planSync } from '@vereinsfunk/integrations'
import type { FastifyReply } from 'fastify'
import { buildPendingConflicts, finishSyncRun, handleAbortedSync, loadIgnoredFingerprints, normalizeStructureName, parseIncomingRows, resolveScheduleDateTime, type SyncDomainContext } from '../integrationSync.js'

export async function handleFixturesSync(ctx: SyncDomainContext): Promise<FastifyReply> {
  const { request, reply, service, organizationId, sourceDepartmentId, sourceId, sourceFieldMapping, sourceLossThresholdPercent, mode, domain, runId, idempotencyKey, rawRows, organizationTimezone } = ctx

  // Ein Spiel braucht eine Abteilung (fixtures.department_id ist not null) und die Quelle liefert
  // keinen eigenen Abteilungsnamen (anders als teams/people) -- ohne abteilungsgebundene Quelle
  // ist nicht entscheidbar, wohin ein synchronisiertes Spiel gehoert.
  if (!sourceDepartmentId) return reply.code(409).send({ error: 'source_missing_department', correlationId: request.id })

  const existingRows = await service
    .from('fixtures')
    .select('id, external_id, source_id, team_id, is_home, own_team_label, opponent_name, competition, kickoff_at, kickoff_time_confirmed, venue_name, venue_address, status, home_score, away_score, note, source_updated_at, updated_at')
    .eq('organization_id', organizationId)
    .eq('department_id', sourceDepartmentId)
    .or(`source_id.is.null,source_id.eq.${sourceId}`)
  if (existingRows.error) throw existingRows.error
  const existingLocals: FixtureLocal[] = existingRows.data.map((row) => ({
    id: row.id as string, externalId: row.external_id as string | null, sourceId: row.source_id as string | null,
    teamId: row.team_id as string | null, isHome: row.is_home as boolean | null, ownTeamLabel: row.own_team_label as string | null,
    opponentName: row.opponent_name as string | null, competition: row.competition as string | null,
    kickoffAt: row.kickoff_at ? new Date(row.kickoff_at as string) : null, kickoffTimeConfirmed: row.kickoff_time_confirmed as boolean,
    venueName: row.venue_name as string | null, venueAddress: row.venue_address as string | null,
    status: row.status as FixtureStatus, homeScore: row.home_score as number | null, awayScore: row.away_score as number | null,
    note: row.note as string | null, sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at as string) : null,
    updatedAt: new Date(row.updated_at as string),
  }))

  // Mannschaftszuordnung ("wer sind wir") nur innerhalb der eigenen Abteilung -- dieselbe
  // Scope-Einschraenkung wie bei Personen/Mannschaften.
  const teamRows = await service.from('teams').select('id, name').eq('department_id', sourceDepartmentId)
  if (teamRows.error) throw teamRows.error
  const teamIdByName = new Map(teamRows.data.map((row) => [normalizeStructureName(row.name as string), row.id as string]))
  const resolver: TeamNameResolver = { resolveTeamId: (name) => teamIdByName.get(normalizeStructureName(name)) }

  const { incoming, invalidRecords } = parseIncomingRows<ExternalFixture>({
    rawRows, fieldMapping: sourceFieldMapping, normalize: fixtureDomainAdapter.normalize, schema: ExternalFixtureSchema,
    labelOf: (normalized, rowIndex) =>
      typeof normalized.opponentName === 'string' ? normalized.opponentName : typeof normalized.awayNameRaw === 'string' ? normalized.awayNameRaw : `Zeile ${rowIndex}`,
  })

  const match = createFixtureMatchStrategy(resolver)
  const plan = planSync({ existing: existingLocals, incoming, match, policy: { lossThresholdPercent: sourceLossThresholdPercent } })
  if (plan.aborted) {
    return reply.code(200).send(await handleAbortedSync({ service, runId, organizationId, sourceId, domain, mode, idempotencyKey }))
  }

  const ignoredFingerprints = await loadIgnoredFingerprints(service, sourceId)
  const pendingConflicts = buildPendingConflicts({ plan, sourceId, domain, identityOf: fixtureDomainAdapter.identityOf, invalidRecords, ignoredFingerprints })

  let appliedUpdatedCount = plan.updated.length
  if (mode === 'apply') {
    if (plan.created.length > 0) {
      const insertRows = plan.created.map((entity) => {
        const resolved = match.fieldsOf(entity) as { teamId: string | null; opponentName: string | null; isHome: boolean | null; competition: string | null; kickoffAt: string | null }
        const kickoff = resolved.kickoffAt ? resolveScheduleDateTime(resolved.kickoffAt, entity.kickoffAtTzid, organizationTimezone) : undefined
        const ownTeamLabel = resolved.isHome === true ? entity.homeNameRaw ?? null : resolved.isHome === false ? entity.awayNameRaw ?? null : null
        return {
          organization_id: organizationId, department_id: sourceDepartmentId, team_id: resolved.teamId,
          is_home: resolved.isHome, own_team_label: ownTeamLabel, opponent_name: resolved.opponentName, competition: resolved.competition,
          kickoff_at: kickoff?.iso ?? null, kickoff_time_confirmed: kickoff ? (entity.kickoffTimeConfirmed ?? kickoff.confirmed) : true,
          venue_name: entity.venueName ?? null, venue_address: entity.venueAddress ?? null,
          status: entity.status ?? 'scheduled', home_score: entity.homeScore ?? null, away_score: entity.awayScore ?? null,
          note: entity.note ?? null, source_id: sourceId, external_id: entity.externalId ?? null, source_updated_at: entity.sourceUpdatedAt ?? null,
        }
      })
      const insert = await service.from('fixtures').insert(insertRows)
      if (insert.error) throw insert.error
    }
    for (const update of plan.updated) {
      const resolved = match.fieldsOf(update.external) as { teamId: string | null; opponentName: string | null; isHome: boolean | null; competition: string | null; kickoffAt: string | null }
      const patch: Record<string, unknown> = {
        team_id: resolved.teamId ?? update.local.teamId, opponent_name: resolved.opponentName ?? update.local.opponentName,
        is_home: resolved.isHome ?? update.local.isHome, competition: resolved.competition ?? update.local.competition,
        source_updated_at: update.external.sourceUpdatedAt ?? update.local.sourceUpdatedAt?.toISOString() ?? null,
      }
      if (update.external.kickoffAt !== undefined) {
        const kickoff = resolveScheduleDateTime(update.external.kickoffAt, update.external.kickoffAtTzid, organizationTimezone)
        if (kickoff) { patch.kickoff_at = kickoff.iso; patch.kickoff_time_confirmed = update.external.kickoffTimeConfirmed ?? kickoff.confirmed }
      }
      if (update.external.venueName !== undefined) patch.venue_name = update.external.venueName
      if (update.external.venueAddress !== undefined) patch.venue_address = update.external.venueAddress
      if (update.external.status !== undefined) patch.status = update.external.status
      if (update.external.homeScore !== undefined) patch.home_score = update.external.homeScore
      if (update.external.awayScore !== undefined) patch.away_score = update.external.awayScore
      if (update.external.note !== undefined) patch.note = update.external.note
      const result = await service.from('fixtures').update(patch).eq('id', update.local.id)
      if (result.error) {
        // 23514: status='played' ohne beide Torzahlen -- eine unvollstaendige Ergebniskorrektur
        // bleibt unveraendert stehen statt den ganzen Lauf abzubrechen (dasselbe Muster wie bei
        // Personen/Elternkontakt in Paket 014).
        if (result.error.code !== '23514') throw result.error
        appliedUpdatedCount -= 1
      }
    }
    for (const retired of plan.retired) {
      // Ein aus der Quelle verschwundenes Spiel gilt als abgesagt, nie als geloescht -- ein
      // bereits gespieltes ('played') Ergebnis bleibt davon unberuehrt.
      const result = await service.from('fixtures').update({ status: 'cancelled' }).eq('id', retired.id).neq('status', 'played')
      if (result.error) throw result.error
    }
  }

  return reply.code(200).send(await finishSyncRun({
    service, request, runId, organizationId, sourceId, domain, mode, idempotencyKey,
    createdCount: plan.created.length, updatedCount: appliedUpdatedCount, retiredCount: plan.retired.length,
    skippedCount: plan.skipped.length, pendingConflicts,
  }))
}

