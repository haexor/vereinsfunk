import { contrastRatio } from '@vereinsfunk/domain'

const WHITE = '#ffffff'
const INK = '#14221d'
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export interface SidebarPalette {
  surface: string
  onSurface: string
  actionSurface: string
  onAction: string
}

function readableForeground(background: string) {
  return contrastRatio(WHITE, background) >= contrastRatio(INK, background) ? WHITE : INK
}

export function deriveSidebarPalette(primaryColor: string, accentColor: string): SidebarPalette {
  const primary = HEX_COLOR.test(primaryColor) ? primaryColor : INK
  const accent = HEX_COLOR.test(accentColor) ? accentColor : WHITE

  // Die Marke bestimmt die Flaechen. Die Textfarbe richtet sich jeweils nach der konkreten
  // Flaeche: auf einem hellen Blau ist dunkle Schrift lesbarer, auf einem dunklen Vereinsrot
  // weisse. Dasselbe gilt unabhaengig fuer die Akzentflaeche des CTA.
  return {
    surface: primary,
    onSurface: readableForeground(primary),
    actionSurface: accent,
    onAction: readableForeground(accent),
  }
}

export interface SidebarClasses {
  text: string
  muted: string
  quiet: string
  panel: string
  divider: string
  select: string
  nav: string
  activeNav: string
  footer: string
}

// Die Klassen stehen vollstaendig ausgeschrieben, damit Tailwind sie beim Scannen findet.
export function sidebarClassesFor(palette: SidebarPalette): SidebarClasses {
  return palette.onSurface === WHITE
    ? {
        text: 'text-white',
        muted: 'text-white',
        quiet: 'text-white',
        panel: 'border-white/30 bg-white/[.06]',
        divider: 'bg-white/30',
        select: 'text-white [&_svg]:text-white',
        nav: 'text-white hover:bg-white/[.07]',
        activeNav: '!bg-white/[.11] !text-white',
        footer: 'border-white/30',
      }
    : {
        text: 'text-ink',
        muted: 'text-ink',
        quiet: 'text-ink',
        panel: 'border-ink/30 bg-ink/[.05]',
        divider: 'bg-ink/30',
        select: 'text-ink [&_svg]:text-ink',
        nav: 'text-ink hover:bg-ink/[.07]',
        activeNav: '!bg-ink/[.11] !text-ink',
        footer: 'border-ink/30',
      }
}
