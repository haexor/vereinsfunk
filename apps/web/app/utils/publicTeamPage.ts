import {
  DepartmentPublicSlugSchema,
  OrganizationPublicSlugSchema,
  PublicTeamAddressSchema,
  TeamPublicSlugSchema,
} from '@vereinsfunk/contracts'

// Die oeffentliche Mannschaftsseite /mannschaft/{verein}/{abteilung}/{mannschaft} ist ohne
// Anmeldung erreichbar (ADR-014). Bewusst ein exaktes Muster statt eines Praefixes: genau drei
// nicht leere Segmente im Slug-Format mit den Laengengrenzen der API (Verein und Abteilung 200,
// Mannschaft 80), keine weiteren Segmente, kein abschliessender Schraegstrich -- jede andere Route
// unter /mannschaft bleibt hinter der Anmeldung.
const MAX_PATH_LENGTH = 512
const SEGMENT_SCHEMAS = [OrganizationPublicSlugSchema, DepartmentPublicSlugSchema, TeamPublicSlugSchema] as const

/** Validiert die Slugs der oeffentlichen Mannschaftsseite vor jedem API-Aufruf. */
export const PublicTeamRouteParamsSchema = PublicTeamAddressSchema.strict()

/** Segmente nach /mannschaft; null, wenn der Pfad nicht unter /mannschaft liegt oder zu lang ist. */
function segmentsBelowTeamRoot(path: string): string[] | null {
  if (path.length > MAX_PATH_LENGTH) return null
  const [empty, root, ...segments] = path.split('/')
  return empty === '' && root === 'mannschaft' ? segments : null
}

/** Ist der Pfad die oeffentliche Seite einer Mannschaft? */
export function isPublicTeamPagePath(path: string): boolean {
  const segments = segmentsBelowTeamRoot(path)
  return segments?.length === SEGMENT_SCHEMAS.length && segments.every((segment, index) => SEGMENT_SCHEMAS[index]!.safeParse(segment).success)
}

/**
 * Die fruehere zweiteilige Adresse /mannschaft/{verein}/{mannschaft}. Sie liefert nichts mehr aus
 * und leitet nicht um; die Middleware beantwortet sie fuer alle Besucher mit 404 statt mit der
 * Anmeldung.
 */
export function isLegacyPublicTeamPagePath(path: string): boolean {
  const segments = segmentsBelowTeamRoot(path)
  return segments?.length === 2 && OrganizationPublicSlugSchema.safeParse(segments[0]).success && TeamPublicSlugSchema.safeParse(segments[1]).success
}
