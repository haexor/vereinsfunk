import { z } from 'zod'

// Paket 052, PR 4: die oeffentliche Mannschaftsseite /mannschaft/{verein}/{mannschaft} ist ohne
// Anmeldung erreichbar. Bewusst ein exaktes Muster statt eines Praefixes: genau zwei nicht leere
// Segmente im Slug-Format, keine weiteren Segmente, kein abschliessender Schraegstrich -- jede
// andere Route unter /mannschaft bleibt hinter der Anmeldung.
const PUBLIC_SLUG_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*'
const PUBLIC_SLUG = new RegExp(`^${PUBLIC_SLUG_PATTERN}$`)
const PUBLIC_TEAM_PAGE = new RegExp(`^/mannschaft/${PUBLIC_SLUG_PATTERN}/${PUBLIC_SLUG_PATTERN}$`)

/** Validiert die Slugs der öffentlichen Mannschaftsseite vor jedem API-Aufruf. */
export const PublicTeamSlugSchema = z.string().max(80).regex(PUBLIC_SLUG)
export const PublicTeamRouteParamsSchema = z
  .object({
    orgSlug: PublicTeamSlugSchema,
    teamSlug: PublicTeamSlugSchema,
  })
  .strict()

/** Ist der Pfad die oeffentliche Seite einer Mannschaft? */
export function isPublicTeamPagePath(path: string): boolean {
  return path.length <= 200 && PUBLIC_TEAM_PAGE.test(path)
}
