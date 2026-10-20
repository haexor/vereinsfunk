export interface KpiTrend {
  label: string
  good: boolean
  rising: boolean
}

// Trend einer Kennzahl gegenueber dem Vorzeitraum (Anteil, 0.1 = +10 %). Bei Durchlaufzeiten ist ein
// Rueckgang die gute Richtung (lowerIsBetter). 0 % gilt als gut, der Pfeil zeigt dann in die gute
// Richtung. Ohne Vorzeitraum (null) gibt es keinen Trend.
export function kpiTrend(trend: number | null | undefined, lowerIsBetter = false): KpiTrend | null {
  if (trend === undefined || trend === null) return null
  const percent = Math.round(trend * 100)
  const good = lowerIsBetter ? trend <= 0 : trend >= 0
  return { label: `${percent > 0 ? '+' : ''}${percent} %`, good, rising: lowerIsBetter ? !good : good }
}
