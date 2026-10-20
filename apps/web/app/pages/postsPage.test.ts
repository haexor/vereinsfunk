import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Ladereihenfolge der Beitragsliste -- ohne Seiten-Mount nur im Quelltext festzuhalten, dieselbe
// Bauart wie targetPlatformDefaults.test.ts.
describe('Beitraege', () => {
  it('laedt Beitraege, Entwuerfe und Medien bei einem Bereichswechsel gemeinsam neu', () => {
    const page = readFileSync(join(PAGES_DIR, 'beitraege.vue'), 'utf8')

    // Vorher nur einmal beim Setup geladen; "Nur meine" lud danach Medien des neuen Bereichs
    // neben Beitraegen des alten.
    expect(page).not.toContain('if (scope.value?.organizationId) {\n  const query')
    expect(page).toContain('useScopedLoad(() => `${activeOrganizationId.value}:${activeDepartmentId.value}`')
    expect(page).toContain('if (!isLatest()) return\n  await loadMedia()')
    // Eine noch laufende Medien-Anfrage des vorigen Bereichs darf nicht mehr schreiben.
    expect(page).toContain('mediaRuns.begin()\n  posts.value = []')
    expect(page).toContain('if (isLatest()) mediaAssets.value = assets')
  })
})
