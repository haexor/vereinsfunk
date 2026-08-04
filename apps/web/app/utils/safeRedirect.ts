// `startsWith('/')` allein reicht nicht: Browser normalisieren Rueckwaertsschraegstriche
// wie Vorwaertsschraegstriche, wodurch z. B. "/\evil.example" ausserhalb der eigenen
// Origin landet (CWE-601 Open Redirect). Deshalb ueber die echte URL-Origin pruefen.
export function resolveSafeRedirect(candidate: unknown, fallback = '/'): string {
  if (typeof candidate !== 'string' || !candidate) return fallback
  try {
    const resolved = new URL(candidate, window.location.origin)
    return resolved.origin === window.location.origin ? `${resolved.pathname}${resolved.search}${resolved.hash}` : fallback
  } catch {
    return fallback
  }
}
