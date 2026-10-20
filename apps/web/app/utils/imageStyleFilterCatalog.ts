import type { ImageStyleFilter } from '@vereinsfunk/contracts'

export interface ImageStyleFilterOption {
  value: ImageStyleFilter
  label: string
  description: string
  group: 'Basis' | 'G’MIC'
}

// Der vollständige Katalog bleibt an einer Stelle: Die G'MIC-Effekte selbst rendert der Server,
// die Werkstatt (PhotoImageWorkshop.vue) waehlt hier nur Wert, Beschriftung und Gruppe aus.
export const IMAGE_STYLE_FILTER_OPTIONS: ImageStyleFilterOption[] = [
  ['original', 'Original', 'Unbearbeitet', 'Basis'],
  ['schwarz_weiss', 'Schwarz-Weiß', 'Klar & zeitlos', 'Basis'],
  ['kontrastreich', 'Kontrast', 'Mehr Energie', 'Basis'],
  ['warm', 'Warm', 'Sanfte Töne', 'Basis'],
  ['vereinsfarben_duoton', 'Duoton', 'In Vereinsfarben', 'Basis'],
  ['comic', 'Comic', 'Pop-Art & Raster', 'Basis'],
  ['konfetti', 'Konfetti', 'Jubel aufs Bild', 'Basis'],
  ['gmic_vintage', 'Vintage', 'Analogfoto', 'G’MIC'],
  // Das Hope-Rezept laeuft serverseitig ueber G’MIC und mischt den weicheren Poster-Look mit dem
  // Original, statt das Foto hart zu quantisieren.
  ['gmic_poster', 'Hope Poster', 'Schablonendruck', 'G’MIC'],
  ['gmic_brushify', 'Brushify', 'Pinselstruktur', 'G’MIC'],
  ['gmic_cartoon', 'Cartoon', 'Illustrierte Flächen', 'G’MIC'],
  ['gmic_color_ellipses', 'Farbellipsen', 'Abstrakte Formen', 'G’MIC'],
  ['gmic_cubism', 'Kubismus', 'Geometrische Flächen', 'G’MIC'],
  ['gmic_ellipsionism', 'Ellipsionismus', 'Punktmalerei', 'G’MIC'],
  ['gmic_fire_edges', 'Feuerkanten', 'Leuchtende Konturen', 'G’MIC'],
  ['gmic_fractalize', 'Fraktal', 'Organische Struktur', 'G’MIC'],
  ['gmic_glow', 'Glow', 'Weiches Leuchten', 'G’MIC'],
  ['gmic_halftone', 'Halbton', 'Druckraster', 'G’MIC'],
  ['gmic_hardsketchbw', 'Harte Skizze', 'Kräftige Skizzenlinien über dem Original', 'G’MIC'],
  ['gmic_hearts', 'Herzen', 'Dekoratives Muster', 'G’MIC'],
  ['gmic_houghsketchbw', 'Linien-Skizze', 'Technische Konturen über dem Original', 'G’MIC'],
  ['gmic_lightrays', 'Lichtstrahlen', 'Sonnenstrahlen', 'G’MIC'],
  ['gmic_light_relief', 'Relief', 'Plastische Kanten', 'G’MIC'],
  ['gmic_linify', 'Linien', 'Grafische Zeichnung', 'G’MIC'],
  ['gmic_mosaic', 'Mosaik', 'Farbflächen', 'G’MIC'],
  ['gmic_pencilbw', 'Bleistift', 'Feine Skizze', 'G’MIC'],
  ['gmic_pixelsort', 'Pixelsort', 'Digitale Streifen', 'G’MIC'],
  ['gmic_polaroid', 'Polaroid', 'Sofortbildlook', 'G’MIC'],
  ['gmic_polygonize', 'Polygone', 'Facetten', 'G’MIC'],
  ['gmic_poster_edges', 'Poster-Kanten', 'Grafische Ränder', 'G’MIC'],
  ['gmic_rodilius', 'Rodilius', 'Fraktale Linien', 'G’MIC'],
  ['gmic_sketchbw', 'Skizze', 'Handgezeichnet über dem Original', 'G’MIC'],
  ['gmic_sponge', 'Schwamm', 'Körnige Textur', 'G’MIC'],
  ['gmic_stained_glass', 'Buntglas', 'Glasfragmente', 'G’MIC'],
  ['gmic_stars', 'Sterne', 'Lichtpunkte', 'G’MIC'],
  ['gmic_stencil', 'Schablone', 'Zweifarbige Flächen', 'G’MIC'],
  ['gmic_stencilbw', 'Schablone SW', 'Harter Kontrast', 'G’MIC'],
  ['gmic_tetris', 'Tetris', 'Blockmuster', 'G’MIC'],
  ['gmic_warhol', 'Warhol', 'Pop-Art-Raster', 'G’MIC'],
  ['gmic_weave', 'Gewebe', 'Geflochtene Struktur', 'G’MIC'],
  ['gmic_whirls', 'Wirbel', 'Dynamische Drehung', 'G’MIC'],
].map(([value, label = '', description = '', group]) => ({
  value: value as ImageStyleFilter,
  label,
  description,
  group: group as 'Basis' | 'G’MIC',
}))

