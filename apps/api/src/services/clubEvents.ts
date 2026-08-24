import { AgentEventProposalInputSchema, type AgentEventProposalInput, type AgentScope } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_EVENT_COLUMNS, mapClubEventRow } from '../apiMappers.js'

// Gemeinsamer fachlicher Write-Use-Case: Die Agentenroute liefert nur den bereits
// autorisierten Akteur und einen serverseitig gebundenen Scope, nie Browser-IDs.
export async function createClubEvent(
  service: SupabaseClient,
  actorUserId: string,
  scope: AgentScope,
  input: AgentEventProposalInput,
) {
  const event = AgentEventProposalInputSchema.parse(input)
  const result = await service.from('club_events').insert({
    organization_id: scope.organizationId,
    department_id: scope.departmentId ?? null,
    team_id: scope.teamId ?? null,
    title: event.title,
    description: event.description ?? null,
    category: event.category,
    starts_at: event.startsAt,
    ends_at: event.endsAt ?? null,
    all_day: event.allDay,
    location_name: event.locationName ?? null,
    location_address: event.locationAddress ?? null,
    registration_url: event.registrationUrl ?? null,
    created_by: actorUserId,
  }).select(CLUB_EVENT_COLUMNS).single()
  if (result.error) throw result.error
  return mapClubEventRow(result.data)
}
