import { UuidSchema, type ScheduleOccasion } from '@vereinsfunk/contracts'

export type ScheduleOccasionReference = { fixtureId?: string; clubEventId?: string }

export function occasionReference(occasion: ScheduleOccasion | null): ScheduleOccasionReference {
  if (!occasion) return {}
  return occasion.kind === 'fixture' ? { fixtureId: occasion.id } : { clubEventId: occasion.id }
}

// ?fixtureId= aus Kalender und Anlassvorschlaegen, ?clubEventId= fuer Veranstaltungen. null ohne
// Anlass, 'invalid' bei einer kaputten ID.
export function occasionReferenceFromQuery(query: Record<string, unknown>): ScheduleOccasionReference | null | 'invalid' {
  if (query.fixtureId === undefined && query.clubEventId === undefined) return null
  const fixtureId = UuidSchema.safeParse(query.fixtureId)
  if (fixtureId.success && query.clubEventId === undefined) return { fixtureId: fixtureId.data }
  const clubEventId = UuidSchema.safeParse(query.clubEventId)
  if (clubEventId.success && query.fixtureId === undefined) return { clubEventId: clubEventId.data }
  return 'invalid'
}

const FACT_LABELS: Record<string, string> = {
  opponent: 'Gegner', date: 'Termin', location: 'Ort', title: 'Veranstaltung', homeTeam: 'Heim', awayTeam: 'Gast',
}

// Das Ergebnis steht als eine Zeile "2:1" statt als zwei Zahlenfelder.
export function occasionFactRows(facts: ScheduleOccasion['facts']): { label: string; value: string }[] {
  const rows = Object.entries(facts)
    .filter(([key]) => key !== 'homeScore' && key !== 'awayScore')
    .map(([key, value]) => ({ label: FACT_LABELS[key] ?? key, value: String(value) }))
  if (facts.homeScore !== undefined && facts.awayScore !== undefined) rows.push({ label: 'Ergebnis', value: `${facts.homeScore}:${facts.awayScore}` })
  return rows
}

export function occasionSourceLabel(occasion: ScheduleOccasion, timeZone: string): string {
  const capturedAt = new Intl.DateTimeFormat('de-DE', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(occasion.capturedAt))
  return `aus dem ${occasion.kind === 'fixture' ? 'Spielplan' : 'Kalender'} · Stand ${capturedAt}`
}

export function occasionLoadErrorMessage(code: string): string {
  if (code === 'fixture_not_found_in_department' || code === 'event_not_found_in_department') {
    return 'Dieser Termin gehört zu einem anderen Bereich. Wähle links die passende Abteilung und öffne den Link erneut.'
  }
  return 'Der Termin konnte nicht geladen werden. Du kannst den Beitrag trotzdem ohne Termin schreiben.'
}
