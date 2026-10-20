/** Bis zu zwei Anfangsbuchstaben eines Namens fuer Avatar- und Bereichskacheln, z. B. "SV Musterstadt" -> "SM". */
export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
}
