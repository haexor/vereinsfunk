import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Formular- und Ladezustand der Einwilligungsseite -- ohne Seiten-Mount nur im Quelltext
// festzuhalten, dieselbe Bauart wie targetPlatformDefaults.test.ts.
describe('Einwilligungen', () => {
  it('leert das Datei-Feld nach dem Hinterlegen einer Papiererklaerung', () => {
    const page = readFileSync(join(PAGES_DIR, 'einwilligungen.vue'), 'utf8')

    expect(page).toContain('registerForm.file = null; registerFileInputKey.value += 1')
    expect(page).toContain('<input :key="registerFileInputKey" type="file" required')
  })

  it('laesst eine veraltete Ladung auch im Fehlerfall nichts mehr schreiben', () => {
    const page = readFileSync(join(PAGES_DIR, 'einwilligungen.vue'), 'utf8')

    // Vorher war nur der Erfolgsweg geschuetzt; eine aeltere, scheiternde Anfrage setzte die
    // Fehlermeldung ueber frische Daten.
    expect(page).toContain('useScopedLoad(')
    expect(page).toContain("if (isLatest()) errorMessage.value = 'Die Einwilligungen konnten nicht geladen werden.'")
    expect(page).toContain('if (isLatest()) loading.value = false')
  })

  it('setzt das Eingangsdatum einer Betroffenenanfrage auf den heutigen Tag in der Vereinszeitzone', () => {
    const page = readFileSync(join(PAGES_DIR, 'datenschutz/anfragen.vue'), 'utf8')

    // toISOString() ist UTC: zwischen 0 und 2 Uhr deutscher Zeit stand dort der Vortag.
    expect(page).not.toContain('new Date().toISOString().slice(0, 10)')
    expect(page).toContain('receivedAt: localDateKey(new Date(), organizationTimezone.value),')
  })
})
