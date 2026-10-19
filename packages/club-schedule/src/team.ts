import { applyFieldMapping, type DomainAdapter } from '@vereinsfunk/integrations'
import { z } from 'zod'

// Erlaubte Felder, vollstaendig (plans/019): Name, Altersklasse, Liga/Staffel, Abteilung (als Name --
// die Aufloesung zur ID passiert in teamMatch.ts, dieses Package kennt keine Datenbank). Ein
// Verbandsexport mit Vereinsnummer, Spielberechtigungen o.ae. verliert diese Felder beim Einlesen.
export const ExternalTeamSchema = z.object({
  externalId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  ageGroup: z.string().trim().min(1).max(60).optional(),
  competition: z.string().trim().min(1).max(120).optional(),
  departmentName: z.string().trim().min(1).max(120).optional(),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).optional(),
})
export type ExternalTeam = z.infer<typeof ExternalTeamSchema>

// Anders als bei fixtures/events gibt es hier kein iCal-Freitext-Fallback: eine Mannschaftsliste
// kommt immer mit expliziten Spalten, nie aus einem gemischten Kalenderfeed -- normalize ist
// deshalb nur das FieldMapping. Die Identitaet steht in createTeamMatchStrategy (teamMatch.ts).
export const teamDomainAdapter: DomainAdapter<ExternalTeam> = {
  domain: 'teams',
  schema: ExternalTeamSchema,
  normalize: applyFieldMapping,
}
