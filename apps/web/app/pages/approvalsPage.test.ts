import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Ohne Seiten-Mount nur im Quelltext festzuhalten, dieselbe Bauart wie consentPage.test.ts.
describe('Freigaben', () => {
  it('erklaert eine inzwischen invalidierte Freigabe und laedt die Liste neu', () => {
    const page = readFileSync(join(PAGES_DIR, 'freigaben.vue'), 'utf8')

    expect(page).toContain("error.code === 'approval_invalidated'")
    expect(page).toMatch(/approval_invalidated'\) \{\n\s+actionError\.value = '[^']+'\n\s+await load\(\)/)
  })
})
