import { TeamSchema, type CommunicationGoal, type FactProvenance, type ScheduleOccasion, type Team } from '@vereinsfunk/contracts'
import { factsFromClubEvent, factsFromFixture, type FactsFromScheduleResult } from '@vereinsfunk/content-engine'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_EVENT_COLUMNS, FIXTURE_COLUMNS, mapClubEventRow, mapFixtureRow, mapTeamRow } from '../apiMappers.js'

export type ScheduleOccasionReference = { fixtureId?: string | undefined; clubEventId?: string | undefined }

// Was ein Beitrag aus einem Spiel oder einer Veranstaltung mitbekommt. Fakten und Herkunft leitet
// die API selbst aus der referenzierten Zeile her, nie aus Client-Angaben (plans/README.md, "RPC
// traut Client nicht") -- der Client nennt nur fixtureId/clubEventId.
export type ResolvedScheduleOccasion = {
  view: ScheduleOccasion
  factsResult: FactsFromScheduleResult
  provenance: Record<string, FactProvenance>
  sourceRevisionAt: string
}

export type ScheduleOccasionResult =
  | { ok: true; occasion: ResolvedScheduleOccasion }
  | { ok: false; error: 'fixture_not_found_in_department' | 'event_not_found_in_department' }

async function organizationTimezone(client: SupabaseClient, organizationId: string): Promise<string> {
  const organization = await client.from('organizations').select('timezone').eq('id', organizationId).single()
  if (organization.error) throw organization.error
  return organization.data.timezone as string
}

function resolved(kind: ScheduleOccasion['kind'], id: string, label: string, suggestedGoal: CommunicationGoal, factsResult: FactsFromScheduleResult, sourceRevisionAt: string): ResolvedScheduleOccasion {
  return {
    view: { kind, id, label, facts: factsResult.facts, missing: factsResult.ok ? [] : [...factsResult.missing], capturedAt: sourceRevisionAt, suggestedGoal },
    factsResult,
    provenance: factsResult.provenance,
    sourceRevisionAt,
  }
}

/**
 * Laedt den Anlass im Bereich des Beitrags. Ein Spiel gehoert immer zu einer Abteilung; eine
 * Veranstaltung ohne Abteilung ist vereinsweit und passt zu jedem Bereich des Vereins.
 */
export async function loadScheduleOccasion(
  client: SupabaseClient,
  scope: { organizationId: string; departmentId: string | null },
  reference: ScheduleOccasionReference,
): Promise<ScheduleOccasionResult | null> {
  if (reference.fixtureId) {
    const fixtureRow = await client.from('fixtures').select(FIXTURE_COLUMNS)
      .eq('organization_id', scope.organizationId).eq('id', reference.fixtureId).maybeSingle()
    if (fixtureRow.error) throw fixtureRow.error
    if (!fixtureRow.data || scope.departmentId === null || fixtureRow.data.department_id !== scope.departmentId) {
      return { ok: false, error: 'fixture_not_found_in_department' }
    }
    const fixture = mapFixtureRow(fixtureRow.data)
    let team: Team | null = null
    if (fixture.teamId) {
      const teamRow = await client.from('teams')
        .select('id, organization_id, department_id, name, age_group, competition, source_id, archived_at, created_at')
        .eq('id', fixture.teamId).maybeSingle()
      if (teamRow.error) throw teamRow.error
      team = teamRow.data ? TeamSchema.parse(mapTeamRow(teamRow.data)) : null
    }
    const factsResult = factsFromFixture(fixture, team, await organizationTimezone(client, scope.organizationId))
    const isResult = fixture.status === 'played' && fixture.homeScore !== null && fixture.awayScore !== null
    const label = fixture.opponentName ? `Spiel gegen ${fixture.opponentName}` : 'Spiel'
    return { ok: true, occasion: resolved('fixture', fixture.id, label, isResult ? 'inform' : 'invite', factsResult, fixture.sourceUpdatedAt ?? fixture.updatedAt) }
  }
  if (reference.clubEventId) {
    const eventRow = await client.from('club_events').select(CLUB_EVENT_COLUMNS)
      .eq('organization_id', scope.organizationId).eq('id', reference.clubEventId).maybeSingle()
    if (eventRow.error) throw eventRow.error
    if (!eventRow.data || (eventRow.data.department_id !== null && eventRow.data.department_id !== scope.departmentId)) {
      return { ok: false, error: 'event_not_found_in_department' }
    }
    const clubEvent = mapClubEventRow(eventRow.data)
    const factsResult = factsFromClubEvent(clubEvent, await organizationTimezone(client, scope.organizationId))
    return { ok: true, occasion: resolved('club_event', clubEvent.id, clubEvent.title || 'Veranstaltung', 'invite', factsResult, clubEvent.sourceUpdatedAt ?? clubEvent.updatedAt) }
  }
  return null
}
