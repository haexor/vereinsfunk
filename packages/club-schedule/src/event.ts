import type { DomainAdapter, FieldMapping } from '@vereinsfunk/integrations'
import { z } from 'zod'
import { detectFixtureTitle } from './titleHeuristic.js'

// Erlaubte Felder, vollstaendig (plans/019). title/startsAt sind hier absichtlich nicht optional --
// eine Veranstaltung ohne beides ist keine. normalize() unten darf das Ergebnis trotzdem ohne sie
// zurueckgeben (ungeprueft, siehe unten); erst schema.parse() erzwingt die Pflicht.
export const ExternalClubEventSchema = z.object({
  externalId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  category: z.enum(['general_meeting', 'festival', 'tournament', 'training_camp', 'course', 'social', 'fundraiser', 'ceremony', 'other']).optional(),
  startsAt: z.string().trim().min(1),
  // Nur fuer den unaufgeloesten iCal-Fall gedacht -- siehe kickoffAtTzid in fixture.ts fuer die
  // Begruendung (die API loest die tatsaechliche UTC-Zeit auf, dieses Package kennt die
  // Vereinszeitzone nicht).
  startsAtTzid: z.string().trim().min(1).optional(),
  endsAt: z.string().trim().min(1).optional(),
  endsAtTzid: z.string().trim().min(1).optional(),
  // z.union([z.boolean(), z.stringbool()]) statt z.coerce.boolean() -- siehe fixture.ts, dieselbe Begruendung.
  allDay: z.union([z.boolean(), z.stringbool()]).optional(),
  locationName: z.string().trim().max(200).optional(),
  locationAddress: z.string().trim().max(300).optional(),
  registrationUrl: z.url().optional(),
  status: z.enum(['scheduled', 'postponed', 'cancelled']).optional(),
  recurrenceKey: z.string().trim().min(1).max(200).optional(),
  sourceUpdatedAt: z.string().trim().min(1).optional(),
})
export type ExternalClubEvent = z.infer<typeof ExternalClubEventSchema>

/**
 * Wendet das FieldMapping wie bei person.ts an. title und startsAt werden danach unabhaengig
 * voneinander aus einem iCal-`summary`/`dtstart` ergaenzt, falls das FieldMapping das jeweilige
 * Feld nicht schon geliefert hat. Fehlt title noch und liegt ein `summary` vor, wird zuerst
 * geprueft, ob die Titelheuristik ein Spielmuster erkennt -- wenn ja, gehoert die Zeile zur
 * fixtures-Domaene, nicht hierher (undefined, damit derselbe Kalendereintrag nicht doppelt als
 * Spiel UND Veranstaltung landet). Erkennt sie keines, wird der Titel als Veranstaltungstitel
 * uebernommen.
 */
function normalize(raw: Readonly<Record<string, unknown>>, mapping: FieldMapping): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {}
  for (const [externalColumn, internalField] of Object.entries(mapping)) {
    const value = raw[externalColumn]
    if (value !== undefined && value !== null && value !== '') result[internalField] = value
  }

  // title und startsAt unabhaengig voneinander aus der Quelle ergaenzen: eine Zuordnung, die
  // bereits per FieldMapping nur eines der beiden liefert (z. B. ein explizites Titel-Feld ohne
  // eigene Beginn-Spalte), soll den jeweils fehlenden Teil trotzdem aus summary/dtstart erhalten,
  // statt beide Ergaenzungen an dieselbe "beide fehlen"-Bedingung zu koppeln.
  const summary = raw['summary']
  const hasUsableSummary = typeof summary === 'string' && summary.trim().length > 0

  if (result.title === undefined && hasUsableSummary) {
    if (detectFixtureTitle(summary) !== undefined) return undefined

    result.title = summary

    const location = raw['location']
    if (result.locationName === undefined && typeof location === 'string' && location.length > 0) result.locationName = location

    const description = raw['description']
    if (result.description === undefined && typeof description === 'string' && description.length > 0) result.description = description

    const uid = raw['uid']
    if (result.externalId === undefined && typeof uid === 'string' && uid.length > 0) result.externalId = uid
  }

  if (result.startsAt === undefined) {
    const dtstart = raw['dtstart']
    if (typeof dtstart === 'string' && dtstart.length > 0) {
      result.startsAt = dtstart
      const dtstartTzid = raw['dtstart_tzid']
      if (typeof dtstartTzid === 'string' && dtstartTzid.length > 0) result.startsAtTzid = dtstartTzid
      // VALUE=DATE (kein DATE-TIME) heisst in RFC 5545: ganztaegig, keine Uhrzeit im Feed.
      if (result.allDay === undefined && raw['dtstart_value'] === 'DATE') result.allDay = true

      const dtend = raw['dtend']
      if (result.endsAt === undefined && typeof dtend === 'string' && dtend.length > 0) {
        result.endsAt = dtend
        const dtendTzid = raw['dtend_tzid']
        if (typeof dtendTzid === 'string' && dtendTzid.length > 0) result.endsAtTzid = dtendTzid
      }
    }
  }

  if (result.title === undefined || result.startsAt === undefined) return undefined

  return result
}

export const clubEventDomainAdapter: DomainAdapter<ExternalClubEvent> = {
  domain: 'events',
  schema: ExternalClubEventSchema,
  normalize,
  identityOf(entity) {
    if (entity.externalId) return { externalId: entity.externalId }
    return { fuzzy: [entity.title.trim().toLowerCase(), entity.startsAt] }
  },
}
