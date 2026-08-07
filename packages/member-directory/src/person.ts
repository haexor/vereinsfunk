import type { DomainAdapter, FieldMapping } from '@vereinsfunk/integrations'
import { z } from 'zod'

// Erlaubte Felder, vollstaendig (plans/014, "Mitgliederverzeichnis"): Vorname, Nachname,
// Geburtsjahr, Abteilung/Mannschaft (als Name -- die Aufloesung zur ID passiert in match.ts,
// dieses Package kennt keine Datenbank), Status/Austrittsdatum, Elternkontakt. Alles andere --
// Adresse, IBAN, Geschlecht, Nationalitaet, Gesundheitsdaten, volles Geburtsdatum, Freitext --
// existiert hier nicht: das Schema selbst ist die Datenminimierung. normalize() unten kopiert nur
// gemappte Felder, und parse() wirft unbekannte Schluessel ohnehin weg -- eine falsch benannte
// Zuordnung (z. B. auf 'iban') landet nie in einem PersonExternal.
export const PersonExternalSchema = z.object({
  externalId: z.string().trim().min(1).optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthYear: z.coerce.number().int().min(1900).max(2100).optional(),
  departmentName: z.string().trim().min(1).max(120).optional(),
  teamName: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'inactive', 'left']).optional(),
  joinedAt: z.string().trim().min(1).optional(),
  leftAt: z.string().trim().min(1).optional(),
  guardianName: z.string().trim().min(1).max(160).optional(),
  guardianEmail: z.string().trim().toLowerCase().pipe(z.email()).optional(),
  sourceUpdatedAt: z.string().trim().min(1).optional(),
})
export type PersonExternal = z.infer<typeof PersonExternalSchema>

/**
 * Wendet das FieldMapping (externe Spalte -> interner Feldname) auf eine rohe Zeile an. Das
 * Ergebnis ist bewusst ungeprueft -- der Aufrufer validiert es mit PersonExternalSchema.parse().
 * Werte, die keinem gemappten Feld zugeordnet sind, verschwinden einfach: dieses Package kopiert
 * nie das gesamte raw-Objekt durch.
 */
function normalize(raw: Readonly<Record<string, unknown>>, mapping: FieldMapping): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [externalColumn, internalField] of Object.entries(mapping)) {
    const value = raw[externalColumn]
    if (value !== undefined && value !== null && value !== '') result[internalField] = value
  }
  return result
}

export const peopleDomainAdapter: DomainAdapter<PersonExternal> = {
  domain: 'people',
  schema: PersonExternalSchema,
  normalize,
  identityOf(entity) {
    if (entity.externalId) return { externalId: entity.externalId }
    // Unscharfer Schluessel: Name (kleingeschrieben) plus Geburtsjahr, falls vorhanden -- zwei
    // gleichnamige Personen unterschiedlichen Jahrgangs sind keine Kandidaten fuereinander.
    return { fuzzy: [entity.firstName.trim().toLowerCase(), entity.lastName.trim().toLowerCase(), String(entity.birthYear ?? '')] }
  },
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
