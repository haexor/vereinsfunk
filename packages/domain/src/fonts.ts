// Kuratierte Font-Registry (Plan 013, "Kuratierte Font-Registry"). Jeder Eintrag wird als Datei
// im Repository mitgeliefert und selbst ausgeliefert (packages/config/apps/web) statt von einem
// CDN geladen -- Grund ist die IP-Uebertragung an Google Fonts, ein bekanntes Datenschutzrisiko
// fuer Vereinsseiten in Deutschland. Bewusst klein gehalten (zwei statt der empfohlenen drei bis
// vier Paare): das Vendern realer, lizenzgeprueften Schriftdateien ist der teure Teil, nicht der
// Code. Ein drittes Paar zu ergaenzen ist reine Datenpflege -- neue Dateien plus ein Registry-
// Eintrag, keine Codeaenderung.
export interface CuratedFont {
  key: string
  family: string
  role: 'display' | 'body'
  weights: readonly number[]
  license: 'ofl'
  selfHostedPath: string
}

export const curatedFonts: readonly CuratedFont[] = [
  { key: 'manrope', family: 'Manrope', role: 'display', weights: [600, 700, 800], license: 'ofl', selfHostedPath: '/fonts/manrope/manrope.css' },
  { key: 'dm_sans', family: 'DM Sans', role: 'body', weights: [400, 500, 600, 700], license: 'ofl', selfHostedPath: '/fonts/dm-sans/dm-sans.css' },
  { key: 'space_grotesk', family: 'Space Grotesk', role: 'display', weights: [600, 700], license: 'ofl', selfHostedPath: '/fonts/space-grotesk/space-grotesk.css' },
  { key: 'karla', family: 'Karla', role: 'body', weights: [400, 700], license: 'ofl', selfHostedPath: '/fonts/karla/karla.css' },
]

export function findCuratedFont(key: string): CuratedFont | undefined {
  return curatedFonts.find((font) => font.key === key)
}

export interface CuratedFontPairing {
  key: string
  displayFontKey: string
  bodyFontKey: string
  label: string
}

export const curatedFontPairings: readonly CuratedFontPairing[] = [
  { key: 'manrope_dm_sans', displayFontKey: 'manrope', bodyFontKey: 'dm_sans', label: 'Manrope / DM Sans' },
  { key: 'space_grotesk_karla', displayFontKey: 'space_grotesk', bodyFontKey: 'karla', label: 'Space Grotesk / Karla' },
]
