import type { ImageStyleFilter } from '@vereinsfunk/contracts'

export interface ImageStyleFilterOption {
  value: ImageStyleFilter
  label: string
  description: string
  group: 'Basis' | 'G’MIC'
  /** A fast browser approximation for the editor preview and export. */
  cssFilter: string
}

// Der vollständige Katalog bleibt an einer Stelle: Die endgültigen G'MIC-Effekte werden bei
// Bildstil-Presets serverseitig gerendert. Im lokalen Upload-Editor ist dies die bestmögliche,
// sofort sichtbare Canvas-Näherung, damit der Upload nicht zuerst in einen öffentlichen Dienst
// gegeben werden muss.
export const IMAGE_STYLE_FILTER_OPTIONS: ImageStyleFilterOption[] = [
  ['original', 'Original', 'Unbearbeitet', 'Basis', ''],
  ['schwarz_weiss', 'Schwarz-Weiß', 'Klar & zeitlos', 'Basis', 'grayscale(1)'],
  ['kontrastreich', 'Kontrast', 'Mehr Energie', 'Basis', 'contrast(1.35) saturate(1.12)'],
  ['warm', 'Warm', 'Sanfte Töne', 'Basis', 'sepia(.28) saturate(1.12)'],
  ['vereinsfarben_duoton', 'Duoton', 'In Vereinsfarben', 'Basis', 'grayscale(1) sepia(.7) hue-rotate(105deg) saturate(1.7)'],
  ['comic', 'Comic', 'Pop-Art & Raster', 'Basis', 'contrast(1.55) saturate(1.55)'],
  ['konfetti', 'Konfetti', 'Jubel aufs Bild', 'Basis', 'saturate(1.2)'],
  ['gmic_vintage', 'Vintage', 'Analogfoto', 'G’MIC', 'sepia(.55) contrast(.86) saturate(.78)'],
  ['gmic_poster', 'Hope Poster', 'Schablonendruck', 'G’MIC', 'contrast(1.7) saturate(1.65)'],
  ['gmic_brushify', 'Brushify', 'Pinselstruktur', 'G’MIC', 'contrast(1.25) saturate(.85)'],
  ['gmic_cartoon', 'Cartoon', 'Illustrierte Flächen', 'G’MIC', 'contrast(1.45) saturate(1.45)'],
  ['gmic_color_ellipses', 'Farbellipsen', 'Abstrakte Formen', 'G’MIC', 'saturate(1.8) hue-rotate(18deg)'],
  ['gmic_cubism', 'Kubismus', 'Geometrische Flächen', 'G’MIC', 'contrast(1.35) saturate(1.25)'],
  ['gmic_ellipsionism', 'Ellipsionismus', 'Punktmalerei', 'G’MIC', 'saturate(1.45) contrast(1.16)'],
  ['gmic_fire_edges', 'Feuerkanten', 'Leuchtende Konturen', 'G’MIC', 'contrast(1.7) saturate(1.8) hue-rotate(-18deg)'],
  ['gmic_fractalize', 'Fraktal', 'Organische Struktur', 'G’MIC', 'saturate(1.55) hue-rotate(35deg)'],
  ['gmic_glow', 'Glow', 'Weiches Leuchten', 'G’MIC', 'brightness(1.14) contrast(.9) saturate(1.25)'],
  ['gmic_halftone', 'Halbton', 'Druckraster', 'G’MIC', 'grayscale(1) contrast(1.4)'],
  ['gmic_hardsketchbw', 'Harte Skizze', 'Kräftiges Schwarzweiß', 'G’MIC', 'grayscale(1) contrast(2) brightness(1.1)'],
  ['gmic_hearts', 'Herzen', 'Dekoratives Muster', 'G’MIC', 'sepia(.24) saturate(1.45)'],
  ['gmic_houghsketchbw', 'Linien-Skizze', 'Technische Konturen', 'G’MIC', 'grayscale(1) contrast(1.75)'],
  ['gmic_lightrays', 'Lichtstrahlen', 'Sonnenstrahlen', 'G’MIC', 'brightness(1.2) saturate(1.3)'],
  ['gmic_light_relief', 'Relief', 'Plastische Kanten', 'G’MIC', 'grayscale(.65) contrast(1.55)'],
  ['gmic_linify', 'Linien', 'Grafische Zeichnung', 'G’MIC', 'grayscale(1) contrast(1.55)'],
  ['gmic_mosaic', 'Mosaik', 'Farbflächen', 'G’MIC', 'saturate(1.6) contrast(1.25)'],
  ['gmic_pencilbw', 'Bleistift', 'Feine Skizze', 'G’MIC', 'grayscale(1) contrast(1.22) brightness(1.18)'],
  ['gmic_pixelsort', 'Pixelsort', 'Digitale Streifen', 'G’MIC', 'saturate(1.7) contrast(1.28) hue-rotate(20deg)'],
  ['gmic_polaroid', 'Polaroid', 'Sofortbildlook', 'G’MIC', 'sepia(.16) contrast(.92) saturate(.86) brightness(1.08)'],
  ['gmic_polygonize', 'Polygone', 'Facetten', 'G’MIC', 'contrast(1.4) saturate(1.38)'],
  ['gmic_poster_edges', 'Poster-Kanten', 'Grafische Ränder', 'G’MIC', 'contrast(1.85) saturate(1.15)'],
  ['gmic_rodilius', 'Rodilius', 'Fraktale Linien', 'G’MIC', 'saturate(1.45) contrast(1.4)'],
  ['gmic_sketchbw', 'Skizze', 'Handgezeichnet', 'G’MIC', 'grayscale(1) contrast(1.35) brightness(1.12)'],
  ['gmic_sponge', 'Schwamm', 'Körnige Textur', 'G’MIC', 'saturate(1.3) contrast(1.2)'],
  ['gmic_stained_glass', 'Buntglas', 'Glasfragmente', 'G’MIC', 'saturate(1.85) contrast(1.55)'],
  ['gmic_stars', 'Sterne', 'Lichtpunkte', 'G’MIC', 'brightness(1.12) saturate(1.4)'],
  ['gmic_stencil', 'Schablone', 'Zweifarbige Flächen', 'G’MIC', 'grayscale(1) contrast(1.85) sepia(.22)'],
  ['gmic_stencilbw', 'Schablone SW', 'Harter Kontrast', 'G’MIC', 'grayscale(1) contrast(2.25)'],
  ['gmic_tetris', 'Tetris', 'Blockmuster', 'G’MIC', 'saturate(1.85) contrast(1.5) hue-rotate(12deg)'],
  ['gmic_warhol', 'Warhol', 'Pop-Art-Raster', 'G’MIC', 'saturate(2) contrast(1.4) hue-rotate(42deg)'],
  ['gmic_weave', 'Gewebe', 'Geflochtene Struktur', 'G’MIC', 'sepia(.22) saturate(.82) contrast(1.2)'],
  ['gmic_whirls', 'Wirbel', 'Dynamische Drehung', 'G’MIC', 'saturate(1.7) hue-rotate(70deg)'],
].map(([value, label = '', description = '', group, cssFilter = '']) => ({
  value: value as ImageStyleFilter,
  label,
  description,
  group: group as 'Basis' | 'G’MIC',
  cssFilter,
}))

export function cssFilterForImageStyle(filter: ImageStyleFilter): string {
  return IMAGE_STYLE_FILTER_OPTIONS.find((option) => option.value === filter)?.cssFilter ?? ''
}
