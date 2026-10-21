import type { ClubEvent, ContentPresetSlug, FactProvenance, Fixture, Team } from '@vereinsfunk/contracts'

type ScheduleFacts = Record<string, string | number | boolean>

// Auch ohne vollstaendigen Faktensatz traegt das Ergebnis die bekannten Fakten: die Textwerkstatt
// belegt damit vor, was die Quelle hergibt, und nennt den Rest als fehlend. Ein Preset gibt es
// dagegen nur bei vollstaendigen Fakten (POST /v1/submissions nutzt facts nur bei ok).
export type FactsFromScheduleResult =
  | { readonly ok: true; readonly presetSlug: ContentPresetSlug; readonly facts: ScheduleFacts; readonly provenance: Record<string, FactProvenance> }
  | { readonly ok: false; readonly missing: readonly string[]; readonly facts: ScheduleFacts; readonly provenance: Record<string, FactProvenance> }

// Ohne Uhrzeit, wenn die Quelle sie nicht bestaetigt hat -- eine praezise wirkende, aber
// unbestaetigte Uhrzeit waere schlimmer als gar keine (plans/019, Abschnitt 3).
function formatDate(iso: string, timezone: string, timeConfirmed: boolean): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: timezone, dateStyle: 'medium', timeStyle: timeConfirmed ? 'short' : undefined }).format(new Date(iso))
}

function knownFacts(candidates: Record<string, string | number | boolean | null>): ScheduleFacts {
  return Object.fromEntries(Object.entries(candidates).filter((entry): entry is [string, string | number | boolean] => entry[1] !== null))
}

function provenanceFor(facts: ScheduleFacts, source: FactProvenance['source'], sourceId: string, capturedAt: string): Record<string, FactProvenance> {
  return Object.fromEntries(Object.keys(facts).map((key) => [key, { source, sourceId, capturedAt }]))
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

  // Ohne Heimrecht laesst sich ein Ergebnis keiner Seite zuordnen; dann bleiben nur die Fakten der
  // Ankuendigung.
  let facts: ScheduleFacts
  if (target === 'match_result' && fixture.isHome !== null && fixture.opponentName !== null) {
    const ownName = fixture.ownTeamLabel ?? team?.name ?? 'Wir'
    facts = {
      homeTeam: fixture.isHome ? ownName : fixture.opponentName,
      awayTeam: fixture.isHome ? fixture.opponentName : ownName,
      homeScore: fixture.homeScore!,
      awayScore: fixture.awayScore!,
    }
  } else {
    facts = knownFacts({
      opponent: fixture.opponentName,
      date: fixture.kickoffAt === null ? null : formatDate(fixture.kickoffAt, timezone, fixture.kickoffTimeConfirmed),
      location: fixture.venueName,
    })
  }
  const provenance = provenanceFor(facts, 'fixture', fixture.id, fixture.sourceUpdatedAt ?? fixture.updatedAt)
  if (missing.length > 0) return { ok: false, missing, facts, provenance }
  return { ok: true, presetSlug: target, facts, provenance }
}

export function factsFromClubEvent(event: ClubEvent, timezone: string): FactsFromScheduleResult {
  const missing: string[] = []
  if (!event.title) missing.push('Titel')
  if (!event.startsAt) missing.push('Datum')
  if (event.locationName === null) missing.push('Ort')

  const facts = knownFacts({
    title: event.title || null,
    date: event.startsAt ? formatDate(event.startsAt, timezone, !event.allDay) : null,
    location: event.locationName,
  })
  const provenance = provenanceFor(facts, 'club_event', event.id, event.sourceUpdatedAt ?? event.updatedAt)
  if (missing.length > 0) return { ok: false, missing, facts, provenance }
  return { ok: true, presetSlug: 'event', facts, provenance }
}
