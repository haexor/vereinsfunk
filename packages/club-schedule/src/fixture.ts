import type { DomainAdapter, FieldMapping } from '@vereinsfunk/integrations'
import { z } from 'zod'
import { detectFixtureTitle } from './titleHeuristic.js'

// Erlaubte Felder, vollstaendig (plans/019). teamReference/opponentName/isHome sind die direkten
// Felder aus einem Export mit eigenen Spalten. homeNameRaw/awayNameRaw sind die noch nicht
// aufgeloesten Titel-Kandidaten aus einem iCal-Feed ohne solche Spalten -- welche Seite die eigene
// Mannschaft ist, klaert erst der Resolver in fixtureMatch.ts (braucht einen Datenbankabgleich,
// den dieses Package nicht hat).
export const ExternalFixtureSchema = z.object({
  externalId: z.string().trim().min(1).optional(),
  teamReference: z.string().trim().min(1).max(200).optional(),
  opponentName: z.string().trim().min(1).max(160).optional(),
  homeNameRaw: z.string().trim().min(1).max(200).optional(),
  awayNameRaw: z.string().trim().min(1).max(200).optional(),
  competition: z.string().trim().min(1).max(120).optional(),
  // z.union([z.boolean(), z.stringbool()]) statt z.coerce.boolean(): letzteres ist Boolean(value) --
  // ein Datei-Wert "false" waere ein nicht-leerer String und damit truthy (derselbe Fund wie bei
  // isMinor/missingGuardian in Paket 014, siehe apps/api/src/app.ts). Ein XLSX-Boolean-Zellwert
  // kommt bereits als echtes boolean an, eine CSV-/iCal-Zeile als String -- beide bleiben erlaubt.
  isHome: z.union([z.boolean(), z.stringbool()]).optional(),
  kickoffAt: z.string().trim().min(1).optional(),
  // Nur fuer den unaufgeloesten iCal-Fall gedacht (dtstart ohne Z-Suffix): das TZID-Parameter der
  // Quellzeile, damit die API (die als einzige organizations.timezone kennt) kickoff_at korrekt
  // in UTC aufloesen und kickoff_time_confirmed setzen kann -- siehe icalTransport.ts,
  // resolveIcalDateTime(). Ein Datei-Export mit einer expliziten kickoffAt-Spalte braucht das nicht.
  kickoffAtTzid: z.string().trim().min(1).optional(),
  kickoffTimeConfirmed: z.union([z.boolean(), z.stringbool()]).optional(),
  venueName: z.string().trim().max(200).optional(),
  venueAddress: z.string().trim().max(300).optional(),
  status: z.enum(['scheduled', 'postponed', 'cancelled', 'played', 'unknown']).optional(),
  homeScore: z.coerce.number().int().min(0).max(999).optional(),
  awayScore: z.coerce.number().int().min(0).max(999).optional(),
  note: z.string().trim().max(2000).optional(),
  sourceUpdatedAt: z.string().trim().min(1).optional(),
})
export type ExternalFixture = z.infer<typeof ExternalFixtureSchema>

/**
 * Wendet das FieldMapping wie bei person.ts an. Fehlen danach sowohl opponentName als auch
 * teamReference und liegt ein iCal-`summary` vor, wird die Titelheuristik versucht: erkennt sie
 * kein Spielmuster, gehoert die Zeile nicht zu dieser Domaene (undefined -- die events-Domaene
 * bekommt die Chance). Erkennt sie eines, ergaenzt sie homeNameRaw/awayNameRaw plus die iCal-
 * Rohfelder, ohne bereits explizit gemappte Werte zu ueberschreiben (gemappt gewinnt vor erraten).
 */
function normalize(raw: Readonly<Record<string, unknown>>, mapping: FieldMapping): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {}
  for (const [externalColumn, internalField] of Object.entries(mapping)) {
    const value = raw[externalColumn]
    if (value !== undefined && value !== null && value !== '') result[internalField] = value
  }

  if (result.opponentName === undefined && result.teamReference === undefined) {
    const summary = raw['summary']
    if (typeof summary === 'string' && summary.trim().length > 0) {
      const detected = detectFixtureTitle(summary)
      if (!detected) return undefined

      result.homeNameRaw = detected.homeName
      result.awayNameRaw = detected.awayName
      if (result.homeScore === undefined && detected.homeScore !== undefined) result.homeScore = detected.homeScore
      if (result.awayScore === undefined && detected.awayScore !== undefined) result.awayScore = detected.awayScore

      const dtstart = raw['dtstart']
      if (result.kickoffAt === undefined && typeof dtstart === 'string' && dtstart.length > 0) {
        result.kickoffAt = dtstart
        const dtstartTzid = raw['dtstart_tzid']
        if (typeof dtstartTzid === 'string' && dtstartTzid.length > 0) result.kickoffAtTzid = dtstartTzid
      }

      const location = raw['location']
      if (result.venueName === undefined && typeof location === 'string' && location.length > 0) result.venueName = location

      const uid = raw['uid']
      if (result.externalId === undefined && typeof uid === 'string' && uid.length > 0) result.externalId = uid

      const description = raw['description']
      if (result.note === undefined && typeof description === 'string' && description.length > 0) result.note = description
    }
  }

  return result
}

export const fixtureDomainAdapter: DomainAdapter<ExternalFixture> = {
  domain: 'fixtures',
  schema: ExternalFixtureSchema,
  normalize,
  identityOf(entity) {
    if (entity.externalId) return { externalId: entity.externalId }
    // Unscharfer Schluessel: Gegner (aufgeloest oder roh) plus Anstoßzeit -- zwei Spiele gegen
    // denselben Gegner zu unterschiedlichen Zeiten sind keine Kandidaten fuereinander.
    return { fuzzy: [(entity.opponentName ?? entity.awayNameRaw ?? '').trim().toLowerCase(), entity.kickoffAt ?? ''] }
  },
}
