import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Reihenfolge eintreffender Antworten -- ohne Seiten-Mount nur im Quelltext festzuhalten, dieselbe
// Bauart wie targetPlatformDefaults.test.ts.
describe('Auswertung', () => {
  it('verwirft eine veraltete Gesamtladung und stimmt sie mit Metrik- und Dimensionswechseln ab', () => {
    const page = readFileSync(join(PAGES_DIR, 'auswertung.vue'), 'utf8')

    // Ohne Laufpruefung landete eine spaete 7-Tage-Antwort unter der 90-Tage-Ueberschrift.
    expect(page).toContain('const isLatestTimeseries = timeseriesRuns.begin()\n    const isLatestBreakdown = breakdownRuns.begin()')
    expect(page).toContain('if (!isLatest()) return\n      summary.value =')
    expect(page).toContain('if (isLatestTimeseries()) {')
    expect(page).toContain('if (isLatestBreakdown()) {')
    expect(page).toContain("if (isLatest()) errorMessage.value = 'Die Kennzahlen konnten nicht geladen werden.'")
    expect(page).toContain('if (isLatest()) loading.value = false')
    // Die Laufzaehler muessen vor dem ersten Ladelauf existieren (sonst TDZ-Fehler).
    expect(page.indexOf('const breakdownRuns = useLatestRequest()')).toBeLessThan(page.indexOf('useScopedLoad('))
  })
})
