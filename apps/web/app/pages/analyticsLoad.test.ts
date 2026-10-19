import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Reihenfolge eintreffender Antworten -- ohne Seiten-Mount nur im Quelltext festzuhalten, dieselbe
// Bauart wie targetPlatformDefaults.test.ts.
describe('Auswertung', () => {
  it('verwirft eine veraltete Gesamtladung und stimmt sie mit Metrik- und Dimensionswechseln ab', () => {
    const page = readFileSync(join(PAGES_DIR, 'auswertung.vue'), 'utf8')

    // Ohne Zaehler landete eine spaete 7-Tage-Antwort unter der 90-Tage-Ueberschrift.
    expect(page).toContain('const requestId = ++loadRequestId\n  const timeseriesRequest = ++timeseriesRequestId\n  const breakdownRequest = ++breakdownRequestId')
    expect(page).toContain('if (requestId !== loadRequestId) return\n    summary.value =')
    expect(page).toContain('if (timeseriesRequest === timeseriesRequestId) {')
    expect(page).toContain('if (breakdownRequest === breakdownRequestId) {')
    expect(page).toContain("if (requestId === loadRequestId) errorMessage.value = 'Die Kennzahlen konnten nicht geladen werden.'")
    expect(page).toContain('if (requestId === loadRequestId) loading.value = false')
    // Die Zaehler muessen vor dem ersten load()-Aufruf deklariert sein (sonst TDZ-Fehler).
    expect(page.indexOf('let breakdownRequestId = 0')).toBeLessThan(page.indexOf('await load()'))
  })
})
