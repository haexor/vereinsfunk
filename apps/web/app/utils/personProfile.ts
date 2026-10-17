// Spielerprofil auf Vereinsebene: Adresse der Profilseite einer Verzeichnisperson.

/**
 * Pfad der Profilseite, oder null ohne Person -- dann ist der Name kein Link (z. B. eine nicht
 * zugeordnete Veo-Zeile). Die Id wird kodiert, damit ein ungueltiger Wert nie einen anderen Pfad
 * bildet.
 */
export function personProfilePath(personId: string | null | undefined): string | null {
  return personId ? `/personen/${encodeURIComponent(personId)}` : null
}
