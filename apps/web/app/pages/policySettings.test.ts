import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Watcher-Reihenfolge der Richtlinienseite -- ohne Seiten-Mount nur im Quelltext festzuhalten,
// dieselbe Bauart wie targetPlatformDefaults.test.ts.
describe('Richtlinien', () => {
  it('behaelt ungespeicherte Aenderungen, wenn eine Pruefperson angelegt oder entfernt wird', () => {
    const page = readFileSync(join(PAGES_DIR, 'einstellungen/index.vue'), 'utf8')

    // addReviewer/removeReviewer rufen load(); der Watcher auf das Eintragsobjekt fuellte danach
    // den Entwurf neu und verwarf offene Aenderungen.
    expect(page).not.toContain('watch(selectedEntry, (entry) => { if (entry) loadDraftFrom(entry) }')
    expect(page).toContain('watch(() => (selectedEntry.value ? entryKey(selectedEntry.value) : null),')
    expect(page).toContain('if (entries.value !== entriesBeforeReload && selectedEntry.value) loadDraftFrom(selectedEntry.value)')
  })
})
