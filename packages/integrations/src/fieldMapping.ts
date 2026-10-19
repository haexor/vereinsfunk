import type { FieldMapping } from './types.js'

/**
 * Wendet das FieldMapping (externe Spalte -> interner Feldname) auf eine rohe Zeile an -- fuer
 * jeden Bereich gleich, deshalb hier statt in jedem DomainAdapter.normalize. Kopiert nur gemappte
 * Spalten, nie das ganze raw-Objekt; erst das Zod-Schema des Bereichs entscheidet, was davon
 * bleiben darf (Datenminimierung). Leere Zellen fallen weg, damit eine leere CSV-Zelle kein
 * leeres Pflichtfeld wird. Das Ergebnis ist bewusst ungeprueft.
 */
export function applyFieldMapping(raw: Readonly<Record<string, unknown>>, mapping: FieldMapping): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [externalColumn, internalField] of Object.entries(mapping)) {
    const value = raw[externalColumn]
    if (value !== undefined && value !== null && value !== '') result[internalField] = value
  }
  return result
}
