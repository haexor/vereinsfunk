// v-model auf <input type="number"> liefert eine Zahl, ein geleertes Feld aber ''. Ein als ''
// initialisierter Formularzustand ist zur Laufzeit also string | number -- .trim() darauf wirft.
export function optionalNumber(value: string | number): number | null {
  return typeof value === 'number' ? value : value.trim() === '' ? null : Number(value)
}
