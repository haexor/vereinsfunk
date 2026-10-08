// Paket 052, PR 4: Zeitraeume und Platzierungen der Rangliste, getrennt von den Seiten testbar.

// Eintrag der Ranglistenliste: intern mit Namen, oeffentlich nur mit "#7 M. K.".
export interface RankingListItem {
  key: string
  rank: number
  label: string
  total: number
  highlight?: boolean
  categories: readonly { name: string; points: number }[]
}

export type RankingPeriodKind = 'season' | 'month' | 'all' | 'custom'

export interface RankingRange {
  from?: string
  to?: string
}

/** Erster und letzter Tag eines Monats im Format YYYY-MM. */
export function monthRange(month: string): Required<RankingRange> {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

/**
 * Datumsgrenzen fuer GET .../ranking. "Saison" ohne Saisonbeginn faellt auf die gesamte Zeit
 * zurueck; ein freier Zeitraum gibt nur die gesetzten Grenzen weiter.
 */
export function rankingRange(kind: RankingPeriodKind, options: { seasonFrom: string | null; month: string; customFrom: string; customTo: string }): RankingRange {
  switch (kind) {
    case 'season': return options.seasonFrom ? { from: options.seasonFrom } : {}
    case 'month': return monthRange(options.month)
    case 'custom': return {
      ...(options.customFrom ? { from: options.customFrom } : {}),
      ...(options.customTo ? { to: options.customTo } : {}),
    }
    default: return {}
  }
}

/** Farbe des Platzierungsabzeichens: Gold, Silber, Bronze fuer geteilte Plaetze 1 bis 3. */
export function placementBadgeClass(rank: number): string {
  if (rank === 1) return 'bg-[#f5c542] text-[#4a3500]'
  if (rank === 2) return 'bg-[#cfd5dc] text-[#2c3640]'
  if (rank === 3) return 'bg-[#dfa16a] text-[#4a2608]'
  return 'bg-[#eef1ea] text-[#5b625d]'
}
