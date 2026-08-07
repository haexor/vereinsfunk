import type { ClubEvent, ContentPresetSlug, FactProvenance, Fixture, Team } from '@vereinsfunk/contracts'

export type FactsFromScheduleResult =
  | { readonly ok: true; readonly presetSlug: ContentPresetSlug; readonly facts: Record<string, string | number | boolean>; readonly provenance: Record<string, FactProvenance> }
  | { readonly ok: false; readonly missing: readonly string[] }

// Ohne Uhrzeit, wenn die Quelle sie nicht bestaetigt hat -- eine praezise wirkende, aber
// unbestaetigte Uhrzeit waere schlimmer als gar keine (plans/019, Abschnitt 3).
function formatDate(iso: string, timezone: string, timeConfirmed: boolean): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: timezone, dateStyle: 'medium', timeStyle: timeConfirmed ? 'short' : undefined }).format(new Date(iso))
}

export function factsFromFixture(fixture: Fixture, team: Team | null, timezone: string): FactsFromScheduleResult {
  const target: ContentPresetSlug = fixture.status === 'played' && fixture.homeScore !== null && fixture.awayScore !== null ? 'match_result' : 'match_announcement'

  const missing: string[] = []
  // Heimrecht blockt immer, unabhaengig vom Ziel-Preset (plans/019: "kein Preset, wenn ein
  // Pflichtfakt oder is_home fehlt" -- als Pauschalregel formuliert, nicht bedingt aufs Preset).
  if (fixture.isHome === null) missing.push('Heimrecht')
  if (fixture.opponentName === null) missing.push('Gegner')
  if (fixture.kickoffAt === null) missing.push('Zeit')
  if (fixture.venueName === null) missing.push('Ort')
  if (target === 'match_result' && (fixture.homeScore === null || fixture.awayScore === null)) missing.push('Ergebnis')
  if (missing.length > 0) return { ok: false, missing }

  const ownName = fixture.ownTeamLabel ?? team?.name ?? 'Wir'
  const homeTeamName = fixture.isHome ? ownName : fixture.opponentName!
  const awayTeamName = fixture.isHome ? fixture.opponentName! : ownName
  const date = formatDate(fixture.kickoffAt!, timezone, fixture.kickoffTimeConfirmed)

  const facts: Record<string, string | number | boolean> = target === 'match_result'
    ? { homeTeam: homeTeamName, awayTeam: awayTeamName, homeScore: fixture.homeScore!, awayScore: fixture.awayScore! }
    : { opponent: fixture.opponentName!, date, location: fixture.venueName! }

  const capturedAt = fixture.sourceUpdatedAt ?? fixture.updatedAt
  const provenance: Record<string, FactProvenance> = {}
  for (const key of Object.keys(facts)) provenance[key] = { source: 'fixture', sourceId: fixture.id, capturedAt }

  return { ok: true, presetSlug: target, facts, provenance }
}

export function factsFromClubEvent(event: ClubEvent, timezone: string): FactsFromScheduleResult {
  const missing: string[] = []
  if (!event.title) missing.push('Titel')
  if (!event.startsAt) missing.push('Datum')
  if (event.locationName === null) missing.push('Ort')
  if (missing.length > 0) return { ok: false, missing }

  const date = formatDate(event.startsAt, timezone, !event.allDay)
  const facts: Record<string, string | number | boolean> = { title: event.title, date, location: event.locationName! }

  const capturedAt = event.sourceUpdatedAt ?? event.updatedAt
  const provenance: Record<string, FactProvenance> = {}
  for (const key of Object.keys(facts)) provenance[key] = { source: 'club_event', sourceId: event.id, capturedAt }

  return { ok: true, presetSlug: 'event', facts, provenance }
}
