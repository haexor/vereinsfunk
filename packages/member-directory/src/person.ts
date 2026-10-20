import { applyFieldMapping, type DomainAdapter } from '@vereinsfunk/integrations'
import { z } from 'zod'

// Erlaubte Felder, vollstaendig (plans/014, "Mitgliederverzeichnis"): Vorname, Nachname,
// Geburtsjahr, Abteilung/Mannschaft (als Name -- die Aufloesung zur ID passiert in match.ts,
// dieses Package kennt keine Datenbank), Status/Austrittsdatum, eigene E-Mail (Paket 054; einen
// Elternkontakt gibt es seitdem nicht mehr). Alles andere --
// Adresse, IBAN, Geschlecht, Nationalitaet, Gesundheitsdaten, volles Geburtsdatum, Freitext --
// existiert hier nicht: das Schema selbst ist die Datenminimierung. applyFieldMapping kopiert nur
// gemappte Felder, und parse() wirft unbekannte Schluessel ohnehin weg -- eine falsch benannte
// Zuordnung (z. B. auf 'iban') landet nie in einem PersonExternal.
// directory_people.joined_at/left_at sind date-Spalten. Nur 'YYYY-MM-DD' -- "15.03.2019" liesse
// Postgres mitten im Schreiben abbrechen, "03.04.2019" laese es still als MDY. Eine XLSX-Datumszelle
// kommt aus fileTransport als UTC-Mitternachts-Zeitstempel und wird auf ihr Datum gekuerzt.
const DirectoryDateSchema = z.string().trim().pipe(z.union([z.iso.date(), z.iso.datetime().transform((value) => value.slice(0, 10))]))

export const PersonExternalSchema = z.object({
  externalId: z.string().trim().min(1).optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthYear: z.coerce.number().int().min(1900).max(2100).optional(),
  departmentName: z.string().trim().min(1).max(120).optional(),
  teamName: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'inactive', 'left']).optional(),
  joinedAt: DirectoryDateSchema.optional(),
  leftAt: DirectoryDateSchema.optional(),
  email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
  // Mit Offset wie bei ExternalTeamSchema: ein ungueltiger Wert waere als Invalid Date durch
  // sourceUpdatedAtOf gelaufen und haette den local_newer-Schutz in planSync abgeschaltet.
  sourceUpdatedAt: z.iso.datetime({ offset: true }).optional(),
})
export type PersonExternal = z.infer<typeof PersonExternalSchema>

// Die Identitaet (externe ID bzw. unscharfer Schluessel) steht nur in createPeopleMatchStrategy
// (match.ts) -- eine zweite Kopie hier liefe beim naechsten Aendern auseinander.
export const peopleDomainAdapter: DomainAdapter<PersonExternal> = {
  domain: 'people',
  schema: PersonExternalSchema,
  normalize: applyFieldMapping,
}

/**
 * Entscheidung aus plans/014 ("Entscheidungen vor der Umsetzung", 2026-08-07): das ganze
 * Kalenderjahr des 18. Geburtstags gilt noch als minderjaehrig. Dieselbe Regel ist als SQL-Funktion
 * public.recompute_directory_minor_status() dupliziert (Migration 2026080703_integration_framework.sql)
 * -- hier fuer die API beim Anlegen/Aendern einer Person, dort fuer den taeglichen Abgleich.
 */
export function deriveIsMinor(birthYear: number, referenceYear: number): boolean {
  return referenceYear <= birthYear + 18
}
