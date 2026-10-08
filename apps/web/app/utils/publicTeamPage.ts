// Paket 052, PR 4: die oeffentliche Mannschaftsseite /mannschaft/{verein}/{mannschaft} ist ohne
// Anmeldung erreichbar. Bewusst ein exaktes Muster statt eines Praefixes: genau zwei nicht leere
// Segmente im Slug-Format, keine weiteren Segmente, kein abschliessender Schraegstrich -- jede
// andere Route unter /mannschaft bleibt hinter der Anmeldung.
const PUBLIC_TEAM_PAGE = /^\/mannschaft\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Ist der Pfad die oeffentliche Seite einer Mannschaft? */
export function isPublicTeamPagePath(path: string): boolean {
  return path.length <= 200 && PUBLIC_TEAM_PAGE.test(path)
}
