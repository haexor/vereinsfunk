export interface DetectedFixtureTitle {
  readonly homeName: string
  readonly awayName: string
  readonly homeScore?: number
  readonly awayScore?: number
}

// Ein Ergebnis steht immer am Ende, durch Leerraum vom Rest getrennt: "<Rest> 3:1" oder "<Rest> 3-1".
const SCORE_SUFFIX_PATTERN = /^(.*)\s+(\d{1,2})\s*[:-]\s*(\d{1,2})\s*$/

// Trenner nur bei Leerraum auf beiden Seiten -- ein Mannschaftsname mit Bindestrich ohne
// umgebende Leerzeichen (z. B. "SV Bad-Homburg") darf nicht als zwei Teile gelesen werden.
const SEPARATOR_PATTERN = /\s+(?:vs\.?|[-–—:])\s+/i

/**
 * Erkennt ein Spiel-Titelmuster in freiem Text (iCal-`summary`, keine strukturierten Felder).
 * Rein deterministisch, kein Modell (plans/019, "iCal fachlich lesen"): eine falsch gelesene
 * Ansetzung wird sonst zu einem falschen oeffentlichen Beitrag. Erkennt die Heuristik kein
 * Muster, ist der Titel Kandidat fuer eine allgemeine Veranstaltung statt eines Spiels.
 */
export function detectFixtureTitle(rawTitle: string): DetectedFixtureTitle | undefined {
  const trimmed = rawTitle.trim()
  if (trimmed.length === 0) return undefined

  const suffixMatch = trimmed.match(SCORE_SUFFIX_PATTERN)
  const remainder = suffixMatch ? (suffixMatch[1] ?? '').trim() : trimmed
  // Eine zweistellige Zahl mit fuehrender Null ("15:00", "09:30") schreibt kein Ergebnis, nur eine
  // Uhrzeit -- abtrennen, aber nie als 15:0 speichern. ponytail: "19:30" bleibt mehrdeutig
  // (Handball-Ergebnis oder Anstoss) und wird weiter als Ergebnis gelesen; eindeutig wird das erst
  // mit einem Abgleich gegen die Anstosszeit aus DTSTART.
  const isClockTime = suffixMatch !== null && [suffixMatch[2], suffixMatch[3]].some((part) => part !== undefined && part.length === 2 && part.startsWith('0'))
  const scoreMatch = isClockTime ? null : suffixMatch

  const parts = remainder.split(SEPARATOR_PATTERN)
  if (parts.length !== 2) return undefined
  const homeName = (parts[0] ?? '').trim()
  const awayName = (parts[1] ?? '').trim()
  if (homeName.length === 0 || awayName.length === 0) return undefined

  return {
    homeName,
    awayName,
    ...(scoreMatch ? { homeScore: Number(scoreMatch[2] ?? ''), awayScore: Number(scoreMatch[3] ?? '') } : {}),
  }
}
