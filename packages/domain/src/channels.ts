import type { ScopeLevelName } from './reviewRoute.js'

// Hier stand evaluateQuota (Plan 011). Entfernt, statt unbenutzt liegen zu bleiben: die Durchsetzung
// gehoert aus Atomaritaetsgruenden in public.schedule_publication (Advisory Lock um Zaehlung und
// Einplanung), und die Signatur paarte Limit und Zaehlung nur ueber (scope, period) -- damit liessen
// sich zwei Kontingente derselben Ebene und Periode fuer VERSCHIEDENE Kanaele nicht unterscheiden,
// obwohl channel_quotas genau das erlaubt (unique ueber scope/department/team/social_connection_id/
// period). Wer die Auslastung anzeigen will ("2 von 3 diese Woche"), baut sie mit der
// Kanaldimension neu -- sinnvoll zusammen mit der Kanal-Oberflaeche in Paket 012 und einem
// Endpunkt, der count_publications_in_period service-seitig aufruft (an authenticated bewusst
// nicht vergeben). Als Anzeige, nie als Gate.

// --- Paket 012: Kanaele und Social-Accounts ----------------------------------------------------

// Ein channel_scopes-Eintrag deckt einen Scope S, wenn er auf S selbst oder eine uebergeordnete
// Ebene von S zeigt: organization deckt immer, department deckt department UND jedes seiner Teams,
// team deckt nur genau dieses Team. Gespiegelt in SQL innerhalb von schedule_publication (Plan 011/012:
// die RPC ist die tatsaechliche Durchsetzungsgrenze, diese Funktion dient Oberflaeche/Vorabpruefung).
function grantCoversScope(
  grant: { scope: ScopeLevelName; departmentId?: string; teamId?: string },
  targetScope: ScopeLevelName,
  targetDepartmentId?: string,
  targetTeamId?: string,
): boolean {
  if (grant.scope === 'organization') return true
  if (grant.scope === 'department') return grant.departmentId === targetDepartmentId
  return targetScope === 'team' && grant.teamId === targetTeamId
}

export interface ChannelCandidate {
  socialConnectionId: string
  status: 'active' | 'action_required' | 'disconnected'
  archivedAt: string | null
  responsibleProfileId: string | null
  scopeGrants: readonly { scope: ScopeLevelName; departmentId?: string; teamId?: string; canSchedule: boolean }[]
}

// Auflösungsregel fuer erlaubte Kanaele eines Beitrags in Scope S (Plan 012): channel_scopes-Treffer
// fuer S oder eine uebergeordnete Ebene, geschnitten mit allowedChannelIds aus der effektiven
// Konfiguration (Paket 011; null = keine Einschraenkung), ohne inaktive/archivierte Kanaele, ohne
// Kanaele ohne verantwortliche Person, falls die Richtlinie das verlangt.
export function resolveAvailableChannels(input: {
  scope: ScopeLevelName
  departmentId?: string
  teamId?: string
  channels: readonly ChannelCandidate[]
  allowedChannelIds: readonly string[] | null
  requireChannelResponsible: boolean
}): string[] {
  return input.channels
    .filter((channel) => channel.status === 'active' && channel.archivedAt === null)
    .filter((channel) => input.allowedChannelIds === null || input.allowedChannelIds.includes(channel.socialConnectionId))
    .filter((channel) => !input.requireChannelResponsible || channel.responsibleProfileId !== null)
    .filter((channel) =>
      channel.scopeGrants.some(
        (grant) => grant.canSchedule && grantCoversScope(grant, input.scope, input.departmentId, input.teamId),
      ),
    )
    .map((channel) => channel.socialConnectionId)
}
